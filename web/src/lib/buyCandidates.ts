import type { PlanAction, PlanRow } from './positionPlan'
import { fairWord, type Research } from './research'

export type BuyCandidate = {
  symbol: string
  /** Dollars under target: the plan row's own figure. */
  under: number
  /** Whole shares to get back on plan, as the plan works them out. */
  shares: number
  research: Research
}

/** Does Research put this ticker's price in its cheapest band? No fair value, no answer. */
export const ratedCheap = (r: Research | undefined): r is Research => !!r && r.pct !== null && fairWord(r.pct) === 'cheap'

/** Planned tickers the plan says to buy that Research also rates cheap, furthest under target
 * first. Nothing new is worked out here: the gap and the shares are the plan's, the rating is
 * Research's. A ticker with no price or no fair value is never listed. */
export function buyCandidates(rows: PlanRow[], actions: Map<string, PlanAction> | null, research: Map<string, Research>, limit = 5): BuyCandidate[] {
  if (!actions) return []
  const out: BuyCandidate[] = []
  for (const row of rows) {
    if (row.kind !== 'ticker') continue
    const a = actions.get(row.symbol)
    const r = research.get(row.symbol)
    if (a?.kind !== 'buy' || a.shares === null || !ratedCheap(r)) continue
    out.push({ symbol: row.symbol, under: row.move, shares: a.shares, research: r })
  }
  return out.sort((x, y) => y.under - x.under).slice(0, limit)
}
