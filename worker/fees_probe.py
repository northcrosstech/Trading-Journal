"""
Throwaway probe: find out where Webull actually surfaces commission/fee data.

Does NOT touch transform.py or write anywhere -- just dumps raw JSON from a few
candidate endpoints so we can decide, with real data in hand, how (and from where)
to wire fees into the grouping logic.

    python fees_probe.py

Prints, in order:
  1. Full raw JSON of one recent filled order from get_order_history (account_id
     redacted; everything else -- including fees/commission -- left intact).
  2. That same order's get_order_detail response -- a different endpoint
     (/openapi/trade/order/detail) that might expose settled fields the batch
     history call doesn't.
  3. Full raw JSON of an older filled order (~1-4 weeks back), in case fees only
     populate after settlement rather than immediately on fill.
  4. That older order's get_order_detail response.
  5. Raw response from activity.get_activities (/openapi/trade/activities/cash)
     for the same historical window, in case fees live in the cash-activity ledger
     rather than on the order at all.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from webull.core.client import ApiClient
from webull.trade.trade_client import TradeClient

from transform import extract_orders

load_dotenv()

APP_KEY = os.environ["WEBULL_APP_KEY"]
APP_SECRET = os.environ["WEBULL_APP_SECRET"]
REGION_ID = os.environ.get("WEBULL_REGION_ID", "us")
ENDPOINT = os.environ["WEBULL_ENDPOINT"]
ACCOUNT_ID = os.environ.get("WEBULL_ACCOUNT_ID")

_REDACT_KEY = re.compile(r"account.*(id|no|number)|routing", re.IGNORECASE)


def _redact(obj):
    if isinstance(obj, dict):
        return {k: ("«redacted»" if _REDACT_KEY.search(k) else _redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


def dump(label, payload):
    print(f"\n===== {label} =====")
    print(json.dumps(_redact(payload), indent=2, default=str))


def find_filled_order(raw_orders):
    for combo in raw_orders:
        for inner in combo.get("orders", []):
            if inner.get("status") == "FILLED":
                return combo, inner
    return None, None


def get_account_id(trade_client):
    if ACCOUNT_ID:
        return ACCOUNT_ID
    accounts_res = trade_client.account_v2.get_account_list()
    if accounts_res.status_code != 200:
        print(f"get_account_list failed: {accounts_res.status_code} {accounts_res.text}", file=sys.stderr)
        sys.exit(1)
    try:
        return accounts_res.json()["data"][0]["account_id"]
    except (KeyError, IndexError, TypeError):
        print(
            "Could not auto-detect account_id from the accounts response. "
            "Set WEBULL_ACCOUNT_ID in worker/.env and re-run.",
            file=sys.stderr,
        )
        sys.exit(1)


def probe_order_and_detail(trade_client, account_id, label, **history_kwargs):
    res = trade_client.order_v2.get_order_history(account_id, page_size=20, **history_kwargs)
    if res.status_code != 200:
        print(f"get_order_history ({label}) failed: {res.status_code} {res.text}", file=sys.stderr)
        return

    combo, inner = find_filled_order(extract_orders(res.json()))
    if combo is None:
        print(f"No FILLED order found for {label} window.")
        return

    dump(f"{label.upper()} FILLED ORDER ({inner.get('filled_time_at')}) -- full combo wrapper", combo)

    client_order_id = inner.get("client_order_id")
    if not client_order_id:
        print(f"{label}: no client_order_id on the inner order, can't call get_order_detail.")
        return

    detail_res = trade_client.order_v2.get_order_detail(account_id, client_order_id)
    print(f"\nget_order_detail ({label}) status: {detail_res.status_code}")
    dump(
        f"{label.upper()} ORDER -- get_order_detail response",
        detail_res.json() if detail_res.status_code == 200 else detail_res.text,
    )


def main():
    api_client = ApiClient(APP_KEY, APP_SECRET, REGION_ID)
    api_client.add_endpoint(REGION_ID, ENDPOINT)
    trade_client = TradeClient(api_client)

    print("Waiting for token approval — open your Webull app and approve the request (up to 5 minutes)...")
    account_id = get_account_id(trade_client)

    # 1. Recent filled order -- today-ish, likely the empty-fees case you already saw.
    probe_order_and_detail(trade_client, account_id, "recent")

    # 2. Older filled order -- give it a few weeks to settle.
    today = datetime.now(timezone.utc).date()
    old_start = (today - timedelta(days=30)).isoformat()
    old_end = (today - timedelta(days=3)).isoformat()
    probe_order_and_detail(trade_client, account_id, "older", start_date=old_start, end_date=old_end)

    # 3. Cash activities ledger for the same older window.
    activities_res = trade_client.activity.get_activities(
        account_id, start_time=old_start, end_time=today.isoformat(), page_size=50
    )
    print(f"\nget_activities status: {activities_res.status_code}")
    dump(
        "CASH ACTIVITIES",
        activities_res.json() if activities_res.status_code == 200 else activities_res.text,
    )


if __name__ == "__main__":
    main()
