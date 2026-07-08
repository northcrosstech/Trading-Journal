"""
Phase 1 milestone: one authenticated Webull OpenAPI call that prints recent orders.

On the very first run for a given App Key, the SDK creates a one-time token and polls
for your approval in the Webull app (defaults: every 5s, up to 300s) before this returns.
Approve it there when prompted. The token is cached afterward, so later runs are instant.
"""
import os
import sys

from dotenv import load_dotenv
from webull.core.client import ApiClient
from webull.trade.trade_client import TradeClient

load_dotenv()

APP_KEY = os.environ["WEBULL_APP_KEY"]
APP_SECRET = os.environ["WEBULL_APP_SECRET"]
REGION_ID = os.environ.get("WEBULL_REGION_ID", "us")
ENDPOINT = os.environ["WEBULL_ENDPOINT"]
ACCOUNT_ID = os.environ.get("WEBULL_ACCOUNT_ID")


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
    print("accounts:", accounts)

    account_id = ACCOUNT_ID
    if not account_id:
        try:
            account_id = accounts["data"][0]["account_id"]
        except (KeyError, IndexError, TypeError):
            print(
                "Could not auto-detect account_id from the response above. "
                "Set WEBULL_ACCOUNT_ID in worker/.env and re-run.",
                file=sys.stderr,
            )
            sys.exit(1)

    orders_res = trade_client.order_v2.get_order_history(account_id, page_size=20)
    if orders_res.status_code != 200:
        print(f"get_order_history failed: {orders_res.status_code} {orders_res.text}", file=sys.stderr)
        sys.exit(1)

    print("recent orders:", orders_res.json())


if __name__ == "__main__":
    main()
