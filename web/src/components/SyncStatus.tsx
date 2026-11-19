import { useEffect, useState } from 'react'
import type { SyncState } from '../lib/useSyncState'
import { relativeTimeFmt } from '../lib/format'

/** Manual "sync now" control + last-synced status, always visible in the Trading sidebar.
 * The state comes from useSyncState (see there for how a sync is triggered), shared with
 * the failed-sync banner. */
export function SyncStatus({ sync }: { sync: SyncState }) {
  const { log, loaded, busy, cooldownSeconds, error, syncNow } = sync
  const [, setTick] = useState(0) // forces a re-render periodically so "Xm ago" stays fresh

  useEffect(() => {
    const freshnessTick = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(freshnessTick)
  }, [])

  const failed = log?.status === 'error'
  const statusColor = failed ? 'bg-(--status-critical)' : log?.status === 'success' ? 'bg-(--status-good)' : 'bg-neutral-600'
  const text = !loaded
    ? 'Loading…'
    : busy
      ? 'Syncing…'
      : !log
        ? 'Not synced yet'
        : `${failed ? 'Sync failed' : 'Synced'} ${relativeTimeFmt(log.ran_at)}`

  return (
    <div className="mx-3 mb-2 rounded-lg border border-(--border) bg-(--card) px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
          <span className={`truncate text-[11px] ${loaded && !busy && failed ? 'font-medium text-(--status-critical)' : 'text-neutral-500'}`} title={log?.message ?? undefined}>
            {text}
          </span>
        </div>
        <button
          onClick={syncNow}
          disabled={busy || cooldownSeconds > 0}
          title={cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : 'Sync now'}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-(--accent-text) transition hover:bg-(--accent-soft) disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
        >
          {cooldownSeconds > 0 ? `${cooldownSeconds}s` : 'Sync now'}
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-(--status-critical)">{error}</div>}
    </div>
  )
}
