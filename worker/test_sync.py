"""
Unit tests for the new logic in sync.py: order-history pagination and market-hours
gating. No network, no Supabase -- pull_all_orders is tested against a fake trade_client.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

import sync
from rate_limiter import RateLimiter


def _rate_limiter():
    return RateLimiter(min_interval_seconds=0)


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def _combo(n):
    return {
        "client_order_id": f"client-{n}",
        "combo_order_id": f"order-{n}",
        "orders": [{"order_id": f"order-{n}", "client_order_id": f"client-{n}"}],
    }


class _FakeOrderV2:
    def __init__(self, pages):
        self.pages = pages  # list of lists of combo dicts, one list per call
        self.calls = []

    # No last_order_id param here ON PURPOSE: passing it at all (even alongside a
    # valid last_client_order_id) makes the real API respond 417
    # OAUTH_OPENAPI_ORDER_NOT_FOUND -- confirmed by testing each cursor param in
    # isolation against a real account. If sync.py regresses and starts passing
    # last_order_id again, this fake raises TypeError immediately.
    def get_order_history(self, account_id, page_size=None, start_date=None, end_date=None,
                           last_client_order_id=None):
        self.calls.append({"last_client_order_id": last_client_order_id})
        idx = len(self.calls) - 1
        page = self.pages[idx] if idx < len(self.pages) else []
        # Real behavior: the first (unpaginated) call returns a {"data": [...]}
        # envelope; subsequent paginated calls return a bare list. extract_orders()
        # handles both -- exercise both shapes here too.
        payload = {"data": page} if idx == 0 else page
        return _Response(200, payload)


class _FakeTradeClient:
    def __init__(self, pages):
        self.order_v2 = _FakeOrderV2(pages)


def test_pull_all_orders_stops_when_page_shorter_than_page_size(monkeypatch):
    monkeypatch.setattr(sync, "PAGE_SIZE", 3)

    page1 = [_combo(1), _combo(2), _combo(3)]  # full page
    page2 = [_combo(4)]  # short page -- pagination should stop here
    client = _FakeTradeClient([page1, page2])

    orders = sync.pull_all_orders(client, "acct", _rate_limiter())

    assert len(orders) == 4
    assert len(client.order_v2.calls) == 2


def test_pull_all_orders_passes_previous_pages_last_cursor(monkeypatch):
    monkeypatch.setattr(sync, "PAGE_SIZE", 2)

    page1 = [_combo(1), _combo(2)]
    page2 = [_combo(3)]
    client = _FakeTradeClient([page1, page2])

    sync.pull_all_orders(client, "acct", _rate_limiter())

    first_call, second_call = client.order_v2.calls
    assert first_call["last_client_order_id"] is None  # no cursor on the first page
    assert second_call["last_client_order_id"] == "client-2"


def test_pull_all_orders_stops_on_no_progress(monkeypatch):
    monkeypatch.setattr(sync, "PAGE_SIZE", 2)
    monkeypatch.setattr(sync, "MAX_PAGES", 50)

    # A pathological API that keeps returning the exact same full page regardless of
    # the cursor sent -- must not loop forever chasing a cursor that never advances.
    same_page = [_combo(1), _combo(2)]
    client = _FakeTradeClient([same_page, same_page, same_page])

    orders = sync.pull_all_orders(client, "acct", _rate_limiter())

    assert len(client.order_v2.calls) == 2  # first page, then one more reveals no progress
    assert len(orders) == 4  # both fetched pages still get counted


def test_pull_all_orders_respects_max_pages_cap(monkeypatch, capsys):
    monkeypatch.setattr(sync, "PAGE_SIZE", 2)
    monkeypatch.setattr(sync, "MAX_PAGES", 3)

    # Always a full page with a genuinely new cursor -- infinite real history.
    pages = [[_combo(n), _combo(n + 1)] for n in range(0, 20, 2)]
    client = _FakeTradeClient(pages)

    orders = sync.pull_all_orders(client, "acct", _rate_limiter())

    assert len(client.order_v2.calls) == 3
    assert len(orders) == 6
    assert "MAX_PAGES" in capsys.readouterr().out


@pytest.mark.parametrize(
    "when, expected",
    [
        (datetime(2026, 7, 8, 10, 0, tzinfo=ZoneInfo("America/New_York")), True),  # Wed 10am
        (datetime(2026, 7, 8, 8, 0, tzinfo=ZoneInfo("America/New_York")), False),  # Wed 8am, before open
        (datetime(2026, 7, 8, 17, 0, tzinfo=ZoneInfo("America/New_York")), False),  # Wed 5pm, at the boundary
        (datetime(2026, 7, 8, 16, 59, tzinfo=ZoneInfo("America/New_York")), True),  # Wed 4:59pm, just inside
        (datetime(2026, 7, 11, 10, 0, tzinfo=ZoneInfo("America/New_York")), False),  # Saturday
        (datetime(2026, 7, 12, 10, 0, tzinfo=ZoneInfo("America/New_York")), False),  # Sunday
    ],
)
def test_is_market_hours(when, expected):
    assert sync.is_market_hours(when) is expected
