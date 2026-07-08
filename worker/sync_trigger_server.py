"""
Minimal authenticated HTTP endpoint so the frontend can trigger an immediate sync
cycle instead of waiting for the next scheduled interval.

This is NOT reachable by the public internet in practice even though Fly exposes the
port: it requires a shared secret (SYNC_TRIGGER_SECRET) that only the Vercel proxy
function (web/api/trigger-sync.ts) holds server-side -- the browser never sees it.
The proxy is what actually checks the caller is a logged-in Supabase user; this
endpoint's only job is "did the request carry the right secret," which is enough
given the proxy is the sole intended caller.

Runs in a background thread inside the same process as the scheduler (sync.py's
BlockingScheduler blocks the main thread, so the HTTP server has to live on its own
thread regardless). A triggered sync also runs in its own thread so the HTTP request
returns immediately (a full cycle can take longer than an HTTP client wants to wait)
-- the frontend polls the sync_log table it already reads to see the result land.
"""
from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

SYNC_TRIGGER_SECRET = os.environ.get("SYNC_TRIGGER_SECRET")
DEBOUNCE_SECONDS = int(os.environ.get("SYNC_TRIGGER_DEBOUNCE_SECONDS", "60"))

_state_lock = threading.Lock()
_last_trigger_at = 0.0
_sync_in_progress = False


def _run_sync_in_background(run_sync_fn, print_summary_fn) -> None:
    global _sync_in_progress
    try:
        summary = run_sync_fn()
        print_summary_fn(summary)
    finally:
        with _state_lock:
            _sync_in_progress = False


def make_handler(run_sync_fn, print_summary_fn):
    class SyncTriggerHandler(BaseHTTPRequestHandler):
        def _respond(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self._respond(200, {"status": "ok"})
                return
            self._respond(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path != "/sync/trigger":
                self._respond(404, {"error": "not found"})
                return

            if not SYNC_TRIGGER_SECRET:
                self._respond(500, {"error": "SYNC_TRIGGER_SECRET not configured on the worker"})
                return

            provided = self.headers.get("X-Sync-Secret")
            if provided != SYNC_TRIGGER_SECRET:
                self._respond(401, {"error": "unauthorized"})
                return

            global _last_trigger_at, _sync_in_progress
            with _state_lock:
                if _sync_in_progress:
                    self._respond(409, {"error": "a sync is already running"})
                    return
                now = time.time()
                remaining = DEBOUNCE_SECONDS - (now - _last_trigger_at)
                if remaining > 0:
                    self._respond(429, {"error": "rate limited", "retry_after_seconds": round(remaining)})
                    return
                _last_trigger_at = now
                _sync_in_progress = True

            threading.Thread(target=_run_sync_in_background, args=(run_sync_fn, print_summary_fn), daemon=True).start()
            self._respond(202, {"status": "triggered"})

        def log_message(self, format: str, *args) -> None:  # noqa: A002 -- matches base class signature
            pass  # run_sync already logs its own progress; keep the HTTP access log quiet

    return SyncTriggerHandler


def start_http_server(run_sync_fn, print_summary_fn, port: int = 8080) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), make_handler(run_sync_fn, print_summary_fn))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Sync-trigger HTTP endpoint listening on :{port} (POST /sync/trigger, secret-protected)")
    return server
