"""
Deployable sync worker: pulls Webull order history (paginated), transforms it, fetches
fees, writes to Supabase, and logs every run. Two modes:

    python sync.py --once      # one cycle, then exit (local testing)
    python sync.py             # runs forever: one cycle now, then every
                                # SYNC_INTERVAL_MINUTES (default 15) after that

Token lifecycle: the SDK caches its auth token on disk and re-validates it against
Webull's server every time an ApiClient/TradeClient is constructed. If the cached
session is still good, that re-validation is near-instant (confirmed empirically --
every separate process run so far in this project has reused the cached token with no
new phone approval). It only blocks -- on the same 5s/300s interactive polling loop as
first-auth -- if the session has actually been invalidated, and after 300s with no
approval it raises instead of hanging forever. There's no non-interactive refresh path;
if that ever happens, this cycle logs an error to sync_log and the NEXT cycle will hang
the same way until a human reopens the Webull app and approves. Because re-validation
is cheap when the session is fine, a fresh client is built at the top of every cycle
rather than held alive across the whole process -- simpler and it's the only way to
notice a revoked session and recover once it's re-approved.
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from dotenv import load_dotenv
from webull.core.client import ApiClient
from webull.trade.trade_client import TradeClient

from db_writer import get_client, write_sync_log, write_trades
from fees import DEFAULT_MAX_FETCHES_PER_CYCLE, FeesCache, annotate_execution_fees
from market_calendar import is_trading_day
from rate_limiter import RateLimiter
from sync_trigger_server import start_http_server
from transform import extract_orders, group_trades, normalize_orders, open_trade_warnings

load_dotenv()

APP_KEY = os.environ["WEBULL_APP_KEY"]
APP_SECRET = os.environ["WEBULL_APP_SECRET"]
REGION_ID = os.environ.get("WEBULL_REGION_ID", "us")
ENDPOINT = os.environ["WEBULL_ENDPOINT"]
ACCOUNT_ID = os.environ.get("WEBULL_ACCOUNT_ID")
START_DATE = os.environ.get("WEBULL_ORDER_START_DATE")
END_DATE = os.environ.get("WEBULL_ORDER_END_DATE")
PAGE_SIZE = int(os.environ.get("WEBULL_ORDER_PAGE_SIZE", "100"))
# One shared limit for EVERY Webull trade-endpoint call in a cycle (order/history pages
# AND order/detail fee fetches) -- see rate_limiter.py for why pacing each loop
# independently isn't the same as respecting one combined rate limit.
TRADE_API_MIN_INTERVAL_SECONDS = float(os.environ.get("WEBULL_TRADE_API_MIN_INTERVAL_SECONDS", "1.0"))
FEE_BACKFILL_BATCH_SIZE = int(os.environ.get("WEBULL_FEE_BACKFILL_BATCH_SIZE", str(DEFAULT_MAX_FETCHES_PER_CYCLE)))
WEBULL_USER_ID = os.environ["WEBULL_USER_ID"]

SYNC_INTERVAL_MINUTES = int(os.environ.get("SYNC_INTERVAL_MINUTES", "15"))
MARKET_HOURS_ONLY = os.environ.get("SYNC_MARKET_HOURS_ONLY", "false").strip().lower() == "true"
MARKET_START_HOUR = int(os.environ.get("SYNC_MARKET_START_HOUR", "9"))
MARKET_END_HOUR = int(os.environ.get("SYNC_MARKET_END_HOUR", "17"))
MARKET_TZ = ZoneInfo("America/New_York")

# After the regular session ends, allow a couple more syncs (to catch fills/fees still
# settling) before going fully quiet overnight -- see _should_sync_now.
AFTER_CLOSE_TAPER_HOURS = float(os.environ.get("SYNC_AFTER_CLOSE_TAPER_HOURS", "1"))
AFTER_CLOSE_MAX_SYNCS = int(os.environ.get("SYNC_AFTER_CLOSE_MAX_SYNCS", "2"))

MAX_PAGES = 50  # safety cap against a runaway pagination loop


@dataclass
class SyncSummary:
    status: str  # "success" | "error"
    orders_pulled: int = 0
    trades_written: int = 0
    warnings: list = field(default_factory=list)
    error: Optional[str] = None


def is_market_hours(now: Optional[datetime] = None) -> bool:
    """Mon-Fri, [MARKET_START_HOUR, MARKET_END_HOUR) America/New_York, excluding US
    market holidays (see market_calendar.py). Does not account for early-close
    half-days."""
    now = (now or datetime.now(MARKET_TZ)).astimezone(MARKET_TZ)
    if not is_trading_day(now.date()):
        return False
    return MARKET_START_HOUR <= now.hour < MARKET_END_HOUR


def _in_after_close_taper_window(now: datetime) -> bool:
    close = now.replace(hour=MARKET_END_HOUR, minute=0, second=0, microsecond=0)
    taper_end = close + timedelta(hours=AFTER_CLOSE_TAPER_HOURS)
    return close <= now < taper_end


# In-memory only -- resets on every deploy/restart, which just means a fresh taper
# budget for that day. Fine for a single-process worker with one machine running.
_taper_date = None
_taper_count = 0


def _should_sync_now(now: Optional[datetime] = None) -> tuple[bool, str]:
    """Gate used by the scheduled job (not the manual-refresh endpoint, which always
    runs on demand regardless of market hours). Regular session -> always sync. After
    close -> a capped number of taper syncs to catch fills/fees still settling, then
    quiet for the rest of the night. Weekends and US market holidays -> off entirely."""
    global _taper_date, _taper_count
    now = (now or datetime.now(MARKET_TZ)).astimezone(MARKET_TZ)

    if not is_trading_day(now.date()):
        return False, "not a trading day (weekend or US market holiday)"

    if MARKET_START_HOUR <= now.hour < MARKET_END_HOUR:
        return True, ""

    if _in_after_close_taper_window(now):
        if _taper_date != now.date():
            _taper_date = now.date()
            _taper_count = 0
        if _taper_count < AFTER_CLOSE_MAX_SYNCS:
            _taper_count += 1
            return True, ""
        return False, f"after-close taper budget ({AFTER_CLOSE_MAX_SYNCS}) already used today"

    return False, "outside market hours and the after-close taper window"


def _build_trade_client() -> tuple[TradeClient, str]:
    api_client = ApiClient(APP_KEY, APP_SECRET, REGION_ID)
    api_client.add_endpoint(REGION_ID, ENDPOINT)
    trade_client = TradeClient(api_client)

    account_id = ACCOUNT_ID
    if not account_id:
        accounts_res = trade_client.account_v2.get_account_list()
        if accounts_res.status_code != 200:
            raise RuntimeError(f"get_account_list failed: {accounts_res.status_code} {accounts_res.text}")
        try:
            account_id = accounts_res.json()["data"][0]["account_id"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError("could not auto-detect account_id from accounts response")

    return trade_client, account_id


def pull_all_orders(trade_client, account_id: str, rate_limiter: RateLimiter) -> list[dict]:
    """Pages through get_order_history until a page comes back shorter than
    PAGE_SIZE (or MAX_PAGES is hit as a safety cap). Every request -- including the
    first page -- goes through the shared rate_limiter, the same one used for
    order/detail fee fetches in the same cycle, so the two loops can't combine to
    exceed Webull's documented "2 requests / 2 seconds" order-query limit even though
    each paces itself independently otherwise.

    Cursor is last_client_order_id ONLY -- passing last_order_id (Webull's own
    internal order/leg id) at all, even alongside a valid last_client_order_id, makes
    the API respond 417 OAUTH_OPENAPI_ORDER_NOT_FOUND. Confirmed by testing each
    parameter in isolation against a real account: client_order_id-only succeeds,
    order_id-only and both-together both fail. Also note the paginated response comes
    back as a bare JSON list rather than the {"data": [...]} envelope the first page
    uses -- extract_orders() already handles both shapes."""
    all_orders: list[dict] = []
    last_client_order_id = None

    for _ in range(MAX_PAGES):
        rate_limiter.wait()
        res = trade_client.order_v2.get_order_history(
            account_id,
            page_size=PAGE_SIZE,
            start_date=START_DATE,
            end_date=END_DATE,
            last_client_order_id=last_client_order_id,
        )
        if res.status_code != 200:
            raise RuntimeError(f"get_order_history failed: {res.status_code} {res.text}")

        page = extract_orders(res.json())
        all_orders.extend(page)

        if len(page) < PAGE_SIZE:
            break

        last_combo = page[-1]
        last_inner = (last_combo.get("orders") or [{}])[0]
        new_last_client_order_id = last_inner.get("client_order_id")
        if new_last_client_order_id == last_client_order_id:
            break  # no progress -- stop rather than loop forever on the same page
        last_client_order_id = new_last_client_order_id
    else:
        print(f"WARNING: hit MAX_PAGES ({MAX_PAGES}) while paginating order history -- history may be truncated.")

    return all_orders


def run_sync() -> SyncSummary:
    """One full cycle: pull (paginated) -> normalize -> fetch fees -> group into
    trades -> write to Supabase -> log to sync_log. Never raises -- any failure is
    caught, logged as an error row, and returned in the summary, so a caller (the
    scheduler, or --once) never crashes on a bad cycle."""
    db = get_client()
    warnings: list[str] = []

    try:
        trade_client, account_id = _build_trade_client()
        rate_limiter = RateLimiter(TRADE_API_MIN_INTERVAL_SECONDS)

        raw_orders = pull_all_orders(trade_client, account_id, rate_limiter)

        executions, normalize_warnings = normalize_orders(raw_orders)
        warnings.extend(normalize_warnings)

        cache = FeesCache()
        warnings.extend(
            annotate_execution_fees(
                trade_client,
                account_id,
                executions,
                cache,
                rate_limiter,
                max_fetches_per_cycle=FEE_BACKFILL_BATCH_SIZE,
            )
        )

        trades, group_warnings = group_trades(executions)
        warnings.extend(group_warnings)
        warnings.extend(open_trade_warnings(trades))

        write_result = write_trades(db, WEBULL_USER_ID, trades)
        warnings.extend(write_result.warnings)

        status = "error" if write_result.warnings and not write_result.trade_ids else "success"
        summary = SyncSummary(
            status=status,
            orders_pulled=len(raw_orders),
            trades_written=len(write_result.trade_ids),
            warnings=warnings,
        )

    except Exception as exc:  # noqa: BLE001 -- a scheduled worker must never die from one bad cycle
        summary = SyncSummary(status="error", warnings=warnings, error=repr(exc))

    write_sync_log(
        db,
        WEBULL_USER_ID,
        summary.status,
        orders_pulled=summary.orders_pulled,
        trades_written=summary.trades_written,
        warnings_count=len(summary.warnings) + (1 if summary.error else 0),
        message=summary.error or ("; ".join(summary.warnings[:10]) if summary.warnings else None),
    )
    return summary


def _print_summary(summary: SyncSummary) -> None:
    print(
        f"[{datetime.now().isoformat()}] status={summary.status} orders_pulled={summary.orders_pulled} "
        f"trades_written={summary.trades_written} warnings={len(summary.warnings)}"
    )
    if summary.error:
        print(f"ERROR: {summary.error}", file=sys.stderr)
    for w in summary.warnings:
        print(f"  - {w}")


def _scheduled_job() -> None:
    if MARKET_HOURS_ONLY:
        should_run, reason = _should_sync_now()
        if not should_run:
            print(f"[{datetime.now().isoformat()}] skipping this cycle -- {reason}.")
            return
    _print_summary(run_sync())


def main() -> None:
    parser = argparse.ArgumentParser(description="Webull -> Supabase sync worker")
    parser.add_argument("--once", action="store_true", help="Run a single sync cycle and exit (for local testing)")
    args = parser.parse_args()

    if args.once:
        summary = run_sync()
        _print_summary(summary)
        sys.exit(0 if summary.status == "success" else 1)

    print(
        f"Starting scheduled sync worker: every {SYNC_INTERVAL_MINUTES} min"
        + (
            f", market-hours only ({MARKET_START_HOUR}-{MARKET_END_HOUR} America/New_York, Mon-Fri, "
            f"excluding US market holidays) + up to {AFTER_CLOSE_MAX_SYNCS} taper syncs in the "
            f"{AFTER_CLOSE_TAPER_HOURS}h after close"
            if MARKET_HOURS_ONLY
            else ""
        )
    )
    start_http_server(run_sync, _print_summary, port=int(os.environ.get("PORT", "8080")))

    scheduler = BlockingScheduler()
    scheduler.add_job(
        _scheduled_job,
        "interval",
        minutes=SYNC_INTERVAL_MINUTES,
        max_instances=1,  # a still-running cycle blocks the next fire time instead of stacking
        coalesce=True,  # missed fire times (e.g. after a hang) collapse into a single run, not a backlog
        next_run_time=datetime.now(),  # run once immediately on startup, then on the interval
    )
    scheduler.start()


if __name__ == "__main__":
    main()
