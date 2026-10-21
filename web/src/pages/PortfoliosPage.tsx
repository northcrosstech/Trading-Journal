import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { CspPosition, Holding, OptionPosition, Portfolio, PortfolioDailyValue, PortfolioKind } from '../lib/database.types'
import {
  createPortfolio,
  fetchCsps,
  fetchDailyValues,
  fetchHoldings,
  fetchLatestPrices,
  fetchOptions,
  fetchPortfolios,
  fetchRealizedGains,
  updatePortfolio,
  type SymbolPrice,
} from '../lib/wealthQueries'
import { PORTFOLIO_KINDS, combineDailyValues, kindLabel, optionValue, portfolioSnapshot, seriesFor, signedCurrency as signed, timeWeightedReturn, unpricedSymbols } from '../lib/portfolio'
import { currency, percentFmt } from '../lib/format'
import { AllocationList, ValueHistoryChart } from '../components/WealthCharts'
import { Kpi, ReturnsRow } from '../components/WealthBits'
import { DividendsCard } from '../components/DividendsCard'
import { GetPricesButton } from '../components/GetPricesButton'

const INPUT =
  'rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'
const CARD = 'rounded-xl border border-neutral-800 bg-neutral-900 p-4'

export function PortfoliosPage() {
  const { user } = useAuth()
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [csps, setCsps] = useState<CspPosition[]>([])
  const [options, setOptions] = useState<OptionPosition[]>([])
  const [values, setValues] = useState<PortfolioDailyValue[]>([])
  const [realized, setRealized] = useState<Map<string, number>>(new Map())
  const [prices, setPrices] = useState<Map<string, SymbolPrice>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<PortfolioKind>('brokerage')
  const [showArchived, setShowArchived] = useState(false)

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
    () =>
      portfolioSnapshot(
        active,
        activeHoldings,
        openCsps.filter((c) => activeIds.has(c.portfolio_id)),
        prices,
        openOptions,
      ),
    [active, activeIds, activeHoldings, openCsps, prices, openOptions],
  )
  const series = useMemo(() => combineDailyValues(values.filter((v) => activeIds.has(v.portfolio_id))), [values, activeIds])
  const realizedTotal = active.reduce((s, p) => s + (realized.get(p.id) ?? 0), 0)

  // Allocation across everything: each ticker summed over portfolios, plus cash.
  const allocation = useMemo(() => {
    const bySymbol = new Map<string, number>()
    for (const v of combined.holdings) bySymbol.set(v.holding.symbol, (bySymbol.get(v.holding.symbol) ?? 0) + v.value)
    const rows = Array.from(bySymbol, ([symbol, value]) => ({ key: symbol, label: symbol, value }))
    const longOptions = openOptions.filter((o) => o.side === 'long').reduce((s, o) => s + optionValue(o, prices), 0)
    if (longOptions > 0) rows.push({ key: 'options', label: 'Options', value: longOptions })
    if (combined.cashAvailable > 0) rows.push({ key: 'cash', label: 'Cash', value: combined.cashAvailable })
    if (combined.collateral > 0) rows.push({ key: 'collateral', label: 'Put collateral', value: Math.min(combined.collateral, combined.cash) })
    return rows
  }, [combined, openOptions, prices])

  async function add() {
    if (!user || !name.trim()) return
    try {
      await createPortfolio(user.id, { name: name.trim(), kind })
      setName('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (error) return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load portfolios: {error}</div>
  if (!portfolios) return <div className="text-neutral-500">Loading portfolios…</div>

  const archived = portfolios.filter((p) => p.archived)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="text-lg font-semibold text-neutral-100">Portfolios</h1>

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <span>Waiting for a first price: {pending.join(', ')}. Prices update once a day after the close.</span>
          <GetPricesButton symbols={pending} onDone={load} />
        </div>
      )}

      {active.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="All portfolios" value={currency(combined.total)} sub={`${active.length} portfolio${active.length === 1 ? '' : 's'}`} />
            <Kpi
              label="Today"
              value={signed(combined.dayChange)}
              sub={combined.total - combined.dayChange > 0 ? percentFmt(combined.dayChange / (combined.total - combined.dayChange)) : undefined}
              tone={combined.dayChange}
            />
            <Kpi label="Unrealized gain" value={signed(combined.unrealized)} sub={combined.cost > 0 ? percentFmt(combined.unrealized / combined.cost) : undefined} tone={combined.unrealized} />
            <Kpi label="Realized gain" value={signed(realizedTotal)} sub="sales and puts" tone={realizedTotal} />
          </div>

          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Returns · all portfolios</h2>
            <ReturnsRow series={series} />
          </div>

          <DividendsCard
            holdings={activeHoldings}
            prices={prices}
            holdingsValue={combined.holdingsValue}
            portfolioIds={activeIds}
          />
        </>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-3 lg:col-span-3">
          {perPortfolio.map(({ portfolio: p, snap }) => {
            const ret = timeWeightedReturn(seriesFor(values, p.id))
            return (
              <Link
                key={p.id}
                to={`/portfolios/${p.id}`}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-700"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-100">{p.name}</div>
                  <div className="text-xs text-neutral-500">
                    {kindLabel(p.kind)} · {snap.holdings.length} holding{snap.holdings.length === 1 ? '' : 's'}
                    {snap.unpriced > 0 && <span className="text-amber-500/80"> · {snap.unpriced} price pending</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold tabular-nums text-neutral-100">{currency(snap.total)}</div>
                  <div className={`text-xs tabular-nums ${snap.dayChange > 0 ? 'text-(--status-good)' : snap.dayChange < 0 ? 'text-(--status-critical)' : 'text-neutral-500'}`}>
                    {signed(snap.dayChange)} today
                  </div>
                </div>
                <div className="w-24 text-right text-xs text-neutral-500">
                  <div className={`tabular-nums ${snap.unrealized >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>{signed(snap.unrealized)}</div>
                  {ret && <div className="tabular-nums">{percentFmt(ret.cumulative)} since start</div>}
                </div>
              </Link>
            )
          })}

          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">New portfolio</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fidelity long-term" className={`${INPUT} min-w-0 flex-1`} />
              <select value={kind} onChange={(e) => setKind(e.target.value as PortfolioKind)} className={INPUT}>
                {PORTFOLIO_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button onClick={add} disabled={!name.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
                Create
              </button>
            </div>
            <p className="mt-2 text-[11px] text-neutral-600">The type decides which Net worth line the portfolio's value fills.</p>
          </div>

          {archived.length > 0 && (
            <div className="text-xs text-neutral-500">
              <button onClick={() => setShowArchived((v) => !v)} className="hover:text-neutral-300">
                {showArchived ? 'Hide' : 'Show'} {archived.length} archived portfolio{archived.length === 1 ? '' : 's'}
              </button>
              {showArchived && (
                <div className="mt-2 flex flex-col gap-1">
                  {archived.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-2">
                      <Link to={`/portfolios/${p.id}`} className="text-neutral-400 hover:text-neutral-200">
                        {p.name}
                      </Link>
                      <button onClick={() => updatePortfolio(p.id, { archived: false }).then(load)} className="text-blue-400 hover:text-blue-300">
                        Unarchive
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Allocation · all portfolios</h2>
            <AllocationList rows={allocation} total={allocation.reduce((s, r) => s + r.value, 0)} />
          </div>
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Value · all portfolios</h2>
            <ValueHistoryChart data={series.map((s) => ({ date: s.date, total: s.total }))} />
          </div>
        </div>
      </div>
    </div>
  )
}
