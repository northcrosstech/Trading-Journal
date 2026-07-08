import { Link } from 'react-router-dom'
import type { Trade } from '../lib/database.types'
import { currency, dateFmt } from '../lib/format'

/** Compact recent-trades glance list -- most recent N trades, win/loss colored, so
 * you can scan wins vs. losses at a glance without opening the full Trade Log. */
export function RecentTradesList({ trades, limit = 8 }: { trades: Trade[]; limit?: number }) {
  const recent = [...trades]
    .sort((a, b) => new Date(b.first_in_at ?? 0).getTime() - new Date(a.first_in_at ?? 0).getTime())
    .slice(0, limit)

  if (recent.length === 0) {
    return <div className="p-6 text-center text-sm text-neutral-500">No trades yet.</div>
  }

  return (
    <div className="flex flex-col divide-y divide-neutral-800/60">
      {recent.map((t) => (
        <Link key={t.id} to={`/trades/${t.id}`} className="flex items-center justify-between px-1 py-2 text-sm hover:bg-neutral-800/40">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                t.status === 'OPEN'
                  ? 'bg-blue-500'
                  : (t.realized_pnl_net ?? 0) >= 0
                    ? 'bg-(--status-good)'
                    : 'bg-(--status-critical)'
              }`}
            />
            <span className="font-medium text-neutral-200">{t.symbol}</span>
            <span className="text-xs text-neutral-500">{dateFmt(t.first_in_at)}</span>
          </div>
          {t.status === 'OPEN' ? (
            <span className="text-xs text-neutral-500">OPEN</span>
          ) : (
            <span className={`tabular-nums ${(t.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
              {currency(t.realized_pnl_net)}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
