import type { TradeWithDetails } from '../lib/database.types'
import { tagChipStyle } from '../lib/tagColors'
import { reviewChecks } from '../lib/reviewChecks'

const MARK = { good: '✓', bad: '✗' } as const
const TONE = { good: 'text-emerald-400', bad: 'text-red-400' } as const

/** Compact review summary for a trade list: the setup chip, then Entry / Size / Stop /
 * TP each marked ✓ (done right), ✗ (mistake) or · (not tagged). Hover a check for the
 * tags behind it. Mistakes outside those four areas show as a red +N. */
export function ReviewChecks({ trade }: { trade: TradeWithDetails }) {
  const setup = trade.trade_playbooks?.playbooks ?? null
  const { checks, otherMistakes } = reviewChecks(trade)
  const unreviewed = trade.status === 'CLOSED' && !trade.reviewed_at
  const anyTagged = checks.some((c) => c.status) || otherMistakes.length > 0

  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {setup && (
        <span style={tagChipStyle(setup.color)} className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
          {setup.name}
        </span>
      )}
      {anyTagged &&
        checks.map((c) => (
          <span
            key={c.label}
            title={c.tags.length ? c.tags.join(', ') : 'Not tagged'}
            className={`text-[11px] ${c.status ? TONE[c.status] : 'text-neutral-600'}`}
          >
            {c.label} {c.status ? MARK[c.status] : '·'}
          </span>
        ))}
      {otherMistakes.length > 0 && (
        <span title={otherMistakes.join(', ')} className="rounded-full bg-red-950/70 px-1.5 py-0.5 text-[10px] text-red-300">
          +{otherMistakes.length}
        </span>
      )}
      {unreviewed && <span className="text-[10px] text-blue-400">to review</span>}
    </span>
  )
}
