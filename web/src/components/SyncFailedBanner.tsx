import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { SyncState } from '../lib/useSyncState'
import { dateTimeFmt } from '../lib/format'
import { Button } from './ui/Button'

const DISMISSED_KEY = 'tj.syncFailedDismissed'

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

/** Shown above the Trading pages while the newest sync run is a failed one: when it failed,
 * why, and a retry. Dismissing hides it for that run only (remembered for the browser tab);
 * the next failed run shows it again. */
export function SyncFailedBanner({ sync }: { sync: SyncState }) {
  const { log, busy, cooldownSeconds, error, syncNow } = sync
  const [dismissedId, setDismissedId] = useState(readDismissed)

  if (!log || log.status !== 'error' || log.id === dismissedId) return null

  function dismiss(id: string) {
    setDismissedId(id)
    try {
      sessionStorage.setItem(DISMISSED_KEY, id)
    } catch {
      /* private mode -- it just comes back on the next page load */
    }
  }

  return (
    <div role="alert" className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-red-900 bg-red-950/40 px-4 py-2.5 text-sm text-red-200">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-(--status-critical)" />
        <div className="min-w-0">
          <p className="line-clamp-2 wrap-break-word" title={log.message ?? undefined}>
            <span className="font-medium">The last sync failed ({dateTimeFmt(log.ran_at)}).</span>
            {log.message && <span className="text-red-300/80"> {log.message}</span>}
          </p>
          {error && <p className="mt-0.5 text-xs text-red-300/80">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={syncNow} disabled={busy || cooldownSeconds > 0}>
          {busy ? 'Syncing…' : cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : 'Sync now'}
        </Button>
        <button onClick={() => dismiss(log.id)} aria-label="Dismiss" title="Dismiss" className="rounded-md p-1.5 text-red-300/70 transition hover:bg-white/5 hover:text-white">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
