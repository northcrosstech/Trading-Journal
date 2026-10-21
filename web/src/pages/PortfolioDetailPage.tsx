import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CspPosition, Holding, OptionPosition, Portfolio, PortfolioActivity, PortfolioDailyValue, PortfolioKind } from '../lib/database.types'
import {
  fetchActivity,
  fetchCsps,
  fetchDailyValues,
  fetchHoldings,
  fetchLatestPrices,
  fetchOptions,
  fetchPortfolios,
  updateHolding,
  updatePortfolio,
  type SymbolPrice,
} from '../lib/wealthQueries'
import { PORTFOLIO_KINDS, kindLabel, optionValue, portfolioSnapshot, seriesFor, signedCurrency as signed, unpricedSymbols, type HoldingView } from '../lib/portfolio'
import { currency, dateFmt, percentFmt, priceFmt } from '../lib/format'
import { AllocationDonut, ValueHistoryChart } from '../components/WealthCharts'
import { allocationSlices } from '../lib/allocation'
import { Kpi, ReturnsRow } from '../components/WealthBits'
import { PortfolioActions } from '../components/PortfolioActions'
import { CspSection } from '../components/CspSection'
import { DividendsCard } from '../components/DividendsCard'
import { GetPricesButton } from '../components/GetPricesButton'
import { OptionsSection } from '../components/OptionsSection'

const CARD = 'rounded-xl border border-neutral-800 bg-neutral-900 p-4'
const tone = (n: number | null) => (n === null ? 'text-neutral-500' : n > 0 ? 'text-(--status-good)' : n < 0 ? 'text-(--status-critical)' : 'text-neutral-300')

const ACTIVITY_LABEL: Record<PortfolioActivity['kind'], string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  dividend: 'Dividend',
  buy: 'Buy',
  sell: 'Sell',
  transfer_in: 'Added existing',
  transfer_out: 'Moved out',
  csp_open: 'Sold put',
  csp_close: 'Bought back put',
  csp_expire: 'Put expired',
  csp_assign: 'Put assigned',
  option_buy: 'Bought option',
  option_sell: 'Sold option',
  option_write: 'Sold covered call',
  option_buyback: 'Bought back call',
  option_expire: 'Option expired',
  option_exercise: 'Exercised call',
  option_assign: 'Call assigned',
}

const EDIT_INPUT =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-sm tabular-nums text-neutral-100 outline-none focus:border-blue-500'

/** Inline correction of a holding -- no cash or money-in/out effect. For a stock split, a
 * typo, or a manual price for a fund with no public ticker. Enter saves, Esc cancels. */
function HoldingEditRow({ holding: h, onSaved, onCancel }: { holding: Holding; onSaved: () => void; onCancel: () => void }) {
  const [qty, setQty] = useState(String(Number(h.quantity)))
  const [avg, setAvg] = useState(String(Number(h.avg_cost)))
  const [manual, setManual] = useState(h.manual_price !== null ? String(Number(h.manual_price)) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const quantity = Number(qty.replace(/[$,\s]/g, ''))
    const avgCost = Number(avg.replace(/[$,\s]/g, ''))
    const manualPrice = manual.trim() === '' ? null : Number(manual.replace(/[$,\s]/g, ''))
    if (!(quantity > 0)) return setError('Quantity must be above zero.')
    if (!(avgCost >= 0)) return setError('Average cost can’t be negative.')
    if (manualPrice !== null && !(manualPrice >= 0)) return setError('Manual price can’t be negative.')
    setSaving(true)
    setError(null)
    try {
      await updateHolding(h.id, { quantity, avg_cost: avgCost, manual_price: manualPrice })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    else if (e.key === 'Escape') onCancel()
  }

  return (
    <tr className="border-b border-neutral-800/60 bg-neutral-950/50 last:border-0">
      <td className="py-2 pr-2 align-top font-medium text-neutral-100">{h.symbol}</td>
      <td colSpan={8} className="py-2">
        <div className="flex flex-wrap items-end gap-2" onKeyDown={onKeyDown}>
          <label className="flex w-28 flex-col gap-0.5">
            <span className="text-[11px] text-neutral-500">Quantity</span>
            <input autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={EDIT_INPUT} />
          </label>
          <label className="flex w-28 flex-col gap-0.5">
            <span className="text-[11px] text-neutral-500">Avg cost / share</span>
            <input inputMode="decimal" value={avg} onChange={(e) => setAvg(e.target.value)} className={EDIT_INPUT} />
          </label>
          <label className="flex w-32 flex-col gap-0.5">
            <span className="text-[11px] text-neutral-500" title="Only for funds with no public ticker, like many 401k funds">
              Manual price <span className="text-neutral-600">(optional)</span>
            </span>
            <input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="daily close" className={EDIT_INPUT} />
          </label>
          <span className="flex items-center gap-2 pb-1">
            <button onClick={save} disabled={saving} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onCancel} className="text-xs text-neutral-500 hover:text-neutral-300">
              Cancel
            </button>
          </span>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-600">
          {error ? (
            <span className="text-(--status-critical)">{error}</span>
          ) : (
            'Corrections only (splits, typos) — no cash moves. Use Buy / Sell for trades. Manual price is for funds without a public ticker; leave it blank to use the daily close.'
          )}
        </p>
      </td>
    </tr>
  )
}

function HoldingsTable({ views, total, onSaved }: { views: HoldingView[]; total: number; onSaved: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  if (views.length === 0) return <p className="text-sm text-neutral-500">No holdings yet — buy or add existing shares on the right.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="py-1.5 pr-2">Ticker</th>
            <th className="py-1.5 pr-2 text-right">Qty</th>
            <th className="py-1.5 pr-2 text-right">Avg cost</th>
            <th className="py-1.5 pr-2 text-right">Price</th>
            <th className="py-1.5 pr-2 text-right">Value</th>
            <th className="py-1.5 pr-2 text-right">Today</th>
            <th className="py-1.5 pr-2 text-right">Gain</th>
            <th className="py-1.5 pr-2 text-right">Weight</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {views.map((v) =>
            editingId === v.holding.id ? (
              <HoldingEditRow
                key={v.holding.id}
                holding={v.holding}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null)
                  onSaved()
                }}
              />
            ) : (
            <tr key={v.holding.id} className="border-b border-neutral-800/60 last:border-0">
              <td className="py-2 pr-2 font-medium text-neutral-100">{v.holding.symbol}</td>
              <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">{Number(v.holding.quantity)}</td>
              <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{priceFmt(Number(v.holding.avg_cost))}</td>
              <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">
                {v.priced === 'none' ? (
                  <span className="text-amber-500/80" title="Prices update once a day after the close">pending</span>
                ) : (
                  <>
                    {priceFmt(v.price)}
                    {v.priced === 'manual' && <span className="text-neutral-600" title="Manual price"> m</span>}
                  </>
                )}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums text-neutral-200">{currency(v.value)}</td>
              <td className={`py-2 pr-2 text-right tabular-nums ${tone(v.dayChange)}`}>
                {v.dayChange === null ? '—' : signed(v.dayChange)}
                {v.dayChangePct !== null && <div className="text-[11px]">{percentFmt(v.dayChangePct)}</div>}
              </td>
              <td className={`py-2 pr-2 text-right tabular-nums ${tone(v.gain)}`}>
                {v.gain === null ? '—' : signed(v.gain)}
                {v.gainPct !== null && <div className="text-[11px]">{percentFmt(v.gainPct)}</div>}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{total > 0 ? percentFmt(v.value / total).replace('+', '') : '—'}</td>
              <td className="py-2 text-right">
                <button onClick={() => setEditingId(v.holding.id)} className="text-xs text-neutral-600 hover:text-neutral-300">
                  Edit
                </button>
              </td>
            </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

export function PortfolioDetailPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>()
  const [portfolio, setPortfolio] = useState<Portfolio | null | undefined>(undefined)
  const [allPortfolios, setAllPortfolios] = useState<Portfolio[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [csps, setCsps] = useState<CspPosition[]>([])
  const [options, setOptions] = useState<OptionPosition[]>([])
  const [values, setValues] = useState<PortfolioDailyValue[]>([])
  const [activity, setActivity] = useState<PortfolioActivity[]>([])
  const [prices, setPrices] = useState<Map<string, SymbolPrice>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [showAllActivity, setShowAllActivity] = useState(false)

  const load = useCallback(() => {
    if (!portfolioId) return
    Promise.all([fetchPortfolios(), fetchHoldings(portfolioId), fetchCsps(portfolioId), fetchDailyValues(portfolioId), fetchActivity(portfolioId), fetchOptions(portfolioId)])
      .then(async ([ps, h, c, v, a, o]) => {
        const symbols = [
          ...new Set([
            ...h.map((x) => x.symbol),
            ...c.filter((x) => x.status === 'open').map((x) => x.symbol),
            ...o.filter((x) => x.status === 'open').map((x) => x.symbol),
          ]),
        ]
        setPrices(await fetchLatestPrices(symbols))
        setHoldings(h)
        setCsps(c)
        setOptions(o)
        setValues(v)
        setActivity(a)
        setAllPortfolios(ps)
        setPortfolio(ps.find((p) => p.id === portfolioId) ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [portfolioId])
  useEffect(load, [load])

  const openCsps = useMemo(() => csps.filter((c) => c.status === 'open'), [csps])
  const openOptions = useMemo(() => options.filter((o) => o.status === 'open'), [options])
  const snap = useMemo(
    () => (portfolio ? portfolioSnapshot([portfolio], holdings, openCsps, prices, openOptions) : null),
    [portfolio, holdings, openCsps, prices, openOptions],
  )
  const series = useMemo(() => (portfolioId ? seriesFor(values, portfolioId) : []), [values, portfolioId])
  const pending = useMemo(() => unpricedSymbols(holdings, openCsps, prices, openOptions), [holdings, openCsps, prices, openOptions])
  const realized = useMemo(() => activity.reduce((s, a) => s + (a.realized_gain !== null ? Number(a.realized_gain) : 0), 0), [activity])

  const allocation = useMemo(() => {
    if (!snap) return allocationSlices([], 0)
    const positions = snap.holdings.map((v) => ({ key: v.holding.id, label: v.holding.symbol, value: v.value }))
    for (const o of openOptions)
      if (o.side === 'long')
        positions.push({ key: o.id, label: `${o.symbol} ${Number(o.strike)}${o.option_type === 'call' ? 'C' : 'P'}`, value: optionValue(o, prices) })
    const cashSub = snap.collateral > 0 && snap.cash > 0 ? `incl. ${currency(Math.min(snap.collateral, snap.cash))} set aside for puts` : undefined
    return allocationSlices(positions, snap.cash, cashSub)
  }, [snap, openOptions, prices])
  // Weights share the Allocation card's base -- everything held (shares, long options,
  // positive cash) -- so a negative cash balance can't inflate them past 100%.
  const allocationTotal = allocation.total

  if (error) return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>
  if (portfolio === undefined || !snap) return <div className="text-neutral-500">Loading portfolio…</div>
  if (portfolio === null)
    return (
      <div className="text-neutral-400">
        Portfolio not found. <Link to="/portfolios" className="text-blue-400">Back to portfolios</Link>
      </div>
    )

  const p = portfolio
  const shownActivity = showAllActivity ? activity : activity.slice(0, 10)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/portfolios" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Portfolios
          </Link>
          <h1 className="text-lg font-semibold text-neutral-100">
            {p.name} {p.archived && <span className="text-sm font-normal text-neutral-500">(archived)</span>}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <select
            value={p.kind}
            onChange={(e) => updatePortfolio(p.id, { kind: e.target.value as PortfolioKind }).then(load)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-300"
            title="Which Net worth line this portfolio fills"
          >
            {PORTFOLIO_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const next = window.prompt('Rename portfolio', p.name)?.trim()
              if (next && next !== p.name) updatePortfolio(p.id, { name: next }).then(load)
            }}
            className="text-neutral-500 hover:text-neutral-300"
          >
            Rename
          </button>
          <button
            onClick={() => {
              if (p.archived || window.confirm(`Archive "${p.name}"? It stops being priced and leaves Net worth; you can unarchive it later.`))
                updatePortfolio(p.id, { archived: !p.archived }).then(load)
            }}
            className="text-neutral-500 hover:text-neutral-300"
          >
            {p.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={`Value · ${kindLabel(p.kind)}`} value={currency(snap.total)} sub={snap.optionsValue !== 0 ? `incl. ${currency(snap.optionsValue)} options` : snap.cspLiability > 0 ? `after ${currency(snap.cspLiability)} to buy back puts` : undefined} />
        <Kpi
          label="Today"
          value={signed(snap.dayChange)}
          sub={snap.total - snap.dayChange > 0 ? percentFmt(snap.dayChange / (snap.total - snap.dayChange)) : undefined}
          tone={snap.dayChange}
        />
        <Kpi label="Unrealized gain" value={signed(snap.unrealized)} sub={snap.cost > 0 ? percentFmt(snap.unrealized / snap.cost) : undefined} tone={snap.unrealized} />
        <Kpi label="Realized gain" value={signed(realized)} sub="sales and puts" tone={realized} />
        <Kpi label="Cash" value={currency(snap.cash)} sub={snap.collateral > 0 ? `${currency(snap.cashAvailable)} available after puts` : 'available'} tone={snap.cashAvailable < 0 ? -1 : null} />
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <span>
            Waiting for a first price: {pending.join(', ')}. Prices update once a day after the close — until then holdings are valued at average cost.
          </span>
          <GetPricesButton symbols={pending} onDone={load} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Holdings</h2>
            <HoldingsTable views={snap.holdings} total={allocationTotal} onSaved={load} />
          </div>
          <DividendsCard holdings={holdings} prices={prices} holdingsValue={snap.holdingsValue} portfolioId={p.id} onRecorded={load} />
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Returns</h2>
            <ReturnsRow series={series} />
          </div>
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Value</h2>
            <ValueHistoryChart data={series.map((s) => ({ date: s.date, total: s.total }))} />
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <PortfolioActions
            portfolioId={p.id}
            otherPortfolios={allPortfolios.filter((x) => x.id !== p.id && !x.archived)}
            holdings={holdings} prices={prices} cashAvailable={snap.cashAvailable} onDone={load} />
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-medium text-neutral-200">Allocation</h2>
            <AllocationDonut allocation={allocation} centerLabel="Value" />
          </div>
        </div>
      </div>

      <OptionsSection portfolioId={p.id} options={options} holdings={holdings} prices={prices} cashAvailable={snap.cashAvailable} onDone={load} />

      <CspSection portfolioId={p.id} csps={csps} prices={prices} cashAvailable={snap.cashAvailable} onDone={load} />

      <div className={CARD}>
        <h2 className="mb-2 text-sm font-medium text-neutral-200">Activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-neutral-800/60 text-sm">
            {shownActivity.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="w-24 text-xs tabular-nums text-neutral-500">{dateFmt(a.occurred_on)}</span>
                <span className="w-32 text-neutral-300">{ACTIVITY_LABEL[a.kind]}</span>
                <span className="min-w-0 flex-1 text-neutral-400">
                  {a.symbol}
                  {a.quantity !== null && ` × ${Number(a.quantity)}`}
                  {a.price !== null && ` @ ${priceFmt(Number(a.price))}`}
                </span>
                {Number(a.cash_change) !== 0 && <span className="text-xs tabular-nums text-neutral-500">cash {signed(Number(a.cash_change))}</span>}
                {a.realized_gain !== null && <span className={`text-xs tabular-nums ${tone(Number(a.realized_gain))}`}>{signed(Number(a.realized_gain))}</span>}
              </div>
            ))}
          </div>
        )}
        {activity.length > 10 && (
          <button onClick={() => setShowAllActivity((v) => !v)} className="mt-2 text-xs text-neutral-500 hover:text-neutral-300">
            {showAllActivity ? 'Show less' : `Show all ${activity.length}`}
          </button>
        )}
      </div>
    </div>
  )
}
