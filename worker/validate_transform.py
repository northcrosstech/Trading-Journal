"""
Throwaway validation script: pulls real order history via the same auth path proven in
auth_test.py, runs it through transform.process_orders, and prints the grouped trades so
you can eyeball them against your Webull app history. Writes nothing to any database.

    python validate_transform.py

Optional env vars (in worker/.env):
    WEBULL_ORDER_START_DATE=yyyy-MM-dd   (default: Webull's own default, last 7 days)
    WEBULL_ORDER_END_DATE=yyyy-MM-dd
    WEBULL_ORDER_PAGE_SIZE=100            (default 100; bump if you trade a lot)
    WEBULL_FEE_FETCH_INTERVAL_SECONDS=1.0 (throttle between get_order_detail calls)

Fee fetching calls get_order_detail once per distinct order_id (throttled, with
backoff/retry -- see fees.py) and caches resolved fees in worker/.fees_cache.json so
re-running this script doesn't re-fetch orders it already has answers for.
"""
import os
import sys

from dotenv import load_dotenv
from webull.core.client import ApiClient
from webull.trade.trade_client import TradeClient

from fees import FeesCache, annotate_execution_fees
from transform import extract_orders, normalize_orders, group_trades, open_trade_warnings, print_report

load_dotenv()

APP_KEY = os.environ["WEBULL_APP_KEY"]
APP_SECRET = os.environ["WEBULL_APP_SECRET"]
REGION_ID = os.environ.get("WEBULL_REGION_ID", "us")
ENDPOINT = os.environ["WEBULL_ENDPOINT"]
ACCOUNT_ID = os.environ.get("WEBULL_ACCOUNT_ID")
START_DATE = os.environ.get("WEBULL_ORDER_START_DATE")
END_DATE = os.environ.get("WEBULL_ORDER_END_DATE")
PAGE_SIZE = int(os.environ.get("WEBULL_ORDER_PAGE_SIZE", "100"))
FEE_FETCH_INTERVAL_SECONDS = float(os.environ.get("WEBULL_FEE_FETCH_INTERVAL_SECONDS", "1.0"))


def main():
    api_client = ApiClient(APP_KEY, APP_SECRET, REGION_ID)
    api_client.add_endpoint(REGION_ID, ENDPOINT)
    trade_client = TradeClient(api_client)

    print("Waiting for token approval — open your Webull app and approve the request (up to 5 minutes)...")
    accounts_res = trade_client.account_v2.get_account_list()
    if accounts_res.status_code != 200:
        print(f"get_account_list failed: {accounts_res.status_code} {accounts_res.text}", file=sys.stderr)
        sys.exit(1)

    accounts = accounts_res.json()

    account_id = ACCOUNT_ID
    if not account_id:
        try:
            account_id = accounts["data"][0]["account_id"]
        except (KeyError, IndexError, TypeError):
            print(
                "Could not auto-detect account_id from the accounts response. "
                "Set WEBULL_ACCOUNT_ID in worker/.env and re-run.",
                file=sys.stderr,
            )
            sys.exit(1)

    orders_res = trade_client.order_v2.get_order_history(
        account_id, page_size=PAGE_SIZE, start_date=START_DATE, end_date=END_DATE
    )
    if orders_res.status_code != 200:
        print(f"get_order_history failed: {orders_res.status_code} {orders_res.text}", file=sys.stderr)
        sys.exit(1)

    raw_orders = extract_orders(orders_res.json())
    print(f"Pulled {len(raw_orders)} raw order(s).")
    if len(raw_orders) == PAGE_SIZE:
        print(
            f"NOTE: order count equals page_size ({PAGE_SIZE}) -- there may be more history "
            "than this single page returned. Narrow WEBULL_ORDER_START_DATE/END_DATE or raise "
            "WEBULL_ORDER_PAGE_SIZE if trades look like they're missing."
        )
    print()

    executions, warnings = normalize_orders(raw_orders)

    cache = FeesCache()
    fee_warnings = annotate_execution_fees(
        trade_client, account_id, executions, cache, min_interval_seconds=FEE_FETCH_INTERVAL_SECONDS
    )
    warnings.extend(fee_warnings)

    trades, group_warnings = group_trades(executions)
    warnings.extend(group_warnings)
    warnings.extend(open_trade_warnings(trades))

    print_report(trades, warnings)


if __name__ == "__main__":
    main()
