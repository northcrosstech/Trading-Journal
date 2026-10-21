import type { CspPosition, Holding, OptionPosition, Portfolio, PortfolioDailyValue, PortfolioKind } from './database.types'
import type { SymbolPrice } from './wealthQueries'
import { currency } from './format'
import type { PillTone } from '../components/ui/Pill'

/** $ amount with an explicit + for gains. */
export const signedCurrency = (n: number) => `${n > 0 ? '+' : ''}${currency(n)}`

export const OPTION_MULTIPLIER = 100

export const PORTFOLIO_KINDS: { value: PortfolioKind; label: string }[] = [
  { value: 'brokerage', label: 'Brokerage' },
  { value: '401k', label: '401k' },
  { value: 'traditional_ira', label: 'Traditional IRA' },
  { value: 'roth_ira', label: 'Roth IRA' },
]
export const kindLabel = (k: PortfolioKind) => PORTFOLIO_KINDS.find((x) => x.value === k)?.label ?? k

/** Pill color per portfolio type, so each type is recognizable at a glance. */
export const KIND_TONE: Record<PortfolioKind, PillTone> = { brokerage: 'teal', '401k': 'violet', traditional_ira: 'sky', roth_ira: 'amber' }

export type HoldingView = {
  holding: Holding
  price: number | null // null = no price yet
  priced: 'close' | 'manual' | 'none'
  value: number // at avg cost when there's no price yet
  cost: number
  gain: number | null
  gainPct: number | null
  dayChange: number | null
  dayChangePct: number | null
}

export function holdingView(h: Holding, prices: Map<string, SymbolPrice>): HoldingView {
  const qty = Number(h.quantity)
  const cost = qty * Number(h.avg_cost)
  const p = prices.get(h.symbol)
  const price = h.manual_price !== null ? Number(h.manual_price) : (p?.close ?? null)
  const priced = h.manual_price !== null ? 'manual' : p ? 'close' : 'none'
  const value = price !== null ? qty * price : cost
  const dayChange = priced === 'close' && p && p.prevClose !== null ? qty * (p.close - p.prevClose) : null
  return {
    holding: h,
    price,
    priced,
    value,
    cost,
    gain: price !== null ? value - cost : null,
    gainPct: price !== null && cost > 0 ? (value - cost) / cost : null,
    dayChange,
    dayChangePct: dayChange !== null && p?.prevClose ? (p.close - p.prevClose) / p.prevClose : null,
  }
}

/** Cash held back to cover open puts if they're assigned. */
export const cspCollateral = (c: CspPosition) => Number(c.strike) * OPTION_MULTIPLIER * c.contracts

/** Cost to buy an open put back now: the entered mark, else its intrinsic value from the
 * stock's latest close, else zero. Mirrors worker/prices.py csp_liability. */
export function cspLiability(c: CspPosition, prices: Map<string, SymbolPrice>): number {
  const close = prices.get(c.symbol)?.close
  const perShare = c.mark !== null ? Number(c.mark) : close !== undefined ? Math.max(0, Number(c.strike) - close) : 0
  return perShare * OPTION_MULTIPLIER * c.contracts
}

/** Signed value of an open long option / covered call. Long: your entered price, else what
 * you paid (no free option prices; intrinsic value would show an out-of-the-money LEAPS
 * or hedge as worthless). Covered call: minus its buy-back cost -- your price, else
 * max(0, stock - strike). Mirrors worker/prices.py option_value. */
export function optionValue(o: OptionPosition, prices: Map<string, SymbolPrice>): number {
  const n = OPTION_MULTIPLIER * o.contracts
  if (o.side === 'long') return (o.mark !== null ? Number(o.mark) : Number(o.open_price)) * n
  const close = prices.get(o.symbol)?.close
  const perShare = o.mark !== null ? Number(o.mark) : close !== undefined ? Math.max(0, close - Number(o.strike)) : 0
  return -perShare * n
}

/** Unrealized gain on an open option: today's value vs the premium paid (long) or received (short). */
export function optionGain(o: OptionPosition, prices: Map<string, SymbolPrice>): number {
  const premium = Number(o.open_price) * OPTION_MULTIPLIER * o.contracts
  const value = optionValue(o, prices)
  return o.side === 'long' ? value - premium : premium + value
}

export type PortfolioSnapshot = {
  holdings: HoldingView[]
  holdingsValue: number
  cash: number
  collateral: number
  cashAvailable: number
  cspLiability: number
  optionsValue: number // long options minus covered-call buy-back cost
  optionsGain: number
  total: number
  cost: number
  unrealized: number
  dayChange: number
  unpriced: number // holdings still waiting for their first price
}

export function portfolioSnapshot(
  portfolios: Pick<Portfolio, 'cash'>[],
  holdings: Holding[],
  openCsps: CspPosition[],
  prices: Map<string, SymbolPrice>,
  openOptions: OptionPosition[] = [],
): PortfolioSnapshot {
  const optionsValue = openOptions.reduce((s, o) => s + optionValue(o, prices), 0)
  const optionsGain = openOptions.reduce((s, o) => s + optionGain(o, prices), 0)
  const views = holdings.map((h) => holdingView(h, prices)).sort((a, b) => b.value - a.value)
  const holdingsValue = views.reduce((s, v) => s + v.value, 0)
  const cost = views.reduce((s, v) => s + v.cost, 0)
  const cash = portfolios.reduce((s, p) => s + Number(p.cash), 0)
  const collateral = openCsps.reduce((s, c) => s + cspCollateral(c), 0)
  const liability = openCsps.reduce((s, c) => s + cspLiability(c, prices), 0)
  return {
    holdings: views,
    holdingsValue,
    cash,
    collateral,
    cashAvailable: cash - collateral,
    cspLiability: liability,
    optionsValue,
    optionsGain,
    total: holdingsValue + cash - liability + optionsValue,
    cost,
    unrealized: views.reduce((s, v) => s + (v.gain ?? 0), 0) + optionsGain,
    dayChange: views.reduce((s, v) => s + (v.dayChange ?? 0), 0),
    unpriced: views.filter((v) => v.priced === 'none').length,
  }
}

/** Sums several portfolios' daily values by date -- for the combined view. A date only
 * counts once every portfolio that existed by then has a value, so a missing row
 * doesn't look like a crash. */
export function combineDailyValues(values: PortfolioDailyValue[]): { date: string; total: number; netFlow: number }[] {
  const firstDate = new Map<string, string>()
  for (const v of values) if (!firstDate.has(v.portfolio_id) || v.value_date < firstDate.get(v.portfolio_id)!) firstDate.set(v.portfolio_id, v.value_date)
  const byDate = new Map<string, { total: number; netFlow: number; count: number }>()
  for (const v of values) {
    const e = byDate.get(v.value_date) ?? { total: 0, netFlow: 0, count: 0 }
    e.total += Number(v.total_value)
    e.netFlow += Number(v.net_flow)
    e.count += 1
    byDate.set(v.value_date, e)
  }
  return Array.from(byDate, ([date, e]) => ({ date, ...e }))
    .filter((e) => e.count === Array.from(firstDate.values()).filter((d) => d <= e.date).length)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, total, netFlow }) => ({ date, total, netFlow }))
}

export type ReturnResult = { cumulative: number; days: number; annualized: number | null }

/** Time-weighted return over a date-ordered value series: each day's growth with that
 * day's money in/out removed, chained together -- so deposits and withdrawals don't
 * count as gains or losses. Annualized only once there's a year of history; before
 * that, compounding a few weeks up to a year is misleading. */
export function timeWeightedReturn(series: { date: string; total: number; netFlow: number }[], fromDate?: string): ReturnResult | null {
  let start = 0
  if (fromDate) {
    // Begin from the last value on or before fromDate (the starting point), if any.
    const idx = series.findIndex((s) => s.date > fromDate)
    if (idx === -1) return null
    start = Math.max(0, idx - 1)
  }
  const s = series.slice(start)
  if (s.length < 2) return null
  let growth = 1
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1].total
    if (prev <= 0) continue
    growth *= (s[i].total - s[i].netFlow) / prev
  }
  const days = (Date.parse(s[s.length - 1].date) - Date.parse(s[0].date)) / 86_400_000
  const cumulative = growth - 1
  return { cumulative, days, annualized: days >= 365 ? Math.pow(growth, 365 / days) - 1 : null }
}

/** Annualized yield of one put: premium over the cash set aside, scaled to a year by
 * how long it was (or will be) held. */
export function cspAnnualizedYield(c: CspPosition): number | null {
  const end = c.closed_on ?? c.expiration
  const days = Math.max(1, (Date.parse(end) - Date.parse(c.opened_on)) / 86_400_000)
  const strike = Number(c.strike)
  if (strike <= 0) return null
  return (Number(c.premium) / strike) * (365 / days)
}

export type CspStats = { premiumCollected: number; resolved: number; assigned: number; assignmentRate: number | null; avgAnnualizedYield: number | null }

export function cspStats(csps: CspPosition[]): CspStats {
  const premiumCollected = csps.reduce((s, c) => {
    const credit = Number(c.premium) * OPTION_MULTIPLIER * c.contracts
    const buyback = c.status === 'closed' && c.close_price !== null ? Number(c.close_price) * OPTION_MULTIPLIER * c.contracts : 0
    return s + credit - buyback
  }, 0)
  const resolved = csps.filter((c) => c.status !== 'open')
  const assigned = resolved.filter((c) => c.status === 'assigned').length
  const yields = csps.map(cspAnnualizedYield).filter((y): y is number => y !== null)
  return {
    premiumCollected,
    resolved: resolved.length,
    assigned,
    assignmentRate: resolved.length ? assigned / resolved.length : null,
    avgAnnualizedYield: yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : null,
  }
}

/** Each portfolio's own daily series, ready for timeWeightedReturn. */
export function seriesFor(values: PortfolioDailyValue[], portfolioId: string) {
  return values
    .filter((v) => v.portfolio_id === portfolioId)
    .sort((a, b) => a.value_date.localeCompare(b.value_date))
    .map((v) => ({ date: v.value_date, total: Number(v.total_value), netFlow: Number(v.net_flow) }))
}

/** Tickers with no price stored yet -- holdings without a manual price, plus the stocks
 * behind open puts. What "Get prices now" fetches. */
export function unpricedSymbols(
  holdings: Holding[],
  openCsps: CspPosition[],
  prices: Map<string, SymbolPrice>,
  openOptions: OptionPosition[] = [],
): string[] {
  const out = new Set<string>()
  for (const h of holdings) if (h.manual_price === null && !prices.has(h.symbol)) out.add(h.symbol)
  for (const c of openCsps) if (!prices.has(c.symbol)) out.add(c.symbol)
  for (const o of openOptions) if (!prices.has(o.symbol)) out.add(o.symbol)
  return [...out].sort()
}
