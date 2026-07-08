"""
Confirms what OHLCV granularity is actually available under this account's market-data
subscription (see the accounts/keys checklist in claude.md). Requests M1 and D bars for
one symbol and prints the raw response, including status codes -- a 403 here means the
OpenAPI market-data subscription isn't active yet (separate from app-level subscriptions).
"""
import os
import sys

from dotenv import load_dotenv
from webull.core.client import ApiClient
from webull.data.data_client import DataClient
from webull.data.common.category import Category
from webull.data.common.timespan import Timespan

load_dotenv()

APP_KEY = os.environ["WEBULL_APP_KEY"]
APP_SECRET = os.environ["WEBULL_APP_SECRET"]
REGION_ID = os.environ.get("WEBULL_REGION_ID", "us")
API_ENDPOINT = os.environ.get("WEBULL_API_ENDPOINT", "us-openapi-alb.uat.webullbroker.com")
SYMBOL = os.environ.get("WEBULL_TEST_SYMBOL", "AAPL")


def main():
    api_client = ApiClient(APP_KEY, APP_SECRET, REGION_ID)
    api_client.add_endpoint(REGION_ID, API_ENDPOINT)
    data_client = DataClient(api_client)

    for timespan in (Timespan.M1, Timespan.D):
        res = data_client.market_data.get_history_bar(SYMBOL, Category.US_STOCK.name, timespan.name, count="5")
        print(f"{timespan.name} bars -> status {res.status_code}")
        print(res.json() if res.status_code == 200 else res.text)


if __name__ == "__main__":
    main()
