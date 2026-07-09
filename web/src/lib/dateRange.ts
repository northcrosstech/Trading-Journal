import type { Trade } from './database.types'
import { centralDateStr } from './format'

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last3Months'
  | 'thisYear'
  | 'lastYear'

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This Wk' },
  { value: 'lastWeek', label: 'Last Wk' },
  { value: 'thisMonth', label: 'This Mo' },
  { value: 'lastMonth', label: 'Last Mo' },
  { value: 'last3Months', label: 'Last 3 Mo' },
  { value: 'thisYear', label: 'This Yr' },
  { value: 'lastYear', label: 'Last Yr' },
]

/** Central Time calendar date (the exchange's own timezone), not the viewer's
 * browser timezone and not UTC -- "today"/"yesterday" etc. must reflect the trading
 * day, which is the same single source of truth used to bucket trades themselves
 * (see bucketDate below), or presets and trade buckets can disagree. */
export function toDateStr(d: Date): string {
  return centralDateStr(d)
}

function startOfWeek(d: Date): Date {
  const start = new Date(d)
  start.setDate(start.getDate() - start.getDay())
  return start
}

/** null preset = no filter (all-time / Reset). */
export function presetRange(preset: DateRangePreset | null): { from: string; to: string } | null {
  if (preset === null) return null
  const now = new Date()

  switch (preset) {
    case 'today': {
      const today = toDateStr(now)
      return { from: today, to: today }
    }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      const ys = toDateStr(y)
      return { from: ys, to: ys }
    }
    case 'thisWeek': {
      const start = startOfWeek(now)
      return { from: toDateStr(start), to: toDateStr(now) }
    }
    case 'lastWeek': {
      const thisStart = startOfWeek(now)
      const lastStart = new Date(thisStart)
      lastStart.setDate(lastStart.getDate() - 7)
      const lastEnd = new Date(thisStart)
      lastEnd.setDate(lastEnd.getDate() - 1)
      return { from: toDateStr(lastStart), to: toDateStr(lastEnd) }
    }
    case 'thisMonth': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: toDateStr(start), to: toDateStr(now) }
    }
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toDateStr(start), to: toDateStr(end) }
    }
    case 'last3Months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, 1)
      return { from: toDateStr(start), to: toDateStr(now) }
    }
    case 'thisYear': {
      const start = new Date(now.getFullYear(), 0, 1)
      return { from: toDateStr(start), to: toDateStr(now) }
    }
    case 'lastYear': {
      const start = new Date(now.getFullYear() - 1, 0, 1)
      const end = new Date(now.getFullYear() - 1, 11, 31)
      return { from: toDateStr(start), to: toDateStr(end) }
    }
  }
}

/** The date a trade "counts" against for range filtering -- closed trades bucket
 * under their close date (when the P&L became real), open trades under their entry
 * date. Matches the bucketing convention used by the calendar and journal feed. */
function bucketDate(trade: Pick<Trade, 'status' | 'first_in_at' | 'last_out_at'>): string | null {
  const iso = trade.status === 'CLOSED' ? trade.last_out_at : trade.first_in_at
  return iso ? centralDateStr(new Date(iso)) : null
}

export function filterTradesByDateRange<T extends Pick<Trade, 'status' | 'first_in_at' | 'last_out_at'>>(
  trades: T[],
  range: { from: string; to: string } | null,
): T[] {
  if (range === null) return trades
  return trades.filter((t) => {
    const date = bucketDate(t)
    return date !== null && date >= range.from && date <= range.to
  })
}
