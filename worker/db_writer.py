"""
Persists validated Trade/Execution objects (from transform.py) to Supabase.

Idempotent by design -- this sync runs every 15 minutes and re-sees the same orders,
so re-running the same batch must never duplicate rows:

  - Each execution maps to exactly one Webull order. Upserted on (user_id,
    client_order_id) -- re-running updates fields (e.g. a previously-pending fee that
    has since populated) but never inserts a duplicate row.
  - A Trade is a derived grouping, not a broker object, so it has no natural id.
    trade_key is a deterministic hash of (contract_key + first-open execution's
    client_order_id): regrouping the same executions always yields the same key, and a
    contract that flattens then reopens later gets a distinct key (the first-open
    order id differs), so the two trades don't collapse into one row. Upserted on
    (user_id, trade_key).
  - An OPEN trade updating to CLOSED on a later sync is just another upsert on the same
    trade_key -- status/avg_exit/realized_pnl/etc. get overwritten in place.

The worker authenticates with the service-role key (it runs outside any user session),
so RLS can't infer user_id -- every row is stamped with it explicitly via the payload.

Transaction safety: a trade + its executions + its options_detail are written by a
single call to the upsert_trade_bundle() Postgres function (see the migration), not by
separate sequential .table().upsert() calls -- the Python client has no multi-statement
transaction API, so doing this as three separate HTTP calls could leave a trade with
missing executions if the process died in between. The function call is one round trip
and one transaction: it either all lands or none of it does.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from supabase import Client, create_client

from transform import Trade

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# DB's `executions.action` check constraint uses the vocabulary from the original
# schema doc (entry/add/trim/exit); transform.py's Execution.tag uses open/add/trim/close.
_TAG_TO_DB_ACTION = {"open": "entry", "add": "add", "trim": "trim", "close": "exit"}


def get_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def compute_trade_key(trade: Trade) -> str:
    """Deterministic id for a derived (non-broker) Trade grouping. Same executions
    regrouped -> same key. A reopen after going flat -> a different key, because the
    first execution (and therefore its client_order_id) differs."""
    first_order_id = trade.executions[0].order_id
    raw = f"{trade.contract_key}|{first_order_id}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _build_payload(user_id: str, trade: Trade) -> dict:
    trade_key = compute_trade_key(trade)

    return {
        "trade": {
            "user_id": user_id,
            "trade_key": trade_key,
            "symbol": trade.symbol,
            "asset_type": "option",
            "side": trade.trade_direction,
            "status": trade.status,
            "avg_entry": trade.avg_entry_price,
            "avg_exit": trade.avg_exit_price,
            "hold_seconds": trade.hold_seconds,
            "total_contracts": trade.total_contracts,
            "realized_pnl_gross": trade.realized_pnl_gross,
            "realized_pnl_net": trade.realized_pnl_net,
            "estimated_fee": trade.estimated_fee,
            "actual_fee": trade.actual_fee,
            "fee_source": trade.fee_source,
            "first_in_at": trade.executions[0].filled_at.isoformat(),
            "last_out_at": trade.executions[-1].filled_at.isoformat() if trade.status == "CLOSED" else None,
        },
        "executions": [
            {
                "client_order_id": e.order_id,
                "filled_at": e.filled_at.isoformat(),
                "action": _TAG_TO_DB_ACTION.get(e.tag, e.tag),
                "price": e.price_per_contract,
                "quantity": e.quantity,
                "side": e.side,
                "estimated_fee": e.estimated_fee,
                "actual_fee": e.actual_fee,
            }
            for e in trade.executions
            if e.order_id
        ],
        "options_detail": {
            "option_type": trade.option_type.lower(),
            "strike": trade.strike,
            "expiration": trade.expiration,
            "premium": trade.avg_entry_price,
        },
    }


@dataclass
class WriteResult:
    trade_ids: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def write_trade(client: Client, user_id: str, trade: Trade) -> str:
    """Writes one trade bundle atomically. Returns the trade's DB id."""
    payload = _build_payload(user_id, trade)
    res = client.rpc("upsert_trade_bundle", {"payload": payload}).execute()
    return res.data


def write_trades(client: Client, user_id: str, trades: list[Trade]) -> WriteResult:
    result = WriteResult()

    for trade in trades:
        if not trade.executions or not trade.executions[0].order_id:
            result.warnings.append(f"{trade.contract_key}: no usable order_id on first execution -- skipped")
            continue
        try:
            trade_id = write_trade(client, user_id, trade)
            result.trade_ids.append(trade_id)
        except Exception as exc:  # noqa: BLE001 -- surface any DB failure as a warning, not a crash
            result.warnings.append(f"{trade.contract_key} ({compute_trade_key(trade)}): write failed ({exc!r})")

    return result


def write_sync_log(
    client: Client,
    user_id: str,
    status: str,
    orders_pulled: int,
    trades_written: int,
    warnings_count: int,
    message: Optional[str] = None,
) -> None:
    client.table("sync_log").insert(
        {
            "user_id": user_id,
            "status": status,
            "orders_pulled": orders_pulled,
            "trades_ingested": trades_written,
            "warnings_count": warnings_count,
            "message": message,
        }
    ).execute()
