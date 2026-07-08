"""Unit tests for RateLimiter -- deterministic via monkeypatching time.monotonic/sleep."""
import pytest

import rate_limiter as rl


def _patch_clock(monkeypatch):
    """A fake clock where sleep() actually advances the mocked monotonic time, so
    _last_call correctly reflects when a call really finished -- matching real
    time.sleep()'s behavior of consuming real wall-clock time."""
    clock = [0.0]

    def fake_sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds

    sleeps: list[float] = []
    monkeypatch.setattr(rl.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(rl.time, "sleep", fake_sleep)
    return clock, sleeps


def test_wait_sleeps_when_called_again_too_soon(monkeypatch):
    clock, sleeps = _patch_clock(monkeypatch)
    limiter = rl.RateLimiter(min_interval_seconds=1.0)

    limiter.wait()  # elapsed=0 -> sleeps 1.0; clock now at 1.0
    assert sleeps == [1.0]

    clock[0] += 0.3  # 0.3s passes before the next call (clock now 1.3)
    limiter.wait()  # elapsed=0.3 -> sleeps the remaining 0.7
    assert sleeps[-1] == pytest.approx(0.7)


def test_wait_does_not_sleep_when_enough_time_has_passed(monkeypatch):
    clock, sleeps = _patch_clock(monkeypatch)
    limiter = rl.RateLimiter(min_interval_seconds=1.0)

    limiter.wait()
    clock[0] += 5.0  # well past the interval
    limiter.wait()

    assert sleeps == [1.0]  # only the first call needed to sleep


def test_backoff_stays_within_jitter_bounds(monkeypatch):
    _clock, sleeps = _patch_clock(monkeypatch)
    limiter = rl.RateLimiter(min_interval_seconds=1.0)
    monkeypatch.setattr(rl.random, "uniform", lambda a, b: b)  # pin to the upper bound

    limiter.backoff(attempt=0)
    limiter.backoff(attempt=2)

    assert sleeps == [1.0, 4.0]  # min_interval * 2**attempt, at the (deterministic) upper bound
