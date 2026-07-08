import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchLatestSyncLog } from '../lib/queries'
import type { SyncLog } from '../lib/database.types'
import { relativeTimeFmt } from '../lib/format'

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20 // ~60s -- long enough for a normal cycle, not forever

/** Manual "sync now" control + last-synced status, always visible in the sidebar.
 * Triggering POSTs to /api/trigger-sync (which verifies the session and forwards to
 * the worker with a server-side-only secret -- see server/triggerSync.ts), then polls
 * the sync_log table this app already reads/writes rather than inventing a separate
 * status endpoint on the worker. */
export function SyncStatus() {
  const [log, setLog] = useState<SyncLog | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0) // forces a re-render periodically so "Xm ago" stays fresh

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    fetchLatestSyncLog()
      .then((l) => {
        if (mounted.current) {
          setLog(l)
          setLoaded(true)
        }
      })
      .catch(() => setLoaded(true))

    const freshnessTick = setInterval(() => setTick((t) => t + 1), 30_000)

    return () => {
      mounted.current = false
      clearInterval(freshnessTick)
      if (pollTimer.current) clearTimeout(pollTimer.current)
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  function startCooldown(seconds: number) {
    setCooldownSeconds(seconds)
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    cooldownTimer.current = setInterval(() => {
      setCooldownSeconds((s) => {
        if (s <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  function pollForNewLog(sinceIso: string, attempt = 0) {
    fetchLatestSyncLog().then((l) => {
      if (!mounted.current) return
      if (l && l.ran_at > sinceIso) {
        setLog(l)
        setBusy(false)
        return
      }
      if (attempt >= POLL_MAX_ATTEMPTS) {
        setBusy(false)
        return
      }
      pollTimer.current = setTimeout(() => pollForNewLog(sinceIso, attempt + 1), POLL_INTERVAL_MS)
    })
  }

  async function handleSyncNow() {
    setError(null)
    setBusy(true)
    const sinceIso = log?.ran_at ?? new Date(0).toISOString()

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setError('Not signed in')
      setBusy(false)
      return
    }

    try {
      const res = await fetch('/api/trigger-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const body = await res.json().catch(() => ({}))

      if (res.status === 202) {
        pollForNewLog(sinceIso)
        return
      }
      if (res.status === 429) {
        startCooldown(Math.max(1, Number(body.retry_after_seconds) || 30))
        setBusy(false)
        return
      }
      if (res.status === 409) {
        pollForNewLog(sinceIso) // something else is already syncing -- watch for it to land
        return
      }
      setError(body.error ?? `Sync trigger failed (${res.status})`)
      setBusy(false)
    } catch {
      setError('Could not reach the sync trigger')
      setBusy(false)
    }
  }

  const statusColor = log?.status === 'error' ? 'bg-(--status-critical)' : log?.status === 'success' ? 'bg-(--status-good)' : 'bg-neutral-600'

  return (
    <div className="mx-2 mb-2 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
          <span className="truncate text-[11px] text-neutral-500" title={log?.message ?? undefined}>
            {!loaded ? 'Loading…' : busy ? 'Syncing…' : `Synced ${relativeTimeFmt(log?.ran_at)}`}
          </span>
        </div>
        <button
          onClick={handleSyncNow}
          disabled={busy || cooldownSeconds > 0}
          title={cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : 'Sync now'}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-400 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
        >
          {cooldownSeconds > 0 ? `${cooldownSeconds}s` : 'Sync now'}
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-(--status-critical)">{error}</div>}
    </div>
  )
}
