import type { PortfolioActivity } from './database.types'
import { monthOf } from './networth'

/** Activity kinds that are option premium: selling a covered call or a cash-secured put
 * brings premium in, buying one back gives some of it up. Bought options (and selling them
 * again) are trades, not income, so they aren't here. */
export const PREMIUM_KINDS = ['option_write', 'csp_open', 'option_buyback', 'csp_close'] as const

/** Everything counted as income from investments: dividends received and option premium. */
export const INCOME_KINDS = ['dividend', ...PREMIUM_KINDS] as const

export type IncomeEntry = Pick<PortfolioActivity, 'portfolio_id' | 'occurred_on' | 'kind' | 'symbol' | 'cash_change'>

export type MonthIncome = {
  /** yyyy-mm-01 */
  month: string
  dividends: number
  /** Premium received from sold options, less what was paid to buy any back. */
  premium: number
  total: number
}

const isPremium = (kind: string) => (PREMIUM_KINDS as readonly string[]).includes(kind)

/** Dividends and net option premium for one month, from entries as recorded (cash in is
 * positive, a buy-back negative). Nothing is estimated. */
export function incomeIn(entries: IncomeEntry[], month: string): MonthIncome {
  let dividends = 0
  let premium = 0
  for (const e of entries) {
    if (monthOf(e.occurred_on) !== month) continue
    const cash = Number(e.cash_change) || 0
    if (e.kind === 'dividend') dividends += cash
    else if (isPremium(e.kind)) premium += cash
  }
  return { month, dividends, premium, total: dividends + premium }
}

/** The same, for each of the months given, in that order. */
export function incomeByMonth(entries: IncomeEntry[], months: string[]): MonthIncome[] {
  return months.map((m) => incomeIn(entries, m))
}
