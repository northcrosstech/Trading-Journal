import type { NetworthAccount, NetworthBalance, Portfolio, PortfolioActivity, PortfolioDailyValue } from './database.types'
import { balanceAt, monthCashFlow } from './cashflow'
import { addMonths, isOpenIn, monthTotals, portfolioCountsIn } from './networth'

/** Money in or out of a portfolio, as fetchExternalFlows returns it. */
export type ExternalFlow = Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>

export type ChangePart = { key: string; label: string; hint: string; value: number }

/** One month's net worth change for the Overview card, or why it can't be shown as numbers. */
export type NetWorthChange =
  /** Nothing recorded for the month. */
  | { state: 'none' }
  /** Nothing recorded before the month, so there is no change to speak of. */
  | { state: 'first'; month: string }
  /** Some balances were carried, not entered. `fixMonth` is the month to enter them for. */
  | { state: 'carried'; month: string; carried: string[]; fixMonth: string }
  /** `parts` are the non-zero pieces of monthCashFlow, which add up to `change`. `added` names
   * accounts and portfolios whose starting value falls in the month (part of "Other changes"). */
  | { state: 'ready'; month: string; change: number; parts: ChangePart[]; added: string[] }

// Below half a cent a figure prints as $0.00.
const isZero = (n: number) => Math.abs(n) < 0.005

/** The month's change and its split, straight from monthCashFlow: nothing is recalculated here. */
export function netWorthChange(
  month: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  portfolios: Portfolio[],
  dailyValues: PortfolioDailyValue[],
  flows: ExternalFlow[],
): NetWorthChange {
  const prev = addMonths(month, -1)
  if (monthTotals(month, accounts, balances, portfolios, dailyValues).lines.length === 0) return { state: 'none' }
  if (monthTotals(prev, accounts, balances, portfolios, dailyValues).lines.length === 0) return { state: 'first', month }

  const cf = monthCashFlow(month, accounts, balances, portfolios, dailyValues, flows)
  if (!cf.complete) {
    const carriedIn = (m: string) => accounts.some((a) => cf.carried.includes(a.name) && isOpenIn(a, m) && !balanceAt(a, balances, m).entered)
    return { state: 'carried', month, carried: cf.carried, fixMonth: carriedIn(prev) ? prev : month }
  }

  const next = addMonths(month, 1)
  const added = [
    ...accounts.filter((a) => balanceAt(a, balances, prev).value === null && balanceAt(a, balances, month).value !== null).map((a) => a.name),
    ...portfolios
      .filter((p) => {
        if (!portfolioCountsIn(p, month)) return false
        const dates = dailyValues.filter((v) => v.portfolio_id === p.id).map((v) => v.value_date)
        return dates.some((d) => d >= month && d < next) && !dates.some((d) => d < month)
      })
      .map((p) => p.name),
  ]
  const parts: ChangePart[] = [
    { key: 'cash', label: 'Cash saved', hint: 'Change in cash and emergency fund', value: cf.cashSaved },
    { key: 'invested', label: 'Invested', hint: 'Deposits into portfolios, minus withdrawals', value: cf.invested },
    { key: 'debt', label: 'Debt paid down', hint: cf.debtPaidDown < 0 ? 'Debt grew this month' : 'Loans and cards', value: cf.debtPaidDown },
    { key: 'growth', label: 'Investment growth', hint: 'Portfolio gains, not money you added', value: cf.investmentGrowth },
    { key: 'other', label: 'Other changes', hint: 'Home and car values, manually entered retirement accounts, new accounts', value: cf.otherChanges },
  ]
  return { state: 'ready', month, change: cf.netWorthChange, parts: parts.filter((p) => !isZero(p.value)), added }
}

/** The Cash flow tab on `month`. It opens on last month, so that month needs no ?month. */
export function cashFlowLink(month: string, currentMonth: string): string {
  return month === addMonths(currentMonth, -1) ? '/networth?view=cashflow' : `/networth?view=cashflow&month=${month.slice(0, 7)}`
}
