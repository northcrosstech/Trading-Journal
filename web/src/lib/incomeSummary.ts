import { addMonths, monthOf } from './networth'
import { incomeByMonth, type IncomeEntry, type MonthIncome } from './income'

/** Full months the Income card shows before the current one. */
export const INCOME_FULL_MONTHS = 12

export type IncomeTotals = Pick<MonthIncome, 'dividends' | 'premium' | 'total'>

export type IncomeMonth = MonthIncome & {
  /** The month still running: its figures are so far. */
  current: boolean
}

export type IncomeSummary = {
  /** The last 12 full months, then the current one. */
  months: IncomeMonth[]
  /** January through today. */
  yearToDate: IncomeTotals
  /** The 12 full months before the current one. */
  lastYear: IncomeTotals
  /** `lastYear` divided by `averagedMonths`. */
  monthlyAverage: IncomeTotals
  /** The full months the average covers: from the first one with any income, at most 12, so
   * months before anything was recorded don't pull it down. */
  averagedMonths: number
  /** The first of those months. */
  averagedFrom: string
  firstMonth: string
  lastFullMonth: string
}

/** The date to load income entries from: the first day of the earliest month shown. */
export const incomeSince = (today: string) => addMonths(monthOf(today), -INCOME_FULL_MONTHS)

const sum = (months: MonthIncome[]): IncomeTotals =>
  months.reduce((s, m) => ({ dividends: s.dividends + m.dividends, premium: s.premium + m.premium, total: s.total + m.total }), { dividends: 0, premium: 0, total: 0 })

/** Month-by-month income for the Income card and its three headline figures. Only adds up
 * what incomeByMonth returns. */
export function incomeSummary(entries: IncomeEntry[], today: string): IncomeSummary {
  const current = monthOf(today)
  const firstMonth = incomeSince(today)
  const months = incomeByMonth(
    entries,
    Array.from({ length: INCOME_FULL_MONTHS + 1 }, (_, i) => addMonths(firstMonth, i)),
  ).map((m) => ({ ...m, current: m.month === current }))
  const full = months.filter((m) => !m.current)
  const lastYear = sum(full)
  const firstWithIncome = full.findIndex((m) => m.dividends !== 0 || m.premium !== 0)
  const averaged = firstWithIncome === -1 ? full : full.slice(firstWithIncome)
  const n = Math.max(averaged.length, 1)
  return {
    months,
    yearToDate: sum(months.filter((m) => m.month.slice(0, 4) === today.slice(0, 4))),
    lastYear,
    monthlyAverage: { dividends: lastYear.dividends / n, premium: lastYear.premium / n, total: lastYear.total / n },
    averagedMonths: n,
    averagedFrom: averaged[0]?.month ?? firstMonth,
    firstMonth,
    lastFullMonth: addMonths(current, -1),
  }
}
