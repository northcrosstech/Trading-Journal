import type { InstallmentPayment, NetworthAccount, NetworthBalance, NetworthCategory, Portfolio, PortfolioActivity, PortfolioDailyValue } from './database.types'
import { addMonths, isDebt, isOpenIn, monthOf, monthTotals } from './networth'
import { expectedPayment, hasPaymentPlan, paymentDueDate } from './installments'

/** Everyday money: what a month's change in these balances means you kept (or used). */
export const CASH_CATEGORIES: NetworthCategory[] = ['cash', 'emergency_fund']

type Flow = Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>

/** Latest balance on or before `month` for an account (null = none yet), and whether it was
 * entered for that exact month (false = carried from an earlier month). */
export function balanceAt(a: NetworthAccount, balances: NetworthBalance[], month: string): { value: number | null; entered: boolean } {
  if (month < a.opened_month || (a.closed_month !== null && month >= a.closed_month)) return { value: null, entered: false }
  let best: NetworthBalance | null = null
  for (const b of balances) if (b.account_id === a.id && b.month <= month && b.month >= a.opened_month && (!best || b.month > best.month)) best = b
  return { value: best ? Number(best.balance) : null, entered: best?.month === month }
}

export type MonthCashFlow = {
  month: string
  /** Change in cash + emergency fund. */
  cashSaved: number
  /** Deposits minus withdrawals into portfolios (not shares moved in; not the setup month). */
  invested: number
  /** Fall in debt balances (negative = new borrowing). */
  debtPaidDown: number
  /** cashSaved + invested + debtPaidDown: what you kept this month. */
  kept: number
  /** Portfolio value change that isn't money in/out: market moves, dividends, option results. */
  investmentGrowth: number
  /** The rest of the net worth change: home / car values, manually entered retirement
   * accounts (contributions + growth together), and opening balances of accounts and
   * portfolios added this month. */
  otherChanges: number
  netWorthChange: number
  /** Every manual account open this month and last month has a balance entered (not carried)
   * for both months -- otherwise the figures lean on carried balances. */
  complete: boolean
  carried: string[] // account names whose balance this month or last was carried
}

/** One month's cash flow, derived only from month-end balances and portfolio activity -- no
 * income entry. Income and spending can't be separated from balances (a balance is net of
 * both), so this measures what was kept and where it went, reconciled to net worth. */
export function monthCashFlow(
  month: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  portfolios: Portfolio[],
  dailyValues: PortfolioDailyValue[],
  flows: Flow[],
): MonthCashFlow {
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  let cashSaved = 0
  let debtPaidDown = 0
  const carried: string[] = []

  for (const a of accounts) {
    const openNow = isOpenIn(a, month)
    const openBefore = isOpenIn(a, prev)
    if (!openNow && !openBefore) continue
    const now = balanceAt(a, balances, month)
    const before = balanceAt(a, balances, prev)
    // An account's first balance is its opening balance, not money moving -- it belongs to
    // "other changes", not to what was kept.
    if (before.value === null) continue
    if ((openNow && !now.entered) || (openBefore && !before.entered)) carried.push(a.name)
    const delta = (now.value ?? 0) - before.value
    if (CASH_CATEGORIES.includes(a.category)) cashSaved += delta
    else if (isDebt(a.category)) debtPaidDown -= delta
  }

  const active = portfolios.filter((p) => !p.archived)
  const inMonth = (d: string) => d >= month && d < next
  let invested = 0
  let investmentGrowth = 0
  for (const p of active) {
    const setupMonth = monthOf(p.created_at.slice(0, 10))
    // The month a portfolio is set up is all opening value (shares and cash brought in, at
    // whatever cost basis) -- neither "invested" nor "growth". It lands in other changes.
    if (setupMonth === month) continue
    const pFlows = flows.filter((f) => f.portfolio_id === p.id && inMonth(f.occurred_on))
    invested += pFlows.filter((f) => f.kind === 'deposit' || f.kind === 'withdrawal').reduce((s, f) => s + Number(f.external_flow), 0)
    const endValue = (before: string) => {
      let best: PortfolioDailyValue | null = null
      for (const v of dailyValues) if (v.portfolio_id === p.id && v.value_date < before && (!best || v.value_date > best.value_date)) best = v
      return best ? Number(best.total_value) : null
    }
    const end = endValue(next)
    if (end === null) continue
    const start = endValue(month)
    if (start === null) continue // no value before this month yet -- nothing to compare against
    investmentGrowth += end - start - pFlows.reduce((s, f) => s + Number(f.external_flow), 0)
  }

  const netWorthChange = monthTotals(month, accounts, balances, portfolios, dailyValues).net - monthTotals(prev, accounts, balances, portfolios, dailyValues).net
  const kept = cashSaved + invested + debtPaidDown
  return {
    month,
    cashSaved,
    invested,
    debtPaidDown,
    kept,
    investmentGrowth,
    otherChanges: netWorthChange - kept - investmentGrowth,
    netWorthChange,
    complete: carried.length === 0,
    carried,
  }
}

export type CloseStatus = {
  month: string // the month being closed (the previous calendar month)
  missing: NetworthAccount[] // open accounts with no balance entered for that month
  unpaid: NetworthAccount[] // debts with a payment set but not marked paid for that month
}

/** The month-end checklist: last month's accounts still without a fresh balance, and
 * installments not marked paid. Null once everything is done, or when last month is before
 * `closeFrom` (the month closing starts from). */
export function closeStatus(
  today: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  payments: InstallmentPayment[],
  closeFrom: string | null = null,
): CloseStatus | null {
  const month = addMonths(monthOf(today), -1)
  if (closeFrom !== null && month < closeFrom) return null
  const open = accounts.filter((a) => isOpenIn(a, month))
  const missing = open.filter((a) => !balances.some((b) => b.account_id === a.id && b.month === month))
  const unpaid = open.filter(
    (a) =>
      isDebt(a.category) &&
      hasPaymentPlan(a) &&
      expectedPayment(a, balances, month).amount > 0 &&
      paymentDueDate(a, month) < today &&
      !payments.some((p) => p.account_id === a.id && p.month === month),
  )
  return missing.length === 0 && unpaid.length === 0 ? null : { month, missing, unpaid }
}

/** The month Net worth opens on: the current month, except from the 1st to the 5th while
 * last month is still being closed out, when it stays on last month. */
export function netWorthOpenMonth(
  today: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  payments: InstallmentPayment[],
  closeFrom: string | null = null,
): string {
  const current = monthOf(today)
  if (Number(today.slice(8, 10)) > 5) return current
  return closeStatus(today, accounts, balances, payments, closeFrom) ? addMonths(current, -1) : current
}
