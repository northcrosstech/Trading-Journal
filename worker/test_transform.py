"""
Unit tests for transform.py using fixtures shaped like the REAL Webull order_history
nesting confirmed against a live account: a three-level combo wrapper, not a flat order.

    combo wrapper: { client_order_id, combo_order_id, option_strategy, orders: [...] }
      orders[0]:   { position_intent, filled_price, filled_quantity, filled_time_at, legs: [...] }
        legs[0]:   { symbol, strike_price, option_expire_date, option_type, option_contract_multiplier }

An earlier version of these fixtures flattened position_intent etc. to the wrapper level,
which happened to match where the (buggy) extraction code was reading from -- so the bug
never showed up in tests, only against real orders. These fixtures now mirror the real
nesting so that class of bug would be caught here.
"""
import pytest

from fee_rates import estimate_fees
from transform import group_trades, normalize_orders, process_orders


def _set_actual_fees(executions, fees_by_order_id):
    for e in executions:
        if e.order_id in fees_by_order_id:
            e.actual_fee = fees_by_order_id[e.order_id]


def _order(intent, qty, price, filled_at, symbol="META", strike=620, expiration="2026-07-17",
           option_type="CALL", multiplier=100, order_id=None, status="FILLED"):
    # client_order_id (caller-generated) and order_id/combo_order_id (Webull's own,
    # broker-side id) are deliberately DIFFERENT strings here, like real data -- see
    # test_execution_order_id_is_client_order_id_not_brokers_internal_id. An earlier
    # version of this fixture used the same value for both, which is exactly how the
    # wrong-id bug (get_order_detail needs client_order_id, not order_id) slipped
    # through every test.
    client_order_id = order_id or f"{symbol}-{filled_at}"
    broker_order_id = f"BROKER-{client_order_id}"
    return {
        "client_order_id": client_order_id,
        "combo_order_id": broker_order_id,
        "option_strategy": "SINGLE",
        "orders": [
            {
                "order_id": broker_order_id,
                "client_order_id": client_order_id,
                "symbol": symbol,
                "position_intent": intent,
                "order_type": "LIMIT",
                "status": status,
                "filled_price": price,
                "filled_quantity": qty,
                "filled_time_at": filled_at,
                "place_time_at": filled_at,
                "legs": [
                    {
                        "symbol": symbol,
                        "strike_price": strike,
                        "option_expire_date": expiration,
                        "option_type": option_type,
                        "option_contract_multiplier": multiplier,
                    }
                ],
            }
        ],
    }


def test_execution_order_id_is_client_order_id_not_brokers_internal_id():
    # Regression guard: get_order_detail's client_order_id param needs the
    # caller-generated id. Preferring Webull's own order_id/leg id instead made every
    # real fee-fetch call 404 (OAUTH_OPENAPI_ORDER_NOT_FOUND) despite normalize_order
    # never raising -- the bug was silent until fees.py tried to use the wrong id.
    orders = [_order("BUY_TO_OPEN", 1, 1.00, "2026-07-07T09:00:00Z", order_id="my-client-id-123")]

    executions, warnings = normalize_orders(orders)

    assert warnings == []
    assert executions[0].order_id == "my-client-id-123"
    assert executions[0].order_id != "BROKER-my-client-id-123"


def test_meta_620c_multi_open_close_and_reopen_same_day():
    orders = [
        _order("BUY_TO_OPEN", 2, 5.00, "2026-07-07T09:35:00Z"),
        _order("BUY_TO_OPEN", 1, 5.50, "2026-07-07T09:40:00Z"),
        _order("SELL_TO_CLOSE", 1, 6.00, "2026-07-07T10:00:00Z"),
        _order("SELL_TO_CLOSE", 2, 6.50, "2026-07-07T10:15:00Z"),
        _order("BUY_TO_OPEN", 1, 4.00, "2026-07-07T13:00:00Z"),
        _order("SELL_TO_CLOSE", 1, 4.50, "2026-07-07T13:30:00Z"),
    ]

    trades, warnings = process_orders(orders)

    assert warnings == []
    assert len(trades) == 2

    first, second = sorted(trades, key=lambda t: t.executions[0].filled_at)

    assert first.status == "CLOSED"
    assert first.trade_direction == "long"
    assert [e.tag for e in first.executions] == ["open", "add", "trim", "close"]
    assert first.total_contracts == 3
    assert first.avg_entry_price == pytest.approx((2 * 5.00 + 1 * 5.50) / 3)
    assert first.avg_exit_price == pytest.approx((1 * 6.00 + 2 * 6.50) / 3)
    assert first.hold_seconds == 40 * 60
    assert first.realized_pnl_gross == pytest.approx(350.0)

    # A fresh open after the contract went flat is a new trade, not a continuation.
    assert second.status == "CLOSED"
    assert [e.tag for e in second.executions] == ["open", "close"]
    assert second.total_contracts == 1
    assert second.avg_entry_price == pytest.approx(4.00)
    assert second.avg_exit_price == pytest.approx(4.50)
    assert second.realized_pnl_gross == pytest.approx(50.0)


def test_short_premium_pnl_is_credit_minus_debit():
    orders = [
        _order("SELL_TO_OPEN", 1, 3.00, "2026-07-07T09:00:00Z", symbol="TSLA", strike=250,
               option_type="PUT"),
        _order("BUY_TO_CLOSE", 1, 1.50, "2026-07-07T09:30:00Z", symbol="TSLA", strike=250,
               option_type="PUT"),
    ]

    trades, warnings = process_orders(orders)

    assert warnings == []
    assert len(trades) == 1
    trade = trades[0]
    assert trade.trade_direction == "short"
    assert trade.status == "CLOSED"
    # Credit received (300) minus debit paid to close (150).
    assert trade.realized_pnl_gross == pytest.approx(150.0)


def test_still_open_position_is_flagged_not_closed():
    orders = [
        _order("BUY_TO_OPEN", 5, 2.00, "2026-07-07T09:00:00Z", symbol="NVDA", strike=900),
    ]

    trades, warnings = process_orders(orders)

    assert len(trades) == 1
    trade = trades[0]
    assert trade.status == "OPEN"
    assert trade.residual_quantity == 5
    assert trade.realized_pnl_gross is None
    assert any("still open" in w for w in warnings)


def test_missing_position_intent_is_flagged_not_crashed():
    bad_order = _order("BUY_TO_OPEN", 1, 1.00, "2026-07-07T09:00:00Z", symbol="SPY", strike=500)
    del bad_order["orders"][0]["position_intent"]

    good_order = _order("BUY_TO_OPEN", 1, 2.00, "2026-07-07T09:00:00Z", symbol="QQQ", strike=400)

    trades, warnings = process_orders([bad_order, good_order])

    # The bad order is dropped with a warning; the good order still gets processed.
    assert len(trades) == 1
    assert trades[0].symbol == "QQQ"
    assert any("position_intent" in w for w in warnings)


def test_cancelled_order_is_skipped_quietly_not_crashed():
    # Real order_history includes non-filled orders (e.g. CANCELLED) that have no
    # filled_price/filled_quantity at all -- this is what actually crashed the first
    # version of normalize_order against real data (a bare KeyError, not a GroupingError).
    cancelled = _order("BUY_TO_OPEN", 1, 1.00, "2026-07-07T09:00:00Z", symbol="SPY", strike=500,
                        status="CANCELLED")
    del cancelled["orders"][0]["filled_price"]
    del cancelled["orders"][0]["filled_quantity"]

    good_order = _order("BUY_TO_OPEN", 1, 2.00, "2026-07-07T09:00:00Z", symbol="QQQ", strike=400)

    trades, warnings = process_orders([cancelled, good_order])

    assert len(trades) == 1
    assert trades[0].symbol == "QQQ"
    # Routine, not an anomaly: tallied in one summary line, not per-order noise, and
    # must not appear as a position_intent warning.
    assert any("no fill" in w for w in warnings)
    assert not any("position_intent" in w for w in warnings)


def test_combo_order_with_multiple_leg_orders_is_flagged_and_skipped():
    # A multi-leg strategy (e.g. a vertical spread) shows up as more than one entry in
    # the combo wrapper's "orders" list. Only single-leg is supported right now.
    combo = _order("BUY_TO_OPEN", 1, 1.00, "2026-07-07T09:00:00Z", symbol="SPY", strike=500)
    combo["option_strategy"] = "VERTICAL"
    second_leg_order = dict(combo["orders"][0])
    second_leg_order["legs"] = [dict(combo["orders"][0]["legs"][0], strike_price=505)]
    combo["orders"].append(second_leg_order)

    good_order = _order("BUY_TO_OPEN", 1, 2.00, "2026-07-07T09:00:00Z", symbol="QQQ", strike=400)

    trades, warnings = process_orders([combo, good_order])

    assert len(trades) == 1
    assert trades[0].symbol == "QQQ"
    assert any("leg" in w.lower() for w in warnings)


def test_single_order_entry_with_multiple_legs_is_flagged_and_skipped():
    # Defensive: a single "orders" entry that itself carries more than one leg.
    order = _order("BUY_TO_OPEN", 1, 1.00, "2026-07-07T09:00:00Z", symbol="IWM", strike=200)
    order["orders"][0]["legs"].append(dict(order["orders"][0]["legs"][0], strike_price=205))

    good_order = _order("BUY_TO_OPEN", 1, 2.00, "2026-07-07T09:00:00Z", symbol="DIA", strike=350)

    trades, warnings = process_orders([order, good_order])

    assert len(trades) == 1
    assert trades[0].symbol == "DIA"
    assert any("leg" in w.lower() for w in warnings)


def test_flip_within_single_aggregated_order_splits_into_close_and_reopen():
    # Hypothetical/defensive case: one order's fill quantity exceeds the open position,
    # flipping net exposure sign in a single aggregated fill. Real Webull data may never
    # produce this, but the grouping shouldn't crash if it does.
    orders = [
        _order("BUY_TO_OPEN", 2, 1.00, "2026-07-07T09:00:00Z", symbol="AAPL", strike=200),
        _order("SELL_TO_CLOSE", 5, 1.50, "2026-07-07T09:30:00Z", symbol="AAPL", strike=200),
    ]

    trades, warnings = process_orders(orders)

    assert len(trades) == 2
    first, second = sorted(trades, key=lambda t: t.executions[0].filled_at)

    assert first.status == "CLOSED"
    assert first.total_contracts == 2
    assert first.realized_pnl_gross == pytest.approx(-200 + 300)  # bought 2@1.00, sold 2@1.50

    assert second.status == "OPEN"
    assert second.trade_direction == "short"
    assert second.residual_quantity == -3
    assert any("flips net position" in w for w in warnings)


def test_net_pnl_uses_estimated_fee_when_actual_not_yet_resolved():
    # No actual fee data at all here (fetching that is a separate, later step -- see
    # fees.py). Net P&L must still be immediately available -- using the zero-API-call
    # estimate -- rather than staying None/pending the way it used to.
    orders = [
        _order("BUY_TO_OPEN", 1, 1.00, "2026-07-07T09:00:00Z", symbol="SPY", strike=500),
        _order("SELL_TO_CLOSE", 1, 1.50, "2026-07-07T09:30:00Z", symbol="SPY", strike=500),
    ]

    trades, _ = process_orders(orders)

    assert len(trades) == 1
    trade = trades[0]
    assert trade.realized_pnl_gross == pytest.approx(50.0)
    assert trade.fee_source == "estimated"
    assert trade.actual_fee is None
    expected_estimate = estimate_fees(1, "buy", 100.0) + estimate_fees(1, "sell", 150.0)
    assert trade.estimated_fee == pytest.approx(expected_estimate)
    assert trade.realized_pnl_net == pytest.approx(50.0 - expected_estimate)


def test_net_pnl_folds_fee_into_signed_cash_flow_when_fully_resolved():
    # Deterministic synthetic case (hand-computable) verifying the finalize() math once
    # every execution's actual fee is known: net must equal gross minus total actual
    # fee, and fee_source must switch to "actual".
    orders = [
        _order("BUY_TO_OPEN", 2, 5.00, "2026-07-07T09:00:00Z", symbol="MSFT", strike=400,
               order_id="open-1"),
        _order("SELL_TO_CLOSE", 2, 6.00, "2026-07-07T09:30:00Z", symbol="MSFT", strike=400,
               order_id="close-1"),
    ]

    executions, warnings = normalize_orders(orders)
    assert warnings == []
    _set_actual_fees(executions, {"open-1": 0.66, "close-1": 0.75})

    trades, group_warnings = group_trades(executions)
    assert group_warnings == []
    assert len(trades) == 1

    trade = trades[0]
    assert trade.fee_source == "actual"
    assert trade.actual_fee == pytest.approx(0.66 + 0.75)
    assert trade.realized_pnl_gross == pytest.approx(-1000 + 1200)  # 200.0
    assert trade.realized_pnl_net == pytest.approx(200.0 - (0.66 + 0.75))


def test_real_spy_746p_scale_in_then_close_with_real_fees_on_every_leg():
    # Real order sequence pulled from validate_transform.py against the live account
    # (2026-07-07): open 10@0.67, add 5@0.55, close 15@0.34. All three legs' real fees
    # came from a full validate_transform.py run wired to fees.py (each order's fee
    # fetched via get_order_detail and cached in worker/.fees_cache.json). Contrary to
    # the earlier hypothesis that BUY_TO_OPEN orders are always fee-free (regulatory
    # fees are typically sell-side only), the real data shows opening legs DO carry
    # fees here too (ORF/clearing fees apply both directions) -- so all three legs
    # resolved and this trade is NOT fees-pending.
    orders = [
        _order("BUY_TO_OPEN", 10, 0.67, "2026-07-07T15:55:50.590Z", symbol="SPY", strike=746,
               option_type="PUT", order_id="spy746p-open-1"),
        _order("BUY_TO_OPEN", 5, 0.55, "2026-07-07T16:08:25.788Z", symbol="SPY", strike=746,
               option_type="PUT", order_id="spy746p-open-2"),
        _order("SELL_TO_CLOSE", 15, 0.34, "2026-07-07T16:15:04.246Z", symbol="SPY", strike=746,
               option_type="PUT", order_id="spy746p-close"),
    ]

    executions, warnings = normalize_orders(orders)
    assert warnings == []
    _set_actual_fees(executions, {
        "spy746p-open-1": 0.45,
        "spy746p-open-2": 0.23,
        "spy746p-close": 0.75,
    })

    trades, group_warnings = group_trades(executions)
    assert group_warnings == []
    assert len(trades) == 1

    trade = trades[0]
    assert trade.total_contracts == 15
    assert trade.avg_entry_price == pytest.approx((10 * 0.67 + 5 * 0.55) / 15)
    assert trade.avg_exit_price == pytest.approx(0.34)
    assert trade.realized_pnl_gross == pytest.approx(-435.0)
    assert trade.fee_source == "actual"
    assert trade.actual_fee == pytest.approx(0.45 + 0.23 + 0.75)  # 1.43
    assert trade.realized_pnl_net == pytest.approx(-436.43)  # matches validate_transform.py's real output


def test_real_spy_742p_simple_round_trip_with_real_fees_on_every_leg():
    # Real order sequence from the same account (2026-07-02): open 2@0.28, close 2@0.12.
    # Both legs' real fees came from the same live validate_transform.py run.
    orders = [
        _order("BUY_TO_OPEN", 2, 0.28, "2026-07-02T19:34:50.009Z", symbol="SPY", strike=742,
               option_type="PUT", order_id="spy742p-open"),
        _order("SELL_TO_CLOSE", 2, 0.12, "2026-07-02T19:45:56.109Z", symbol="SPY", strike=742,
               option_type="PUT", order_id="spy742p-close"),
    ]

    executions, warnings = normalize_orders(orders)
    assert warnings == []
    _set_actual_fees(executions, {"spy742p-open": 0.09, "spy742p-close": 0.11})

    trades, group_warnings = group_trades(executions)
    assert group_warnings == []
    assert len(trades) == 1

    trade = trades[0]
    assert trade.realized_pnl_gross == pytest.approx(-32.0)
    assert trade.fee_source == "actual"
    assert trade.actual_fee == pytest.approx(0.09 + 0.11)  # 0.20
    assert trade.realized_pnl_net == pytest.approx(-32.20)  # matches validate_transform.py's real output
