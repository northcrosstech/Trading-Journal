import type { TradeWithDetails } from '../lib/database.types'
import { tagChipStyle } from '../lib/tagColors'

/** Compact read-only summary of a trade's review: setup, planned/unplanned, mistakes,
 * or a "to review" hint when it hasn't been reviewed yet. */
export function TradeTags({ trade }: { trade: TradeWithDetails }) {
  const setup = trade.trade_playbooks?.playbooks ?? null
  const unreviewed = trade.status === 'CLOSED' && !trade.reviewed_at

  return (
    <span className="flex flex-wrap items-center gap-1">
      {setup && (
        <span style={tagChipStyle(setup.color)} className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
          {setup.name}
        </span>
      )}
      {trade.planned === true && (
        <span className="rounded-full border border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-400">Planned</span>
      )}
      {trade.planned === false && (
        <span className="rounded-full border border-amber-800 px-1.5 py-0.5 text-[10px] text-amber-400">Unplanned</span>
      )}
      {trade.mistakes.map((m) => (
        <span key={m} className="rounded-full bg-red-950/70 px-1.5 py-0.5 text-[10px] text-red-300">
          {m}
        </span>
      ))}
      {unreviewed && <span className="text-[10px] text-blue-400">to review</span>}
    </span>
  )
}
