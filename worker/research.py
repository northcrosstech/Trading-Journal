"""
Research data for fair value and scores: per-ticker fundamentals from Finnhub, analysts'
EPS forecasts from Financial Modeling Prep, and a few economic indicators from FRED,
refreshed once a trading day after pricing.

  fundamentals      -- EPS (trailing 12 months), 5y/3y EPS growth, gross/net margin,
                       return on equity, debt-to-equity, current ratio, next earnings date
                       and estimate, and forecast EPS growth (from FMP's annual estimates).
                       One row per ticker held in any portfolio or on anyone's research
                       watchlist; shared like `prices`.
  macro_indicators  -- AAA corporate bond effective yield (the yield the fair-value formula
                       divides by), 10-year Treasury yield, unemployment rate and its
                       12-month low (for the economy score).

Finnhub's free plan allows 60 calls a minute; each ticker costs 2-3 calls (metrics, earnings
calendar, and the company name the first time), paced just under the limit. FMP's free plan
allows 250 calls a day; each ticker costs 1. FRED's CSV downloads need no key.

Run after pricing from sync.py, or by hand:  python sync.py --research-once
"""
from __future__ import annotations

import csv
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from rate_limiter import RateLimiter

FINNHUB_API_KEY = os.environ.get("FINNHUB_API_KEY")
FINNHUB_URL = "https://finnhub.io/api/v1/"
FINNHUB_INTERVAL_SECONDS = 1.1  # just under 60 calls a minute
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id="
FRED_SERIES = {
    "aaa_yield": "BAMLC0A1CAAAEY",  # ICE BofA AAA US Corporate Index effective yield, daily
    "treasury_10y": "DGS10",  # 10-year Treasury constant maturity, daily
    "unemployment_rate": "UNRATE",  # monthly
}
EARNINGS_LOOKAHEAD_DAYS = 120
FMP_API_KEY = os.environ.get("FMP_API_KEY")
FMP_URL = "https://financialmodelingprep.com/stable/"
FMP_INTERVAL_SECONDS = 0.5
FORECAST_MAX_YEARS = 5  # the last forecast year used is at most this far past the current one
FORECAST_MIN_ANALYSTS = 3  # thinner far-out estimates are ignored
FORECAST_COLUMNS = ("eps_growth_forecast", "forecast_from_year", "forecast_to_year", "forecast_analysts")
# Columns added by later migrations: if the database doesn't have them yet, the rest still saves.
OPTIONAL_COLUMNS = FORECAST_COLUMNS + ("pe_ttm", "reporting_currency")

# Finnhub /stock/metric field -> fundamentals column
METRIC_FIELDS = {
    "epsTTM": "eps_ttm",
    "epsGrowth5Y": "eps_growth_5y",
    "epsGrowth3Y": "eps_growth_3y",
    "grossMarginTTM": "gross_margin",
    "roeTTM": "roe",
    "netProfitMarginTTM": "net_margin",
    "totalDebt/totalEquityQuarterly": "debt_to_equity",
    "currentRatioQuarterly": "current_ratio",
    "peTTM": "pe_ttm",
}


@dataclass
class ResearchSummary:
    symbols_requested: int = 0
    fundamentals_saved: int = 0
    macro_saved: int = 0
    warnings: list[str] = field(default_factory=list)
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------


def _number(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def parse_metric(body: dict) -> dict:
    """Finnhub /stock/metric response -> fundamentals columns (missing values are None)."""
    metric = (body or {}).get("metric") or {}
    return {col: _number(metric.get(key)) for key, col in METRIC_FIELDS.items()}


def pick_next_earnings(body: dict, today: date) -> dict:
    """Earliest upcoming report in a Finnhub /calendar/earnings response."""
    upcoming = []
    for e in (body or {}).get("earningsCalendar") or []:
        try:
            d = date.fromisoformat(e.get("date") or "")
        except ValueError:
            continue
        if d >= today:
            upcoming.append((d, e))
    if not upcoming:
        return {"next_earnings_date": None, "next_earnings_hour": None, "next_eps_estimate": None}
    d, e = min(upcoming, key=lambda x: x[0])
    return {
        "next_earnings_date": d.isoformat(),
        "next_earnings_hour": e.get("hour") or None,
        "next_eps_estimate": _number(e.get("epsEstimate")),
    }


def symbol_types(rows: list[dict]) -> dict[str, tuple[Optional[str], Optional[str]]]:
    """Finnhub /stock/symbol list -> {symbol: (type, description)}, e.g. ('ETP', 'VANGUARD
    TOTAL BOND MARKET'). The app turns these into stock / ETF / bond."""
    return {r["symbol"]: (r.get("type") or None, r.get("description") or None) for r in rows or [] if r.get("symbol")}


def forecast_growth(rows: list[dict], today: date) -> dict:
    """FMP annual analyst estimates -> expected EPS growth % per year.

    Measured from next fiscal year to the furthest year (within FORECAST_MAX_YEARS of the
    current one) that at least FORECAST_MIN_ANALYSTS analysts estimate. The current year is
    skipped as the starting point when possible: it mixes reported quarters with forecasts
    and can carry one-off gains (GOOGL's 2026), which would skew the rate. With too few
    years for that, it starts from the current year instead."""
    empty = {c: None for c in FORECAST_COLUMNS}
    years: list[tuple[int, float, int]] = []  # (fiscal year, EPS estimate, analysts), future years only
    for r in rows or []:
        try:
            end = date.fromisoformat((r.get("date") or "")[:10])
        except ValueError:
            continue
        eps = _number(r.get("epsAvg"))
        if end > today and eps is not None:
            years.append((end.year, eps, int(_number(r.get("numAnalystsEps")) or 0)))
    years.sort()
    if len(years) < 2:
        return empty
    current = years[0][0]
    ends = [y for y in years if y[0] <= current + FORECAST_MAX_YEARS and y[2] >= FORECAST_MIN_ANALYSTS and y[1] > 0]
    if not ends:
        return empty
    last = ends[-1]
    start = years[1] if len(years) > 1 and last[0] - years[1][0] >= 2 else years[0]
    span = last[0] - start[0]
    if span < 1 or start[1] <= 0:
        return empty
    return {
        "eps_growth_forecast": round(((last[1] / start[1]) ** (1 / span) - 1) * 100, 2),
        "forecast_from_year": start[0],
        "forecast_to_year": last[0],
        "forecast_analysts": last[2],
    }


def parse_fred_csv(text: str) -> list[tuple[date, float]]:
    """FRED graph CSV (date,value; '.' for missing) -> [(date, value)] oldest first."""
    rows: list[tuple[date, float]] = []
    reader = csv.reader(io.StringIO(text))
    next(reader, None)  # header
    for row in reader:
        if len(row) < 2:
            continue
        try:
            d = date.fromisoformat(row[0])
        except ValueError:
            continue
        v = _number(row[1])
        if v is not None:
            rows.append((d, v))
    return rows


def macro_rows(series: dict[str, list[tuple[date, float]]]) -> list[dict]:
    """Latest value of each series, plus the unemployment rate's low over the last 12 months."""
    out = []
    for key, points in series.items():
        if not points:
            continue
        d, v = points[-1]
        out.append({"key": key, "value": v, "as_of": d.isoformat()})
        if key == "unemployment_rate":
            recent = [p for p in points if p[0] > d - timedelta(days=366)]
            out.append({"key": "unemployment_12m_low", "value": min(p[1] for p in recent), "as_of": d.isoformat()})
    return out


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def _finnhub(path: str, params: dict, api_key: str, limiter: RateLimiter) -> dict:
    query = urllib.parse.urlencode({**params, "token": api_key})
    for attempt in range(3):
        limiter.wait()
        try:
            with urllib.request.urlopen(f"{FINNHUB_URL}{path}?{query}", timeout=20) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 2:
                limiter.backoff(attempt + 1)
                continue
            raise
    return {}


def _fmp(path: str, params: dict, api_key: str, limiter: RateLimiter):
    limiter.wait()
    query = urllib.parse.urlencode({**params, "apikey": api_key})
    with urllib.request.urlopen(f"{FMP_URL}{path}?{query}", timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def _fred(series_id: str) -> list[tuple[date, float]]:
    with urllib.request.urlopen(FRED_CSV_URL + series_id, timeout=30) as res:
        return parse_fred_csv(res.read().decode())


def _all_rows(query) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = query.range(start, start + 999).execute().data or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        start += 1000


def research_symbols(client) -> list[str]:
    """Every ticker held (without a manual price) or on anyone's watchlist."""
    held = {h["symbol"] for h in _all_rows(client.table("holdings").select("symbol,manual_price")) if h.get("manual_price") is None}
    try:
        watched = {w["symbol"] for w in _all_rows(client.table("research_watchlist").select("symbol"))}
    except Exception:  # table not created yet (migration not run)
        watched = set()
    return sorted(held | watched)


def run_research(
    today: date,
    client=None,
    api_key: Optional[str] = FINNHUB_API_KEY,
    only_new: bool = False,
    fmp_key: Optional[str] = FMP_API_KEY,
) -> ResearchSummary:
    """Never raises -- failures land in summary.error so the scheduler keeps running.

    only_new=True (with "Get prices now"): only tickers that have no fundamentals yet, and
    the economic indicators only if none are stored."""
    summary = ResearchSummary()
    try:
        if client is None:
            from db_writer import get_client

            client = get_client()

        symbols = research_symbols(client)
        known = {r["symbol"]: r for r in _all_rows(client.table("fundamentals").select("*"))}
        if only_new:
            symbols = [s for s in symbols if s not in known]
        summary.symbols_requested = len(symbols)

        if symbols and not api_key:
            summary.warnings.append("FINNHUB_API_KEY is not set -- no fundamentals fetched")
        elif symbols:
            limiter = RateLimiter(min_interval_seconds=FINNHUB_INTERVAL_SECONDS)
            limiter._last_call = -FINNHUB_INTERVAL_SECONDS
            fmp_limiter = RateLimiter(min_interval_seconds=FMP_INTERVAL_SECONDS)
            if not fmp_key:
                summary.warnings.append("FMP_API_KEY is not set -- fair value uses past growth")
            missing: set[str] = set()  # optional columns the database turns out not to have yet
            horizon = (today + timedelta(days=EARNINGS_LOOKAHEAD_DAYS)).isoformat()
            # One call lists every US ticker with its type (Common Stock, ETP, ADR, REIT...).
            try:
                types = symbol_types(_finnhub("stock/symbol", {"exchange": "US"}, api_key, limiter))
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                types = {}
                summary.warnings.append(f"symbol list: request failed ({exc})")
            for s in symbols:
                try:
                    row = {"symbol": s, **parse_metric(_finnhub("stock/metric", {"symbol": s, "metric": "all"}, api_key, limiter))}
                    row.update(pick_next_earnings(
                        _finnhub("calendar/earnings", {"symbol": s, "from": today.isoformat(), "to": horizon}, api_key, limiter), today
                    ))
                    # Name and reporting currency (TSM reports in TWD) from the profile, fetched
                    # until both are stored.
                    prev = known.get(s) or {}
                    row["name"], row["reporting_currency"] = prev.get("name"), prev.get("reporting_currency")
                    if not row["name"] or (not row["reporting_currency"] and "reporting_currency" not in missing):
                        profile = _finnhub("stock/profile2", {"symbol": s}, api_key, limiter) or {}
                        row["name"] = row["name"] or profile.get("name") or None
                        row["reporting_currency"] = profile.get("currency") or None
                    if s in types:
                        row["security_type"], row["description"] = types[s]
                    if fmp_key and not missing.intersection(FORECAST_COLUMNS):
                        try:
                            row.update(forecast_growth(_fmp("analyst-estimates", {"symbol": s, "period": "annual", "limit": 10}, fmp_key, fmp_limiter), today))
                        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                            summary.warnings.append(f"{s}: forecast request failed ({exc})")
                    row["updated_at"] = datetime.now(timezone.utc).isoformat()
                    while True:
                        try:
                            client.table("fundamentals").upsert({k: v for k, v in row.items() if k not in missing}, on_conflict="symbol").execute()
                            break
                        except Exception as exc:  # noqa: BLE001
                            # A newer research migration not run yet: drop the columns it adds, save the rest
                            absent = {c for c in OPTIONAL_COLUMNS if c in str(exc) and c not in missing}
                            if not absent:
                                raise
                            missing |= absent
                            summary.warnings.append(f"columns missing ({', '.join(sorted(absent))}) -- run the newest research migration")
                    summary.fundamentals_saved += 1
                except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                    summary.warnings.append(f"{s}: request failed ({exc})")

        need_macro = not only_new or not _all_rows(client.table("macro_indicators").select("key"))
        if need_macro:
            series: dict[str, list[tuple[date, float]]] = {}
            for key, series_id in FRED_SERIES.items():
                try:
                    series[key] = _fred(series_id)
                except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                    summary.warnings.append(f"FRED {series_id}: request failed ({exc})")
            rows = macro_rows(series)
            if rows:
                now_iso = datetime.now(timezone.utc).isoformat()
                client.table("macro_indicators").upsert([{**r, "updated_at": now_iso} for r in rows], on_conflict="key").execute()
                summary.macro_saved = len(rows)
    except Exception as exc:  # noqa: BLE001 -- the scheduler must keep running
        summary.error = f"{type(exc).__name__}: {exc}"
    return summary


def print_research_summary(s: ResearchSummary) -> None:
    status = "error" if s.error else "ok"
    print(
        f"[{datetime.now().isoformat()}] research {status}: {s.fundamentals_saved}/{s.symbols_requested} tickers, "
        f"{s.macro_saved} economic indicators"
    )
    for w in s.warnings:
        print(f"  warning: {w}")
    if s.error:
        print(f"  error: {s.error}")
