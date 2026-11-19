import type { BuyCandidate } from '../lib/buyCandidates'
import type { Research } from '../lib/research'
import { currency } from '../lib/format'
import { FairBar, ScoreBadge } from './ResearchBits'
import { Button } from './ui/Button'

const DASH = <span className="text-xs text-neutral-600">—</span>

/** A ticker's price against fair value and its score, shown as the Research page shows them.
 * A fund reads "ETF"; a ticker with nothing to go on reads as a dash. */
export function PlanResearch({ r }: { r: Research | undefined }) {
  if (r?.kind === 'etf' && r.fair === null) return <span className="text-xs text-neutral-600">ETF</span>
  if (!r || (r.pct === null && r.total === null)) return DASH
  return (
    <span className="inline-flex items-center gap-3">
      {r.pct !== null ? <FairBar pct={r.pct} /> : DASH}
      {r.total !== null && <ScoreBadge r={r} size="sm" />}
    </span>
  )
}

/** "Worth a look": planned tickers that are under target and rated cheap, with a button that
 * opens the buy form filled in. Renders nothing when the list is empty. */
export function BuyCandidates({ items, onBuy }: { items: BuyCandidate[]; onBuy?: (symbol: string, shares: number) => void }) {
  if (items.length === 0) return null
  return (
    <div className="border-y border-(--border) bg-white/2 px-5 py-3">
      <p className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-300">Worth a look</span> · under target and rated cheap
      </p>
      <ul className="mt-2 grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1.5 text-sm">
        {items.map((c) => (
          <li key={c.symbol} className="contents">
            <span className="font-semibold text-white">{c.symbol}</span>
            <span className="tabular-nums text-neutral-200">
              {currency(c.under)} under target
              <span className="text-xs text-neutral-500">
                {' '}
                · {c.shares} share{c.shares === 1 ? '' : 's'} to get back on plan
              </span>
            </span>
            <PlanResearch r={c.research} />
            {onBuy ? (
              <Button size="sm" onClick={() => onBuy(c.symbol, c.shares)} title={`Opens the buy form with ${c.shares} ${c.symbol} filled in. Nothing is logged until you press Log.`}>
                Fill in trade
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
