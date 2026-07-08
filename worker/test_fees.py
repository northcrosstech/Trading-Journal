"""
Unit tests for fees.py using a fake trade_client (no real network, no real SDK
exceptions) -- verifies caching skip behavior, PENDING-vs-resolved handling,
retry/backoff on failure, and the per-cycle fetch budget, all without waiting on real
throttle intervals (RateLimiter is constructed with min_interval_seconds=0).
"""
from datetime import datetime, timedelta

import pytest

from fees import PENDING, FeesCache, annotate_execution_fees, fetch_order_fees
from rate_limiter import RateLimiter
from transform import Execution


def _rate_limiter():
    return RateLimiter(min_interval_seconds=0)


def _execution(order_id, actual_fee=None, filled_at=None):
    return Execution(
        contract_key="SPY|500.0|2026-07-17|CALL",
        symbol="SPY",
        option_type="CALL",
        strike=500.0,
        expiration="2026-07-17",
        action="open",
        side="buy",
        quantity=1,
        price_per_contract=1.0,
        multiplier=100,
        dollar_value=100.0,
        filled_at=filled_at or datetime(2026, 1, 1),
        order_id=order_id,
        actual_fee=actual_fee,
    )


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def _detail_payload(fees):
    return {"orders": [{"fees": fees}]}


class _FakeOrderV2:
    def __init__(self, responses):
        # responses: dict[client_order_id] -> list of _Response to return, one per call
        self._responses = {k: list(v) for k, v in responses.items()}
        self.calls = []

    def get_order_detail(self, account_id, client_order_id):
        self.calls.append(client_order_id)
        queue = self._responses[client_order_id]
        return queue.pop(0) if len(queue) > 1 else queue[0]


class _FakeTradeClient:
    def __init__(self, responses):
        self.order_v2 = _FakeOrderV2(responses)


def test_fetch_order_fees_sums_populated_fees_list():
    payload = _detail_payload([{"type": "ORF", "actual_value": "0.30"}, {"type": "SEC", "actual_value": "0.02"}])
    client = _FakeTradeClient({"abc": [_Response(200, payload)]})

    fee = fetch_order_fees(client, "acct", "abc")

    assert fee == pytest.approx(0.32)


def test_fetch_order_fees_returns_none_for_empty_list():
    client = _FakeTradeClient({"abc": [_Response(200, _detail_payload([]))]})

    fee = fetch_order_fees(client, "acct", "abc")

    assert fee is None


def test_fetch_order_fees_raises_on_non_200():
    from fees import FeesFetchError

    client = _FakeTradeClient({"abc": [_Response(500, {"message": "boom"})]})

    with pytest.raises(FeesFetchError):
        fetch_order_fees(client, "acct", "abc")


def test_annotate_execution_fees_skips_already_resolved_cache_entries(tmp_path):
    cache = FeesCache(tmp_path / "cache.json")
    cache.set("known", 1.23)

    execs = [_execution("known")]
    client = _FakeTradeClient({})  # no responses configured -- a call here would KeyError

    warnings = annotate_execution_fees(client, "acct", execs, cache, _rate_limiter())

    assert warnings == []
    assert execs[0].actual_fee == pytest.approx(1.23)
    assert client.order_v2.calls == []  # never called the network for a cached order


def test_annotate_execution_fees_marks_empty_result_as_pending_and_retries_next_time(tmp_path):
    cache_path = tmp_path / "cache.json"
    cache = FeesCache(cache_path)

    execs = [_execution("still-settling")]
    client = _FakeTradeClient({"still-settling": [_Response(200, _detail_payload([]))]})

    warnings = annotate_execution_fees(client, "acct", execs, cache, _rate_limiter())

    assert warnings == []
    assert execs[0].actual_fee is None
    assert cache.get("still-settling") == PENDING

    # A second run against a fresh FeesCache instance loaded from the same file must
    # still see PENDING (not a resolved float) and must be willing to retry.
    reloaded = FeesCache(cache_path)
    assert reloaded.get("still-settling") == PENDING


def test_annotate_execution_fees_retries_on_failure_then_succeeds(tmp_path):
    cache = FeesCache(tmp_path / "cache.json")
    execs = [_execution("flaky")]
    client = _FakeTradeClient(
        {
            "flaky": [
                _Response(500, {"message": "transient"}),
                _Response(500, {"message": "transient"}),
                _Response(200, _detail_payload([{"type": "ORF", "actual_value": "0.10"}])),
            ]
        }
    )

    warnings = annotate_execution_fees(client, "acct", execs, cache, _rate_limiter(), max_retries=3)

    assert warnings == []
    assert execs[0].actual_fee == pytest.approx(0.10)
    assert len(client.order_v2.calls) == 3


def test_annotate_execution_fees_gives_up_after_max_retries_and_warns(tmp_path):
    cache = FeesCache(tmp_path / "cache.json")
    execs = [_execution("always-fails")]
    client = _FakeTradeClient({"always-fails": [_Response(500, {"message": "down"})]})

    warnings = annotate_execution_fees(client, "acct", execs, cache, _rate_limiter(), max_retries=2)

    assert execs[0].actual_fee is None
    assert any("always-fails" in w for w in warnings)
    assert len(client.order_v2.calls) == 2


def test_annotate_execution_fees_respects_per_cycle_batch_limit(tmp_path):
    cache = FeesCache(tmp_path / "cache.json")
    base_time = datetime(2026, 1, 1)

    # 5 never-before-seen orders, oldest to newest.
    execs = [
        _execution(f"order-{i}", filled_at=base_time + timedelta(minutes=i))
        for i in range(5)
    ]
    responses = {
        e.order_id: [_Response(200, _detail_payload([{"type": "ORF", "actual_value": "0.10"}]))]
        for e in execs
    }
    client = _FakeTradeClient(responses)

    warnings = annotate_execution_fees(client, "acct", execs, cache, _rate_limiter(), max_fetches_per_cycle=2)

    assert warnings == []
    assert len(client.order_v2.calls) == 2
    assert client.order_v2.calls == ["order-0", "order-1"]  # oldest first

    resolved = [e for e in execs if e.actual_fee is not None]
    unresolved = [e for e in execs if e.actual_fee is None]
    assert {e.order_id for e in resolved} == {"order-0", "order-1"}
    assert {e.order_id for e in unresolved} == {"order-2", "order-3", "order-4"}

    # Untouched orders must not be cached as PENDING either -- next cycle should still
    # treat them as never-looked-up, not skip them or misreport them as settled-empty.
    assert cache.get("order-2") is None


def test_annotate_execution_fees_second_cycle_picks_up_where_first_left_off(tmp_path):
    cache_path = tmp_path / "cache.json"
    cache = FeesCache(cache_path)
    base_time = datetime(2026, 1, 1)

    execs = [
        _execution(f"order-{i}", filled_at=base_time + timedelta(minutes=i))
        for i in range(3)
    ]
    responses = {
        e.order_id: [_Response(200, _detail_payload([{"type": "ORF", "actual_value": "0.10"}]))]
        for e in execs
    }
    client = _FakeTradeClient(responses)

    annotate_execution_fees(client, "acct", execs, cache, _rate_limiter(), max_fetches_per_cycle=1)
    assert [e.order_id for e in execs if e.actual_fee is not None] == ["order-0"]

    # Simulate a later sync cycle re-normalizing the same orders (fresh Execution
    # objects, actual_fee reset to None) but sharing the same on-disk cache.
    execs2 = [
        _execution(f"order-{i}", filled_at=base_time + timedelta(minutes=i))
        for i in range(3)
    ]
    cache2 = FeesCache(cache_path)
    annotate_execution_fees(client, "acct", execs2, cache2, _rate_limiter(), max_fetches_per_cycle=1)

    # order-0 came straight from cache (no new call); order-1 is the new fetch this cycle.
    assert client.order_v2.calls == ["order-0", "order-1"]
    assert [e.actual_fee for e in execs2] == [pytest.approx(0.10), pytest.approx(0.10), None]
