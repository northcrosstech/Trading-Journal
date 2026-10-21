"""Covers the two safety behaviors the manual-refresh endpoint exists to provide:
can't be spammed (debounce) and can't overlap itself (in-progress guard). Auth
(secret check) is also covered since it's the only thing standing between this
endpoint and "anyone who can reach the port can trigger a sync"."""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

import sync_trigger_server


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    monkeypatch.setattr(sync_trigger_server, "SYNC_TRIGGER_SECRET", "test-secret")
    monkeypatch.setattr(sync_trigger_server, "DEBOUNCE_SECONDS", 60)
    monkeypatch.setattr(sync_trigger_server, "_last_trigger_at", 0.0)
    monkeypatch.setattr(sync_trigger_server, "_sync_in_progress", False)
    monkeypatch.setattr(sync_trigger_server, "PRICES_DEBOUNCE_SECONDS", 120)
    monkeypatch.setattr(sync_trigger_server, "_last_prices_at", 0.0)
    monkeypatch.setattr(sync_trigger_server, "_prices_in_progress", False)


def _post(port: int, secret: str | None, path: str = "/sync/trigger") -> tuple[int, dict]:
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method="POST")
    if secret is not None:
        req.add_header("X-Sync-Secret", secret)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _start_server(run_sync_fn):
    server = sync_trigger_server.start_http_server(run_sync_fn, lambda summary: None, port=0)
    return server, server.server_port


def test_missing_secret_is_rejected():
    server, port = _start_server(run_sync_fn=lambda: None)
    try:
        status, _ = _post(port, secret=None)
        assert status == 401
    finally:
        server.shutdown()


def test_wrong_secret_is_rejected():
    server, port = _start_server(run_sync_fn=lambda: None)
    try:
        status, _ = _post(port, secret="not-the-secret")
        assert status == 401
    finally:
        server.shutdown()


def test_valid_trigger_runs_sync_in_background():
    called = threading.Event()

    def fake_run_sync():
        called.set()

    server, port = _start_server(run_sync_fn=fake_run_sync)
    try:
        status, body = _post(port, secret="test-secret")
        assert status == 202
        assert body["status"] == "triggered"
        assert called.wait(timeout=2), "run_sync should have been invoked"
    finally:
        server.shutdown()


def test_second_trigger_within_debounce_window_is_rate_limited():
    server, port = _start_server(run_sync_fn=lambda: None)
    try:
        first_status, _ = _post(port, secret="test-secret")
        assert first_status == 202

        second_status, body = _post(port, secret="test-secret")
        assert second_status == 429
        assert body["retry_after_seconds"] > 0
    finally:
        server.shutdown()


def test_concurrent_trigger_while_in_progress_is_rejected():
    release = threading.Event()

    def slow_run_sync():
        release.wait(timeout=5)

    server, port = _start_server(run_sync_fn=slow_run_sync)
    try:
        first_status, _ = _post(port, secret="test-secret")
        assert first_status == 202

        # give the background thread a moment to flip _sync_in_progress before
        # the second request lands
        time.sleep(0.2)

        second_status, body = _post(port, secret="test-secret")
        assert second_status == 409
        assert "already running" in body["error"]
    finally:
        release.set()
        server.shutdown()


# --- /prices/trigger ---------------------------------------------------------


def _start_with_prices(run_prices_fn, run_sync_fn=lambda: None):
    server = sync_trigger_server.start_http_server(
        run_sync_fn, lambda summary: None, port=0, run_prices_fn=run_prices_fn, print_prices_fn=lambda summary: None
    )
    return server, server.server_port


def test_prices_trigger_requires_the_secret():
    server, port = _start_with_prices(run_prices_fn=lambda: None)
    try:
        status, _ = _post(port, secret="nope", path="/prices/trigger")
        assert status == 401
    finally:
        server.shutdown()


def test_prices_trigger_runs_pricing_not_sync():
    priced = threading.Event()
    synced = threading.Event()
    server, port = _start_with_prices(run_prices_fn=priced.set, run_sync_fn=synced.set)
    try:
        status, body = _post(port, secret="test-secret", path="/prices/trigger")
        assert status == 202 and body["status"] == "triggered"
        assert priced.wait(timeout=2)
        assert not synced.is_set()
    finally:
        server.shutdown()


def test_prices_trigger_has_its_own_cooldown():
    server, port = _start_with_prices(run_prices_fn=lambda: None)
    try:
        assert _post(port, secret="test-secret", path="/prices/trigger")[0] == 202
        status, body = _post(port, secret="test-secret", path="/prices/trigger")
        assert status == 429 and body["retry_after_seconds"] > 0
        # a trade sync is unaffected by the prices cooldown
        assert _post(port, secret="test-secret")[0] == 202
    finally:
        server.shutdown()


def test_prices_trigger_404_when_not_wired():
    server, port = _start_server(run_sync_fn=lambda: None)
    try:
        status, _ = _post(port, secret="test-secret", path="/prices/trigger")
        assert status == 404
    finally:
        server.shutdown()
