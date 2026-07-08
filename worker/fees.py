"""
Backfills real per-order fee data via get_order_detail -- a separate endpoint/call from
get_order_history, which was confirmed (against both a same-day and a 5-day-old order)
to never include fees at all, regardless of settlement time.

A genuinely fee-free order (e.g. BUY_TO_OPEN, where regulatory fees are typically
sell-side only) is indistinguishable from one whose fees just haven't posted yet --
Webull returns an empty `fees` list either way. So an empty result is cached as PENDING,
never as 0.0, and gets retried on a later run instead of silently under-reporting fees
forever.

This only ever backfills Execution.actual_fee -- Execution.estimated_fee (see
fee_rates.py) is computed immediately at normalize time with zero API calls, so a trade
always has *some* usable fee/net-P&L the instant it's written, and this fills in the
real number in the background over however many cycles it takes.

Batched and rate-limited on purpose: a cold-start sync with a large backlog of
never-fetched orders used to fire one get_order_detail per order as fast as the
throttle allowed, which was still enough to trip Webull's 429. max_fetches_per_cycle
caps how many NEW network calls happen per call to annotate_execution_fees (already
cached/resolved order_ids don't count against it), converging the backlog over several
sync cycles instead of bursting through it in one.

FeesCache is a local JSON file standing in for what will eventually be DB columns
(executions.actual_fee) once this is wired into Supabase.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from webull.core.exception.exceptions import ClientException, ServerException

from rate_limiter import RateLimiter
from transform import Execution

# Overridable so a deployment can point this at a persistent volume (e.g. Fly.io) --
# the container filesystem itself doesn't survive a redeploy/restart.
DEFAULT_CACHE_PATH = Path(os.environ.get("WEBULL_FEES_CACHE_PATH") or (Path(__file__).parent / ".fees_cache.json"))
PENDING = "PENDING"
DEFAULT_MAX_FETCHES_PER_CYCLE = 10


class FeesFetchError(Exception):
    """get_order_detail failed outright (bad status or SDK-raised exception) -- distinct
    from succeeding with an empty fees list, which is PENDING, not an error."""


class FeesCache:
    def __init__(self, path: Path = DEFAULT_CACHE_PATH):
        self.path = Path(path)
        self._data: dict[str, object] = {}
        if self.path.exists():
            with open(self.path) as f:
                self._data = json.load(f)

    def get(self, order_id: str):
        """Returns a float (resolved), PENDING (looked up, still empty), or None (never looked up)."""
        return self._data.get(order_id)

    def set(self, order_id: str, value) -> None:
        self._data[order_id] = value

    def save(self) -> None:
        with open(self.path, "w") as f:
            json.dump(self._data, f, indent=2)


def fetch_order_fees(trade_client, account_id: str, client_order_id: str) -> Optional[float]:
    """Returns the summed fee total for one order, or None if Webull returned an empty
    fees list (ambiguous: could be a genuinely fee-free order or not-yet-settled)."""
    try:
        res = trade_client.order_v2.get_order_detail(account_id, client_order_id)
    except (ClientException, ServerException) as exc:
        raise FeesFetchError(f"get_order_detail({client_order_id}) raised {exc}") from exc

    if res.status_code != 200:
        raise FeesFetchError(f"get_order_detail({client_order_id}) failed: {res.status_code} {res.text}")

    inner_orders = res.json().get("orders") or []
    if not inner_orders:
        raise FeesFetchError(f"get_order_detail({client_order_id}) returned no inner order")

    fees_list = inner_orders[0].get("fees") or []
    if not fees_list:
        return None

    return sum(float(f["actual_value"]) for f in fees_list)


def annotate_execution_fees(
    trade_client,
    account_id: str,
    executions: list[Execution],
    cache: FeesCache,
    rate_limiter: RateLimiter,
    max_retries: int = 3,
    max_fetches_per_cycle: int = DEFAULT_MAX_FETCHES_PER_CYCLE,
) -> list[str]:
    """
    Mutates each Execution's `actual_fee` in place. Skips a network call entirely for
    any order_id the cache already has a resolved (float) value for -- never re-fetches
    an order once its fee is known. Of the remaining (never-looked-up or still-PENDING)
    order_ids, only fetches up to max_fetches_per_cycle of them -- oldest execution
    first -- leaving the rest untouched for a later cycle rather than bursting through
    the whole backlog at once. All real calls (including retries) go through the shared
    rate_limiter, which every other Webull trade-endpoint call in the same sync cycle
    also uses (see rate_limiter.py for why a per-loop-local throttle isn't enough).
    """
    warnings: list[str] = []
    fetches_done = 0

    order_id_earliest_time: dict[str, object] = {}
    for e in executions:
        if not e.order_id:
            continue
        if e.order_id not in order_id_earliest_time or e.filled_at < order_id_earliest_time[e.order_id]:
            order_id_earliest_time[e.order_id] = e.filled_at
    order_ids = sorted(order_id_earliest_time, key=lambda oid: order_id_earliest_time[oid])

    for order_id in order_ids:
        cached = cache.get(order_id)

        if isinstance(cached, (int, float)):
            fee = cached
        elif fetches_done >= max_fetches_per_cycle:
            # This cycle's backfill budget is spent -- leave it for next time rather
            # than fetching everything at once.
            fee = None
        else:
            fee = None
            for attempt in range(max_retries):
                rate_limiter.wait()
                try:
                    fee = fetch_order_fees(trade_client, account_id, order_id)
                    break
                except FeesFetchError as exc:
                    if attempt == max_retries - 1:
                        warnings.append(f"{order_id}: fee fetch failed after {max_retries} attempts ({exc})")
                        fee = None
                    else:
                        rate_limiter.backoff(attempt)

            cache.set(order_id, fee if fee is not None else PENDING)
            fetches_done += 1

        for e in executions:
            if e.order_id == order_id:
                e.actual_fee = fee if isinstance(fee, (int, float)) else None

    cache.save()
    return warnings
