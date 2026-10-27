import { CalendarClock } from 'lucide-react'
import { fairTone, fairWord, scoreTone, type Research, type Tone } from '../lib/research'
import { currency } from '../lib/format'
import { Pill, type PillTone } from './ui/Pill'

export const PILL_TONE: Record<Tone, PillTone> = { green: 'green', neutral: 'neutral', amber: 'amber', red: 'red', teal: 'teal' }
const BAR: Record<Tone, string> = { green: 'bg-emerald-400', neutral: 'bg-neutral-400', amber: 'bg-amber-400', red: 'bg-red-400', teal: 'bg-teal-400' }
const RING: Record<Tone, string> = {
  green: 'border-emerald-400/70 text-emerald-200',
  neutral: 'border-neutral-500 text-neutral-200',
  amber: 'border-amber-400/70 text-amber-200',
  red: 'border-red-400/70 text-red-200',
  teal: 'border-teal-400/70 text-teal-200',
}

const pctText = (pct: number) => `${Math.round(pct * 100)}%`
export const earningsText = (days: number) => (days === 0 ? 'Earnings today' : days === 1 ? 'Earnings tomorrow' : `Earnings in ${days}d`)

/** The score as a coloured ring with the number, plus its label. */
export function ScoreBadge({ r, size = 'md', withLabel = true }: { r: Research; size?: 'sm' | 'md'; withLabel?: boolean }) {
  if (r.total === null || r.label === null) return <span className="text-xs text-neutral-600">—</span>
  const tone = scoreTone(r.label)
  const ring = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm'
  return (
    <span className="inline-flex items-center gap-2" title={`Score ${r.total}/100${r.partial ? ' (partial)' : ''}`}>
      <span className={`inline-flex ${ring} items-center justify-center rounded-full border-2 font-semibold tabular-nums ${RING[tone]}`}>{r.total}</span>
      {withLabel && (
        <span className="text-xs text-neutral-400">
          {r.label}
          {r.partial && <span className="text-neutral-600"> · partial</span>}
        </span>
      )}
    </span>
  )
}

/** Price as a share of fair value, as a short bar with the number. */
export function FairBar({ pct }: { pct: number }) {
  const tone = fairTone(pct)
  return (
    <span className="inline-flex items-center gap-2" title={`${pctText(pct)} of fair value — ${fairWord(pct)}`}>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-800">
        <span className={`block h-full rounded-full ${BAR[tone]}`} style={{ width: `${Math.min(pct / 1.5, 1) * 100}%` }} />
      </span>
      <span className="w-11 text-right text-xs tabular-nums text-neutral-300">{pctText(pct)}</span>
    </span>
  )
}

/** Holdings-table pills: fair value and % of it, the score, and an earnings warning within
 * a week. Clicking opens the breakdown. */
export function ResearchPills({ r, onOpen }: { r: Research | undefined; onOpen: () => void }) {
  if (!r) return null
  if (r.kind === 'etf') return <span className="text-xs text-neutral-600">ETF</span>
  if (r.fair === null && r.total === null) return <span className="text-xs text-neutral-600" title="Waiting for earnings data">—</span>
  return (
    <button onClick={onOpen} className="flex flex-col items-start gap-1 text-left" title="Open the breakdown">
      <span className="flex flex-wrap items-center gap-1">
        {r.fair !== null && r.pct !== null && (
          <Pill tone={PILL_TONE[fairTone(r.pct)]}>
            FV {currency(r.fair)} · {pctText(r.pct)}
          </Pill>
        )}
        {r.total !== null && r.label !== null && <Pill tone={PILL_TONE[scoreTone(r.label)]}>{r.total}</Pill>}
        {r.checks.length > 0 && <Pill tone="amber">check</Pill>}
      </span>
      {r.earnings && r.earnings.days <= 7 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
          <CalendarClock size={11} /> {earningsText(r.earnings.days)}
        </span>
      )}
    </button>
  )
}
