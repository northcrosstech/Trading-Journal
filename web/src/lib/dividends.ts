import type { DividendFrequency, DividendInfo, Holding, PortfolioActivity } from './database.types'
import type { SymbolPrice } from './wealthQueries'

export const FREQUENCIES: { value: DividendFrequency; label: string; perYear: number }[] = [
  { value: 'monthly', label: 'Monthly', perYear: 12 },
  { value: 'quarterly', label: 'Quarterly', perYear: 4 },
  { value: 'semiannual', label: 'Twice a year', perYear: 2 },
  { value: 'annual', label: 'Yearly', perYear: 1 },
]
const PER_YEAR = new Map(FREQUENCIES.map((f) => [f.value, f.perYear]))
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The months (1-12) a ticker pays in: every month for monthly payers, otherwise the
 * chosen month and every 12/n months after it, wrapping around the year. */
export function payMonths(frequency: DividendFrequency, payMonth: number | null): number[] {
  const n = PER_YEAR.get(frequency) ?? 1
  if (n === 12 || payMonth === null) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const step = 12 / n
  return Array.from({ length: n }, (_, i) => ((payMonth - 1 + i * step) % 12) + 1).sort((a, b) => a - b)
}

/** "Mar · Jun · Sep · Dec" -- shown in the month picker so the whole cycle is clear. */
export function cycleLabel(frequency: DividendFrequency, payMonth: number | null): string {
  if (frequency === 'monthly') return 'Every month'
  return payMonths(frequency, payMonth)
    .map((m) => MONTHS[m - 1])
    .join(' · ')
}

/** Shares and total cost per ticker -- one ticker held in several portfolios counts once. */
export function sharesBySymbol(holdings: Holding[]): Map<string, { shares: number; cost: number }> {
  const out = new Map<string, { shares: number; cost: number }>()
  for (const h of holdings) {
    const e = out.get(h.symbol) ?? { shares: 0, cost: 0 }
    e.shares += Number(h.quantity)
    e.cost += Number(h.quantity) * Number(h.avg_cost)
    out.set(h.symbol, e)
  }
  return out
}

export type DividendRow = {
  symbol: string
  shares: number
  info: DividendInfo | null // null = no dividend entered (doesn't pay, or not set up yet)
  perYear: number
  perPayment: number
  yield: number | null // on today's price
  yieldOnCost: number | null // on your average cost
  months: number[]
  nextMonth: number | null // 1-12, the next pay month from the current month on
}

export function dividendRows(
  holdings: Holding[],
  info: Map<string, DividendInfo>,
  prices: Map<string, SymbolPrice>,
  currentMonth: number,
): DividendRow[] {
  return Array.from(sharesBySymbol(holdings), ([symbol, { shares, cost }]) => {
    const d = info.get(symbol) ?? null
    if (!d) return { symbol, shares, info: null, perYear: 0, perPayment: 0, yield: null, yieldOnCost: null, months: [], nextMonth: null }
    const annual = Number(d.annual_per_share)
    const months = payMonths(d.frequency, d.pay_month)
    const perYear = annual * shares
    const holding = holdings.find((h) => h.symbol === symbol)
    const price = holding?.manual_price != null ? Number(holding.manual_price) : prices.get(symbol)?.close
    const avgCost = shares > 0 ? cost / shares : 0
    return {
      symbol,
      shares,
      info: d,
      perYear,
      perPayment: perYear / months.length,
      yield: price ? annual / price : null,
      yieldOnCost: avgCost > 0 ? annual / avgCost : null,
      months,
      nextMonth: months.find((m) => m >= currentMonth) ?? months[0] ?? null,
    }
  }).sort((a, b) => b.perYear - a.perYear || a.symbol.localeCompare(b.symbol))
}

export type CalendarMonth = {
  month: number // 1-12
  label: string
  kind: 'received' | 'expected'
  amount: number // what the bar shows
  expected: number
  received: number
  breakdown: { symbol: string; amount: number }[] // matches `kind`
}

/** January-December of a year: months already over show what was actually recorded as
 * received; the current month and later show what's expected from today's shares. */
export function dividendCalendar(rows: DividendRow[], received: PortfolioActivity[], year: number, currentMonth: number): CalendarMonth[] {
  return MONTHS.map((label, i) => {
    const month = i + 1
    const expectedBreakdown = rows.filter((r) => r.months.includes(month)).map((r) => ({ symbol: r.symbol, amount: r.perPayment }))
    const receivedBreakdownMap = new Map<string, number>()
    for (const a of received) {
      if (Number(a.occurred_on.slice(0, 4)) !== year || Number(a.occurred_on.slice(5, 7)) !== month) continue
      const key = a.symbol ?? 'Other'
      receivedBreakdownMap.set(key, (receivedBreakdownMap.get(key) ?? 0) + Number(a.cash_change))
    }
    const receivedBreakdown = Array.from(receivedBreakdownMap, ([symbol, amount]) => ({ symbol, amount }))
    const expected = expectedBreakdown.reduce((s, b) => s + b.amount, 0)
    const got = receivedBreakdown.reduce((s, b) => s + b.amount, 0)
    const past = month < currentMonth
    return {
      month,
      label,
      kind: past ? 'received' : 'expected',
      amount: past ? got : expected,
      expected,
      received: got,
      breakdown: (past ? receivedBreakdown : expectedBreakdown).sort((a, b) => b.amount - a.amount),
    }
  })
}

/** Sum of dividends recorded on or after a date. */
export function receivedSince(received: PortfolioActivity[], since: string): number {
  return received.filter((a) => a.occurred_on >= since).reduce((s, a) => s + Number(a.cash_change), 0)
}
