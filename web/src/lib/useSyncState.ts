import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { fetchLatestSyncLog } from './queries'
import type { SyncLog } from './database.types'

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20 // ~60s -- long enough for a normal cycle, not forever

export type SyncState = {
  /** The newest sync_log row; null when a sync has never run. */
  log: SyncLog | null
  loaded: boolean
  /** A manual sync was asked for and its result hasn't landed yet. */
  busy: boolean
  cooldownSeconds: number
  /** Why a manual sync couldn't be started. */
  error: string | null
  syncNow: () => void
}

/** The latest sync result and the manual "sync now" action, loaded once and shared by the
 * sidebar badge and the failed-sync banner. Triggering POSTs to /api/trigger-sync (which
 * verifies the session and forwards to the worker with a server-side-only secret), then
 * polls the sync_log table this app already reads rather than a separate status endpoint on
 * the worker. Loads only while `active` (the Trading area), and again whenever `page`
 * changes, so a scheduled run that landed since is picked up on the next page. */
export function useSyncState(active: boolean, page: string): SyncState {
  const [log, setLog] = useState<SyncLog | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (pollTimer.current) clearTimeout(pollTimer.current)
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let live = true
    fetchLatestSyncLog()
      .then((l) => {
        if (!live) return
        // Never back to an older run than the one a manual sync just brought in.
        setLog((cur) => (cur && l && l.ran_at < cur.ran_at ? cur : l))
        setLoaded(true)
      })
      .catch(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [active, page])

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
    fetchLatestSyncLog()
      .catch(() => null) // a failed read counts as "not there yet"
      .then((l) => {
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

  async function syncNow() {
    if (busy || cooldownSeconds > 0) return
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

  return { log, loaded, busy, cooldownSeconds, error, syncNow }
}
