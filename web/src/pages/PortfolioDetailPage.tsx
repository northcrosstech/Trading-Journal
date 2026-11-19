import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ChevronDown, Pencil, Plus, Wallet } from 'lucide-react'
import type { AuditProblem, CspPosition, Holding, OptionPosition, Portfolio, PortfolioActivity, PortfolioDailyValue, PortfolioKind, TickerThesisRow } from '../lib/database.types'
import {
  fetchActivity,
  fetchAllocationTolerance,
  fetchAuditProblems,
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
import { PortfolioActions } from '../components/PortfolioActions'
import { LOG_TITLE, type LogAction } from '../lib/logActions'
import { contractLabel, daysTo, openContractLines } from '../lib/optionLines'
import { CHECK_LABEL } from '../lib/healthCheck'
import { useUrlState } from '../lib/useUrlState'
import { DropMenu } from '../components/DropMenu'
import { AttentionButton, AttentionStrip, type AttentionItem } from '../components/AttentionStrip'
import type { OptionFormInitial } from '../components/OptionTradeForm'
import { DividendsCard } from '../components/DividendsCard'
import { SortTh } from '../components/SortTh'
import { sortRows, useSort } from '../lib/useSort'
import { GetPricesButton } from '../components/GetPricesButton'
import { OptionsCard } from '../components/OptionsCard'
import { ActivityTable } from '../components/ActivityTable'
import { MoversStrip } from '../components/MoversStrip'
import { ResearchPills } from '../components/ResearchBits'
import { QuickTrade, type QuickLine } from '../components/QuickTrade'
import { PlanNotesCard, PositionPlanCard, reviewDue } from '../components/PositionPlan'
import { comparePlan, planActions, type PlanAction, type PlanTarget } from '../lib/positionPlan'
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

type View = 'positions' | 'plan' | 'performance' | 'activity'
// Dividends used to be a tab of its own; old links to it land on Performance, where it lives now.
const TABS_IN_LINK = ['positions', 'plan', 'performance', 'activity', 'dividends'] as const

/** Inline manual price for a holding -- for funds with no public ticker (many 401k funds).
 * Shares and average cost only change through Activity entries (Buy, Sell, Shares I already
 * own, Stock split...), so the holding always matches its history and cash. Enter in the
 * field saves, Esc cancels. */
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
    // Enter on Cancel must cancel, not save: only the field itself saves.
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) save()
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
            'For funds without a public ticker; leave blank to use the daily close. Shares and average cost come from Activity — to fix them, edit the entry there, or use Log → Stock split for a stock split.'
          )}
        </p>
      </td>
    </tr>
  )
}

export type TradePreset = { side: 'buy' | 'sell'; qty: number }

function PlanCell({ a, onTrade }: { a: PlanAction | undefined; onTrade: (a: PlanAction) => void }) {
  if (!a) return null
  if (a.kind === 'unplanned') return <span className="text-xs text-neutral-500">Not in plan</span>
  if (a.kind === 'on') return <span className="text-xs text-emerald-300">✓ On plan</span>
  const label = `${a.kind === 'buy' ? '▲ Buy' : '▼ Trim'} ${a.shares === null ? '' : `${a.shares} sh`}`.trim()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onTrade(a)
      }}
      title={`Log this ${a.kind === 'buy' ? 'buy' : 'sale'}`}
      className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-left text-xs text-amber-300 hover:bg-amber-500/15"
    >
      <span className="font-medium">{label}</span>
      <span className="text-neutral-500"> ({currency(a.dollars)}{a.shares === null ? ', price pending' : ''})</span>
    </button>
  )
}

const HOLDING_SORT_KEYS = ['symbol', 'qty', 'avgCost', 'price', 'fair', 'value', 'day', 'gain', 'weight', 'plan'] as const
// Text sorts A→Z first; fair value (price ÷ fair value) sorts cheapest first.
const HOLDING_ASC_FIRST = ['symbol', 'fair'] as const

/** A table row that opens something: Enter or Space on the row itself does what a click does.
 * Keys pressed on a button inside the row are left to that button. */
const rowKeys = (open: () => void) => (e: React.KeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  open()
}
const ROW_FOCUS = 'focus-visible:bg-white/3 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--accent)'

/** Holdings, with the quick trade form opening under the row you click (or at the top for a
 * new ticker or several lines). `trading` is the open form's ticker: '' = new, null = closed.
 * With a position plan, each row shows what to buy or trim to get back on plan, and planned
 * tickers you don't own yet follow at the bottom. */
function HoldingsTable({
  views,
  total,
  dayLabel,
  research,
  onResearch,
  onSaved,
  trading,
  onTrading,
  renderTrade,
  targets,
  theses,
  actions,
  offOnly,
  focus,
}: {
  views: HoldingView[]
  total: number
  dayLabel: string
  research: Map<string, Research>
  onResearch: (symbol: string) => void
  onSaved: () => void
  trading: string | null
  onTrading: (symbol: string | null, preset?: TradePreset) => void
  /** The quick trade form for the row it opens under. */
  renderTrade: (symbol: string) => ReactNode
  /** Plan target % by ticker (empty = no plan). */
  targets: Map<string, number>
  theses: Map<string, TickerThesisRow>
  /** What to do per ticker to get back on plan; null = no plan. */
  actions: Map<string, PlanAction> | null
  offOnly: boolean
  /** Scrolls to a holding's row (by its id) and highlights it. Pass a new object each time. */
  focus?: { id: string } | null
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!focus) return
    const el = document.getElementById(`holding-row-${focus.id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(focus.id)
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [focus])
  const { state: sort, toggle: onSort } = useSort('holdings', HOLDING_SORT_KEYS, HOLDING_ASC_FIRST)
  const hasPlan = actions !== null
  const cols = hasPlan ? 11 : 10
  const trade = (a: PlanAction) => onTrading(a.symbol, a.shares ? { side: a.kind === 'trim' ? 'sell' : 'buy', qty: a.shares } : undefined)
  const off = (s: string) => {
    const k = actions?.get(s)?.kind
    return k === 'buy' || k === 'trim'
  }
  const drift = (s: string) => {
    const a = actions?.get(s)
    return a && a.target !== null ? a.pct - a.target : null
  }
  const shown = sortRows(offOnly && hasPlan ? views.filter((v) => off(v.holding.symbol)) : views, sort, {
    symbol: (v) => v.holding.symbol,
    qty: (v) => Number(v.holding.quantity),
    avgCost: (v) => Number(v.holding.avg_cost),
    price: (v) => v.price,
    fair: (v) => research.get(v.holding.symbol)?.pct ?? null,
    value: (v) => v.value,
    day: (v) => v.dayChange,
    gain: (v) => v.gain,
    weight: (v) => v.value,
    plan: (v) => drift(v.holding.symbol),
  })
  const notOwned = hasPlan ? [...actions.values()].filter((a) => !a.owned && (!offOnly || off(a.symbol))) : []
  const tradeRow = (symbol: string) => (
    <tr key={`trade-${symbol}`} className="border-b border-(--border) bg-(--accent-soft)/40">
      <td colSpan={cols} className="px-5 py-3">
        {renderTrade(symbol)}
      </td>
    </tr>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <SortTh k="symbol" sort={sort} onSort={onSort} className="px-5 py-2.5">Ticker</SortTh>
            <SortTh k="qty" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Qty</SortTh>
            <SortTh k="avgCost" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Avg cost</SortTh>
            <SortTh k="price" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Price</SortTh>
            <SortTh k="fair" sort={sort} onSort={onSort} className="px-3 py-2.5" title="Fair value, how cheap it is, and the score; sorts cheapest first">Fair value</SortTh>
            <SortTh k="value" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Value</SortTh>
            <SortTh k="day" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">{dayLabel}</SortTh>
            <SortTh k="gain" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Gain</SortTh>
            <SortTh k="weight" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Weight</SortTh>
            {hasPlan && (
              <SortTh k="plan" sort={sort} onSort={onSort} className="hidden px-3 py-2.5 sm:table-cell" title="Drift from target; over plan first">
                Vs plan
              </SortTh>
            )}
            <th className="w-16 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {trading === '' && tradeRow('')}
          {shown.flatMap((v) => [
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
                id={`holding-row-${v.holding.id}`}
                onClick={() => onTrading(trading === v.holding.symbol ? null : v.holding.symbol)}
                tabIndex={0}
                onKeyDown={rowKeys(() => onTrading(trading === v.holding.symbol ? null : v.holding.symbol))}
                title={`Log a buy or sale of ${v.holding.symbol}`}
                className={`group cursor-pointer border-b border-(--border) transition last:border-0 hover:bg-white/2 ${ROW_FOCUS} ${flash === v.holding.id ? 'bg-amber-500/10' : trading === v.holding.symbol ? 'bg-white/3' : ''}`}
              >
                <td className="px-5 py-3 font-semibold text-white">
                  {v.holding.symbol}
                  {reviewDue(theses.get(v.holding.symbol)) && (
                    <span className="ml-1.5 align-middle" title="Your thesis is due for review — open the fair value breakdown">
                      <Pill tone="amber">review</Pill>
                    </span>
                  )}
                  {hasPlan && (
                    <div className="font-normal sm:hidden">
                      <PlanCell a={actions.get(v.holding.symbol)} onTrade={trade} />
                    </div>
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
                  {targets.has(v.holding.symbol) && <div className="text-xs text-neutral-500">→ {Number(targets.get(v.holding.symbol)!.toFixed(1))}%</div>}
                </td>
                {hasPlan && (
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <PlanCell a={actions.get(v.holding.symbol)} onTrade={trade} />
                  </td>
                )}
                <td className="px-3 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingId(v.holding.id)
                    }}
                    title={`Manual price for ${v.holding.symbol}`}
                    aria-label={`Manual price for ${v.holding.symbol}`}
                    className="rounded-md p-1.5 text-neutral-600 transition hover:bg-(--card-raised) hover:text-white group-hover:text-neutral-300"
                  >
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ),
            trading === v.holding.symbol ? tradeRow(v.holding.symbol) : null,
          ])}
          {notOwned.length > 0 && (
            <tr className="border-y border-(--border) bg-white/2">
              <td colSpan={cols} className="px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                In your plan, not owned yet
              </td>
            </tr>
          )}
          {notOwned.flatMap((a) => [
            <tr
              key={`plan-${a.symbol}`}
              onClick={() => trade(a)}
              tabIndex={0}
              onKeyDown={rowKeys(() => trade(a))}
              title={`Log a buy of ${a.symbol}`}
              className={`cursor-pointer border-b border-(--border) last:border-0 hover:bg-white/2 ${ROW_FOCUS}`}
            >
              <td className="px-5 py-3 font-semibold text-white">
                {a.symbol}
                <div className="font-normal sm:hidden">
                  <PlanCell a={a} onTrade={trade} />
                </div>
              </td>
              <td className="px-3 py-3 text-right text-neutral-600">—</td>
              <td className="px-3 py-3 text-right text-neutral-600">—</td>
              <td className="px-3 py-3 text-right tabular-nums text-neutral-200">{a.price !== null ? priceFmt(a.price) : <Pill tone="amber">pending</Pill>}</td>
              <td className="px-3 py-3" />
              <td className="px-3 py-3 text-right text-neutral-600">—</td>
              <td className="px-3 py-3" />
              <td className="px-3 py-3" />
              <td className="px-3 py-3 text-right tabular-nums text-neutral-400">
                0%
                {a.target !== null && <div className="text-xs text-neutral-500">→ {Number(a.target.toFixed(1))}%</div>}
              </td>
              <td className="hidden px-3 py-3 sm:table-cell">
                <PlanCell a={a} onTrade={trade} />
              </td>
              <td className="px-3 py-3" />
            </tr>,
            trading === a.symbol ? tradeRow(a.symbol) : null,
          ])}
          {offOnly && hasPlan && shown.length === 0 && notOwned.length === 0 && (
            <tr>
              <td colSpan={cols} className="px-5 py-6 text-center text-sm text-emerald-300">
                Everything is on plan.
              </td>
            </tr>
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
  // Health check problems for this portfolio; empty when all is well or the check isn't set up.
  const [problems, setProblems] = useState<AuditProblem[]>([])
  const [error, setError] = useState<string | null>(null)
  // The tab lives in the link (?tab=plan), so Back, refresh and links from other pages land on it.
  const [tab, setTab] = useUrlState('tab', 'positions', TABS_IN_LINK)
  const view: View = tab === 'dividends' ? 'performance' : tab
  const [params, setParams] = useSearchParams()
  // The form open in the drawer (from the Log menu), and the contract an option form starts on.
  const [drawer, setDrawer] = useState<LogAction | null>(null)
  const [optionInitial, setOptionInitial] = useState<OptionFormInitial | undefined>(undefined)
  // The quick buy/sell form: the row it is open under ('' = at the top, null = closed), the
  // lines it starts with, and a number that changes each time it opens so it starts fresh.
  const [trading, setTrading] = useState<string | null>(null)
  const [preset, setPreset] = useState<QuickLine[] | null>(null)
  const [formKey, setFormKey] = useState(0)
  // True once something was typed into the quick form, so closing it asks first.
  const dirty = useRef(false)
  const [focusLine, setFocusLine] = useState<{ key: string } | null>(null)
  // The holdings row a "biggest gains and losses" chip points at.
  const [focusHolding, setFocusHolding] = useState<{ id: string } | null>(null)
  // "Off plan only" on the holdings table, remembered per browser.
  const [offOnly, setOffOnly] = useState(() => {
    try {
      return localStorage.getItem('positions-off-plan-only') === '1'
    } catch {
      return false
    }
  })
  const toggleOffOnly = () =>
    setOffOnly((v) => {
      try {
        localStorage.setItem('positions-off-plan-only', v ? '0' : '1')
      } catch {
        // storage blocked: just don't remember
      }
      return !v
    })
  /** Opens (or, with null, closes) the quick form without asking -- callers check first. */
  const showTrade = useCallback((symbol: string | null, lines?: QuickLine[]) => {
    dirty.current = false
    setTrading(symbol)
    setPreset(lines ?? null)
    setFormKey((k) => k + 1)
  }, [])
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
    // On its own, so a slow or missing health check never holds the page up.
    fetchAuditProblems()
      .then((all) => setProblems((all ?? []).filter((x) => x.portfolio_id === portfolioId)))
      .catch(() => setProblems([]))
  }, [portfolioId])
  useEffect(load, [load])

  // ?log=trade|cash|option (from the sidebar's Log shortcut) opens that form once. The
  // parameter is then taken out of the link, so a refresh doesn't open it again.
  const logParam = params.get('log')
  const loaded = portfolio != null
  useEffect(() => {
    if (!logParam || !loaded) return
    if (logParam === 'trade') {
      // A form with lines already typed stays as it is.
      if (!dirty.current) showTrade('')
    } else if (logParam === 'cash') setDrawer('deposit')
    else if (logParam === 'option') {
      setOptionInitial(undefined)
      setDrawer('option')
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('log')
        // The quick form is on the Positions tab.
        if (logParam === 'trade') next.delete('tab')
        return next
      },
      { replace: true },
    )
  }, [logParam, loaded, showTrade, setParams])

  const openCsps = useMemo(() => csps.filter((c) => c.status === 'open'), [csps])
  const openOptions = useMemo(() => options.filter((o) => o.status === 'open'), [options])
  // Open options as the Options card shows them: one line per contract, however many lots.
  const optionLines = useMemo(() => openContractLines(options, csps), [options, csps])
  const snap = useMemo(
    () => (portfolio ? portfolioSnapshot([portfolio], holdings, openCsps, prices, openOptions) : null),
    [portfolio, holdings, openCsps, prices, openOptions],
  )
  const series = useMemo(() => (portfolioId ? seriesFor(values, portfolioId) : []), [values, portfolioId])
  const pending = useMemo(() => unpricedSymbols(holdings, openCsps, prices, openOptions), [holdings, openCsps, prices, openOptions])
  // Fair value and score per holding, compared with the price the holdings table shows. A plan
  // ticker not owned yet is compared with its latest close, as the Research page does.
  const researchPrices = useMemo(() => {
    const m = new Map((snap?.holdings ?? []).filter((v) => v.price !== null).map((v) => [v.holding.symbol, v.price as number]))
    for (const t of plan) {
      const close = prices.get(t.symbol)?.close
      if (close !== undefined && !holdings.some((h) => h.symbol === t.symbol)) m.set(t.symbol, close)
    }
    return m
  }, [snap, plan, prices, holdings])
  // Plan tickers you don't own yet get research too (opened from the plan).
  const holdingSymbols = useMemo(() => [...holdings.map((h) => h.symbol), ...plan.map((t) => t.symbol)], [holdings, plan])
  const planTargets = useMemo(() => new Map(plan.map((t) => [t.symbol, t.pct])), [plan])
  const planHoldings = useMemo(
    () => (snap?.holdings ?? []).map((v) => ({ symbol: v.holding.symbol, value: v.value, price: v.price ?? prices.get(v.holding.symbol)?.close ?? null })),
    [snap, prices],
  )
  const longOptionsValue = useMemo(() => openOptions.filter((o) => o.side === 'long').reduce((s, o) => s + optionValue(o, prices), 0), [openOptions, prices])
  // Buy / trim per ticker to get back on plan, on the same base as the Plan tab.
  const actions = useMemo(() => {
    if (!snap || plan.length === 0) return null
    const cmp = comparePlan(planHoldings, longOptionsValue, snap.cash, plan, tolerance)
    return new Map(planActions(cmp.rows, (s) => prices.get(s)?.close ?? null).map((a) => [a.symbol, a]))
  }, [snap, plan, planHoldings, longOptionsValue, tolerance, prices])
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
        message: 'It stops being priced and leaves Net worth from this month on. Earlier months keep its value. You can unarchive it any time.',
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

  /** False when lines were typed into the quick form and the user chose to keep them. */
  const okToDiscard = async () =>
    !dirty.current ||
    (await dialog.confirm({
      title: 'Discard what you typed?',
      message: 'The trades in the form haven’t been logged yet.',
      confirmLabel: 'Discard',
      tone: 'warning',
    }))
  /** Opens the quick form under a row ('' = at the top) or closes it (null), asking first if
   * that would drop typed lines. */
  const openTrade = async (symbol: string | null, lines?: QuickLine[]) => {
    if (!(await okToDiscard())) return
    showTrade(symbol, lines)
    if (symbol !== null && view !== 'positions') setTab('positions')
  }
  /** "Buy or sell" / "New ticker": a blank form at the top, unless one is open there with
   * lines typed -- that one is what the user wants. */
  const startTrade = () => {
    if (trading === '' && dirty.current) return
    openTrade('')
  }
  const changeView = async (v: View) => {
    // Leaving Positions takes the quick form down with it.
    if (v !== 'positions' && trading !== null) {
      if (!(await okToDiscard())) return
      showTrade(null)
    }
    if (v !== 'positions') {
      setFocusLine(null)
      setFocusHolding(null)
    }
    setTab(v)
  }
  const openDrawer = (action: LogAction, initial?: OptionFormInitial) => {
    setOptionInitial(initial)
    setDrawer(action)
  }
  const showOptionLine = (key: string) => {
    setFocusLine({ key })
    if (view !== 'positions') setTab('positions')
  }

  const tradeDone = (message: string) => {
    showTrade(null)
    toast(message)
    load()
  }
  // A drawer form saving leaves the quick form (and anything typed in it) alone.
  const drawerDone = (message: string) => {
    setDrawer(null)
    toast(message)
    load()
  }
  const priceOf = (s: string) => {
    const v = snap.holdings.find((x) => x.holding.symbol === s)
    return v?.price ?? prices.get(s)?.close ?? null
  }
  const lastEntry = activity.find((a) => a.voided_at === null)?.created_at ?? null
  const planSummary = actions && {
    off: [...actions.values()].filter((a) => a.kind === 'buy' || a.kind === 'trim').length,
    buy: [...actions.values()].filter((a) => a.kind === 'buy').reduce((s, a) => s + a.dollars, 0),
    trim: [...actions.values()].filter((a) => a.kind === 'trim').reduce((s, a) => s + a.dollars, 0),
  }
  // "Log all": the suggestions the Vs plan column shows, as form lines, sells first so the
  // cash is there for the buys. A ticker with no price yet has no share count and is left out.
  const suggested = (kind: 'trim' | 'buy'): QuickLine[] =>
    [...(actions?.values() ?? [])]
      .filter((a) => a.kind === kind && a.shares !== null)
      .map((a) => ({ symbol: a.symbol, side: kind === 'trim' ? 'sell' : 'buy', qty: a.shares as number }))
  const logAllLines = [...suggested('trim'), ...suggested('buy')]
  const logAll = () => openTrade('', logAllLines)

  const today = centralDateStr(new Date())
  const expiring = optionLines.filter((l) => daysTo(l.expiration, today) <= 7)
  const attention: AttentionItem[] = []
  if (planSummary && planSummary.off > 0)
    attention.push({
      key: 'plan',
      text: (
        <>
          {planSummary.off} off plan
          {planSummary.buy > 0 && ` · buy ${currency(planSummary.buy)}`}
          {planSummary.trim > 0 && ` · trim ${currency(planSummary.trim)}`}
        </>
      ),
      action: logAllLines.length > 0 ? <AttentionButton onClick={logAll}>Log all</AttentionButton> : undefined,
    })
  // A long list of expiring contracts would bury the rest: the first few, then one line for the others.
  for (const [i, l] of expiring.entries()) {
    if (i === 3 && expiring.length > 4) {
      attention.push({
        key: 'options-more',
        text: `${expiring.length - 3} more options expire within 7 days or have already expired`,
        action: <AttentionButton onClick={() => showOptionLine(l.key)}>Show</AttentionButton>,
      })
      break
    }
    const days = daysTo(l.expiration, today)
    const name = `${contractLabel(l.symbol, l.strike, l.optionType)} ×${l.contracts}`
    attention.push({
      key: `option-${l.key}`,
      text:
        days < 0
          ? `${name} expired ${dateFmt(l.expiration)}. Record what happened: expired, assigned or closed.`
          : days === 0
            ? `${name} expires today`
            : `${name} expires in ${days} day${days === 1 ? '' : 's'} (${dateFmt(l.expiration)})`,
      action: <AttentionButton onClick={() => showOptionLine(l.key)}>Show</AttentionButton>,
    })
  }
  if (pending.length > 0)
    attention.push({
      key: 'prices',
      text: (
        <>
          Waiting for a first price: <span className="font-medium">{pending.join(', ')}</span>. Until then they’re valued at average cost.
        </>
      ),
      action: <GetPricesButton symbols={pending} onDone={load} />,
    })
  for (const [i, x] of problems.entries())
    attention.push({
      key: `health-${x.check_name}-${x.item ?? ''}-${i}`,
      text: (
        <>
          Health check · {CHECK_LABEL[x.check_name] ?? x.check_name}
          {x.item && ` · ${x.item}`}: {x.detail}
        </>
      ),
      detail: x.fix,
      action: view !== 'activity' ? <AttentionButton onClick={() => changeView('activity')}>Open Activity</AttentionButton> : undefined,
    })

  const quickForm = (symbol: string) => (
    <QuickTrade
      key={formKey}
      portfolioId={p.id}
      views={snap.holdings}
      priceOf={priceOf}
      cash={snap.cash}
      setAside={snap.collateral}
      symbol={symbol}
      preset={preset}
      onDone={tradeDone}
      onCancel={() => showTrade(null)}
      onEscape={() => openTrade(null)}
      onDirtyChange={(d) => {
        dirty.current = d
      }}
    />
  )

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
            <DropMenu
              variant="primary"
              icon={<Plus size={16} />}
              groups={[
                { items: [{ label: 'Buy or sell', hint: 'Shares, one trade or several', onClick: startTrade }] },
                {
                  label: 'Cash',
                  items: [
                    { label: 'Deposit', onClick: () => openDrawer('deposit') },
                    { label: 'Withdraw', onClick: () => openDrawer('withdrawal') },
                    { label: 'Dividend', onClick: () => openDrawer('dividend') },
                    { label: 'Match broker balance', hint: 'Set cash to what your broker shows', onClick: () => openDrawer('balance') },
                  ],
                },
                { items: [{ label: 'Option', hint: 'Buy a call or put, or sell one', onClick: () => openDrawer('option') }] },
                {
                  label: 'More',
                  items: [
                    { label: 'Shares I already own', hint: 'Add them without spending cash', onClick: () => openDrawer('existing') },
                    { label: 'Transfer', hint: 'To another portfolio or broker', onClick: () => openDrawer('transfer') },
                    { label: 'Stock split', onClick: () => openDrawer('split') },
                  ],
                },
              ]}
            >
              Log
              <ChevronDown size={14} className="-mr-1 opacity-80" />
            </DropMenu>
          </>
        }
      />

      <AttentionStrip items={attention} />

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
            <CashCard
              label="Margin used"
              value={currency(-snap.cash)}
              sub={leverage !== null ? `${leverage.toFixed(2)}× leverage` : 'borrowed from your broker'}
              warning
              onClick={() => openDrawer('deposit')}
            />
          </div>
        ) : (
          <CashCard
            label="Cash"
            value={currency(snap.cash)}
            sub={snap.collateral > 0 ? `${currency(snap.cashAvailable)} free after puts` : 'available to invest'}
            onClick={() => openDrawer('deposit')}
          />
        )}
      </div>

      <Tabs<View>
        tabs={[
          { value: 'positions', label: 'Positions', count: snap.holdings.length + optionLines.length },
          { value: 'plan', label: 'Plan' },
          { value: 'performance', label: 'Performance' },
          { value: 'activity', label: 'Activity', count: activity.filter((a) => a.voided_at === null).length },
        ]}
        value={view}
        onChange={changeView}
      />

      {view === 'positions' && (
        <div className="flex flex-col gap-6">
          <Card
            title="Stocks & funds"
            subtitle={
              snap.holdings.length > 0 ? (
                <>
                  {`${snap.holdings.length} holding${snap.holdings.length === 1 ? '' : 's'} · ${currency(snap.holdingsValue)}`}
                  {planSummary &&
                    (planSummary.off === 0 ? (
                      <span className="text-emerald-300"> · on plan</span>
                    ) : (
                      <span className="text-amber-300">
                        {` · ${planSummary.off} off plan`}
                        {planSummary.buy > 0 && ` · buy ${currency(planSummary.buy)}`}
                        {planSummary.trim > 0 && ` · trim ${currency(planSummary.trim)}`}
                        {logAllLines.length > 0 && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              onClick={logAll}
                              title="Opens the form with one line per suggested buy or trim, sells first. Check the prices, then press Log."
                              className="rounded font-medium text-(--accent-text) underline decoration-dotted underline-offset-2 hover:decoration-solid"
                            >
                              Log all
                            </button>
                          </>
                        )}
                      </span>
                    ))}
                  {` · click a row to log a buy or sale${lastEntry ? ` · last entry ${dateFmt(centralDateStr(new Date(lastEntry)))}` : ''}`}
                </>
              ) : undefined
            }
            flush
            actions={
              snap.holdings.length > 0 ? (
                <>
                  {actions && (
                    <Button size="sm" variant={offOnly ? 'primary' : 'ghost'} onClick={toggleOffOnly} aria-pressed={offOnly}>
                      Off plan only
                    </Button>
                  )}
                  <Button size="sm" icon={<Plus size={14} />} onClick={startTrade}>
                    New ticker
                  </Button>
                </>
              ) : undefined
            }
          >
            {/* With "Off plan only" on, a chip's row may be hidden, so the chips don't link. */}
            <MoversStrip views={snap.holdings} asOf={snap.asOf} onShow={offOnly && actions ? undefined : (id) => setFocusHolding({ id })} />
            {snap.holdings.length === 0 ? (
              <>
                {trading !== null && <div className="border-y border-(--border) bg-(--accent-soft)/40 px-5 py-3">{quickForm(trading)}</div>}
                <EmptyState
                  icon={<Wallet size={20} />}
                  title="No holdings yet"
                  action={
                    <span className="flex flex-wrap justify-center gap-2">
                      <Button variant="primary" size="sm" onClick={() => openDrawer('existing')}>
                        Shares I already own
                      </Button>
                      <Button size="sm" onClick={startTrade}>
                        Buy or sell
                      </Button>
                    </span>
                  }
                >
                  Add shares you already hold without touching cash, or log a purchase paid from this portfolio’s cash.
                </EmptyState>
              </>
            ) : (
              <HoldingsTable
                views={snap.holdings}
                total={allocationTotal}
                dayLabel={dayChangeLabel(snap.asOf)}
                research={research.rows}
                onResearch={setResearchOpen}
                onSaved={load}
                trading={trading}
                onTrading={(symbol, pre) => openTrade(symbol, symbol !== null && pre ? [{ symbol, side: pre.side, qty: pre.qty }] : undefined)}
                renderTrade={quickForm}
                targets={planTargets}
                theses={theses}
                actions={actions}
                offOnly={offOnly}
                focus={focusHolding}
              />
            )}
          </Card>
          <OptionsCard
            options={options}
            csps={csps}
            prices={prices}
            holdings={holdings}
            onChanged={load}
            onAdd={(initial) => openDrawer('option', initial)}
            focus={focusLine}
          />
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
          <DividendsCard holdings={holdings} prices={prices} holdingsValue={snap.holdingsValue} portfolioId={p.id} onRecorded={load} showEmpty />
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
            research={research.rows}
            actions={actions}
            onBuy={(symbol, shares) => openTrade(symbol, [{ symbol, side: 'buy', qty: shares }])}
            onOpenTicker={setResearchOpen}
            onSaved={load}
          />
          <PlanNotesCard key={p.id} portfolio={p} onSaved={load} />
          <AccountAllocationCard portfolio={p} snap={snap} options={options} prices={prices} plan={plan} />
        </div>
      )}

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

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={drawer !== null ? `${LOG_TITLE[drawer]} · ${p.name}` : ''}
        subtitle={`Cash available ${currency(snap.cashAvailable)}`}
      >
        {drawer !== null && (
          <PortfolioActions
            // Deposit and Withdraw are one form, so switching between them keeps the amount.
            key={drawer === 'deposit' || drawer === 'withdrawal' ? 'cash-move' : drawer}
            portfolioId={p.id}
            otherPortfolios={allPortfolios.filter((x) => x.id !== p.id && !x.archived)}
            holdings={holdings}
            options={options}
            cashAvailable={snap.cashAvailable}
            cash={snap.cash}
            action={drawer}
            onAction={setDrawer}
            optionInitial={optionInitial}
            onDone={drawerDone}
          />
        )}
      </Drawer>
    </div>
  )
}

/** The Cash figure as a button: it looks like the other stat cards and opens the Deposit
 * form (which switches to Withdraw). On margin (negative cash) it shows what is borrowed, in
 * amber, with the leverage. */
function CashCard({ label, value, sub, warning = false, onClick }: { label: string; value: string; sub: string; warning?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative block h-full w-full overflow-hidden rounded-2xl border border-(--border) bg-(--card) p-4 text-left transition hover:border-(--accent)/50 focus-visible:border-(--accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-soft)"
    >
      <span className="block text-xs font-medium text-neutral-400">{label}</span>
      <span className={`mt-1.5 block break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl ${warning ? 'text-amber-300' : 'text-white'}`}>{value}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">
        <span className="min-w-0">{sub}</span>
        <span className="inline-flex items-center gap-0.5 font-medium text-(--accent-text) group-hover:underline">
          <Plus size={12} />
          Add or withdraw
        </span>
      </span>
    </button>
  )
}
