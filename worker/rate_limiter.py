"""
Shared throttle for every Webull trade-endpoint call made in one sync cycle.

Webull documents order/detail (and the other order-query endpoints) at 2 requests per
2 seconds -- effectively 1/sec sustained. Pacing the order-history pagination loop and
the fee-fetch loop independently at "1/sec each" isn't actually 1/sec combined: if loop
A fires at t=0,1,2... and loop B fires at t=0.5,1.5,2.5..., together that's a request
every 0.5s, comfortably over the documented limit. That mismatch is what caused a 429
storm on a cold-start sync (a paginated pull immediately followed by fee-fetching for a
whole backlog). One shared RateLimiter instance, passed to both loops, fixes this
structurally rather than by tuning either loop's interval in isolation.
"""
from __future__ import annotations

import random
import time


class RateLimiter:
    def __init__(self, min_interval_seconds: float = 1.0):
        self.min_interval_seconds = min_interval_seconds
        self._last_call = 0.0

    def wait(self) -> None:
        """Blocks until at least min_interval_seconds has passed since the last call
        (across ANY caller sharing this instance), then records this call's time."""
        elapsed = time.monotonic() - self._last_call
        if elapsed < self.min_interval_seconds:
            time.sleep(self.min_interval_seconds - elapsed)
        self._last_call = time.monotonic()

    def backoff(self, attempt: int) -> None:
        """Full-jitter exponential backoff after a failed (e.g. 429) call: sleeps a
        random duration between 0 and min_interval_seconds * 2**attempt. Jitter avoids
        every retry converging back onto the same synchronized cadence that caused the
        rate-limit hit in the first place."""
        max_delay = self.min_interval_seconds * (2**attempt)
        time.sleep(random.uniform(0, max_delay))
