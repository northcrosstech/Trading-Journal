"""
Build the shared demo account: a login filled with made-up but realistic data, so someone
can try every part of the app without connecting a broker.

    python demo_account.py            # create the demo account (fails if it exists)
    python demo_account.py --replace  # delete the demo account and build it again

Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, TWELVEDATA_API_KEY,
DEMO_EMAIL and DEMO_PASSWORD in the environment.

Everything is dated relative to today, and prices are the real daily closes from Twelve Data
(about 20 of the 800 free lookups), so charts and values look right on any day:
  Wealth  -- four portfolios from the first of the month six months ago (taxable brokerage,
             physical gold, Roth IRA, 401(k) with a manual-price fund), monthly deposits,
             dividends, a covered call and cash-secured puts, a position plan, mix targets,
             theses and a watchlist; net worth balances and payments for every month up to
             last month, months closed up to the one before last (last month is left to
             close in the demo), and a daily value for every trading day.
  Trading -- about three months of day trades (stocks and options) with fills, setups,
             reviews, emotions, daily journal, plans, rules and missed trades.

Portfolio entries go through the same database functions the app uses, signed in as the
demo user, so the ledger and the Health check agree. Only the daily values, real prices and
the creation dates are written with the service key, as the worker would.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from supabase import create_client

SYMBOLS = ["VOO", "SCHD", "MSFT", "AAPL", "NVDA", "GOOGL", "JNJ", "O", "VTI", "VXUS", "QQQ", "BND",
           "XAU/USD", "SPY", "TSLA", "AMD", "META", "AMZN"]
FUND = "TDF2055"  # a 401(k) target-date fund with no public ticker: manual price
rng = random.Random(20261122)


# ---------------------------------------------------------------------------
# Dates and prices
# ---------------------------------------------------------------------------


def month_start(d: date, back: int = 0) -> date:
    y, m = d.year, d.month - back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def next_month(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def third_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(4 - d.weekday()) % 7)
    return d + timedelta(days=14)


def et_offset(d: date) -> int:
    """Hours to add to New York time for UTC (DST: 2nd Sunday of March to 1st Sunday of November)."""
    march = date(d.year, 3, 1)
    dst_start = march + timedelta(days=(6 - march.weekday()) % 7 + 7)
    nov = date(d.year, 11, 1)
    dst_end = nov + timedelta(days=(6 - nov.weekday()) % 7)
    return 4 if dst_start <= d < dst_end else 5


def utc_iso(d: date, hour: int, minute: int, second: int = 0) -> str:
    t = datetime(d.year, d.month, d.day, hour, minute, second) + timedelta(hours=et_offset(d))
    return t.replace(tzinfo=timezone.utc).isoformat()


def fetch_history(api_key: str, start: date, end: date) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for i in range(0, len(SYMBOLS), 8):
        if i:
            time.sleep(62)  # free plan: 8 lookups a minute
        batch = SYMBOLS[i : i + 8]
        q = urllib.parse.urlencode({"symbol": ",".join(batch), "interval": "1day", "start_date": start.isoformat(),
                                    "end_date": end.isoformat(), "apikey": api_key, "outputsize": 5000})
        with urllib.request.urlopen(f"https://api.twelvedata.com/time_series?{q}", timeout=60) as r:
            body = json.loads(r.read().decode())
        per = {batch[0]: body} if len(batch) == 1 else body
        for s in batch:
            item = per.get(s) or {}
            if item.get("status") != "ok":
                raise SystemExit(f"No price history for {s}: {item.get('message')}")
            out[s] = sorted(
                ({"d": v["datetime"][:10], "o": float(v["open"]), "h": float(v["high"]), "l": float(v["low"]), "c": float(v["close"])}
                 for v in item["values"]),
                key=lambda r: r["d"],
            )
    out["GOLD"] = out.pop("XAU/USD")
    return out


class Prices:
    def __init__(self, history: dict[str, list[dict]]):
        self.bars = {s: {date.fromisoformat(r["d"]): r for r in rows} for s, rows in history.items()}
        self.days = sorted(self.bars["SPY"])  # US trading days
        self.fund_base: float | None = None

    def bar(self, sym: str, d: date) -> dict:
        rows = self.bars[sym]
        while d not in rows:
            d -= timedelta(days=1)
        return rows[d]

    def close(self, sym: str, d: date) -> float:
        if sym == FUND:
            return self.fund(d)
        return self.bar(sym, d)["c"]

    def fund(self, d: date) -> float:
        """The 401(k) fund moves with 80% of the total market."""
        base = self.close("VTI", self.days[0])
        return round(48.60 * (1 + 0.8 * (self.close("VTI", d) / base - 1)), 2)

    def trading_on_or_after(self, d: date) -> date:
        return next(x for x in self.days if x >= d)


# ---------------------------------------------------------------------------
# Wealth
# ---------------------------------------------------------------------------

# Per payment, how often, and the first pay month of the cycle (illustrative amounts).
DIVIDENDS = {
    "VOO": (1.78, "quarterly", 3), "SCHD": (0.26, "quarterly", 3), "MSFT": (0.91, "quarterly", 3),
    "AAPL": (0.26, "quarterly", 2), "JNJ": (1.30, "quarterly", 3), "GOOGL": (0.21, "quarterly", 3),
    "O": (0.27, "monthly", None), "VTI": (0.95, "quarterly", 3), "VXUS": (0.80, "quarterly", 3),
    "QQQ": (0.72, "quarterly", 3), "BND": (0.23, "monthly", None),
}
PER_YEAR = {"monthly": 12, "quarterly": 4}


def pays_in(sym: str, month: int) -> bool:
    _, freq, first = DIVIDENDS[sym]
    return freq == "monthly" or (month - first) % 3 == 0


def seed_wealth(uc, admin, uid: str, px: Prices, today: date) -> dict:
    start = month_start(today, 6)
    d0 = px.trading_on_or_after(start)
    last_day = px.days[-1]
    months = []
    m = start
    while m < month_start(today):
        months.append(m)
        m = next_month(m)

    def rpc(name: str, args: dict):
        return uc.rpc(name, args).execute().data

    def new_portfolio(name: str, kind: str) -> str:
        row = uc.table("portfolios").insert({"user_id": uid, "name": name, "kind": kind}).execute().data[0]
        admin.table("portfolios").update({"created_at": f"{d0.isoformat()}T15:00:00+00:00"}).eq("id", row["id"]).execute()
        return row["id"]

    T = new_portfolio("Taxable brokerage", "brokerage")
    M = new_portfolio("Physical gold", "brokerage")
    R = new_portfolio("Roth IRA", "roth_ira")
    K = new_portfolio("401(k)", "401k")

    held: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    def buy(p: str, sym: str, qty: float, d: date, price: float | None = None, from_cash: bool = True, market: float | None = None):
        price = round(price if price is not None else px.close(sym, d), 2)
        args = {"p_portfolio": p, "p_symbol": sym, "p_quantity": qty, "p_price": price, "p_from_cash": from_cash, "p_on": d.isoformat()}
        if market is not None:
            args["p_market_price"] = round(market, 2)
        rpc("portfolio_buy", args)
        held[p][sym] += qty

    def buy_dollars(p: str, sym: str, dollars: float, d: date):
        qty = math.floor(dollars / px.close(sym, d))
        if qty > 0:
            buy(p, sym, qty, d)

    def cash(p: str, kind: str, amount: float, d: date, sym: str | None = None):
        rpc("portfolio_cash", {"p_portfolio": p, "p_kind": kind, "p_amount": round(amount, 2), "p_symbol": sym, "p_on": d.isoformat()})

    # Opening positions.
    cash(T, "deposit", 80000, d0)
    for sym, dollars in [("VOO", 14000), ("SCHD", 7000), ("MSFT", 7000), ("NVDA", 6000), ("GOOGL", 5000), ("JNJ", 3500), ("O", 4000)]:
        buy_dollars(T, sym, dollars, d0)
    buy(T, "AAPL", 100, d0)
    buy(M, "GOLD", 2, d0, price=2385.00, from_cash=False, market=px.close("GOLD", d0))
    cash(R, "deposit", 30000, d0)
    for sym, dollars in [("VTI", 15000), ("VXUS", 6000), ("QQQ", 6000), ("BND", 2500)]:
        buy_dollars(R, sym, dollars, d0)
    cash(K, "deposit", 92000, d0)
    buy(K, FUND, math.floor(92000 / px.fund(d0)), d0)

    # Month by month: contributions, dividends, one trim, more gold, options.
    events: list[tuple[date, int, callable]] = []
    month_list = months + [month_start(today)]
    for i, m in enumerate(month_list):
        first = px.trading_on_or_after(m)
        if first > last_day:
            continue
        if i > 0:
            def contribute(first=first):
                cash(T, "deposit", 1000, first)
                buy_dollars(T, "VOO", 600, first)
                buy_dollars(T, "SCHD", 400, first)
                cash(R, "deposit", 583, first)
                buy_dollars(R, "VTI", 560, first)
                cash(K, "deposit", 1850, first)
                buy_dollars(K, FUND, 1850, first)
            events.append((first, 0, contribute))
        pay = px.trading_on_or_after(m + timedelta(days=14))
        if pay <= last_day:
            def dividends(pay=pay, month=m.month):
                for p in (T, R):
                    for sym, qty in list(held[p].items()):
                        if sym in DIVIDENDS and qty > 0 and pays_in(sym, month):
                            cash(p, "dividend", qty * DIVIDENDS[sym][0], pay, sym)
            events.append((pay, 1, dividends))

    trim_day = px.trading_on_or_after(month_list[3] + timedelta(days=9))
    events.append((trim_day, 2, lambda: (
        rpc("portfolio_sell", {"p_portfolio": T, "p_symbol": "NVDA", "p_quantity": math.floor(held[T]["NVDA"] / 4),
                               "p_price": round(px.close("NVDA", trim_day), 2), "p_to_cash": True, "p_on": trim_day.isoformat()}),
        held[T].__setitem__("NVDA", held[T]["NVDA"] - math.floor(held[T]["NVDA"] / 4)),
    )))

    gold_day = px.trading_on_or_after(month_list[4] + timedelta(days=12))
    def more_gold():
        price = round(px.close("GOLD", gold_day) * 1.04, 2)  # dealer premium
        cash(M, "deposit", price, gold_day)
        buy(M, "GOLD", 1, gold_day, price=price)
    events.append((gold_day, 2, more_gold))

    # A covered call that expired, one still open; a put that expired, one still open.
    cc1_day = px.trading_on_or_after(month_list[3] + timedelta(days=1))
    cc1_exp = third_friday(next_month(cc1_day).year, next_month(cc1_day).month)
    cc1_strike = math.ceil(px.close("AAPL", cc1_day) * 1.08 / 5) * 5
    put1_day = px.trading_on_or_after(month_list[2] + timedelta(days=20))
    put1_exp = third_friday(next_month(put1_day).year, next_month(put1_day).month)
    put1_strike = math.floor(px.close("O", put1_day) * 0.94)
    cc2_day = px.days[-14]
    cc2_exp = third_friday(next_month(today).year, next_month(today).month)
    cc2_strike = math.ceil(px.close("AAPL", cc2_day) * 1.07 / 5) * 5
    put2_day = px.days[-9]
    put2_strike = math.floor(px.close("O", put2_day) * 0.95)

    def opt_open(d, strike, exp, price):
        return rpc("option_open", {"p_portfolio": T, "p_symbol": "AAPL", "p_option_type": "call", "p_side": "short", "p_strike": strike,
                                   "p_expiration": exp.isoformat(), "p_contracts": 1, "p_price": price, "p_is_hedge": False, "p_on": d.isoformat()})

    def csp(d, strike, exp, premium):
        return rpc("csp_open", {"p_portfolio": T, "p_symbol": "O", "p_strike": strike, "p_expiration": exp.isoformat(),
                                "p_contracts": 1, "p_premium": premium, "p_on": d.isoformat()})

    state: dict[str, str] = {}
    events.append((cc1_day, 3, lambda: state.__setitem__("cc1", opt_open(cc1_day, cc1_strike, cc1_exp, 2.15))))
    if cc1_exp <= last_day:
        events.append((cc1_exp, 4, lambda: rpc("option_close", {"p_option": state["cc1"], "p_outcome": "expired", "p_price": None, "p_on": cc1_exp.isoformat()})))
    events.append((put1_day, 3, lambda: state.__setitem__("put1", csp(put1_day, put1_strike, put1_exp, 0.85))))
    if put1_exp <= last_day:
        events.append((put1_exp, 4, lambda: rpc("csp_resolve", {"p_csp": state["put1"], "p_outcome": "expired", "p_price": None, "p_on": put1_exp.isoformat()})))
    events.append((cc2_day, 3, lambda: opt_open(cc2_day, cc2_strike, cc2_exp, 2.40)))
    events.append((put2_day, 3, lambda: csp(put2_day, put2_strike, cc2_exp, 0.70)))

    for _, _, fn in sorted(events, key=lambda e: (e[0], e[1])):
        fn()

    # Settings, plan, targets, notes.
    uc.table("holdings").update({"manual_price": px.fund(last_day)}).eq("portfolio_id", K).eq("symbol", FUND).execute()
    uc.table("portfolios").update({"target_pct": 85}).eq("id", T).execute()
    uc.table("portfolios").update({"target_pct": 15}).eq("id", M).execute()
    uc.table("portfolios").update({"notes": "Core index funds first; rebalance when a fund drifts more than 5 points."}).eq("id", R).execute()
    rpc("set_position_plan", {"p_portfolio": R, "p_targets": [{"symbol": "VTI", "pct": 50}, {"symbol": "VXUS", "pct": 20},
                                                              {"symbol": "QQQ", "pct": 20}, {"symbol": "BND", "pct": 10}]})
    uc.table("allocation_targets").upsert([
        {"user_id": uid, "scope": "brokerage", "etf": 45, "stock": 45, "bond": 0, "option": 0, "cash": 10},
        {"user_id": uid, "scope": K, "etf": 100, "stock": 0, "bond": 0, "option": 0, "cash": 0},
    ]).execute()
    uc.table("ticker_types").upsert([{"user_id": uid, "symbol": FUND, "asset_type": "etf"}]).execute()
    uc.table("dividend_info").upsert([
        {"user_id": uid, "symbol": s, "annual_per_share": round(per * PER_YEAR[freq], 2), "frequency": freq, "pay_month": first}
        for s, (per, freq, first) in DIVIDENDS.items()
    ]).execute()
    review = (today + timedelta(days=21)).isoformat()
    uc.table("ticker_theses").upsert([
        {"user_id": uid, "symbol": "NVDA", "thesis": "AI data-centre spending keeps growing for at least two more years. Trim when it passes 12% of the account.", "review_on": review},
        {"user_id": uid, "symbol": "SCHD", "thesis": "Steady, growing dividend income. Keep adding monthly; review if the dividend is cut.", "review_on": None},
        {"user_id": uid, "symbol": "GOLD", "thesis": "Insurance, not a bet: 10-15% of brokerage money in physical coins.", "review_on": None},
    ]).execute()
    uc.table("research_watchlist").insert([{"user_id": uid, "symbol": s} for s in ("AMZN", "META")]).execute()
    uc.table("freedom_settings").upsert({"user_id": uid, "monthly_spending": 6200}).execute()

    return {"portfolios": [T, M, R, K], "start": start, "d0": d0, "months": months}


def write_daily_values(admin, uid: str, px: Prices, portfolios: list[str], d0: date):
    acts = admin.table("portfolio_activity").select("*").eq("user_id", uid).is_("voided_at", "null").order("occurred_on").order("created_at").execute().data
    opts = admin.table("option_positions").select("*").eq("user_id", uid).execute().data
    csps = admin.table("csp_positions").select("*").eq("user_id", uid).execute().data
    rows = []
    for p in portfolios:
        mine = [a for a in acts if a["portfolio_id"] == p]
        prev = None
        for d in [x for x in px.days if x >= d0]:
            qty: dict[str, float] = defaultdict(float)
            avg: dict[str, float] = defaultdict(float)
            cash = flow = 0.0
            for a in mine:
                on = date.fromisoformat(a["occurred_on"])
                if on > d:
                    break
                cash += float(a["cash_change"])
                if prev is None or on > prev:
                    flow += float(a["external_flow"])
                s, q = a["symbol"], float(a["quantity"] or 0)
                if a["kind"] in ("buy", "transfer_in"):
                    avg[s] = (avg[s] * qty[s] + float(a["price"]) * q) / (qty[s] + q)
                    qty[s] += q
                elif a["kind"] in ("sell", "transfer_out"):
                    qty[s] -= q
            holdings_value = sum(q * px.close(s, d) for s, q in qty.items() if q > 0)
            cost = sum(q * avg[s] for s, q in qty.items() if q > 0)

            def is_open(o) -> bool:
                opened = date.fromisoformat(o["opened_on"])
                closed = date.fromisoformat(o["closed_on"]) if o.get("closed_on") else None
                return opened <= d and (closed is None or d < closed)

            liability = sum(max(0.0, float(c["strike"]) - px.close(c["symbol"], d)) * 100 * c["contracts"]
                            for c in csps if c["portfolio_id"] == p and is_open(c))
            options = -sum(max(0.0, px.close(o["symbol"], d) - float(o["strike"])) * 100 * o["contracts"]
                           for o in opts if o["portfolio_id"] == p and o["side"] == "short" and is_open(o))
            rows.append({"portfolio_id": p, "user_id": uid, "value_date": d.isoformat(), "holdings_value": round(holdings_value, 2),
                         "cash": round(cash, 2), "csp_liability": round(liability, 2), "options_value": round(options, 2),
                         "total_value": round(holdings_value + cash - liability + options, 2), "cost_basis": round(cost, 2),
                         "net_flow": round(flow, 2)})
            prev = d
    for i in range(0, len(rows), 500):
        admin.table("portfolio_daily_values").upsert(rows[i : i + 500], on_conflict="portfolio_id,value_date").execute()


def seed_networth(uc, uid: str, today: date, months: list[date], start: date):
    accounts = [
        ("Checking", "cash", {}), ("High-yield savings", "emergency_fund", {}), ("Home", "home", {}), ("Car", "auto", {}),
        ("Mortgage", "mortgage", {"payment_amount": 2480, "payment_day": 1, "interest_rate": 6.375, "escrow_amount": 540}),
        ("Auto loan", "auto_loan", {"payment_amount": 465, "payment_day": 15, "interest_rate": 5.9}),
        ("Credit card", "credit_card", {"payment_day": 20}),
    ]
    ids = {}
    for i, (name, cat, extra) in enumerate(accounts):
        row = uc.table("networth_accounts").insert({"user_id": uid, "name": name, "category": cat, "opened_month": start.isoformat(),
                                                    "sort_order": i, **extra}).execute().data[0]
        ids[name] = row["id"]
    balances, payments = [], []
    for i, m in enumerate(months):
        card = round(rng.uniform(900, 2600), 2)
        values = {"Checking": round(7200 + rng.uniform(-1500, 1800), 2), "High-yield savings": 18000 + 450 * i, "Home": 430000 + 1200 * i,
                  "Car": 26500 - 350 * i, "Mortgage": round(318400 - 640 * i, 2), "Auto loan": round(15200 - 410 * i, 2), "Credit card": card}
        balances += [{"user_id": uid, "account_id": ids[n], "month": m.isoformat(), "balance": v} for n, v in values.items()]
        payments += [
            {"user_id": uid, "account_id": ids["Mortgage"], "month": m.isoformat(), "amount": 2480, "paid_on": (m + timedelta(days=1)).isoformat()},
            {"user_id": uid, "account_id": ids["Auto loan"], "month": m.isoformat(), "amount": 465, "paid_on": (m + timedelta(days=13)).isoformat()},
            {"user_id": uid, "account_id": ids["Credit card"], "month": m.isoformat(), "amount": card, "paid_on": (m + timedelta(days=18)).isoformat()},
        ]
    now = month_start(today)
    for name, amount, day in (("Mortgage", 2480, 2), ("Auto loan", 465, 13), ("Credit card", 1450.18, 19)):
        if today.day > day:
            payments.append({"user_id": uid, "account_id": ids[name], "month": now.isoformat(), "amount": amount,
                             "paid_on": (now + timedelta(days=day - 1)).isoformat()})
    uc.table("networth_balances").insert(balances).execute()
    uc.table("installment_payments").insert(payments).execute()
    uc.table("wealth_settings").upsert({"user_id": uid, "close_from_month": start.isoformat()}).execute()
    for m in months[:-1]:  # last month is left for the demo to close
        uc.rpc("close_networth_month", {"p_month": m.isoformat()}).execute()


# ---------------------------------------------------------------------------
# Trading
# ---------------------------------------------------------------------------

STOCKS = ["NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "SPY", "QQQ"]
OPTION_UNDERLYINGS = ["SPY", "QQQ", "NVDA", "TSLA"]
GOOD_WIN = ["Waited for Entry", "Right Size", "Took Profit at Target", "Let Winner Run", "Honored Stop"]
LOSS_PATTERNS = [(["Honored Stop", "Cut Loser Fast"], []), (["Right Size"], ["FOMO"]), ([], ["Oversized"]),
                 ([], ["No Stop", "Held Too Long"]), ([], ["Revenge"]), (["Waited for Entry", "Honored Stop"], [])]
WIN_NOTES = ["Clean break of the opening range, volume confirmed. Took half at the first target and trailed the rest.",
             "Reclaimed VWAP on the 5-minute with a higher low. Patient entry paid off.",
             "Followed the plan exactly. Sized right, hit target, no second-guessing.",
             "Strong relative strength vs SPY all morning; entered the first pullback.",
             "Gap held above premarket high, added on the retest."]
LOSS_NOTES = ["Chased the move after missing the first entry. Should have waited for a pullback.",
              "Setup was fine, the market rolled over. Stop did its job.",
              "Too big for a choppy tape. Cut it, but the size made it hurt.",
              "Entered before confirmation. Broke my own rule of waiting for the 5-minute close.",
              "Revenge trade after the morning loss. Walked away after this one."]


def seed_trading(uc, admin, uid: str, px: Prices, today: date):
    acct = uc.table("accounts").insert({"user_id": uid, "broker": "manual", "label": "Demo brokerage", "account_type": "live",
                                        "sync_mode": "manual", "default_asset_type": "stock", "per_contract_fee": 0.65}).execute().data[0]["id"]

    playbooks = [
        ("Opening range breakout", "Trade the break of the first 15-minute range with volume.", "#3b82f6", "🚀", "Trending open, above-average premarket volume",
         {"Entry": ["Wait for the 15-minute range to form", "Break on above-average volume"], "Exit": ["Half off at 1R", "Trail the rest under the 5-minute low"], "Risk": ["Stop under the range midpoint", "Max 1% of account"]}),
        ("VWAP reclaim", "Long when price reclaims VWAP after a morning flush and holds a higher low.", "#10b981", "📈", "Range or slow trend days",
         {"Entry": ["Close above VWAP on the 5-minute", "Higher low forms"], "Exit": ["Target the high of day"], "Risk": ["Stop below the reclaim candle"]}),
        ("Gap fade", "Short an extended gap up that fails at premarket high.", "#f59e0b", "🔻", "Overextended gap into resistance",
         {"Entry": ["Rejection at premarket high", "Lower high on the 1-minute"], "Exit": ["Cover at VWAP"], "Risk": ["Stop above the high of day"]}),
    ]
    pb_ids = []
    for i, (name, desc, color, icon, cond, groups) in enumerate(playbooks):
        pid = uc.table("playbooks").insert({"user_id": uid, "name": name, "description": desc, "color": color, "icon": icon,
                                            "market_conditions": cond}).execute().data[0]["id"]
        pb_ids.append(pid)
        for gi, (gname, rules) in enumerate(groups.items()):
            gid = uc.table("playbook_rule_groups").insert({"playbook_id": pid, "name": gname, "sort_order": gi}).execute().data[0]["id"]
            uc.table("playbook_rules").insert([{"group_id": gid, "text": t, "sort_order": ri} for ri, t in enumerate(rules)]).execute()

    emotions = {"before": ["Confident", "Impatient", "Calm"], "during": ["Focused", "Nervous"], "after": ["Satisfied", "Frustrated", "Relieved"]}
    em_ids: dict[str, dict[str, str]] = defaultdict(dict)
    for phase, names in emotions.items():
        for i, n in enumerate(names):
            em_ids[phase][n] = uc.table("emotions").insert({"user_id": uid, "phase": phase, "name": n, "sort_order": i}).execute().data[0]["id"]

    rules = ["No trades in the first 5 minutes", "Max 3 trades a day", "Stop after 2 losses in a row", "Write the plan before the open"]
    rule_ids = [uc.table("daily_rules").insert({"user_id": uid, "text": t, "sort_order": i}).execute().data[0]["id"] for i, t in enumerate(rules)]
    uc.table("target_settings").upsert({"user_id": uid, "profit_target_value": 500, "loss_limit_value": 300}).execute()

    days = px.days[-64:]
    trades, fills_by_trade, meta = [], [], []
    day_pnl: dict[date, float] = defaultdict(float)
    for d in days:
        n = rng.choices([0, 1, 2, 3], weights=[15, 35, 35, 15])[0]
        minute = 35
        for _ in range(n):
            minute += rng.randint(4, 40)
            if minute > 150:
                break
            is_option = rng.random() < 0.25
            sym = rng.choice(OPTION_UNDERLYINGS if is_option else STOCKS)
            bar = px.bar(sym, d)
            lo, hi = bar["l"], bar["h"]
            entry_px = round(rng.uniform(lo + 0.25 * (hi - lo), hi - 0.25 * (hi - lo)), 2)
            win = rng.random() < 0.58
            side = "long" if is_option or rng.random() < 0.78 else "short"
            hold = rng.randint(6, 85)
            eh, em = divmod(9 * 60 + 30 + minute, 60)
            xh, xm = divmod(9 * 60 + 30 + minute + hold, 60)
            setup = pb_ids[2] if side == "short" else (pb_ids[0] if minute < 60 else pb_ids[1])
            if is_option:
                opt_type = rng.choice(["call", "call", "put"])
                strike = round(entry_px) if sym in ("SPY", "QQQ") else round(entry_px / 5) * 5
                friday = d + timedelta(days=(4 - d.weekday()) % 7)
                prem = round(rng.uniform(1.2, 4.5), 2)
                exit_prem = round(prem * (rng.uniform(1.2, 1.9) if win else rng.uniform(0.4, 0.75)), 2)
                qty = rng.randint(2, 6)
                fills = [("open", eh, em, prem, qty), ("close", xh, xm, exit_prem, qty)]
                fee = round(0.65 * qty * 2, 2)
                detail = {"option_type": opt_type, "strike": strike, "expiration": friday.isoformat(), "premium": prem}
                mult = 100
            else:
                move = rng.uniform(0.004, 0.018) if win else -rng.uniform(0.002, 0.008)
                sign = 1 if side == "long" else -1
                exit_px = round(min(hi, max(lo, entry_px * (1 + sign * move))), 2)
                qty = max(1, int(rng.uniform(12000, 25000) / entry_px))
                fee = 0.0
                detail = None
                mult = 1
                if rng.random() < 0.3 and hold > 15:
                    add = max(1, qty // 2)
                    add_px = round(entry_px * (1 + sign * rng.uniform(-0.002, 0.002)), 2)
                    ah, am = divmod(9 * 60 + 30 + minute + 4, 60)
                    total = qty + add
                    trim = total // 2
                    th, tm = divmod(9 * 60 + 30 + minute + hold // 2 + 2, 60)
                    trim_px = round((entry_px + exit_px) / 2, 2)
                    fills = [("open", eh, em, entry_px, qty), ("add", ah, am, add_px, add), ("trim", th, tm, trim_px, trim), ("close", xh, xm, exit_px, total - trim)]
                else:
                    fills = [("open", eh, em, entry_px, qty), ("close", xh, xm, exit_px, qty)]
            fill_rows = [{"action": a, "time": utc_iso(d, h, mi, rng.randint(0, 59)), "price": p, "quantity": q} for a, h, mi, p, q in fills]
            entries = [f for f in fill_rows if f["action"] in ("open", "add")]
            exits = [f for f in fill_rows if f["action"] in ("trim", "close")]
            eq = sum(f["quantity"] for f in entries)
            avg_in = sum(f["quantity"] * f["price"] for f in entries) / eq
            avg_out = sum(f["quantity"] * f["price"] for f in exits) / eq
            gross = (avg_out - avg_in) * eq * mult * (1 if side == "long" else -1)
            net = round(gross - fee, 2)
            day_pnl[d] += net
            first_t, last_t = fill_rows[0]["time"], exits[-1]["time"]
            reviewed = d < days[-4] and rng.random() < 0.85
            good, bad = ([], [])
            if reviewed:
                if net > 0:
                    good = rng.sample(GOOD_WIN, 2)
                    bad = ["Exited Early"] if rng.random() < 0.15 else []
                else:
                    good, bad = rng.choice(LOSS_PATTERNS)
            stop = round(avg_in * (1 - 0.006) if side == "long" else avg_in * 1.006, 2)
            target = round(avg_in * (1 + 0.012) if side == "long" else avg_in * 0.988, 2)
            trades.append({
                "user_id": uid, "account_id": acct, "trade_key": None, "symbol": sym, "asset_type": "option" if is_option else "stock",
                "side": side, "status": "CLOSED", "avg_entry": round(avg_in, 4), "avg_exit": round(avg_out, 4),
                "hold_seconds": int((datetime.fromisoformat(last_t) - datetime.fromisoformat(first_t)).total_seconds()),
                "total_contracts": eq, "realized_pnl_gross": round(gross, 2), "realized_pnl_net": net,
                "estimated_fee": fee, "actual_fee": fee, "fee_source": "actual", "first_in_at": first_t, "last_out_at": last_t,
                "notes": (rng.choice(WIN_NOTES) if net > 0 else rng.choice(LOSS_NOTES)) if reviewed and rng.random() < 0.6 else None,
                "thesis_note": "Plan: " + ("break and hold above the opening range" if setup == pb_ids[0] else "reclaim and hold VWAP" if setup == pb_ids[1] else "fade the failed gap") if reviewed else None,
                "reflection_note": ("Would take this again." if net > 0 else "Lesson: wait for confirmation.") if reviewed and rng.random() < 0.5 else None,
                "trade_origin": rng.choices(["planned", "unplanned", "followed"], weights=[60, 30, 10])[0] if reviewed else None,
                "mistakes": bad, "strengths": good, "stop_price": None if is_option else stop, "target_price": None if is_option else target,
                "reviewed_at": utc_iso(d, 17, rng.randint(0, 59)) if reviewed else None, "created_at": last_t,
            })
            fills_by_trade.append((fill_rows, side, fee))
            meta.append({"detail": detail, "setup": setup, "reviewed": reviewed, "win": net > 0})

    # One swing trade still open.
    d = px.days[-2]
    nv = px.bar("NVDA", d)
    open_px = round((nv["l"] + nv["h"]) / 2, 2)
    t_open = utc_iso(d, 14, 12, 31)
    trades.append({"user_id": uid, "account_id": acct, "trade_key": None, "symbol": "NVDA", "asset_type": "stock", "side": "long", "status": "OPEN",
                   "avg_entry": open_px, "avg_exit": None, "hold_seconds": None, "total_contracts": 60, "realized_pnl_gross": None, "realized_pnl_net": None,
                   "estimated_fee": 0, "actual_fee": 0, "fee_source": "actual", "first_in_at": t_open, "last_out_at": None,
                   "notes": "Swing: holding into next week while it stays above the 20-day average.", "thesis_note": None, "reflection_note": None,
                   "trade_origin": None, "mistakes": [], "strengths": [], "stop_price": round(open_px * 0.96, 2), "target_price": round(open_px * 1.08, 2),
                   "reviewed_at": None, "created_at": t_open})
    fills_by_trade.append(([{"action": "open", "time": t_open, "price": open_px, "quantity": 60}], "long", 0.0))
    meta.append({"detail": None, "setup": pb_ids[1], "reviewed": False, "win": False})

    saved = []
    for i in range(0, len(trades), 100):
        saved += uc.table("trades").insert(trades[i : i + 100]).execute().data
    action_db = {"open": "entry", "add": "add", "trim": "trim", "close": "exit"}
    execs, details, links, feels = [], [], [], []
    for t, (fill_rows, side, fee), m in zip(saved, fills_by_trade, meta):
        for i, f in enumerate(fill_rows):
            entering = f["action"] in ("open", "add")
            execs.append({"user_id": uid, "trade_id": t["id"], "client_order_id": f"manual-{t['id']}-{i}", "filled_at": f["time"],
                          "action": action_db[f["action"]], "price": f["price"], "quantity": f["quantity"],
                          "side": ("buy" if entering else "sell") if side == "long" else ("sell" if entering else "buy"),
                          "estimated_fee": fee if i == len(fill_rows) - 1 else 0, "actual_fee": fee if i == len(fill_rows) - 1 else 0})
        if m["detail"]:
            details.append({"trade_id": t["id"], **m["detail"]})
        if m["reviewed"] or t["status"] == "OPEN":
            links.append({"trade_id": t["id"], "playbook_id": m["setup"]})
        if m["reviewed"]:
            feels.append({"trade_id": t["id"], "emotion_id": em_ids["before"][rng.choice(["Confident", "Calm"] if m["win"] else ["Impatient", "Confident"])], "phase": "before"})
            feels.append({"trade_id": t["id"], "emotion_id": em_ids["after"]["Satisfied" if m["win"] else rng.choice(["Frustrated", "Relieved"])], "phase": "after"})
    for i in range(0, len(execs), 200):
        uc.table("executions").insert(execs[i : i + 200]).execute()
    if details:
        uc.table("options_detail").insert(details).execute()
    uc.table("trade_playbooks").insert(links).execute()
    uc.table("trade_emotions").insert(feels).execute()

    # Journal, plans, rule checks, missed trades.
    journal, checks = [], []
    for d in days:
        pnl = day_pnl.get(d, 0.0)
        traded = d in day_pnl
        if traded or rng.random() < 0.3:
            for r_i, rid in enumerate(rule_ids):
                ok = not (pnl < -250 and r_i in (1, 2)) and rng.random() < 0.92
                checks.append({"user_id": uid, "check_date": d.isoformat(), "rule_id": rid, "checked": ok})
        if traded and rng.random() < 0.65:
            mood = 5 if pnl > 300 else 4 if pnl > 0 else 3 if pnl > -150 else 2
            text = (f"Green day (+${pnl:,.0f}). Stuck to the plan and let the winners work." if pnl > 0 else
                    f"Red day (-${abs(pnl):,.0f}). Choppy tape; need to sit on my hands after the first loss.")
            journal.append({"user_id": uid, "entry_date": d.isoformat(), "notes": text, "mood_rating": mood})
    uc.table("daily_rule_checks").insert(checks).execute()
    uc.table("daily_journal").insert(journal).execute()

    for d in days[-12:]:
        prev = px.days[px.days.index(d) - 1]
        spy, nvda = px.bar("SPY", prev), px.bar("NVDA", prev)
        plan = uc.table("daily_plans").insert({
            "user_id": uid, "plan_date": d.isoformat(), "planned_max_trades": 3, "planned_max_loss": 300,
            "plan_notes": f"SPY: above {spy['h']:.2f} long, below {spy['l']:.2f} short\nNVDA: watch {nvda['h']:.2f} for a breakout",
            "market_read": rng.choice(["Futures flat, quiet calendar. Expect a range.", "Gap up on earnings strength; trend day possible.",
                                       "CPI at 8:30, wait for the first 15 minutes.", "Weak breadth yesterday; be picky with longs."]),
            "focus": rng.choice(["Only A+ setups", "Wait for the 5-minute close", "Size down after a loss", "Let winners reach target"]),
        }).execute().data[0]["id"]
        uc.table("daily_plan_playbooks").insert([{"daily_plan_id": plan, "playbook_id": p} for p in pb_ids[:2]]).execute()

    uc.table("missed_trades").insert([
        {"user_id": uid, "playbook_id": pb_ids[0], "missed_date": days[-6].isoformat(), "symbol": "TSLA", "notes": "Clean range break while I was in another trade.", "est_pnl_missed": 420},
        {"user_id": uid, "playbook_id": pb_ids[1], "missed_date": days[-15].isoformat(), "symbol": "AMD", "notes": "Hesitated on the VWAP reclaim; it ran without me.", "est_pnl_missed": 260},
        {"user_id": uid, "playbook_id": pb_ids[2], "missed_date": days[-27].isoformat(), "symbol": "META", "notes": "Gap faded exactly as planned, didn't pull the trigger.", "est_pnl_missed": 310},
    ]).execute()
    return len(saved)


# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--replace", action="store_true", help="delete the existing demo account first")
    ap.add_argument("--history", help="cache file for the price history (skips the download when present)")
    args = ap.parse_args()
    env = {k: os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "DEMO_EMAIL", "DEMO_PASSWORD", "TWELVEDATA_API_KEY")}
    missing = [k for k, v in env.items() if not v and not (k == "TWELVEDATA_API_KEY" and args.history and os.path.exists(args.history))]
    if missing:
        raise SystemExit(f"Missing: {', '.join(missing)}")

    today = date.today()
    if args.history and os.path.exists(args.history):
        history = json.load(open(args.history))
        if "XAU/USD" in history:
            history["GOLD"] = history.pop("XAU/USD")
    else:
        history = fetch_history(env["TWELVEDATA_API_KEY"], month_start(today, 7), today)
        if args.history:
            json.dump(history, open(args.history, "w"))
    px = Prices(history)

    admin = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    email = env["DEMO_EMAIL"].lower()
    existing = next((u for u in admin.auth.admin.list_users(page=1, per_page=1000) if (u.email or "").lower() == email), None)
    if existing:
        if not args.replace:
            raise SystemExit(f"{email} already exists; use --replace to rebuild it")
        admin.auth.admin.delete_user(existing.id)
        print("Deleted the old demo account")
    uid = admin.auth.admin.create_user({"email": email, "password": env["DEMO_PASSWORD"], "email_confirm": True}).user.id

    # Real closes for everything the demo holds or watches, as the worker would save them.
    rows = [{"symbol": s, "price_date": d.isoformat(), "close": r["c"]}
            for s, bars in px.bars.items() if s not in ("SPY", "TSLA", "AMD") for d, r in bars.items()]
    for i in range(0, len(rows), 500):
        admin.table("prices").upsert(rows[i : i + 500], on_conflict="symbol,price_date", ignore_duplicates=True).execute()

    uc = create_client(env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"])
    uc.auth.sign_in_with_password({"email": email, "password": env["DEMO_PASSWORD"]})

    w = seed_wealth(uc, admin, uid, px, today)
    write_daily_values(admin, uid, px, w["portfolios"], w["d0"])
    seed_networth(uc, uid, today, w["months"], w["start"])
    n = seed_trading(uc, admin, uid, px, today)
    problems = uc.table("audit_summary").select("*").execute().data
    uc.auth.sign_out()
    print(f"Demo account ready: {email} -- 4 portfolios, {n} trades, {len(w['months'])} months of net worth")
    for p in problems:
        print(f"  Health check: {p['portfolio']} {p['check_name']} {p.get('item') or ''}: {p['detail']}")


if __name__ == "__main__":
    main()
