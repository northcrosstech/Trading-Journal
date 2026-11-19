import type { HoldingView } from './portfolio'

export type MoverMode = 'total' | 'day'
export type Mover = { id: string; symbol: string; dollars: number; pct: number | null }

/** Is this holding's day change part of the latest trading day (`asOf`)? The same rule the
 * portfolio's day total uses, so a stale ticker can't bring in an older day's move. */
const inDay = (v: HoldingView, asOf: string | null) => v.dayChange !== null && v.priceDate === asOf

/** Holdings with a price. Fewer than three and a ranking adds nothing. */
export const pricedCount = (views: HoldingView[]) => views.filter((v) => v.price !== null).length

/** Does any holding have a change for the latest trading day? */
export const hasDayMoves = (views: HoldingView[], asOf: string | null) => views.some((v) => inDay(v, asOf))

/** The holdings up the most and down the most, in dollars, from the figures the holdings
 * table already shows: gain against cost ('total') or the latest day's change ('day'). Only a
 * gain counts as up and only a loss as down; a holding with no price is left out. */
export function movers(views: HoldingView[], mode: MoverMode, asOf: string | null, limit = 3): { up: Mover[]; down: Mover[] } {
  const rows: Mover[] = []
  for (const v of views) {
    const who = { id: v.holding.id, symbol: v.holding.symbol }
    if (mode === 'total') {
      if (v.gain !== null) rows.push({ ...who, dollars: v.gain, pct: v.gainPct })
    } else if (inDay(v, asOf)) rows.push({ ...who, dollars: v.dayChange as number, pct: v.dayChangePct })
  }
  return {
    up: rows.filter((r) => r.dollars > 0).sort((a, b) => b.dollars - a.dollars).slice(0, limit),
    down: rows.filter((r) => r.dollars < 0).sort((a, b) => a.dollars - b.dollars).slice(0, limit),
  }
}
