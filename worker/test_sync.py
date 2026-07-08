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
        (datetime(2026, 7, 3, 10, 0, tzinfo=ZoneInfo("America/New_York")), False),  # Independence Day (observed)
        (datetime(2026, 11, 26, 10, 0, tzinfo=ZoneInfo("America/New_York")), False),  # Thanksgiving
    ],
)
def test_is_market_hours(when, expected):
    assert sync.is_market_hours(when) is expected


@pytest.fixture(autouse=True)
def _reset_taper_state(monkeypatch):
    monkeypatch.setattr(sync, "_taper_date", None)
    monkeypatch.setattr(sync, "_taper_count", 0)


def test_should_sync_now_true_during_regular_hours():
    when = datetime(2026, 7, 8, 10, 0, tzinfo=ZoneInfo("America/New_York"))  # Wed 10am
    should_run, _ = sync._should_sync_now(when)
    assert should_run is True


def test_should_sync_now_false_on_weekend():
    when = datetime(2026, 7, 11, 10, 0, tzinfo=ZoneInfo("America/New_York"))  # Saturday
    should_run, reason = sync._should_sync_now(when)
    assert should_run is False
    assert "trading day" in reason


def test_should_sync_now_false_on_market_holiday():
    when = datetime(2026, 12, 25, 10, 0, tzinfo=ZoneInfo("America/New_York"))  # Christmas
    should_run, reason = sync._should_sync_now(when)
    assert should_run is False
    assert "trading day" in reason


def test_should_sync_now_allows_limited_taper_syncs_after_close():
    close = datetime(2026, 7, 8, 17, 0, tzinfo=ZoneInfo("America/New_York"))  # Wed 5pm, right at close

    first_should_run, _ = sync._should_sync_now(close)
    second_should_run, _ = sync._should_sync_now(close.replace(minute=20))
    third_should_run, reason = sync._should_sync_now(close.replace(minute=40))

    assert first_should_run is True
    assert second_should_run is True
    assert third_should_run is False  # AFTER_CLOSE_MAX_SYNCS default is 2
    assert "taper budget" in reason


def test_should_sync_now_false_after_taper_window_ends():
    late_night = datetime(2026, 7, 8, 20, 0, tzinfo=ZoneInfo("America/New_York"))  # Wed 8pm, well past the 1h taper
    should_run, reason = sync._should_sync_now(late_night)
    assert should_run is False
    assert "taper window" in reason


def test_should_sync_now_taper_budget_resets_on_a_new_day():
    day1_close = datetime(2026, 7, 8, 17, 10, tzinfo=ZoneInfo("America/New_York"))
    day2_close = datetime(2026, 7, 9, 17, 10, tzinfo=ZoneInfo("America/New_York"))

    assert sync._should_sync_now(day1_close)[0] is True
    assert sync._should_sync_now(day1_close.replace(minute=30))[0] is True
    assert sync._should_sync_now(day1_close.replace(minute=50))[0] is False  # budget used up on day 1

    assert sync._should_sync_now(day2_close)[0] is True  # fresh budget on day 2
