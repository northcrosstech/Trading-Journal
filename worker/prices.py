"""
Daily portfolio pricing: once per trading day after the close, fetch the closing price
of every ticker held in any portfolio (plus the underlying of every open cash-secured
put) from Twelve Data, store them in `prices`, then write each portfolio's value for
the day to `portfolio_daily_values`.

Independent of Webull -- any ticker typed into a portfolio gets priced. Holdings with a
manual_price (funds with no public ticker) are skipped for fetching and valued at that
price instead.

Twelve Data's free tier allows 800 symbol lookups a day and 8 a minute; the /eod
endpoint costs 1 credit per symbol, so lookups go out in batches of 8, one batch a
minute.

Run on a schedule from sync.py, or by hand:  python sync.py --prices-once
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Iterable, Optional

from rate_limiter import RateLimiter

TWELVEDATA_API_KEY = os.environ.get("TWELVEDATA_API_KEY")
EOD_URL = "https://api.twelvedata.com/eod"
BATCH_SIZE = 8  # free tier: 8 credits per minute
BATCH_INTERVAL_SECONDS = 61.0
SPLIT_DROP_RATIO = 0.6  # a close below 60% of the previous one is flagged as a possible split
OPTION_MULTIPLIER = 100


@dataclass
class PricingSummary:
    value_date: str
    symbols_requested: int = 0
    prices_saved: int = 0
    portfolios_valued: int = 0
    warnings: list[str] = field(default_factory=list)
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def parse_eod_response(symbols: list[str], body: dict) -> tuple[dict[str, tuple[str, float]], list[str]]:
    """Twelve Data answers a one-symbol request with a flat object and a multi-symbol
    request with {symbol: object}; an object with status "error" is a per-symbol failure.
    Returns ({symbol: (yyyy-mm-dd, close)}, warnings)."""
    per_symbol = {symbols[0]: body} if len(symbols) == 1 else body
    closes: dict[str, tuple[str, float]] = {}
    warnings: list[str] = []
    for sym in symbols:
        item = per_symbol.get(sym) if isinstance(per_symbol, dict) else None
        if not isinstance(item, dict) or item.get("status") == "error" or "close" not in item:
            reason = item.get("message") if isinstance(item, dict) else "no data returned"
            warnings.append(f"{sym}: no price from Twelve Data ({reason})")
            continue
        try:
            closes[sym] = (str(item["datetime"])[:10], float(item["close"]))
        except (KeyError, TypeError, ValueError):
            warnings.append(f"{sym}: unreadable price {item!r}")
    return closes, warnings


def csp_liability(csp: dict, underlying_close: Optional[float]) -> float:
    """What it would cost to buy back an open put now: the entered mark if there is one,
    otherwise its intrinsic value max(0, strike - stock price). With no price at all,
    assume zero (the premium already sits in cash)."""
    per_share = csp.get("mark")
    if per_share is None:
        per_share = max(0.0, float(csp["strike"]) - underlying_close) if underlying_close is not None else 0.0
    return float(per_share) * OPTION_MULTIPLIER * int(csp["contracts"])


def option_value(opt: dict, underlying_close: Optional[float]) -> float:
    """Signed value of an open option from option_positions. Long (bought calls/puts):
    the entered mark, else what was paid -- no free option prices, and intrinsic value
    would wrongly show an out-of-the-money LEAPS or hedge as worthless. Short (covered
    call): minus the cost to buy it back -- the mark, else max(0, stock - strike)."""
    contracts = int(opt["contracts"]) * OPTION_MULTIPLIER
    if opt["side"] == "long":
        per_share = opt.get("mark")
        if per_share is None:
            per_share = opt["open_price"]
        return float(per_share) * contracts
    per_share = opt.get("mark")
    if per_share is None:
        per_share = max(0.0, underlying_close - float(opt["strike"])) if underlying_close is not None else 0.0
    return -float(per_share) * contracts


def value_portfolio(
    portfolio: dict,
    holdings: list[dict],
    open_csps: list[dict],
    closes: dict[str, float],
    open_options: Iterable[dict] = (),
) -> tuple[dict, list[str]]:
    """One portfolio's value from its holdings, cash and open puts. A holding with no
    price yet is valued at its average cost (and flagged) so the total isn't understated."""
    warnings: list[str] = []
    holdings_value = 0.0
    cost_basis = 0.0
    for h in holdings:
        qty = float(h["quantity"])
        avg = float(h["avg_cost"])
        price = h.get("manual_price")
        if price is None:
            price = closes.get(h["symbol"])
        if price is None:
            warnings.append(f"{portfolio['name']}: no price for {h['symbol']} yet, valued at average cost")
            price = avg
        holdings_value += qty * float(price)
        cost_basis += qty * avg
    liability = sum(csp_liability(c, closes.get(c["symbol"])) for c in open_csps)
    options = sum(option_value(o, closes.get(o["symbol"])) for o in open_options)
    cash = float(portfolio["cash"])
    return (
        {
            "holdings_value": round(holdings_value, 2),
            "cash": round(cash, 2),
            "csp_liability": round(liability, 2),
            "options_value": round(options, 2),
            "total_value": round(holdings_value + cash - liability + options, 2),
            "cost_basis": round(cost_basis, 2),
        },
        warnings,
    )


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def fetch_eod(symbols: list[str], api_key: str) -> dict:
    query = urllib.parse.urlencode({"symbol": ",".join(symbols), "apikey": api_key})
    with urllib.request.urlopen(f"{EOD_URL}?{query}", timeout=30) as res:
        return json.loads(res.read().decode())


def _all_rows(query) -> list[dict]:
    """PostgREST caps a response at 1000 rows; page through."""
    rows: list[dict] = []
    start = 0
    while True:
        page = query.range(start, start + 999).execute().data or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        start += 1000


def run_pricing(
    value_date: date, client=None, api_key: Optional[str] = TWELVEDATA_API_KEY, only_new: bool = False
) -> PricingSummary:
    """Never raises -- failures land in summary.error so the scheduler keeps running.

    only_new=True is the website's "Get prices now": fetch only tickers that have never
    been priced (seconds, one lookup each) and skip writing daily values -- the page
    values holdings live from `prices`, and the after-close run still records the day."""
    summary = PricingSummary(value_date=value_date.isoformat())
    try:
        if client is None:
            from db_writer import get_client

            client = get_client()

        portfolios = _all_rows(client.table("portfolios").select("id,user_id,name,cash").eq("archived", False))
        if not portfolios:
            return summary
        holdings = _all_rows(client.table("holdings").select("portfolio_id,symbol,quantity,avg_cost,manual_price"))
        open_csps = _all_rows(
            client.table("csp_positions").select("portfolio_id,symbol,strike,contracts,mark").eq("status", "open")
        )

        open_options = _all_rows(
            client.table("option_positions")
            .select("portfolio_id,symbol,side,strike,contracts,open_price,mark")
            .eq("status", "open")
        )

        symbols = sorted(
            {h["symbol"] for h in holdings if h.get("manual_price") is None}
            | {c["symbol"] for c in open_csps}
            | {o["symbol"] for o in open_options}
        )
        if only_new and symbols:
            already = {
                row["symbol"]
                for row in _all_rows(client.table("prices").select("symbol").in_("symbol", symbols))
            }
            symbols = [s for s in symbols if s not in already]
        summary.symbols_requested = len(symbols)

        # Previous stored closes, for the split check.
        previous: dict[str, float] = {}
        if symbols:
            for row in _all_rows(
                client.table("prices").select("symbol,close,price_date").in_("symbol", symbols)
                .lt("price_date", value_date.isoformat()).order("price_date", desc=True)
            ):
                previous.setdefault(row["symbol"], float(row["close"]))

        if symbols and not api_key:
            summary.warnings.append("TWELVEDATA_API_KEY is not set -- no new prices fetched")
        elif symbols:
            limiter = RateLimiter(min_interval_seconds=BATCH_INTERVAL_SECONDS)
            limiter._last_call = -BATCH_INTERVAL_SECONDS  # first batch goes immediately
            for batch in chunked(symbols, BATCH_SIZE):
                limiter.wait()
                try:
                    body = fetch_eod(batch, api_key)
                except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                    summary.warnings.append(f"{','.join(batch)}: request failed ({exc})")
                    continue
                closes, warnings = parse_eod_response(batch, body)
                summary.warnings.extend(warnings)
                rows = [{"symbol": s, "price_date": d, "close": c} for s, (d, c) in closes.items()]
                if rows:
                    client.table("prices").upsert(rows, on_conflict="symbol,price_date").execute()
                    summary.prices_saved += len(rows)
                for s, (_, c) in closes.items():
                    prev = previous.get(s)
                    if prev and c < prev * SPLIT_DROP_RATIO:
                        summary.warnings.append(
                            f"{s}: closed at {c:.2f}, down from {prev:.2f} -- possible stock split; update the quantity"
                        )

        if only_new:
            return summary

        # Latest close on or before the value date, per symbol.
        latest: dict[str, float] = {}
        if symbols:
            for row in _all_rows(
                client.table("prices").select("symbol,close,price_date").in_("symbol", symbols)
                .lte("price_date", value_date.isoformat()).order("price_date", desc=True)
            ):
                latest.setdefault(row["symbol"], float(row["close"]))

        now_iso = datetime.now(timezone.utc).isoformat()
        for p in portfolios:
            values, warnings = value_portfolio(
                p,
                [h for h in holdings if h["portfolio_id"] == p["id"]],
                [c for c in open_csps if c["portfolio_id"] == p["id"]],
                latest,
                [o for o in open_options if o["portfolio_id"] == p["id"]],
            )
            summary.warnings.extend(warnings)

            # Money in/out since the previous day's value -- what time-weighted return
            # excludes. The first value is the starting point, so it has none.
            prev_rows = (
                client.table("portfolio_daily_values").select("computed_at")
                .eq("portfolio_id", p["id"]).lt("value_date", value_date.isoformat())
                .order("value_date", desc=True).limit(1).execute().data
            )
            net_flow = 0.0
            if prev_rows:
                flows = _all_rows(
                    client.table("portfolio_activity").select("external_flow")
                    .eq("portfolio_id", p["id"]).gt("created_at", prev_rows[0]["computed_at"])
                )
                net_flow = sum(float(f["external_flow"]) for f in flows)

            client.table("portfolio_daily_values").upsert(
                {
                    "portfolio_id": p["id"],
                    "user_id": p["user_id"],
                    "value_date": value_date.isoformat(),
                    **values,
                    "net_flow": round(net_flow, 2),
                    "computed_at": now_iso,
                },
                on_conflict="portfolio_id,value_date",
            ).execute()
            summary.portfolios_valued += 1
    except Exception as exc:  # noqa: BLE001 -- the scheduler must survive any failure
        summary.error = f"{type(exc).__name__}: {exc}"
    return summary


def print_pricing_summary(s: PricingSummary) -> None:
    status = "ERROR" if s.error else "ok"
    print(
        f"[pricing {s.value_date}] {status}: {s.symbols_requested} symbol(s), {s.prices_saved} price(s) saved, "
        f"{s.portfolios_valued} portfolio(s) valued"
    )
    if s.error:
        print(f"  error: {s.error}")
    for w in s.warnings:
        print(f"  - {w}")
