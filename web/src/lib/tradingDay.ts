import type { Trade } from './database.types'
import { centralDateStr } from './format'

/** The trading day a trade counts toward: closed trades under their close date (when
 * the P&L became real), open trades under their entry date. Central Time. */
export function tradeDay(t: Pick<Trade, 'status' | 'first_in_at' | 'last_out_at'>): string | null {
  const iso = t.status === 'CLOSED' ? t.last_out_at : t.first_in_at
  return iso ? centralDateStr(new Date(iso)) : null
}

/** Next weekday after a yyyy-mm-dd date (market holidays aren't modeled -- worst case
 * tomorrow's focus lands on a holiday and simply shows up the day after). */
export function nextTradingDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d))
  do next.setUTCDate(next.getUTCDate() + 1)
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6)
  return next.toISOString().slice(0, 10)
}

/** "Friday, Oct 9" for a yyyy-mm-dd date, without timezone drift. */
export function longDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

/** Ticker-looking words in the plan's watchlist ("NVDA long over 132.5" -> NVDA), so a
 * trade on a watchlist ticker can be pre-marked as planned during review. */
export function watchlistSymbols(watchlist: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const m of (watchlist ?? '').matchAll(/\b[A-Z]{1,5}\b/g)) out.add(m[0])
  return out
}
