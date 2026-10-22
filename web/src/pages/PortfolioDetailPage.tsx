import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArchiveRestore, Pencil, Plus, Wallet } from 'lucide-react'
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
import { currency, percentFmt, priceFmt } from '../lib/format'
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
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { Tabs } from '../components/ui/Tabs'
import { Drawer } from '../components/ui/Drawer'
import { EmptyState } from '../components/ui/EmptyState'

type View = 'positions' | 'performance' | 'dividends' | 'activity'

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
    <tr className="border-b border-(--border) bg-(--accent-soft)/40 last:border-0">
      <td className="px-5 py-3 align-top font-semibold text-white">{h.symbol}</td>
      <td colSpan={8} className="px-3 py-3">
        <div className="flex flex-wrap items-end gap-3" onKeyDown={onKeyDown}>
          <label className="flex w-32 flex-col gap-1">
            <span className="text-xs text-neutral-400">Quantity</span>
            <input autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={`${INPUT_SM} text-right tabular-nums`} />
          </label>
          <label className="flex w-32 flex-col gap-1">
            <span className="text-xs text-neutral-400">Avg cost / share</span>
            <input inputMode="decimal" value={avg} onChange={(e) => setAvg(e.target.value)} className={`${INPUT_SM} text-right tabular-nums`} />
          </label>
          <label className="flex w-40 flex-col gap-1">
            <span className="text-xs text-neutral-400" title="Only for funds with no public ticker, like many 401k funds">
              Manual price <span className="text-neutral-600">(optional)</span>
            </span>
            <input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="daily close" className={`${INPUT_SM} text-right tabular-nums`} />
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
            'Corrections only (splits, typos) — no cash moves. Use Buy / Sell for trades. Manual price is for funds without a public ticker; leave it blank to use the daily close.'
          )}
        </p>
      </td>
    </tr>
  )
}

function HoldingsTable({ views, total, dayLabel, onSaved }: { views: HoldingView[]; total: number; dayLabel: string; onSaved: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <th className="px-5 py-2.5">Ticker</th>
            <th className="px-3 py-2.5 text-right">Qty</th>
            <th className="px-3 py-2.5 text-right">Avg cost</th>
            <th className="px-3 py-2.5 text-right">Price</th>
            <th className="px-3 py-2.5 text-right">Value</th>
            <th className="px-3 py-2.5 text-right">{dayLabel}</th>
            <th className="px-3 py-2.5 text-right">Gain</th>
            <th className="px-3 py-2.5 text-right">Weight</th>
            <th className="w-16 px-3 py-2.5" />
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
              <tr key={v.holding.id} className="group border-b border-(--border) transition last:border-0 hover:bg-white/2">
                <td className="px-5 py-3 font-semibold text-white">{v.holding.symbol}</td>
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
                <td className="px-3 py-3 text-right font-medium tabular-nums text-white">{currency(v.value)}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${v.dayChange === null ? 'text-neutral-600' : toneClass(v.dayChange)}`}>
                  {v.dayChange === null ? '—' : signed(v.dayChange)}
                  {v.dayChangePct !== null && <div className="text-xs">{percentFmt(v.dayChangePct)}</div>}
                </td>
                <td className={`px-3 py-3 text-right font-medium tabular-nums ${v.gain === null ? 'text-neutral-600' : toneClass(v.gain)}`}>
                  {v.gain === null ? '—' : signed(v.gain)}
                  {v.gainPct !== null && <div className="text-xs font-normal">{percentFmt(v.gainPct)}</div>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-neutral-400">{total > 0 ? percentFmt(v.value / total).replace('+', '') : '—'}</td>
                <td className="px-3 py-3 text-right">
                  <button
                    onClick={() => setEditingId(v.holding.id)}
                    title={`Edit ${v.holding.symbol}`}
                    className="rounded-md p-1.5 text-neutral-600 transition hover:bg-(--card-raised) hover:text-white group-hover:text-neutral-300"
                  >
                    <Pencil size={14} />
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
    toast(message)
    load()
  }

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
          { value: 'performance', label: 'Performance' },
          { value: 'dividends', label: 'Dividends' },
          { value: 'activity', label: 'Activity', count: activity.length },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'positions' && (
        <div className="flex flex-col gap-6">
          <Card
            title="Stocks & funds"
            subtitle={snap.holdings.length > 0 ? `${snap.holdings.length} holding${snap.holdings.length === 1 ? '' : 's'} · ${currency(snap.holdingsValue)}` : undefined}
            flush
            actions={
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setTrade(snap.holdings.length > 0 ? 'buy' : 'existing')}>
                Add shares
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
              <HoldingsTable views={snap.holdings} total={allocationTotal} dayLabel={dayChangeLabel(snap.asOf)} onSaved={load} />
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

      {view === 'dividends' && <DividendsCard holdings={holdings} prices={prices} holdingsValue={snap.holdingsValue} portfolioId={p.id} onRecorded={load} />}

      {view === 'activity' && (
        <Card flush title="Activity" subtitle="Every trade, cash move and option event — use ⋯ to edit or undo a mistake">
          <ActivityTable activity={activity} onChanged={load} />
        </Card>
      )}

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
