import type { InstallmentPayment, NetworthAccount, NetworthBalance, Portfolio, PortfolioActivity, PortfolioDailyValue } from './database.types'
import { monthCashFlow, type MonthCashFlow } from './cashflow'
import { addMonths, monthOf, monthTotals, portfolioCountsIn } from './networth'

/** Money in or out of a portfolio, as fetchExternalFlows returns it. */
export type RecapFlow = Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>

export type PortfolioGrowth = { id: string; name: string; growth: number }

/** Each portfolio's growth in a month that isn't money in or out: end value minus start value
 * minus external flows. The same rule, inputs and order as monthCashFlow's investmentGrowth,
 * kept per portfolio. A portfolio in the month it was set up, or without a value on both
 * sides of the month, has no figure and is left out. */
export function portfolioGrowthIn(month: string, portfolios: Portfolio[], dailyValues: PortfolioDailyValue[], flows: RecapFlow[]): PortfolioGrowth[] {
  const next = addMonths(month, 1)
  const out: PortfolioGrowth[] = []
  for (const p of portfolios) {
    if (!portfolioCountsIn(p, month)) continue
    if (monthOf(p.created_at.slice(0, 10)) === month) continue
    const valueBefore = (before: string) => {
      let best: PortfolioDailyValue | null = null
      for (const v of dailyValues) if (v.portfolio_id === p.id && v.value_date < before && (!best || v.value_date > best.value_date)) best = v
      return best ? Number(best.total_value) : null
    }
    const end = valueBefore(next)
    if (end === null) continue
    const start = valueBefore(month)
    if (start === null) continue
    const moved = flows.filter((f) => f.portfolio_id === p.id && f.occurred_on >= month && f.occurred_on < next).reduce((s, f) => s + Number(f.external_flow), 0)
    out.push({ id: p.id, name: p.name, growth: end - start - moved })
  }
  return out
}

export type RecapPayment = { accountId: string; name: string; amount: number }

export type MonthRecap = {
  month: string
  netWorth: number
  /** False for the first month with anything recorded: there's no earlier month to compare with. */
  hasPrevious: boolean
  cashFlow: MonthCashFlow
  /** Per-portfolio growth, or null when the figures don't add up to cashFlow.investmentGrowth. */
  growth: PortfolioGrowth[] | null
  /** The month's payments marked paid, largest first. */
  payments: RecapPayment[]
  paymentsTotal: number
}

/** Everything the month recap shows except income, which is loaded for the month by itself. */
export function monthRecap(
  month: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  portfolios: Portfolio[],
  dailyValues: PortfolioDailyValue[],
  flows: RecapFlow[],
  payments: InstallmentPayment[],
): MonthRecap {
  const cashFlow = monthCashFlow(month, accounts, balances, portfolios, dailyValues, flows)
  const growth = portfolioGrowthIn(month, portfolios, dailyValues, flows)
  const growthTotal = growth.reduce((s, g) => s + g.growth, 0)
  const paid = payments
    .filter((p) => p.month === month)
    .map((p) => ({ accountId: p.account_id, name: accounts.find((a) => a.id === p.account_id)?.name ?? 'Removed account', amount: Number(p.amount) }))
    .sort((x, y) => y.amount - x.amount)
  return {
    month,
    netWorth: monthTotals(month, accounts, balances, portfolios, dailyValues).net,
    hasPrevious: monthTotals(addMonths(month, -1), accounts, balances, portfolios, dailyValues).lines.length > 0,
    cashFlow,
    growth: Math.abs(growthTotal - cashFlow.investmentGrowth) < 0.005 ? growth : null,
    payments: paid,
    paymentsTotal: paid.reduce((s, p) => s + p.amount, 0),
  }
}

/** The portfolio that grew the most and the one that fell the most (or grew the least). With
 * a single portfolio there is no worst. */
export function bestAndWorst(growth: PortfolioGrowth[]): { best: PortfolioGrowth; worst: PortfolioGrowth | null } | null {
  if (growth.length === 0) return null
  let best = growth[0]
  for (const g of growth) if (g.growth > best.growth) best = g
  // Picked from the others, so two portfolios with the same growth aren't one shown twice.
  let worst: PortfolioGrowth | null = null
  for (const g of growth) if (g !== best && (!worst || g.growth < worst.growth)) worst = g
  return { best, worst }
}
