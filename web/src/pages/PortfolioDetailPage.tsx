import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArchiveRestore, Pencil, Plus, Wallet } from 'lucide-react'
import type { CspPosition, Holding, OptionPosition, Portfolio, PortfolioActivity, PortfolioDailyValue, PortfolioKind, TickerThesisRow } from '../lib/database.types'
import {
  fetchActivity,
  fetchAllocationTolerance,
  fetchCsps,
  fetchDailyValues,
  fetchHoldings,
  fetchLatestPrices,
  fetchOptions,
  fetchPortfolios,
  fetchPositionTargets,
  fetchTheses,
  updateHolding,
  updatePortfolio,
  type SymbolPrice,
} from '../lib/wealthQueries'
import {
  KIND_TONE,
  PORTFOLIO_KINDS,
  dayChangeLabel,
  kindLabel,
  optionValue,
  portfolioSnapshot,
  seriesFor,
  signedCurrency as signed,
  unpricedSymbols,
  type HoldingView,
} from '../lib/portfolio'
import { centralDateStr, currency, dateFmt, percentFmt, priceFmt } from '../lib/format'
import { INPUT_SM, toneClass } from '../lib/ui'
import { allocationSlices } from '../lib/allocation'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { AllocationDonut, ValueHistoryChart } from '../components/WealthCharts'
import { Kpi, ReturnsRow } from '../components/WealthBits'
import { PortfolioActions, type TradeTab } from '../components/PortfolioActions'
import { DividendsCard } from '../components/DividendsCard'
import { GetPricesButton } from '../components/GetPricesButton'
import { OptionsCard } from '../components/OptionsCard'
import { ActivityTable } from '../components/ActivityTable'
import { ResearchPills } from '../components/ResearchBits'
import { QuickTrade } from '../components/QuickTrade'
import { PlanNotesCard, PositionPlanCard, reviewDue } from '../components/PositionPlan'
import type { PlanTarget } from '../lib/positionPlan'
import { ResearchDrawer } from '../components/ResearchDrawer'
import { AccountAllocationCard } from '../components/AllocationCards'
import { useResearch } from '../lib/useResearch'
import type { Research } from '../lib/research'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { Tabs } from '../components/ui/Tabs'
import { Drawer } from '../components/ui/Drawer'
import { EmptyState } from '../components/ui/EmptyState'

type View = 'positions' | 'plan' | 'performance' | 'dividends' | 'activity'

/** Inline manual price for a holding -- for funds with no public ticker (many 401k funds).
 * Shares and average cost only change through Activity entries (Buy, Sell, Add existing,
 * Split...), so the holding always matches its history and cash. Enter saves, Esc cancels. */
function HoldingEditRow({ holding: h, onSaved, onCancel }: { holding: Holding; onSaved: () => void; onCancel: () => void }) {
  const [manual, setManual] = useState(h.manual_price !== null ? String(Number(h.manual_price)) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const manualPrice = manual.trim() === '' ? null : Number(manual.replace(/[$,\s]/g, ''))
    if (manualPrice !== null && !(manualPrice >= 0)) return setError('Manual price can’t be negative.')
    setSaving(true)
    setError(null)
    try {
      await updateHolding(h.id, { manual_price: manualPrice })
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
    <tr className="border-b border-(--border) bg-(--accent-soft)/40 last:border-0">
      <td className="px-5 py-3 align-top font-semibold text-white">{h.symbol}</td>
      <td colSpan={9} className="px-3 py-3">
        <div className="flex flex-wrap items-end gap-3" onKeyDown={onKeyDown}>
          <label className="flex w-40 flex-col gap-1">
            <span className="text-xs text-neutral-400" title="Only for funds with no public ticker, like many 401k funds">
              Manual price <span className="text-neutral-600">(optional)</span>
            </span>
            <input autoFocus inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="daily close" className={`${INPUT_SM} text-right tabular-nums`} />
          </label>
          <span className="flex items-center gap-2 pb-0.5">
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : (
            'For funds without a public ticker; leave blank to use the daily close. Shares and average cost come from Activity — to fix them, edit the entry there, or use Trade → Split for a stock split.'
          )}
        </p>
      </td>
    </tr>
  )
}

/** Holdings, with the quick trade form opening under the row you click (or at the top for a
 * new ticker). `trading` is the open form's ticker: '' = new, null = closed. */
function HoldingsTable({
  views,
  total,
  dayLabel,
  research,
  onResearch,
  onSaved,
  portfolioId,
  cash,
  priceOf,
  trading,
  onTrading,
  onTraded,
  targets,
  theses,
}: {
  views: HoldingView[]
  total: number
  dayLabel: string
  research: Map<string, Research>
  onResearch: (symbol: string) => void
  onSaved: () => void
  portfolioId: string
  cash: number
  priceOf: (symbol: string) => number | null
  trading: string | null
  onTrading: (symbol: string | null) => void
  onTraded: (message: string) => void
  /** Plan target % by ticker (empty = no plan). */
  targets: Map<string, number>
  theses: Map<string, TickerThesisRow>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const tradeRow = (symbol: string) => (
    <tr key={`trade-${symbol}`} className="border-b border-(--border) bg-(--accent-soft)/40">
      <td colSpan={10} className="px-5 py-3">
        <QuickTrade key={symbol} portfolioId={portfolioId} views={views} priceOf={priceOf} cash={cash} symbol={symbol} onDone={onTraded} onCancel={() => onTrading(null)} />
      </td>
    </tr>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <th className="px-5 py-2.5">Ticker</th>
            <th className="px-3 py-2.5 text-right">Qty</th>
            <th className="px-3 py-2.5 text-right">Avg cost</th>
            <th className="px-3 py-2.5 text-right">Price</th>
            <th className="px-3 py-2.5" title="Fair value, how cheap it is, and the score — click for the breakdown">Fair value</th>
            <th className="px-3 py-2.5 text-right">Value</th>
            <th className="px-3 py-2.5 text-right">{dayLabel}</th>
            <th className="px-3 py-2.5 text-right">Gain</th>
            <th className="px-3 py-2.5 text-right">Weight</th>
            <th className="w-16 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {trading === '' && tradeRow('')}
          {views.flatMap((v) => [
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
              <tr
                key={v.holding.id}
                onClick={() => onTrading(trading === v.holding.symbol ? null : v.holding.symbol)}
                title={`Log a buy or sale of ${v.holding.symbol}`}
                className={`group cursor-pointer border-b border-(--border) transition last:border-0 hover:bg-white/2 ${trading === v.holding.symbol ? 'bg-white/3' : ''}`}
              >
                <td className="px-5 py-3 font-semibold text-white">
                  {v.holding.symbol}
                  {reviewDue(theses.get(v.holding.symbol)) && (
                    <span className="ml-1.5 align-middle" title="Your thesis is due for review — open the fair value breakdown">
                      <Pill tone="amber">review</Pill>
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-neutral-300">{Number(Number(v.holding.quantity).toFixed(6))}</td>
                <td className="px-3 py-3 text-right tabular-nums text-neutral-400">{priceFmt(Number(v.holding.avg_cost))}</td>
                <td className="px-3 py-3 text-right tabular-nums text-neutral-200">
                  {v.priced === 'none' ? (
                    <Pill tone="amber" title="Prices update once a day after the close">
                      pending
                    </Pill>
                  ) : (
                    <>
                      {priceFmt(v.price)}
                      {v.priced === 'manual' && (
                        <span className="ml-1 text-[10px] font-medium text-neutral-500" title="Manual price">
                          MANUAL
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <ResearchPills r={research.get(v.holding.symbol)} onOpen={() => onResearch(v.holding.symbol)} />
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums text-white">{currency(v.value)}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${v.dayChange === null ? 'text-neutral-600' : toneClass(v.dayChange)}`}>
                  {v.dayChange === null ? '—' : signed(v.dayChange)}
                  {v.dayChangePct !== null && <div className="text-xs">{percentFmt(v.dayChangePct)}</div>}
                </td>
                <td className={`px-3 py-3 text-right font-medium tabular-nums ${v.gain === null ? 'text-neutral-600' : toneClass(v.gain)}`}>
                  {v.gain === null ? '—' : signed(v.gain)}
                  {v.gainPct !== null && <div className="text-xs font-normal">{percentFmt(v.gainPct)}</div>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-neutral-400">
                  {total > 0 ? percentFmt(v.value / total).replace('+', '') : '—'}
                  {targets.size > 0 && <div className="text-xs text-neutral-600">{targets.has(v.holding.symbol) ? `target ${Number(targets.get(v.holding.symbol)!.toFixed(1))}%` : 'not in plan'}</div>}
                </td>
                <td className="px-3 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingId(v.holding.id)
                    }}
                    title={`Manual price for ${v.holding.symbol}`}
                    className="rounded-md p-1.5 text-neutral-600 transition hover:bg-(--card-raised) hover:text-white group-hover:text-neutral-300"
                  >
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ),
            trading === v.holding.symbol ? tradeRow(v.holding.symbol) : null,
          ])}
        </tbody>
      </table>
    </div>
  )
}

export function PortfolioDetailPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>()
  const dialog = useDialog()
  const toast = useToast()
  const [portfolio, setPortfolio] = useState<Portfolio | null | undefined>(undefined)
  const [allPortfolios, setAllPortfolios] = useState<Portfolio[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [csps, setCsps] = useState<CspPosition[]>([])
  const [options, setOptions] = useState<OptionPosition[]>([])
  const [values, setValues] = useState<PortfolioDailyValue[]>([])
  const [activity, setActivity] = useState<PortfolioActivity[]>([])
  const [prices, setPrices] = useState<Map<string, SymbolPrice>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('positions')
  const [trade, setTrade] = useState<TradeTab | null>(null)
  const [trading, setTrading] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanTarget[]>([])
  const [tolerance, setTolerance] = useState(5)
  const [theses, setTheses] = useState<Map<string, TickerThesisRow>>(new Map())
  const loadTheses = useCallback(() => {
    fetchTheses()
      .then(setTheses)
      .catch(() => {})
  }, [])
  useEffect(loadTheses, [loadTheses])

  const load = useCallback(() => {
    if (!portfolioId) return
    Promise.all([
      fetchPortfolios(),
      fetchHoldings(portfolioId),
      fetchCsps(portfolioId),
      fetchDailyValues(portfolioId),
      fetchActivity(portfolioId),
      fetchOptions(portfolioId),
      fetchPositionTargets(),
      fetchAllocationTolerance(),
    ])
      .then(async ([ps, h, c, v, a, o, pt, tol]) => {
        const ownPlan = pt.filter((t) => t.portfolio_id === portfolioId).map((t) => ({ symbol: t.symbol, pct: Number(t.target_pct) }))
        const symbols = [
          ...new Set([
            ...h.map((x) => x.symbol),
            ...ownPlan.map((x) => x.symbol),
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
        setPlan(ownPlan)
        setTolerance(tol)
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
  // Fair value and score per holding, compared with the price the holdings table shows.
  const researchPrices = useMemo(() => new Map((snap?.holdings ?? []).filter((v) => v.price !== null).map((v) => [v.holding.symbol, v.price as number])), [snap])
  // Plan tickers you don't own yet get research too (opened from the plan).
  const holdingSymbols = useMemo(() => [...holdings.map((h) => h.symbol), ...plan.map((t) => t.symbol)], [holdings, plan])
  const planTargets = useMemo(() => new Map(plan.map((t) => [t.symbol, t.pct])), [plan])
  const planHoldings = useMemo(
    () => (snap?.holdings ?? []).map((v) => ({ symbol: v.holding.symbol, value: v.value, price: v.price ?? prices.get(v.holding.symbol)?.close ?? null })),
    [snap, prices],
  )
  const longOptionsValue = useMemo(() => openOptions.filter((o) => o.side === 'long').reduce((s, o) => s + optionValue(o, prices), 0), [openOptions, prices])
  const research = useResearch(holdingSymbols, researchPrices)
  const [researchOpen, setResearchOpen] = useState<string | null>(null)
  const realized = useMemo(() => activity.reduce((s, a) => s + (a.voided_at === null && a.realized_gain !== null ? Number(a.realized_gain) : 0), 0), [activity])

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

  if (error) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>
  if (portfolio === undefined || !snap) return <div className="text-neutral-500">Loading portfolio…</div>
  if (portfolio === null)
    return (
      <div className="text-neutral-400">
        Portfolio not found.{' '}
        <Link to="/portfolios" className="text-(--accent-text)">
          Back to portfolios
        </Link>
      </div>
    )

  const p = portfolio
  const margin = snap.cash < 0
  const grossPositions = snap.holdingsValue + Math.max(0, snap.optionsValue)
  const leverage = margin && snap.total > 0 ? grossPositions / snap.total : null

  async function editPortfolio() {
    const v = await dialog.form({
      title: 'Edit portfolio',
      submitLabel: 'Save',
      fields: [
        { name: 'name', label: 'Name', defaultValue: p.name },
        {
          name: 'kind',
          label: 'Type',
          type: 'select',
          defaultValue: p.kind,
          options: PORTFOLIO_KINDS.map((k) => ({ value: k.value, label: k.label })),
          hint: 'Decides which Net worth line this portfolio fills.',
        },
      ],
    })
    if (!v) return
    try {
      await updatePortfolio(p.id, { name: v.name, kind: v.kind as PortfolioKind })
      toast('Portfolio updated')
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function toggleArchive() {
    if (
      !p.archived &&
      !(await dialog.confirm({
        title: `Archive “${p.name}”?`,
        message: 'It stops being priced and leaves Net worth. You can unarchive it any time.',
        confirmLabel: 'Archive',
        tone: 'warning',
      }))
    )
      return
    try {
      await updatePortfolio(p.id, { archived: !p.archived })
      toast(p.archived ? 'Portfolio restored' : 'Portfolio archived')
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const tradeDone = (message: string) => {
    setTrade(null)
    setTrading(null)
    toast(message)
    load()
  }
  const priceOf = (s: string) => {
    const v = snap.holdings.find((x) => x.holding.symbol === s)
    return v?.price ?? prices.get(s)?.close ?? null
  }
  const lastEntry = activity.find((a) => a.voided_at === null)?.created_at ?? null

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        back={{ to: '/portfolios', label: 'Portfolios' }}
        title={p.name}
        badge={
          <>
            <Pill tone={KIND_TONE[p.kind]}>{kindLabel(p.kind)}</Pill>
            {p.archived && <Pill>Archived</Pill>}
          </>
        }
        actions={
          <>
            <Button variant="ghost" icon={<Pencil size={15} />} onClick={editPortfolio}>
              Edit
            </Button>
            <Button variant="ghost" icon={p.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />} onClick={toggleArchive}>
              {p.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setTrade('buy')}>
              Trade
            </Button>
          </>
        }
      />

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-200">
          <span>
            Waiting for a first price: <span className="font-medium">{pending.join(', ')}</span>. Until then they’re valued at average cost.
          </span>
          <GetPricesButton symbols={pending} onDone={load} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          label="Value"
          value={currency(snap.total)}
          sub={snap.optionsValue !== 0 ? `incl. ${currency(snap.optionsValue)} options` : snap.cspLiability > 0 ? `after ${currency(snap.cspLiability)} to buy back puts` : undefined}
          accent
        />
        <Kpi
          label={dayChangeLabel(snap.asOf) === 'Today' ? 'Today' : `Last close · ${dayChangeLabel(snap.asOf)}`}
          value={signed(snap.dayChange)}
          tone={snap.dayChange}
          chip={snap.total - snap.dayChange > 0 ? percentFmt(snap.dayChange / (snap.total - snap.dayChange)) : undefined}
          chipTone={snap.dayChange}
        />
        <Kpi
          label="Unrealized gain"
          value={signed(snap.unrealized)}
          tone={snap.unrealized}
          chip={snap.cost > 0 ? percentFmt(snap.unrealized / snap.cost) : undefined}
          chipTone={snap.unrealized}
        />
        <Kpi label="Realized gain" value={signed(realized)} tone={realized} sub="sales, options and puts" />
        {margin ? (
          <div className="col-span-2 lg:col-span-1">
            <StatCardMargin used={-snap.cash} leverage={leverage} />
          </div>
        ) : (
          <Kpi label="Cash" value={currency(snap.cash)} sub={snap.collateral > 0 ? `${currency(snap.cashAvailable)} free after puts` : 'available to invest'} />
        )}
      </div>

      <Tabs<View>
        tabs={[
          { value: 'positions', label: 'Positions', count: snap.holdings.length + openOptions.length + openCsps.length },
          { value: 'plan', label: 'Plan' },
          { value: 'performance', label: 'Performance' },
          { value: 'dividends', label: 'Dividends' },
          { value: 'activity', label: 'Activity', count: activity.filter((a) => a.voided_at === null).length },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'positions' && (
        <div className="flex flex-col gap-6">
          <Card
            title="Stocks & funds"
            subtitle={
              snap.holdings.length > 0
                ? `${snap.holdings.length} holding${snap.holdings.length === 1 ? '' : 's'} · ${currency(snap.holdingsValue)} · click a row to log a buy or sale${lastEntry ? ` · last entry ${dateFmt(centralDateStr(new Date(lastEntry)))}` : ''}`
                : undefined
            }
            flush
            actions={
              <Button size="sm" icon={<Plus size={14} />} onClick={() => (snap.holdings.length > 0 ? setTrading('') : setTrade('existing'))}>
                {snap.holdings.length > 0 ? 'New ticker' : 'Add shares'}
              </Button>
            }
          >
            {snap.holdings.length === 0 ? (
              <EmptyState
                icon={<Wallet size={20} />}
                title="No holdings yet"
                action={
                  <Button variant="primary" size="sm" onClick={() => setTrade('existing')}>
                    Add shares you own
                  </Button>
                }
              >
                Use “Add existing” for shares you already hold, or “Buy” for new purchases from this portfolio’s cash.
              </EmptyState>
            ) : (
              <HoldingsTable
                views={snap.holdings}
                total={allocationTotal}
                dayLabel={dayChangeLabel(snap.asOf)}
                research={research.rows}
                onResearch={setResearchOpen}
                onSaved={load}
                portfolioId={p.id}
                cash={snap.cash}
                priceOf={priceOf}
                trading={trading}
                onTrading={setTrading}
                onTraded={tradeDone}
                targets={planTargets}
                theses={theses}
              />
            )}
          </Card>
          <OptionsCard options={options} csps={csps} prices={prices} onChanged={load} onAdd={() => setTrade('option')} />
        </div>
      )}

      {view === 'performance' && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <Card title="Value" subtitle="At each trading day’s close" className="xl:col-span-3">
              <ValueHistoryChart data={series.map((s) => ({ date: s.date, total: s.total }))} />
            </Card>
            <Card title="Allocation" className="xl:col-span-2">
              <AllocationDonut allocation={allocation} centerLabel="Value" />
            </Card>
          </div>
          <Card title="Returns">
            <ReturnsRow series={series} />
          </Card>
        </div>
      )}

      {view === 'plan' && (
        <div className="flex flex-col gap-6">
          <PositionPlanCard
            portfolio={p}
            holdings={planHoldings}
            longOptions={longOptionsValue}
            cash={snap.cash}
            spendable={snap.cashAvailable}
            plan={plan}
            tolerance={tolerance}
            theses={theses}
            onOpenTicker={setResearchOpen}
            onSaved={load}
          />
          <PlanNotesCard key={p.id} portfolio={p} onSaved={load} />
          <AccountAllocationCard portfolio={p} snap={snap} options={options} prices={prices} plan={plan} />
        </div>
      )}

      {view === 'dividends' && <DividendsCard holdings={holdings} prices={prices} holdingsValue={snap.holdingsValue} portfolioId={p.id} onRecorded={load} />}

      {view === 'activity' && (
        <Card flush title="Activity" subtitle="Every trade, cash move and option event — use ⋯ to edit or undo a mistake">
          <ActivityTable activity={activity} onChanged={load} />
        </Card>
      )}

      <ResearchDrawer
        r={researchOpen ? (research.rows.get(researchOpen) ?? null) : null}
        macro={research.macro}
        settings={research.settings}
        onClose={() => setResearchOpen(null)}
        onChanged={research.reload}
        onThesisSaved={loadTheses}
      />

      <Drawer open={trade !== null} onClose={() => setTrade(null)} title={`Trade · ${p.name}`} subtitle={`Cash available ${currency(snap.cashAvailable)}`}>
        {trade !== null && (
          <PortfolioActions
            key={trade}
            portfolioId={p.id}
            otherPortfolios={allPortfolios.filter((x) => x.id !== p.id && !x.archived)}
            holdings={holdings}
            options={options}
            prices={prices}
            cashAvailable={snap.cashAvailable}
            cash={snap.cash}
            initialTab={trade}
            onDone={tradeDone}
          />
        )}
      </Drawer>
    </div>
  )
}

/** Cash card when the portfolio is on margin (negative cash): amber, with leverage. */
function StatCardMargin({ used, leverage }: { used: number; leverage: number | null }) {
  return <Kpi label="Margin used" value={currency(used)} sub={leverage !== null ? `${leverage.toFixed(2)}× leverage` : 'borrowed from your broker'} warning />
}
