import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import {
  fetchTradeWithDetails,
  fetchTrades,
  fetchPlaybooks,
  deleteManualTrade,
  markTradeExpiredWorthless,
  clearManualOverride,
} from '../lib/queries'
import type { Trade, TradeWithDetails, Playbook } from '../lib/database.types'
import { useTradeJournal } from '../lib/useTradeJournal'
import { TradeChart } from '../components/TradeChart'
import { TradeJournalPanel } from '../components/TradeJournalPanel'
import { currency, holdTimeFmt, optionLabel, dateFmt, dateTimeFmt, timeOnlyFmt, priceFmt, percentFmt, dteLabel } from '../lib/format'
import { returnOnCapitalPct, entrySizeUsd, exitSizeUsd, computeCostBasisAnalysis } from '../lib/metrics'

const ACTION_LABEL: Record<string, string> = { entry: 'Open', add: 'Add', trim: 'Trim', exit: 'Close' }

/** Same bucketing rule used everywhere else: closed trades sort by when the P&L
 * became real, open trades by when the position was entered. */
function navSortDate(t: Trade): string | null {
  return t.status === 'CLOSED' ? t.last_out_at : t.first_in_at
}

/** Persistent trade list so you can click straight through a review session instead
 * of going back to the Trade Log between every trade. Scoped to the current account
 * filter, newest first -- a lighter fetchTrades (no execution/playbook joins) since
 * this only ever renders a summary line per row. */
function TradeNavPanel({ currentTradeId }: { currentTradeId: string }) {
  const { selectedAccountId } = useAccountFilter()
  const [navTrades, setNavTrades] = useState<Trade[] | null>(null)
  const [filter, setFilter] = useState('')
  const currentRowRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchTrades(selectedAccountId).then((t) => {
      if (!cancelled) setNavTrades(t)
    })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const sorted = useMemo(() => {
    if (!navTrades) return []
    return [...navTrades].sort((a, b) => new Date(navSortDate(b) ?? 0).getTime() - new Date(navSortDate(a) ?? 0).getTime())
  }, [navTrades])

  const visible = filter.trim() ? sorted.filter((t) => t.symbol.toLowerCase().includes(filter.trim().toLowerCase())) : sorted

  // Keeps the current trade in view when navigating via the panel itself, without
  // fighting the page's own scroll position on first load.
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentTradeId])

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 lg:flex">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by symbol…"
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500"
      />
      <div className="sticky top-6 flex max-h-[calc(100vh-8rem)] flex-col gap-0.5 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-1.5">
        {navTrades === null && <div className="p-3 text-xs text-neutral-500">Loading…</div>}
        {navTrades !== null && visible.length === 0 && <div className="p-3 text-xs text-neutral-500">No trades match.</div>}
        {visible.map((t) => {
          const isCurrent = t.id === currentTradeId
          const date = navSortDate(t)
          return (
            <Link
              key={t.id}
              ref={isCurrent ? currentRowRef : undefined}
              to={`/trades/${t.id}`}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                isCurrent ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
              }`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{t.symbol}</span>
                <span className="text-[11px] text-neutral-500">{date ? dateFmt(date) : '—'}</span>
              </span>
              {t.status === 'CLOSED' ? (
                <span className={`shrink-0 tabular-nums ${(t.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
                  {currency(t.realized_pnl_net)}
                </span>
              ) : (
                <span className="shrink-0 text-neutral-600">OPEN</span>
              )}
            </Link>
          )
        })}
      </div>
    </aside>
  )
}

export function TradeDetailPage() {
  const { tradeId } = useParams<{ tradeId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [trade, setTrade] = useState<TradeWithDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingExpire, setConfirmingExpire] = useState(false)
  const [marking, setMarking] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [setups, setSetups] = useState<Playbook[]>([])

  const load = useCallback(async () => {
    if (!tradeId) return
    setTrade(await fetchTradeWithDetails(tradeId))
  }, [tradeId])

  useEffect(() => {
    load().catch((e) => setError(e.message))
    fetchPlaybooks().then((p) => setSetups(p ?? []))
  }, [load])

  const updateTrade = useCallback((_id: string, update: (t: TradeWithDetails) => TradeWithDetails) => {
    setTrade((t) => (t ? update(t) : t))
  }, [])
  const journal = useTradeJournal(trade, user?.id, updateTrade)

  async function handleDelete() {
    if (!tradeId) return
    setDeleting(true)
    try {
      await deleteManualTrade(tradeId)
      navigate('/trades')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  async function handleMarkExpiredWorthless() {
    if (!trade?.options_detail) return
    setMarking(true)
    try {
      await markTradeExpiredWorthless(trade, trade.options_detail.expiration)
      setConfirmingExpire(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMarking(false)
    }
  }

  async function handleClearOverride() {
    if (!tradeId) return
    setMarking(true)
    try {
      await clearManualOverride(tradeId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMarking(false)
    }
  }

  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>
  }
  if (!trade) {
    return <div className="text-neutral-500">Loading trade…</div>
  }

  const feeUsed = trade.fee_source === 'actual' ? trade.actual_fee : trade.estimated_fee
  const returnPct = returnOnCapitalPct(trade)
  const entrySize = entrySizeUsd(trade)
  const exitSize = exitSizeUsd(trade)
  const sortedExecutions = [...trade.executions].sort(
    (a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime(),
  )
  const costBasis = computeCostBasisAnalysis(trade)

  return (
    <div className="flex gap-5">
      <TradeNavPanel currentTradeId={trade.id} />
      <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trades
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-100">
            {trade.symbol} {optionLabel(trade.options_detail?.strike, trade.options_detail?.option_type)}
          </h1>
          {trade.options_detail && (
            <span className="text-sm text-neutral-500">{dteLabel(trade.first_in_at, trade.options_detail.expiration)}</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              trade.status === 'OPEN' ? 'bg-blue-950 text-blue-300' : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {trade.status}
          </span>
          {trade.trade_key === null && !confirmingDelete && (
            <>
              <Link to={`/trades/${trade.id}/edit`} className="text-xs text-blue-400 hover:underline">
                Edit
              </Link>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs text-neutral-500 hover:text-red-400 hover:underline"
              >
                Delete
              </button>
            </>
          )}
          {trade.trade_key === null && confirmingDelete && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-red-300">Delete this trade permanently?</span>
              <button type="button" onClick={handleDelete} disabled={deleting} className="text-red-400 hover:underline disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-neutral-500 hover:underline">
                Cancel
              </button>
            </span>
          )}
          {trade.status === 'OPEN' &&
            trade.options_detail &&
            new Date(trade.options_detail.expiration) < new Date() &&
            !confirmingExpire && (
              <button
                type="button"
                onClick={() => setConfirmingExpire(true)}
                className="text-xs text-amber-400 hover:underline"
              >
                Mark expired worthless
              </button>
            )}
          {confirmingExpire && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-amber-300">Close at $0, effective the expiration date?</span>
              <button
                type="button"
                onClick={handleMarkExpiredWorthless}
                disabled={marking}
                className="text-amber-400 hover:underline disabled:opacity-50"
              >
                {marking ? 'Closing…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setConfirmingExpire(false)} className="text-neutral-500 hover:underline">
                Cancel
              </button>
            </span>
          )}
          {trade.manually_closed && !confirmingExpire && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span title="This trade's outcome was set manually -- the broker sync won't overwrite it.">Manually closed</span>
              <button type="button" onClick={handleClearOverride} disabled={marking} className="text-blue-400 hover:underline disabled:opacity-50">
                Clear
              </button>
            </span>
          )}
        </div>
      </div>

      {/* stats row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Avg Entry"
          value={priceFmt(trade.avg_entry)}
          sub={<SizeSub contracts={trade.total_contracts} price={trade.avg_entry} size={entrySize} />}
        />
        <Stat
          label="Avg Exit"
          value={priceFmt(trade.avg_exit)}
          sub={<SizeSub contracts={trade.total_contracts} price={trade.avg_exit} size={exitSize} />}
        />
        <Stat
          label="Net P&L"
          value={currency(trade.realized_pnl_net)}
          tone={pnlTone(trade.realized_pnl_net)}
          sub={
            <>
              {returnPct !== null && (
                <>
                  <PctSpan value={returnPct} /> return ·{' '}
                </>
              )}
              fee {currency(feeUsed)}{' '}
              <span className={trade.fee_source === 'estimated' ? 'text-amber-400/80' : ''}>
                ({trade.fee_source === 'estimated' ? 'estimated' : 'confirmed'})
              </span>
            </>
          }
        />
        <Stat label="Hold Time" value={holdTimeFmt(trade.hold_seconds)} />
      </div>

      <TradeChart trade={trade} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* executions */}
        <div className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">Executions</h2>
          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2">Time (CT)</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Side</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right" title="Priced against the running average cost of the position at that moment; gross, before fees">
                    Realized
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedExecutions.map((e) => {
                  const trim = costBasis.trimResults.get(e.id)
                  return (
                    <tr key={e.id} className="border-b border-neutral-800/60 last:border-0">
                      <td className="px-4 py-2 text-neutral-400" title={dateTimeFmt(e.filled_at)}>
                        {timeOnlyFmt(e.filled_at)}
                      </td>
                      <td className="px-4 py-2 text-neutral-200">{ACTION_LABEL[e.action] ?? e.action}</td>
                      <td className="px-4 py-2 capitalize text-neutral-400">{e.side}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{e.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{priceFmt(e.price)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {trim ? (
                          <span className={trim.realizedDollarGross >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                            {currency(trim.realizedDollarGross)}
                            {trim.realizedPct !== null && <span className="ml-1 text-neutral-500">({percentFmt(trim.realizedPct)})</span>}
                          </span>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">Review</h2>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <TradeJournalPanel trade={trade} journal={journal} setups={setups} />
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

function pnlTone(v: number | null): 'good' | 'critical' | 'neutral' {
  if (v === null) return 'neutral'
  return v >= 0 ? 'good' : 'critical'
}

function PctSpan({ value }: { value: number }) {
  return <span className={value >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>{percentFmt(value)}</span>
}

/** "3 × $5.81 = $1,743.00" -- the position-size total is the point, so it's the only
 * part that's brightened/bolded; the contracts × price factors stay muted context. */
function SizeSub({ contracts, price, size }: { contracts: number | null; price: number | null; size: number | null }) {
  if (contracts === null || price === null || size === null) return null
  return (
    <>
      {contracts} × {priceFmt(price)} = <span className="font-semibold text-neutral-300">{currency(size)}</span>
    </>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
  sub,
}: {
  label: string
  value: string
  tone?: 'good' | 'critical' | 'neutral'
  sub?: ReactNode
}) {
  const toneClass = tone === 'good' ? 'text-(--status-good)' : tone === 'critical' ? 'text-(--status-critical)' : 'text-neutral-100'
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-600">{sub}</div>}
    </div>
  )
}
