import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CspPosition, Holding, OptionPosition, Portfolio, PortfolioDailyValue } from './database.types'
import {
  fetchCsps,
  fetchDailyValues,
  fetchHoldings,
  fetchLatestPrices,
  fetchOptions,
  fetchPortfolios,
  fetchRealizedGains,
  type SymbolPrice,
} from './wealthQueries'
import { combineDailyValues, optionValue, portfolioSnapshot, unpricedSymbols } from './portfolio'
import { allocationSlices } from './allocation'
import { currency } from './format'

/** Everything the Portfolios overview and the Wealth overview need about your portfolios:
 * loads once, then derives per-portfolio and combined snapshots, the combined daily value
 * series, realized gains, allocation and tickers still waiting for a price. Archived
 * portfolios are excluded from every figure. `load` re-fetches after a change. */
export function useWealthPortfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [csps, setCsps] = useState<CspPosition[]>([])
  const [options, setOptions] = useState<OptionPosition[]>([])
  const [values, setValues] = useState<PortfolioDailyValue[]>([])
  const [realized, setRealized] = useState<Map<string, number>>(new Map())
  const [prices, setPrices] = useState<Map<string, SymbolPrice>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchPortfolios(), fetchHoldings(), fetchCsps(), fetchDailyValues(), fetchRealizedGains(), fetchOptions()])
      .then(async ([p, h, c, v, r, o]) => {
        const symbols = [
          ...new Set([
            ...h.map((x) => x.symbol),
            ...c.filter((x) => x.status === 'open').map((x) => x.symbol),
            ...o.filter((x) => x.status === 'open').map((x) => x.symbol),
          ]),
        ]
        setPrices(await fetchLatestPrices(symbols))
        const byPortfolio = new Map<string, number>()
        for (const row of r) byPortfolio.set(row.portfolio_id, (byPortfolio.get(row.portfolio_id) ?? 0) + Number(row.realized_gain))
        setRealized(byPortfolio)
        setHoldings(h)
        setCsps(c)
        setOptions(o)
        setValues(v)
        setPortfolios(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  const active = useMemo(() => (portfolios ?? []).filter((p) => !p.archived), [portfolios])
  const activeIds = useMemo(() => new Set(active.map((p) => p.id)), [active])
  const openCsps = useMemo(() => csps.filter((c) => c.status === 'open'), [csps])
  const openOptions = useMemo(() => options.filter((o) => o.status === 'open' && activeIds.has(o.portfolio_id)), [options, activeIds])
  const activeHoldings = useMemo(() => holdings.filter((h) => activeIds.has(h.portfolio_id)), [holdings, activeIds])
  const pending = useMemo(
    () => unpricedSymbols(activeHoldings, openCsps.filter((c) => activeIds.has(c.portfolio_id)), prices, openOptions),
    [activeHoldings, openCsps, activeIds, prices, openOptions],
  )

  const perPortfolio = useMemo(
    () =>
      active.map((p) => ({
        portfolio: p,
        snap: portfolioSnapshot(
          [p],
          holdings.filter((h) => h.portfolio_id === p.id),
          openCsps.filter((c) => c.portfolio_id === p.id),
          prices,
          openOptions.filter((o) => o.portfolio_id === p.id),
        ),
      })),
    [active, holdings, openCsps, prices, openOptions],
  )
  const combined = useMemo(
    () => portfolioSnapshot(active, activeHoldings, openCsps.filter((c) => activeIds.has(c.portfolio_id)), prices, openOptions),
    [active, activeIds, activeHoldings, openCsps, prices, openOptions],
  )
  const series = useMemo(() => combineDailyValues(values.filter((v) => activeIds.has(v.portfolio_id))), [values, activeIds])
  const realizedTotal = active.reduce((s, p) => s + (realized.get(p.id) ?? 0), 0)

  // Allocation across everything: each ticker summed over portfolios, plus cash.
  const allocation = useMemo(() => {
    const bySymbol = new Map<string, number>()
    for (const v of combined.holdings) bySymbol.set(v.holding.symbol, (bySymbol.get(v.holding.symbol) ?? 0) + v.value)
    const positions = Array.from(bySymbol, ([symbol, value]) => ({ key: symbol, label: symbol, value }))
    const longOptions = openOptions.filter((o) => o.side === 'long').reduce((s, o) => s + optionValue(o, prices), 0)
    if (longOptions > 0) positions.push({ key: 'options', label: 'Options', value: longOptions })
    const cashSub =
      combined.collateral > 0 && combined.cash > 0 ? `incl. ${currency(Math.min(combined.collateral, combined.cash))} set aside for puts` : undefined
    return allocationSlices(positions, combined.cash, cashSub)
  }, [combined, openOptions, prices])

  return {
    portfolios,
    active,
    activeIds,
    activeHoldings,
    values,
    realized,
    realizedTotal,
    prices,
    pending,
    perPortfolio,
    combined,
    series,
    allocation,
    openOptions,
    error,
    load,
  }
}
