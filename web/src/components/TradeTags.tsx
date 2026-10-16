import type { TradeWithDetails } from '../lib/database.types'
import { tagChipStyle } from '../lib/tagColors'
import { strengthsOf } from '../lib/strengths'

/** Compact read-only summary of a trade's review: setup, planned/unplanned/followed, done-right
 * and mistake tags, or a "to review" hint when it hasn't been reviewed yet. */
export function TradeTags({ trade }: { trade: TradeWithDetails }) {
  const setup = trade.trade_playbooks?.playbooks ?? null
  const unreviewed = trade.status === 'CLOSED' && !trade.reviewed_at
  const origin = trade.trade_origin

  return (
    <span className="flex flex-wrap items-center gap-1">
      {setup && (
        <span style={tagChipStyle(setup.color)} className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
          {setup.name}
        </span>
      )}
      {origin === 'planned' && (
        <span className="rounded-full border border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-400">Planned</span>
      )}
      {origin === 'followed' && (
        <span className="rounded-full border border-sky-800 px-1.5 py-0.5 text-[10px] text-sky-400">Followed</span>
      )}
      {origin === 'unplanned' && (
        <span className="rounded-full border border-amber-800 px-1.5 py-0.5 text-[10px] text-amber-400">Unplanned</span>
      )}
      {strengthsOf(trade).map((m) => (
        <span key={m} className="rounded-full bg-emerald-950/70 px-1.5 py-0.5 text-[10px] text-emerald-300">
          {m}
        </span>
      ))}
      {trade.mistakes.map((m) => (
        <span key={m} className="rounded-full bg-red-950/70 px-1.5 py-0.5 text-[10px] text-red-300">
          {m}
        </span>
      ))}
      {unreviewed && <span className="text-[10px] text-blue-400">to review</span>}
    </span>
  )
}
