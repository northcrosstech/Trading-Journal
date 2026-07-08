"""
Parses raw Webull option orders into normalized executions and groups them into trades.

Standalone and DB-free on purpose: run it against a saved order_history response to
eyeball the grouping before this logic gets wired into the sync worker.

    python transform.py path/to/order_history_response.json

Webull aggregates each order into one filled_price/filled_quantity -- there is no
sub-fill array. Scaling in/out on the same contract shows up as separate orders, so a
trade here is reconstructed by walking a contract's orders in time order and tracking
net open quantity, not by grouping "child fills" of one order.

Each item from order_history is a three-level combo wrapper, not a flat order:
    combo wrapper: { client_order_id, combo_order_id, option_strategy, orders: [...] }
      orders[0]:   { position_intent, filled_price, filled_quantity, filled_time_at, legs: [...] }
        legs[0]:   { symbol, strike_price, option_expire_date, option_type, option_contract_multiplier }
Only single-leg orders (one entry in "orders", one entry in its "legs") are handled;
multi-leg combos are flagged as warnings and skipped rather than mishandled.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Optional

from fee_rates import estimate_fees

OPEN_INTENTS = {"BUY_TO_OPEN", "SELL_TO_OPEN"}
CLOSE_INTENTS = {"BUY_TO_CLOSE", "SELL_TO_CLOSE"}
BUY_INTENTS = {"BUY_TO_OPEN", "BUY_TO_CLOSE"}
SELL_INTENTS = {"SELL_TO_OPEN", "SELL_TO_CLOSE"}

_EPS = 1e-9


def _is_zero(x: float) -> bool:
    return abs(x) < _EPS


class GroupingError(Exception):
    """Raised for a single order that can't be normalized; the caller collects these
    instead of letting one bad order crash the whole batch."""


class NotFilledError(Exception):
    """Raised for an order with no fill to process (e.g. CANCELLED, FAILED, still
    SUBMITTED). Expected and routine, not an anomaly -- tallied separately from
    GroupingError so it doesn't drown out real warnings."""


FILLED_STATUSES = {"FILLED", "PARTIAL_FILLED", "PARTIAL FILLED"}


@dataclass
class Execution:
    contract_key: str
    symbol: str
    option_type: str
    strike: float
    expiration: str
    action: str  # "open" | "close" -- derived straight from position_intent
    side: str  # "buy" | "sell"
    quantity: float
    price_per_contract: float
    multiplier: float
    dollar_value: float
    filled_at: datetime
    order_id: Optional[str] = None
    tag: Optional[str] = None  # assigned during grouping: open/add/trim/close
    estimated_fee: float = 0.0  # computed immediately, zero API calls -- see fee_rates.py
    actual_fee: Optional[float] = None  # backfilled later via fees.annotate_execution_fees; None = not yet known


def _parse_time(value: str) -> datetime:
    # Webull ISO timestamps may carry a trailing "Z"; fromisoformat wants +00:00.
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize_order(raw: dict) -> Execution:
    combo_id = raw.get("combo_order_id") or raw.get("client_order_id", "?")

    inner_orders = raw.get("orders") or []
    if len(inner_orders) != 1:
        raise GroupingError(
            f"combo order {combo_id} has {len(inner_orders)} leg order(s); only single-leg "
            f"strategies are supported right now -- skipping"
        )
    inner = inner_orders[0]
    # client_order_id (the caller-generated id), NOT Webull's own order_id/leg id --
    # get_order_detail's client_order_id param specifically expects the former; passing
    # the latter returns OAUTH_OPENAPI_ORDER_NOT_FOUND for every single order.
    order_id = inner.get("client_order_id") or inner.get("order_id") or combo_id

    status = inner.get("status")
    if status not in FILLED_STATUSES:
        raise NotFilledError(f"order {order_id} status={status!r}, no fill to process")

    legs = inner.get("legs") or []
    if len(legs) != 1:
        raise GroupingError(
            f"order {order_id} has {len(legs)} leg(s); only single-leg options are supported "
            f"right now -- skipping"
        )
    leg = legs[0]

    strategy = raw.get("option_strategy") or inner.get("option_strategy")
    if strategy and strategy != "SINGLE":
        raise GroupingError(
            f"order {order_id} has option_strategy={strategy!r}; only SINGLE-leg strategies are "
            f"supported right now -- skipping"
        )

    position_intent = inner.get("position_intent")
    if position_intent not in OPEN_INTENTS | CLOSE_INTENTS:
        raise GroupingError(
            f"order {order_id} has missing/unknown position_intent: {position_intent!r}"
        )

    symbol = leg["symbol"]
    strike = float(leg["strike_price"])
    expiration = leg["option_expire_date"]
    option_type = leg["option_type"]
    multiplier = float(leg.get("option_contract_multiplier", 100))

    action = "open" if position_intent in OPEN_INTENTS else "close"
    side = "buy" if position_intent in BUY_INTENTS else "sell"

    quantity = float(inner["filled_quantity"])
    price = float(inner["filled_price"])
    dollar_value = price * quantity * multiplier

    contract_key = f"{symbol}|{strike}|{expiration}|{option_type}"

    return Execution(
        contract_key=contract_key,
        symbol=symbol,
        option_type=option_type,
        strike=strike,
        expiration=expiration,
        action=action,
        side=side,
        quantity=quantity,
        price_per_contract=price,
        multiplier=multiplier,
        dollar_value=dollar_value,
        filled_at=_parse_time(inner["filled_time_at"]),
        order_id=order_id,
        estimated_fee=estimate_fees(quantity, side, dollar_value),
    )


@dataclass
class Trade:
    contract_key: str
    symbol: str
    option_type: str
    strike: float
    expiration: str
    trade_direction: str  # "long" | "short"
    status: str = "OPEN"  # "OPEN" | "CLOSED"
    executions: list = field(default_factory=list)
    avg_entry_price: Optional[float] = None
    avg_exit_price: Optional[float] = None
    total_contracts: Optional[float] = None
    hold_seconds: Optional[float] = None
    realized_pnl_gross: Optional[float] = None
    estimated_fee: float = 0.0  # always available -- sum of each execution's estimate
    actual_fee: Optional[float] = None  # only set once every execution's actual fee has backfilled
    fee_source: str = "estimated"  # "estimated" | "actual" -- which one realized_pnl_net used
    realized_pnl_net: Optional[float] = None
    residual_quantity: float = 0.0

    def finalize(self) -> None:
        opens = [e for e in self.executions if e.tag in ("open", "add")]
        closes = [e for e in self.executions if e.tag in ("trim", "close")]

        if opens:
            self.total_contracts = sum(e.quantity for e in opens)
            self.avg_entry_price = sum(e.price_per_contract * e.quantity for e in opens) / self.total_contracts
        if closes:
            close_qty = sum(e.quantity for e in closes)
            self.avg_exit_price = sum(e.price_per_contract * e.quantity for e in closes) / close_qty

        first_open = self.executions[0].filled_at
        last_event = self.executions[-1].filled_at
        self.hold_seconds = (last_event - first_open).total_seconds()

        # Estimated fee is always fully available (computed with zero API calls at
        # normalize time); actual only once every execution's real fee has backfilled.
        self.estimated_fee = sum(e.estimated_fee for e in self.executions)
        actual_fees = [e.actual_fee for e in self.executions]
        if all(f is not None for f in actual_fees):
            self.actual_fee = sum(actual_fees)
            self.fee_source = "actual"
        else:
            self.actual_fee = None
            self.fee_source = "estimated"

        if self.status == "CLOSED":
            # Net position returns to zero, so the sum of signed cash flows *is* the
            # gross realized P&L -- this handles long and short the same way with no
            # special casing: buys are debits, sells are credits, regardless of
            # open/close.
            self.realized_pnl_gross = sum(
                (-1 if e.side == "buy" else 1) * e.dollar_value for e in self.executions
            )
            fee_to_use = self.actual_fee if self.fee_source == "actual" else self.estimated_fee
            self.realized_pnl_net = self.realized_pnl_gross - fee_to_use

    def summary(self) -> str:
        header = (
            f"{self.symbol} {self.strike:g}{self.option_type[0]} exp {self.expiration}  "
            f"[{self.trade_direction.upper()} / {self.status}]"
        )
        lines = [header]
        for e in self.executions:
            lines.append(
                f"    {e.filled_at.isoformat()}  {e.tag or '?':<5} {e.side:<4} "
                f"{e.quantity:g} @ {e.price_per_contract:.2f}"
            )
        if self.status == "CLOSED":
            hold_min = (self.hold_seconds or 0) / 60
            fee_used = self.actual_fee if self.fee_source == "actual" else self.estimated_fee
            lines.append(
                f"    -> {self.total_contracts:g} contracts, avg entry {self.avg_entry_price:.2f}, "
                f"avg exit {self.avg_exit_price:.2f}, hold {hold_min:.1f} min, "
                f"gross P&L ${self.realized_pnl_gross:+.2f}, fee ${fee_used:.2f} ({self.fee_source}), "
                f"net P&L ${self.realized_pnl_net:+.2f}"
            )
        else:
            lines.append(f"    -> STILL OPEN, residual quantity {self.residual_quantity:g}")
        return "\n".join(lines)


def _split_execution(e: Execution, quantity: float, tag: str) -> Execution:
    # Prorate both fee fields the same way dollar_value already is, so a split stays
    # internally consistent (this path is a rare/hypothetical edge case -- see
    # group_trades).
    fraction = quantity / e.quantity if e.quantity else 0.0
    return replace(
        e,
        quantity=quantity,
        dollar_value=e.price_per_contract * quantity * e.multiplier,
        tag=tag,
        estimated_fee=e.estimated_fee * fraction,
        actual_fee=(e.actual_fee * fraction if e.actual_fee is not None else None),
    )


def group_trades(executions: list[Execution]) -> tuple[list[Trade], list[str]]:
    by_contract: dict[str, list[Execution]] = {}
    for e in executions:
        by_contract.setdefault(e.contract_key, []).append(e)

    trades: list[Trade] = []
    warnings: list[str] = []

    for contract_key, execs in by_contract.items():
        execs = sorted(execs, key=lambda e: e.filled_at)

        net = 0.0
        current: Optional[Trade] = None

        for e in execs:
            signed_delta = e.quantity if e.side == "buy" else -e.quantity
            new_net = net + signed_delta

            if _is_zero(net):
                current = Trade(
                    contract_key=contract_key,
                    symbol=e.symbol,
                    option_type=e.option_type,
                    strike=e.strike,
                    expiration=e.expiration,
                    trade_direction="long" if signed_delta > 0 else "short",
                )
                trades.append(current)
                e.tag = "open"
                current.executions.append(e)
                net = new_net
                if _is_zero(net):
                    current.status = "CLOSED"
                    current.finalize()
                continue

            flipped = not _is_zero(new_net) and (
                (net > 0 and new_net < 0) or (net < 0 and new_net > 0)
            )

            if flipped:
                warnings.append(
                    f"{contract_key}: order at {e.filled_at.isoformat()} flips net position "
                    f"({net:g} -> {new_net:g}) within a single aggregated fill -- splitting it "
                    f"into a close of the open trade plus a new open trade at the same fill price."
                )
                close_qty = abs(net)
                reopen_qty = e.quantity - close_qty

                current.executions.append(_split_execution(e, close_qty, "close"))
                current.status = "CLOSED"
                current.finalize()

                current = Trade(
                    contract_key=contract_key,
                    symbol=e.symbol,
                    option_type=e.option_type,
                    strike=e.strike,
                    expiration=e.expiration,
                    trade_direction="long" if new_net > 0 else "short",
                )
                trades.append(current)
                current.executions.append(_split_execution(e, reopen_qty, "open"))
                net = new_net
                continue

            same_direction = (net > 0 and signed_delta > 0) or (net < 0 and signed_delta < 0)
            if same_direction:
                e.tag = "add"
            else:
                e.tag = "close" if _is_zero(new_net) else "trim"

            current.executions.append(e)
            net = new_net

            if _is_zero(net):
                current.status = "CLOSED"
                current.finalize()

        if current is not None and current.status == "OPEN":
            current.residual_quantity = net
            current.finalize()

    return trades, warnings


def extract_orders(response_json) -> list[dict]:
    if isinstance(response_json, list):
        return response_json
    for key in ("data", "orders", "items", "list"):
        value = response_json.get(key)
        if isinstance(value, list):
            return value
    raise ValueError(f"Could not find an order list in response; keys={list(response_json.keys())}")


def normalize_orders(raw_orders: list[dict]) -> tuple[list[Execution], list[str]]:
    """Normalizes every raw combo wrapper it can, collecting per-order problems as
    warnings instead of raising. Split out from process_orders so callers that need to
    annotate fees (a separate API call per order_id) can do so between normalizing and
    grouping -- see fees.annotate_execution_fees."""
    executions: list[Execution] = []
    warnings: list[str] = []
    not_filled_count = 0

    for raw in raw_orders:
        try:
            executions.append(normalize_order(raw))
        except NotFilledError:
            not_filled_count += 1
        except GroupingError as exc:
            warnings.append(str(exc))
        except (KeyError, TypeError, ValueError) as exc:
            combo_id = raw.get("combo_order_id") or raw.get("client_order_id", "?")
            warnings.append(f"order {combo_id}: unexpected shape ({exc!r}) -- skipping")

    if not_filled_count:
        warnings.append(f"skipped {not_filled_count} order(s) with no fill (status not FILLED/PARTIAL_FILLED)")

    return executions, warnings


def open_trade_warnings(trades: list[Trade]) -> list[str]:
    return [
        f"{t.contract_key}: still open at end of data (residual quantity {t.residual_quantity:g})"
        for t in trades
        if t.status == "OPEN"
    ]


def process_orders(raw_orders: list[dict]) -> tuple[list[Trade], list[str]]:
    executions, warnings = normalize_orders(raw_orders)

    trades, group_warnings = group_trades(executions)
    warnings.extend(group_warnings)
    warnings.extend(open_trade_warnings(trades))

    return trades, warnings


def print_report(trades: list[Trade], warnings: list[str]) -> None:
    for t in sorted(trades, key=lambda t: t.executions[0].filled_at):
        print(t.summary())
        print()
    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print(f"  - {w}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python transform.py <order_history_response.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        raw_orders = extract_orders(json.load(f))

    result_trades, result_warnings = process_orders(raw_orders)
    print_report(result_trades, result_warnings)
