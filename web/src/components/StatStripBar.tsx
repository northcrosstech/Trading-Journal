import type { StatStrip } from '../lib/metrics'
import { currency, percentFmt } from '../lib/format'

export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'critical' | 'neutral'
}) {
  const toneClass = tone === 'good' ? 'text-(--status-good)' : tone === 'critical' ? 'text-(--status-critical)' : 'text-neutral-100'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
      {sub && <span className="text-[10px] tabular-nums text-neutral-600">{sub}</span>}
    </div>
  )
}

function pctOfTotal(n: number | null): string | undefined {
  return n === null ? undefined : `${(n * 100).toFixed(0)}% of trades`
}

/** Condensed StonkJournal-style stat strip -- small tiles in one dense row. Wins/
 * Losses/Open/Wash partition all trades in range, so each "+%" subline is that
 * tile's share of everything. */
export function StatStripBar({ stats }: { stats: StatStrip }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-7">
      <StatTile label="Wins" value={String(stats.wins)} sub={pctOfTotal(stats.winPct)} tone="good" />
      <StatTile label="Losses" value={String(stats.losses)} sub={pctOfTotal(stats.lossPct)} tone="critical" />
      <StatTile label="Open" value={String(stats.open)} sub={pctOfTotal(stats.openPct)} />
      <StatTile label="Wash" value={String(stats.wash)} sub={pctOfTotal(stats.washPct)} />
      <StatTile label="Avg Win" value={stats.avgWin === null ? '—' : currency(stats.avgWin)} tone="good" />
      <StatTile label="Avg Loss" value={stats.avgLoss === null ? '—' : currency(stats.avgLoss)} tone="critical" />
      <StatTile
        label="Net P&L"
        value={currency(stats.netPnl)}
        sub={stats.netPnlReturnPct === null ? undefined : percentFmt(stats.netPnlReturnPct)}
        tone={stats.netPnl >= 0 ? 'good' : 'critical'}
      />
    </div>
  )
}
