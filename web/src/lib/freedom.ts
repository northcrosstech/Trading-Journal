import type { NetworthAccount, NetworthBalance, NetworthCategory, Portfolio, PortfolioActivity, PortfolioDailyValue } from './database.types'
import { monthCashFlow } from './cashflow'
import { addMonths, isOpenIn, monthTotals, type NetworthLine } from './networth'

export type FreedomSettings = {
  /** Your own numbers; null = use the suggested one. */
  monthlySpending: number | null
  monthlySavings: number | null
  otherBills: number
  withdrawalRate: number // %
  realReturn: number // % a year, after inflation
  coastYears: number
}

export const FREEDOM_DEFAULTS: FreedomSettings = { monthlySpending: null, monthlySavings: null, otherBills: 0, withdrawalRate: 4, realReturn: 5, coastYears: 25 }

/** What counts as freedom money. The home, cars and miscellaneous items don't: you can't live
 * off them. The mortgage isn't subtracted here -- clearing it is part of the freedom number. */
const COUNTED: NetworthCategory[] = ['brokerage', '401k', 'traditional_ira', 'roth_ira', 'cash', 'emergency_fund']
const SUBTRACTED: NetworthCategory[] = ['credit_card', 'auto_loan', 'margin', 'debt', 'other_debt']

export type FreedomMoney = { money: number; mortgage: number; counted: NetworthLine[]; subtracted: NetworthLine[]; left: NetworthLine[] }

export function freedomMoney(lines: NetworthLine[]): FreedomMoney {
  const counted = lines.filter((l) => COUNTED.includes(l.category))
  const subtracted = lines.filter((l) => SUBTRACTED.includes(l.category))
  const left = lines.filter((l) => l.category !== 'mortgage' && !COUNTED.includes(l.category) && !SUBTRACTED.includes(l.category))
  return {
    money: [...counted, ...subtracted].reduce((s, l) => s + l.amount, 0),
    mortgage: -lines.filter((l) => l.category === 'mortgage').reduce((s, l) => s + l.amount, 0),
    counted,
    subtracted,
    left,
  }
}

/** Ongoing spending × 12 ÷ the withdrawal rate, plus clearing the mortgage once. */
export const freedomNumber = (spending: number, mortgage: number, withdrawalRate: number) => (spending * 12 * 100) / withdrawalRate + mortgage

export type SpendingSuggestion = { cards: number; escrow: number; otherBills: number; total: number; notes: string[] }

/** A starting number for ongoing spending, from what the app knows: cards' average month-end
 * balance over the last 12 months (a statement is the month's balance, paid the next month),
 * the mortgage's property tax + insurance, and the bills you enter. A card with a fixed
 * payment is a loan being paid down, so it isn't spending. */
export function suggestSpending(accounts: NetworthAccount[], balances: NetworthBalance[], month: string, otherBills: number): SpendingSuggestion {
  const notes: string[] = []
  const from = addMonths(month, -12)
  let cards = 0
  let cardsSeen = 0
  for (const a of accounts) {
    if (a.category !== 'credit_card' || !isOpenIn(a, month) || (a.payment_amount ?? 0) > 0) continue
    const entered = balances.filter((b) => b.account_id === a.id && b.month >= from && b.month < month)
    if (entered.length === 0) continue
    cards += entered.reduce((s, b) => s + Number(b.balance), 0) / entered.length
    cardsSeen += 1
  }
  if (cardsSeen === 0) notes.push('No card balances to average yet.')
  const mortgages = accounts.filter((a) => a.category === 'mortgage' && isOpenIn(a, month))
  const escrow = mortgages.reduce((s, a) => s + Number(a.escrow_amount ?? 0), 0)
  if (mortgages.some((a) => !a.escrow_amount)) notes.push('No escrow set on your mortgage: add property tax and insurance to other bills.')
  return { cards, escrow, otherBills, total: cards + escrow + otherBills, notes }
}

type Flow = Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>

/** A starting number for monthly savings: the average "kept" on Cash flow (cash saved + money
 * invested + debt paid down) over up to 12 finished months. Using "kept" means moving cash into
 * a brokerage account isn't counted twice. Never below zero. */
export function suggestSavings(month: string, accounts: NetworthAccount[], balances: NetworthBalance[], portfolios: Portfolio[], values: PortfolioDailyValue[], flows: Flow[]): { monthly: number; months: number } {
  let total = 0
  let months = 0
  for (let i = 1; i <= 12; i++) {
    const m = addMonths(month, -i)
    if (monthTotals(addMonths(m, -1), accounts, balances, portfolios, values).lines.length === 0) break
    total += monthCashFlow(m, accounts, balances, portfolios, values, flows).kept
    months += 1
  }
  return { monthly: months > 0 ? Math.max(total / months, 0) : 0, months }
}

/** Months until `money` reaches `target`, adding `savings` a month and growing at `realReturn`
 * % a year. Null when it doesn't get there within 100 years. */
export function monthsToFreedom(money: number, target: number, savings: number, realReturn: number): number | null {
  if (money >= target) return 0
  const rate = Math.pow(1 + realReturn / 100, 1 / 12) - 1
  let m = money
  for (let i = 1; i <= 1200; i++) {
    // Debt doesn't earn the portfolio's return.
    m = m + Math.max(m, 0) * rate + savings
    if (m >= target) return i
  }
  return null
}

export type FreedomSummary = {
  money: FreedomMoney
  spending: number
  savings: number
  target: number
  /** Share of the freedom number, 0 and up (can pass 1); null with no target yet. */
  progress: number | null
  /** What the money could pay each month once the mortgage is cleared. */
  monthlyIncome: number
  months: number | null
  /** The money that, left alone, grows to the freedom number in `coastYears`. */
  coastNumber: number
  /** How much a $500 lower monthly spend lowers the freedom number. */
  per500: number
}

export function freedomSummary(lines: NetworthLine[], spending: number, savings: number, s: FreedomSettings): FreedomSummary {
  const money = freedomMoney(lines)
  const target = freedomNumber(spending, money.mortgage, s.withdrawalRate)
  return {
    money,
    spending,
    savings,
    target,
    progress: target > 0 ? Math.max(money.money, 0) / target : null,
    monthlyIncome: (Math.max(money.money - money.mortgage, 0) * s.withdrawalRate) / 100 / 12,
    months: target > 0 ? monthsToFreedom(money.money, target, savings, s.realReturn) : null,
    coastNumber: target / Math.pow(1 + s.realReturn / 100, s.coastYears),
    per500: (500 * 12 * 100) / s.withdrawalRate,
  }
}

export type FreedomPoint = { month: string; pct: number; money: number; target: number }

/** Progress for the last 12 months with balances, each against that month's mortgage balance
 * and today's spending. */
export function freedomHistory(month: string, accounts: NetworthAccount[], balances: NetworthBalance[], portfolios: Portfolio[], values: PortfolioDailyValue[], spending: number, withdrawalRate: number): FreedomPoint[] {
  const out: FreedomPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(month, -i)
    const lines = monthTotals(m, accounts, balances, portfolios, values).lines
    if (lines.length === 0) continue
    const f = freedomMoney(lines)
    const target = freedomNumber(spending, f.mortgage, withdrawalRate)
    if (target > 0) out.push({ month: m, pct: (Math.max(f.money, 0) / target) * 100, money: f.money, target })
  }
  return out
}
