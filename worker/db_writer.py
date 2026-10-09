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

from transform import Execution, Trade, _parse_time

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# The migrated Webull account's row id (accounts.id -- NOT Webull's own brokerage
# account id, which is WEBULL_ACCOUNT_ID in sync.py, a different thing entirely).
# Every trade this worker writes gets stamped with it. Optional (not os.environ[...])
# so a worker deployed before this secret is set keeps syncing exactly as before, just
# without an account_id -- matches trades.account_id being nullable by design.
JOURNAL_ACCOUNT_ID = os.environ.get("JOURNAL_ACCOUNT_ID")

# DB's `executions.action` check constraint uses the vocabulary from the original
# schema doc (entry/add/trim/exit); transform.py's Execution.tag uses open/add/trim/close.
_TAG_TO_DB_ACTION = {"open": "entry", "add": "add", "trim": "trim", "close": "exit"}


def get_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _trade_key(contract_key: str, first_order_id: Optional[str]) -> str:
    return hashlib.sha256(f"{contract_key}|{first_order_id}".encode()).hexdigest()


def compute_trade_key(trade: Trade) -> str:
    """Deterministic id for a derived (non-broker) Trade grouping. Same executions
    regrouped -> same key. A reopen after going flat -> a different key, because the
    first execution (and therefore its client_order_id) differs."""
    return _trade_key(trade.contract_key, trade.executions[0].order_id)


def _build_payload(user_id: str, trade: Trade) -> dict:
    trade_key = compute_trade_key(trade)

    return {
        "trade": {
            "user_id": user_id,
            "account_id": JOURNAL_ACCOUNT_ID,
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


# ---------------------------------------------------------------------------
# Incremental sync support
#
# The sync pulls only a short recent window of orders (see sync.resolve_start_date),
# but group_trades() is stateless -- it rebuilds positions from zero using only the
# executions it's handed. Without the earlier fills, a close of a position opened
# before the window would look like a brand-new short trade. So before grouping, the
# sync "seeds" the grouper with the already-stored executions of:
#   - every still-OPEN worker-synced trade (a multi-week hold continues correctly no
#     matter how old its opening fill is), and
#   - every trade that already contains one of the freshly pulled orders (a trade
#     opened before the window and closed inside it regroups whole, not as a
#     phantom trade made of just its tail).
# ---------------------------------------------------------------------------

_SEED_IN_CHUNK = 100  # keeps PostgREST `in.(...)` filters well under URL length limits
_DEFAULT_MULTIPLIER = 100.0  # not stored per execution; standard equity option contract


def get_last_successful_sync_at(client: Client, user_id: str) -> Optional[datetime]:
    res = (
        client.table("sync_log")
        .select("ran_at")
        .eq("user_id", user_id)
        .eq("status", "success")
        .order("ran_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return _parse_time(res.data[0]["ran_at"])


def _recover_contract_key(trade_row: dict, detail: dict, order_ids: list[str]) -> Optional[str]:
    """The DB doesn't store transform.py's contract_key, and rebuilding it from columns
    risks tiny formatting drift (strike "500" vs "500.0", option_type casing) -- which
    would change trade_key and silently fork the trade into a duplicate row. So try the
    plausible spellings and only accept one whose hash reproduces the stored trade_key."""
    symbol = trade_row["symbol"]
    strike = detail["strike"]
    expiration = str(detail["expiration"])
    option_type = str(detail["option_type"])

    strikes = {str(float(strike)), str(strike)}
    expirations = {expiration, expiration.replace("-", "")}
    option_types = {option_type.upper(), option_type, option_type.capitalize()}

    for s in strikes:
        for exp in expirations:
            for ot in option_types:
                candidate = f"{symbol}|{s}|{exp}|{ot}"
                if any(_trade_key(candidate, oid) == trade_row["trade_key"] for oid in order_ids):
                    return candidate
    return None


def load_seed_executions(
    client: Client, user_id: str, pulled_order_ids: list[str]
) -> tuple[list[Execution], list[str]]:
    """Returns stored executions (rebuilt as transform.Execution objects) for every
    worker-synced trade that is still OPEN or already contains one of
    pulled_order_ids. See the section comment above for why."""
    warnings: list[str] = []

    open_res = (
        client.table("trades")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "OPEN")
        .eq("manually_closed", False)
        .eq("asset_type", "option")
        .not_.is_("trade_key", "null")
        .is_("import_key", "null")
        .execute()
    )
    trade_ids = {row["id"] for row in open_res.data or []}

    unique_order_ids = list(dict.fromkeys(oid for oid in pulled_order_ids if oid))
    for i in range(0, len(unique_order_ids), _SEED_IN_CHUNK):
        chunk = unique_order_ids[i : i + _SEED_IN_CHUNK]
        linked_res = (
            client.table("executions")
            .select("trade_id")
            .eq("user_id", user_id)
            .in_("client_order_id", chunk)
            .execute()
        )
        trade_ids.update(row["trade_id"] for row in linked_res.data or [] if row.get("trade_id"))

    seed: list[Execution] = []
    trade_id_list = list(trade_ids)
    for i in range(0, len(trade_id_list), _SEED_IN_CHUNK):
        chunk = trade_id_list[i : i + _SEED_IN_CHUNK]
        res = (
            client.table("trades")
            .select(
                "id, symbol, trade_key, "
                "options_detail(option_type, strike, expiration), "
                "executions(client_order_id, filled_at, action, side, price, quantity, estimated_fee, actual_fee)"
            )
            .in_("id", chunk)
            .not_.is_("trade_key", "null")
            .is_("import_key", "null")
            .execute()
        )
        for row in res.data or []:
            detail = row.get("options_detail")
            if isinstance(detail, list):
                detail = detail[0] if detail else None
            execs = row.get("executions") or []
            if not detail or not execs:
                continue

            order_ids = [e["client_order_id"] for e in execs]
            contract_key = _recover_contract_key(row, detail, order_ids)
            if contract_key is None:
                warnings.append(
                    f"trade {row['id']} ({row['symbol']}): couldn't reproduce its trade_key from stored "
                    f"fields -- not seeded, so a fill on it this cycle may group incorrectly"
                )
                continue

            symbol, strike, expiration, option_type = contract_key.split("|")
            for e in execs:
                price = float(e["price"])
                quantity = float(e["quantity"])
                seed.append(
                    Execution(
                        contract_key=contract_key,
                        symbol=symbol,
                        option_type=option_type,
                        strike=float(strike),
                        expiration=expiration,
                        action="open" if e["action"] in ("entry", "add") else "close",
                        side=e["side"],
                        quantity=quantity,
                        price_per_contract=price,
                        multiplier=_DEFAULT_MULTIPLIER,
                        dollar_value=price * quantity * _DEFAULT_MULTIPLIER,
                        filled_at=_parse_time(e["filled_at"]),
                        order_id=e["client_order_id"],
                        estimated_fee=float(e["estimated_fee"] or 0),
                        actual_fee=float(e["actual_fee"]) if e["actual_fee"] is not None else None,
                    )
                )

    return seed, warnings


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
