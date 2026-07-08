"""
Integration tests for db_writer.py against a REAL Supabase project (there's no mocking
Postgres upsert/conflict semantics or the upsert_trade_bundle() function meaningfully --
the whole point is verifying the DB's own idempotency behavior).

Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and WEBULL_USER_ID in worker/.env --
skipped entirely if they're not set, so the rest of the suite still runs without them.

All rows written here use TEST_SYMBOL ("ZZTESTDBW") and a distinctive strike per test,
under your real WEBULL_USER_ID -- a symbol that will never appear in real trade data.
An autouse fixture deletes every trades row matching (user_id, symbol=TEST_SYMBOL)
before AND after every test (cascades to executions/options_detail via ON DELETE
CASCADE), so a prior crashed run can't leak in and nothing lingers afterward.
"""
import os
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TEST_USER_ID = os.environ.get("WEBULL_USER_ID")

pytestmark = pytest.mark.skipif(
    not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and TEST_USER_ID),
    reason="requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and WEBULL_USER_ID in worker/.env",
)

TEST_SYMBOL = "ZZTESTDBW"  # clearly-marked, never a real traded symbol


def _order(intent, qty, price, filled_at, strike, expiration="2099-01-01",
           option_type="CALL", order_id=None, status="FILLED"):
    client_order_id = order_id or f"{TEST_SYMBOL}-{filled_at}-{uuid.uuid4().hex[:8]}"
    broker_order_id = f"BROKER-{client_order_id}"
    return {
        "client_order_id": client_order_id,
        "combo_order_id": broker_order_id,
        "option_strategy": "SINGLE",
        "orders": [
            {
                "order_id": broker_order_id,
                "client_order_id": client_order_id,
                "symbol": TEST_SYMBOL,
                "position_intent": intent,
                "order_type": "LIMIT",
                "status": status,
                "filled_price": price,
                "filled_quantity": qty,
                "filled_time_at": filled_at,
                "place_time_at": filled_at,
                "legs": [
                    {
                        "symbol": TEST_SYMBOL,
                        "strike_price": strike,
                        "option_expire_date": expiration,
                        "option_type": option_type,
                        "option_contract_multiplier": 100,
                    }
                ],
            }
        ],
    }


@pytest.fixture(scope="module")
def db():
    from db_writer import get_client

    return get_client()


@pytest.fixture(autouse=True)
def cleanup_test_rows(db):
    def _delete():
        db.table("trades").delete().eq("user_id", TEST_USER_ID).eq("symbol", TEST_SYMBOL).execute()

    _delete()
    yield
    _delete()


def _trades_for_strike(db, strike):
    return (
        db.table("trades")
        .select("*, executions(*), options_detail(*)")
        .eq("user_id", TEST_USER_ID)
        .eq("symbol", TEST_SYMBOL)
        .execute()
        .data
    )
    # Filtering by strike happens client-side below since strike lives on options_detail.


def _rows_for_strike(db, strike):
    rows = _trades_for_strike(db, strike)
    return [r for r in rows if r["options_detail"] and float(r["options_detail"]["strike"]) == float(strike)]


def test_first_insert_writes_expected_row_counts(db):
    from transform import group_trades, normalize_orders

    from db_writer import write_trades

    strike = 900001
    orders = [
        _order("BUY_TO_OPEN", 1, 1.00, "2026-01-01T09:00:00Z", strike=strike),
        _order("SELL_TO_CLOSE", 1, 1.50, "2026-01-01T09:30:00Z", strike=strike),
    ]
    executions, warnings = normalize_orders(orders)
    assert warnings == []
    trades, group_warnings = group_trades(executions)
    assert group_warnings == []

    result = write_trades(db, TEST_USER_ID, trades)
    assert result.warnings == []
    assert len(result.trade_ids) == 1

    rows = _rows_for_strike(db, strike)
    assert len(rows) == 1
    assert len(rows[0]["executions"]) == 2
    assert rows[0]["options_detail"] is not None
    assert rows[0]["status"] == "CLOSED"


def test_rerunning_identical_batch_does_not_duplicate(db):
    from transform import group_trades, normalize_orders

    from db_writer import write_trades

    strike = 900002
    orders = [
        _order("BUY_TO_OPEN", 1, 1.00, "2026-01-01T09:00:00Z", strike=strike, order_id="rerun-open"),
        _order("SELL_TO_CLOSE", 1, 1.50, "2026-01-01T09:30:00Z", strike=strike, order_id="rerun-close"),
    ]

    def run_once():
        executions, warnings = normalize_orders(orders)
        assert warnings == []
        trades, group_warnings = group_trades(executions)
        assert group_warnings == []
        return write_trades(db, TEST_USER_ID, trades)

    first = run_once()
    second = run_once()

    assert first.trade_ids == second.trade_ids  # same trade_key -> same row, not a new one

    rows = _rows_for_strike(db, strike)
    assert len(rows) == 1
    assert len(rows[0]["executions"]) == 2


def test_pending_actual_fee_execution_gets_updated_on_rerun(db):
    from transform import group_trades, normalize_orders

    from db_writer import write_trades

    strike = 900003
    orders = [
        _order("BUY_TO_OPEN", 1, 1.00, "2026-01-01T09:00:00Z", strike=strike, order_id="fee-open"),
        _order("SELL_TO_CLOSE", 1, 1.50, "2026-01-01T09:30:00Z", strike=strike, order_id="fee-close"),
    ]

    # First sync: actual fee not resolved yet (fetching it is a separate, later step --
    # see fees.py). estimated_fee should already be populated with zero API calls.
    executions, warnings = normalize_orders(orders)
    assert warnings == []
    trades, _ = group_trades(executions)
    write_trades(db, TEST_USER_ID, trades)

    rows = _rows_for_strike(db, strike)
    assert rows[0]["fee_source"] == "estimated"
    close_exec = next(e for e in rows[0]["executions"] if e["client_order_id"] == "fee-close")
    assert close_exec["actual_fee"] is None
    assert close_exec["estimated_fee"] > 0

    # A later sync resolves the actual fee for BOTH orders (same client_order_ids) --
    # only once every execution in the trade has a real fee does fee_source flip.
    executions2, _ = normalize_orders(orders)
    for e in executions2:
        if e.order_id == "fee-open":
            e.actual_fee = 0.44
        elif e.order_id == "fee-close":
            e.actual_fee = 0.75
    trades2, _ = group_trades(executions2)
    write_trades(db, TEST_USER_ID, trades2)

    rows = _rows_for_strike(db, strike)
    assert len(rows) == 1
    assert len(rows[0]["executions"]) == 2  # still 2, not 4 -- updated in place
    assert rows[0]["fee_source"] == "actual"
    assert rows[0]["actual_fee"] == pytest.approx(0.44 + 0.75)
    close_exec = next(e for e in rows[0]["executions"] if e["client_order_id"] == "fee-close")
    assert close_exec["actual_fee"] == pytest.approx(0.75)


def test_open_trade_transitions_to_closed_on_same_trade_key(db):
    from transform import group_trades, normalize_orders

    from db_writer import write_trades

    strike = 900004

    # First sync: only the opening order has arrived -- trade is still OPEN.
    open_order = [_order("BUY_TO_OPEN", 1, 1.00, "2026-01-01T09:00:00Z", strike=strike, order_id="oc-open")]
    executions, _ = normalize_orders(open_order)
    trades, _ = group_trades(executions)
    assert trades[0].status == "OPEN"
    write_trades(db, TEST_USER_ID, trades)

    rows = _rows_for_strike(db, strike)
    assert len(rows) == 1
    assert rows[0]["status"] == "OPEN"
    assert rows[0]["realized_pnl_net"] is None
    open_trade_id = rows[0]["id"]

    # A later sync sees the close too -- same contract, same first-open order id, so
    # this must resolve to the SAME trade_key and update the existing row.
    both_orders = open_order + [
        _order("SELL_TO_CLOSE", 1, 1.50, "2026-01-01T09:30:00Z", strike=strike, order_id="oc-close")
    ]
    executions2, _ = normalize_orders(both_orders)
    trades2, _ = group_trades(executions2)
    assert trades2[0].status == "CLOSED"
    write_trades(db, TEST_USER_ID, trades2)

    rows = _rows_for_strike(db, strike)
    assert len(rows) == 1
    assert rows[0]["id"] == open_trade_id  # same row, updated -- not a second trade
    assert rows[0]["status"] == "CLOSED"
    assert rows[0]["realized_pnl_gross"] is not None
    # No actual fee data was ever supplied in this test (that's fees.py's job, tested
    # separately) -- net P&L must still be immediately available via the estimate
    # rather than staying null the way it used to.
    assert rows[0]["fee_source"] == "estimated"
    assert rows[0]["actual_fee"] is None
    assert rows[0]["estimated_fee"] > 0
    assert rows[0]["realized_pnl_net"] is not None
    assert len(rows[0]["executions"]) == 2


def test_reopen_after_close_produces_two_distinct_trades(db):
    from transform import group_trades, normalize_orders

    from db_writer import write_trades

    strike = 900005
    orders = [
        _order("BUY_TO_OPEN", 1, 1.00, "2026-01-01T09:00:00Z", strike=strike, order_id="reopen-open-1"),
        _order("SELL_TO_CLOSE", 1, 1.50, "2026-01-01T09:30:00Z", strike=strike, order_id="reopen-close-1"),
        _order("BUY_TO_OPEN", 1, 2.00, "2026-01-01T13:00:00Z", strike=strike, order_id="reopen-open-2"),
        _order("SELL_TO_CLOSE", 1, 2.50, "2026-01-01T13:30:00Z", strike=strike, order_id="reopen-close-2"),
    ]
    executions, warnings = normalize_orders(orders)
    assert warnings == []
    trades, group_warnings = group_trades(executions)
    assert group_warnings == []
    assert len(trades) == 2

    result = write_trades(db, TEST_USER_ID, trades)
    assert len(result.trade_ids) == 2
    assert len(set(result.trade_ids)) == 2  # distinct rows, not the same one twice

    rows = _rows_for_strike(db, strike)
    assert len(rows) == 2
    total_executions = sum(len(r["executions"]) for r in rows)
    assert total_executions == 4
