import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchLatestPrices } from '../lib/wealthQueries'

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20 // ~60s -- new tickers normally land in a few seconds

/** "Get prices now" for tickers that have never been priced: asks the worker (through
 * /api/trigger-sync?job=prices, same sign-in check and secret as Sync now) to fetch
 * just those, then waits for them to appear in `prices` and calls onDone to reload. */
export function GetPricesButton({ symbols, onDone }: { symbols: string[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function poll(attempt = 0) {
    fetchLatestPrices(symbols)
      .then((found) => {
        if (!mounted.current) return
        const missing = symbols.filter((s) => !found.has(s))
        if (missing.length === 0 || attempt >= POLL_MAX_ATTEMPTS) {
          setBusy(false)
          if (missing.length > 0) setMessage(`No price found for ${missing.join(', ')} — check the ticker spelling.`)
          onDone()
          return
        }
        timer.current = setTimeout(() => poll(attempt + 1), POLL_INTERVAL_MS)
      })
      .catch(() => {
        if (!mounted.current) return
        setBusy(false)
        setMessage('Could not check for new prices.')
      })
  }

  async function handleClick() {
    setMessage(null)
    setBusy(true)
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setBusy(false)
      setMessage('Not signed in')
      return
    }
    try {
      const res = await fetch('/api/trigger-sync?job=prices', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 202 || res.status === 409) {
        poll()
        return
      }
      setBusy(false)
      if (res.status === 429) setMessage(`Prices were just updated — try again in ${Math.max(1, Number(body.retry_after_seconds) || 60)}s.`)
      else setMessage(body.error ?? `Price update failed (${res.status})`)
    } catch {
      setBusy(false)
      setMessage('Could not reach the price updater.')
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={handleClick}
        disabled={busy}
        className="rounded-md border border-amber-700 px-2 py-0.5 text-xs font-medium text-amber-200 transition hover:bg-amber-900/40 disabled:opacity-50"
      >
        {busy ? 'Getting prices…' : 'Get prices now'}
      </button>
      {message && <span className="text-xs text-amber-300/90">{message}</span>}
    </span>
  )
}
