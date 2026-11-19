import type { OptionPosition, Portfolio } from './database.types'
import type { PortfolioSnapshot } from './portfolio'

/** A single ticker above this share of everything is flagged as a large position. A fixed
 * rule of thumb on purpose, not a per-user setting. */
export const LARGE_POSITION_SHARE = 0.2

/** How many of the biggest holdings the one-line summary adds up. */
export const TOP_HOLDINGS = 5

type PortfolioRef = Pick<Portfolio, 'id' | 'name'>

/** One portfolio's part of a row. */
export type CombinedPart = {
  portfolio: PortfolioRef
  /** null for cash and options. */
  shares: number | null
  /** null while this portfolio's shares have no price. */
  value: number | null
  gain: number | null
}

export type CombinedRow = {
  /** The ticker, or 'cash' / 'options'. */
  key: string
  kind: 'ticker' | 'options' | 'cash'
  label: string
  shares: number | null
  /** Priced shares only; null when none of them has a price yet. */
  value: number | null
  /** Of `total`; null when there is no value or no positive total to divide by. */
  share: number | null
  gain: number | null
  gainPct: number | null
  /** Shares still waiting for a first price, and what was paid for them. Left out of
   * value, share and gain. */
  unpricedShares: number
  unpricedCost: number
  large: boolean
  parts: CombinedPart[]
}

export type CombinedHoldings = {
  /** Tickers, biggest value first (unpriced ones last). */
  tickers: CombinedRow[]
  /** Open options and sold puts as one line; null when there are none. */
  options: CombinedRow | null
  cash: CombinedRow
  /** What the shares are of: priced holdings + cash + options. The page's total value less
   * `unpricedCost`, which that total counts at cost. */
  total: number
  gain: number
  unpricedCost: number
  unpricedSymbols: string[]
  /** Borrowed across the portfolios whose cash is negative. */
  margin: number
  /** True when sold puts are open: their value is in the options line, their gain is not
   * (the snapshot's options gain covers bought options and covered calls). */
  putsOpen: boolean
  /** The biggest holdings added up, and the biggest one. Null without a positive total. */
  top: { count: number; share: number; symbol: string; symbolShare: number } | null
}

type PerPortfolio = { portfolio: PortfolioRef; snap: PortfolioSnapshot }

/** Every active portfolio's holdings added up per ticker, plus one line for options and one
 * for cash, so the shares add to 100% of the combined value. Only sums figures holdingView
 * and portfolioSnapshot already worked out; a holding with no price is never given a value. */
export function combinedHoldings(perPortfolio: PerPortfolio[], combined: PortfolioSnapshot, openOptions: Pick<OptionPosition, 'portfolio_id'>[]): CombinedHoldings {
  type Acc = { shares: number; value: number; cost: number; gain: number; priced: boolean; unpricedShares: number; unpricedCost: number; parts: Map<string, CombinedPart> }
  const bySymbol = new Map<string, Acc>()

  for (const { portfolio, snap } of perPortfolio) {
    for (const v of snap.holdings) {
      const symbol = v.holding.symbol
      const acc = bySymbol.get(symbol) ?? { shares: 0, value: 0, cost: 0, gain: 0, priced: false, unpricedShares: 0, unpricedCost: 0, parts: new Map() }
      const part = acc.parts.get(portfolio.id) ?? { portfolio, shares: 0, value: null, gain: null }
      const qty = Number(v.holding.quantity)
      acc.shares += qty
      part.shares = (part.shares ?? 0) + qty
      if (v.price === null) {
        acc.unpricedShares += qty
        acc.unpricedCost += v.cost
      } else {
        acc.priced = true
        acc.value += v.value
        acc.cost += v.cost
        acc.gain += v.gain ?? 0
        part.value = (part.value ?? 0) + v.value
        part.gain = (part.gain ?? 0) + (v.gain ?? 0)
      }
      acc.parts.set(portfolio.id, part)
      bySymbol.set(symbol, acc)
    }
  }

  const pricedHoldings = Array.from(bySymbol.values()).reduce((s, a) => s + a.value, 0)
  const optionsNet = combined.optionsValue - combined.cspLiability
  const total = pricedHoldings + combined.cash + optionsNet
  const shareOf = (value: number | null) => (value !== null && total > 0 ? value / total : null)

  const tickers: CombinedRow[] = Array.from(bySymbol, ([symbol, a]) => {
    const value = a.priced ? a.value : null
    const share = shareOf(value)
    return {
      key: symbol,
      kind: 'ticker' as const,
      label: symbol,
      shares: a.shares,
      value,
      share,
      gain: a.priced ? a.gain : null,
      gainPct: a.priced && a.cost > 0 ? a.gain / a.cost : null,
      unpricedShares: a.unpricedShares,
      unpricedCost: a.unpricedCost,
      large: share !== null && share > LARGE_POSITION_SHARE,
      parts: Array.from(a.parts.values()),
    }
  }).sort((a, b) => {
    if (a.value !== null && b.value !== null) return b.value - a.value
    return a.value === b.value ? a.label.localeCompare(b.label) : a.value === null ? 1 : -1
  })

  const putsOpen = combined.collateral > 0
  const optionParts = perPortfolio
    .filter(({ portfolio, snap }) => snap.collateral > 0 || openOptions.some((o) => o.portfolio_id === portfolio.id))
    .map(({ portfolio, snap }) => ({ portfolio, shares: null, value: snap.optionsValue - snap.cspLiability, gain: snap.optionsGain }))
  const options: CombinedRow | null =
    optionParts.length === 0
      ? null
      : {
          key: 'options',
          kind: 'options',
          label: 'Options',
          shares: null,
          value: optionsNet,
          share: shareOf(optionsNet),
          gain: combined.optionsGain,
          gainPct: null,
          unpricedShares: 0,
          unpricedCost: 0,
          large: false,
          parts: optionParts,
        }

  const cash: CombinedRow = {
    key: 'cash',
    kind: 'cash',
    label: 'Cash',
    shares: null,
    value: combined.cash,
    share: shareOf(combined.cash),
    gain: null,
    gainPct: null,
    unpricedShares: 0,
    unpricedCost: 0,
    large: false,
    parts: perPortfolio.filter(({ snap }) => snap.cash !== 0).map(({ portfolio, snap }) => ({ portfolio, shares: null, value: snap.cash, gain: null })),
  }

  const priced = tickers.filter((t) => t.value !== null)
  const topRows = priced.slice(0, TOP_HOLDINGS)
  const top =
    total > 0 && topRows.length > 0
      ? { count: topRows.length, share: topRows.reduce((s, t) => s + t.value!, 0) / total, symbol: topRows[0].label, symbolShare: topRows[0].value! / total }
      : null

  return {
    tickers,
    options,
    cash,
    total,
    gain: tickers.reduce((s, t) => s + (t.gain ?? 0), 0) + (options?.gain ?? 0),
    unpricedCost: tickers.reduce((s, t) => s + t.unpricedCost, 0),
    unpricedSymbols: tickers.filter((t) => t.unpricedShares > 0).map((t) => t.label),
    margin: perPortfolio.reduce((s, { snap }) => s + (snap.cash < 0 ? -snap.cash : 0), 0),
    putsOpen,
    top,
  }
}
