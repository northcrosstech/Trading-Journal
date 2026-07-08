# Deploying the sync worker to Fly.io

The worker (`sync.py`) needs to run as a single **always-on** machine, not
Fly's default auto-stop-when-idle behavior — it has to stay warm to keep the
Webull SDK's cached auth token valid and to keep the 15-minute schedule
ticking. `fly.toml` does have an `http_service` block now (for the manual
"Sync Now" trigger endpoint — see below), but `min_machines_running = 1` and
`auto_stop_machines = false` keep it always-on the same as before.

## One-time setup

```
cd worker
fly apps create trading-journal-worker      # match the `app` name in fly.toml, or edit fly.toml to match
fly volumes create worker_data --region iad --size 1
```

The volume persists the Webull token cache and the fees cache across
restarts/redeploys (`WEBULL_OPENAPI_TOKEN_DIR` / `WEBULL_FEES_CACHE_PATH` in
`fly.toml` both point at the mount). Without it, every redeploy would need a
fresh interactive token approval.

## Secrets

Every value in `worker/.env` becomes a Fly secret — **never** bake these into
the image (the Dockerfile only copies source, and `.dockerignore` explicitly
excludes `.env`):

```
fly secrets set \
  WEBULL_APP_KEY=<value> \
  WEBULL_APP_SECRET=<value> \
  WEBULL_REGION_ID=us \
  WEBULL_ENDPOINT=api.webull.com \
  WEBULL_ACCOUNT_ID=<value> \
  WEBULL_USER_ID=<value> \
  SUPABASE_URL=<value> \
  SUPABASE_SERVICE_ROLE_KEY=<value> \
  SYNC_TRIGGER_SECRET=<generate a long random value>
```

`SYNC_TRIGGER_SECRET` protects the manual "Sync Now" endpoint
(`POST /sync/trigger`) — set the exact same value as the `SYNC_TRIGGER_SECRET`
env var on the Vercel project (`web/api/trigger-sync.ts` is the only thing
that's supposed to know it; the browser never sees it). Also set
`WORKER_SYNC_URL` on Vercel to this app's public URL (e.g.
`https://trading-journal-worker.fly.dev`).

Optional (all have defaults, only set what you want to change from
`worker/.env.example`): `WEBULL_ORDER_START_DATE`, `WEBULL_ORDER_END_DATE`,
`WEBULL_ORDER_PAGE_SIZE`, `WEBULL_FEE_FETCH_INTERVAL_SECONDS`,
`WEBULL_PAGE_FETCH_INTERVAL_SECONDS`, `SYNC_INTERVAL_MINUTES`,
`SYNC_MARKET_HOURS_ONLY`, `SYNC_MARKET_START_HOUR`, `SYNC_MARKET_END_HOUR`,
`SYNC_AFTER_CLOSE_TAPER_HOURS`, `SYNC_AFTER_CLOSE_MAX_SYNCS`,
`SYNC_TRIGGER_DEBOUNCE_SECONDS`.

**Gotcha, confirmed the hard way:** `SUPABASE_SERVICE_ROLE_KEY` must be the
**secret** key (starts `sb_secret_...`, or a legacy long `service_role` JWT)
— **not** the publishable key (`sb_publishable_...`). The publishable key
can't bypass RLS: writes via the `upsert_trade_bundle()` RPC will appear to
succeed (it runs `security definer`, bypassing RLS internally), but every
subsequent `select` will silently return zero rows because `auth.uid()` is
null with no real user session. This exact failure mode happened during
local testing — worth an extra glance in Supabase Studio → Settings → API
Keys before setting the secret.

## Deploy

```
fly deploy
```

First deploy will need the same interactive Webull token approval as the
very first local run (check `fly logs` for the "waiting for token approval"
prompt, then approve in the Webull app). After that, the token is cached on
the volume and later deploys/restarts should re-validate silently.

## Verify

```
fly status
fly logs
```

You should see one sync cycle immediately on boot (the scheduler's
`next_run_time=datetime.now()`), then one every `SYNC_INTERVAL_MINUTES`
(default 15). To force a one-off cycle for a smoke test without waiting:

```
fly ssh console -C "python sync.py --once"
```

Check `sync_log` in Supabase for the audit trail either way.

To sanity-check the manual-refresh endpoint directly (bypassing the frontend):

```
curl -i -X POST https://<your-app>.fly.dev/sync/trigger -H "X-Sync-Secret: <value>"
```

Expect `202 {"status":"triggered"}` on the first call, then `429` if you
immediately repeat it (debounce window) or `409` if a cycle is already
running. A missing/wrong secret returns `401`.
