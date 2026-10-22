import type { NetworthAccount, NetworthBalance, NetworthCategory, Portfolio, PortfolioDailyValue, PortfolioKind } from './database.types'

export const CATEGORIES: { value: NetworthCategory; label: string; debt: boolean }[] = [
  { value: 'home', label: 'Home', debt: false },
  { value: 'cash', label: 'Cash', debt: false },
  { value: 'emergency_fund', label: 'Emergency fund', debt: false },
  { value: '401k', label: '401k', debt: false },
  { value: 'traditional_ira', label: 'Traditional IRA', debt: false },
  { value: 'roth_ira', label: 'Roth IRA', debt: false },
  { value: 'brokerage', label: 'Brokerage / investments', debt: false },
  { value: 'auto', label: 'Auto (vehicle value)', debt: false },
  { value: 'misc_asset', label: 'Miscellaneous', debt: false },
  { value: 'mortgage', label: 'Mortgage', debt: true },
  { value: 'auto_loan', label: 'Auto loan', debt: true },
  { value: 'credit_card', label: 'Credit cards', debt: true },
  { value: 'margin', label: 'Margin loans', debt: true },
  { value: 'debt', label: 'Debt', debt: true },
  { value: 'other_debt', label: 'Other debt', debt: true },
]

/** Categories an account can be given ('margin' only comes from portfolios). */
export const ACCOUNT_CATEGORIES = CATEGORIES.filter((c) => c.value !== 'margin')

const CATEGORY_BY_VALUE = new Map(CATEGORIES.map((c) => [c.value, c]))
export const categoryLabel = (c: NetworthCategory) => CATEGORY_BY_VALUE.get(c)?.label ?? c
export const isDebt = (c: NetworthCategory) => CATEGORY_BY_VALUE.get(c)?.debt ?? false

/** Which net-worth line a portfolio fills. */
export const PORTFOLIO_CATEGORY: Record<PortfolioKind, NetworthCategory> = {
  brokerage: 'brokerage',
  '401k': '401k',
  traditional_ira: 'traditional_ira',
  roth_ira: 'roth_ira',
}

// Months are stored as the first day, yyyy-mm-01.
export function monthOf(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

export function monthLabel(month: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' })
}

/** Open in a month: opened on or before it, and not yet closed. */
export function isOpenIn(a: Pick<NetworthAccount, 'opened_month' | 'closed_month'>, month: string): boolean {
  return a.opened_month <= month && (a.closed_month === null || month < a.closed_month)
}

export type NetworthLine = {
  key: string
  name: string
  category: NetworthCategory
  amount: number // signed: debts negative
  source: 'entered' | 'carried' | 'portfolio'
}

export type MonthTotals = {
  month: string
  assets: number
  debts: number // positive number
  net: number
  netExHome: number
  lines: NetworthLine[]
}

/** Net worth for one month: each open account's balance for that month -- or, if none
 * was entered, its most recent earlier balance (marked "carried") -- plus each active
 * portfolio's latest value within or before that month. */
export function monthTotals(
  month: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  portfolios: Portfolio[],
  dailyValues: PortfolioDailyValue[],
): MonthTotals {
  const nextMonth = addMonths(month, 1)
  const lines: NetworthLine[] = []

  for (const a of accounts) {
    if (!isOpenIn(a, month)) continue
    let best: NetworthBalance | null = null
    for (const b of balances) {
      if (b.account_id !== a.id || b.month > month || b.month < a.opened_month) continue
      if (!best || b.month > best.month) best = b
    }
    if (!best) continue
    const sign = isDebt(a.category) ? -1 : 1
    lines.push({ key: a.id, name: a.name, category: a.category, amount: sign * Number(best.balance), source: best.month === month ? 'entered' : 'carried' })
  }

  for (const p of portfolios) {
    if (p.archived) continue
    let best: PortfolioDailyValue | null = null
    for (const v of dailyValues) {
      if (v.portfolio_id !== p.id || v.value_date >= nextMonth) continue
      if (!best || v.value_date > best.value_date) best = v
    }
    if (!best) continue
    // Margin (negative cash) is a loan, so it's shown as a debt and the investments at their
    // full value -- the same net as the portfolio's value, but assets and debts read true.
    const margin = Math.min(Number(best.cash) || 0, 0)
    lines.push({ key: `portfolio:${p.id}`, name: p.name, category: PORTFOLIO_CATEGORY[p.kind], amount: Number(best.total_value) - margin, source: 'portfolio' })
    if (margin < 0) lines.push({ key: `margin:${p.id}`, name: `${p.name} · margin`, category: 'margin', amount: margin, source: 'portfolio' })
  }

  const assets = lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)
  const debts = -lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)
  const homeAndMortgage = lines.filter((l) => l.category === 'home' || l.category === 'mortgage').reduce((s, l) => s + l.amount, 0)
  const net = assets - debts
  return { month, assets, debts, net, netExHome: net - homeAndMortgage, lines }
}

/** January through December of a year (stopping at the current month), skipping
 * months with nothing recorded. */
export function yearTotals(
  year: number,
  currentMonth: string,
  accounts: NetworthAccount[],
  balances: NetworthBalance[],
  portfolios: Portfolio[],
  dailyValues: PortfolioDailyValue[],
): MonthTotals[] {
  const out: MonthTotals[] = []
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}-01`
    if (month > currentMonth) break
    const t = monthTotals(month, accounts, balances, portfolios, dailyValues)
    if (t.lines.length > 0) out.push(t)
  }
  return out
}

export type CategoryTotal = { category: NetworthCategory; label: string; debt: boolean; total: number; count: number }

/** A month's lines summed per category (debts as positive amounts), in the category
 * list's order -- "all credit cards", "all 401k" and so on. */
export function categoryTotals(lines: NetworthLine[]): CategoryTotal[] {
  const byCat = new Map<NetworthCategory, { total: number; count: number }>()
  for (const l of lines) {
    const e = byCat.get(l.category) ?? { total: 0, count: 0 }
    e.total += Math.abs(l.amount)
    e.count += 1
    byCat.set(l.category, e)
  }
  return CATEGORIES.filter((c) => byCat.has(c.value)).map((c) => ({
    category: c.value,
    label: c.label,
    debt: c.debt,
    total: byCat.get(c.value)!.total,
    count: byCat.get(c.value)!.count,
  }))
}

/** Position of a category in CATEGORIES, for sorting accounts by category. */
export const categoryOrder = (c: NetworthCategory) => CATEGORIES.findIndex((x) => x.value === c)
