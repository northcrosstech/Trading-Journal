import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchTradesWithDetails } from '../lib/queries'
import type { TradeWithDetails } from '../lib/database.types'
import { currency, priceFmt, holdTimeFmt, optionLabel, dateFmt, percentFmt } from '../lib/format'
import { returnOnCapitalPct, entrySizeUsd, exitSizeUsd } from '../lib/metrics'
import { DATE_RANGE_PRESETS, presetRange, type DateRangePreset } from '../lib/dateRange'

type SortKey = 'date' | 'holdTime' | 'netPnl' | 'symbol' | 'returnPct'
type WinLossFilter = 'all' | 'win' | 'loss'

/** Peak capital committed to the position -- the larger of what was deployed at
 * entry vs. exit (they can differ if size was added/trimmed along the way). */
function posSize(t: TradeWithDetails): number | null {
  const entry = entrySizeUsd(t)
  const exit = exitSizeUsd(t)
  if (entry === null) return exit
  if (exit === null) return entry
  return Math.max(entry, exit)
}

export function TradeLogPage() {
  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [symbolFilter, setSymbolFilter] = useState('')
  const [playbookFilter, setPlaybookFilter] = useState<string>('all')
  const [winLossFilter, setWinLossFilter] = useState<WinLossFilter>('all')
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(searchParams.get('to') ?? '')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    fetchTradesWithDetails()
      .then(setTrades)
      .catch((e) => setError(e.message))
  }, [])

  const allPlaybooks = useMemo(() => {
    if (!trades) return []
    const map = new Map<string, string>()
    for (const t of trades) {
      const linked = t.trade_playbooks?.playbooks
      if (linked) map.set(linked.id, linked.name)
    }
    return Array.from(map.entries())
  }, [trades])

  const filtered = useMemo(() => {
    if (!trades) return []
    return trades.filter((t) => {
      if (symbolFilter && !t.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false
      if (playbookFilter !== 'all' && t.trade_playbooks?.playbook_id !== playbookFilter) return false
      if (winLossFilter === 'win' && !(t.status === 'CLOSED' && (t.realized_pnl_net ?? 0) > 0)) return false
      if (winLossFilter === 'loss' && !(t.status === 'CLOSED' && (t.realized_pnl_net ?? 0) < 0)) return false
      if (dateFrom && (!t.first_in_at || t.first_in_at.slice(0, 10) < dateFrom)) return false
      if (dateTo && (!t.first_in_at || t.first_in_at.slice(0, 10) > dateTo)) return false
      return true
    })
  }, [trades, symbolFilter, playbookFilter, winLossFilter, dateFrom, dateTo])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'symbol':
          return a.symbol.localeCompare(b.symbol) * dir
        case 'holdTime':
          return ((a.hold_seconds ?? 0) - (b.hold_seconds ?? 0)) * dir
        case 'netPnl':
          return ((a.realized_pnl_net ?? 0) - (b.realized_pnl_net ?? 0)) * dir
        case 'returnPct':
          return ((returnOnCapitalPct(a) ?? 0) - (returnOnCapitalPct(b) ?? 0)) * dir
        case 'date':
        default:
          return (new Date(a.first_in_at ?? 0).getTime() - new Date(b.first_in_at ?? 0).getTime()) * dir
      }
    })
    return copy
  }, [filtered, sortKey, sortDir])

  // Day-grouping subtotals only make sense in chronological order -- grouping a
  // netPnl- or symbol-sorted list would scatter a single day's trades across
  // non-adjacent rows, so grouping is shown only while sorted by date.
  const dayGroups = useMemo(() => {
    if (sortKey !== 'date') return null
    const groups: { date: string; trades: TradeWithDetails[]; netPnl: number; closedCount: number }[] = []
    const indexByDate = new Map<string, number>()
    for (const t of sorted) {
      const date = t.status === 'CLOSED' ? t.last_out_at?.slice(0, 10) : t.first_in_at?.slice(0, 10)
      if (!date) continue
      let idx = indexByDate.get(date)
      if (idx === undefined) {
        idx = groups.length
        indexByDate.set(date, idx)
        groups.push({ date, trades: [], netPnl: 0, closedCount: 0 })
      }
      const group = groups[idx]
      group.trades.push(t)
      if (t.status === 'CLOSED') {
        group.netPnl += t.realized_pnl_net ?? 0
        group.closedCount += 1
      }
    }
    return groups
  }, [sorted, sortKey])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const summary = useMemo(() => {
    const closed = filtered.filter((t) => t.status === 'CLOSED')
    const net = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
    return { count: filtered.length, closedCount: closed.length, net }
  }, [filtered])

  // Derived, not stored -- avoids a separate "which preset is active" state going out
  // of sync with dateFrom/dateTo (e.g. if someone edits the date inputs directly).
  const activeDatePreset = useMemo<DateRangePreset | null>(() => {
    for (const { value } of DATE_RANGE_PRESETS) {
      const r = presetRange(value)
      if (r && r.from === dateFrom && r.to === dateTo) return value
    }
    return null
  }, [dateFrom, dateTo])

  function applyDatePreset(preset: DateRangePreset) {
    if (activeDatePreset === preset) {
      setDateFrom('')
      setDateTo('')
      return
    }
    const r = presetRange(preset)
    if (!r) return
    setDateFrom(r.from)
    setDateTo(r.to)
  }

  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load trades: {error}</div>
  }
  if (trades === null) {
    return <div className="text-neutral-500">Loading trades…</div>
  }

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')
  const COLUMN_COUNT = 13

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Trade Log</h1>
        <div className="text-sm text-neutral-400">
          {summary.count} trade{summary.count === 1 ? '' : 's'} · {summary.closedCount} closed ·{' '}
          <span className={summary.net >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
            {currency(summary.net)}
          </span>
        </div>
      </div>

      {/* filters -- one row, per dataviz interaction convention */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <input
          type="text"
          placeholder="Symbol…"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="w-28 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <select
          value={playbookFilter}
          onChange={(e) => setPlaybookFilter(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        >
          <option value="all">All playbooks</option>
          {allPlaybooks.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-md border border-neutral-700">
          {(['all', 'win', 'loss'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setWinLossFilter(v)}
              className={`px-3 py-1.5 text-sm capitalize transition ${
                winLossFilter === v ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap overflow-hidden rounded-md border border-neutral-700">
          {DATE_RANGE_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => applyDatePreset(p.value)}
              className={`px-2.5 py-1.5 text-xs font-medium transition ${
                activeDatePreset === p.value ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <span className="text-neutral-600">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        {(symbolFilter || playbookFilter !== 'all' || winLossFilter !== 'all' || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setSymbolFilter('')
              setPlaybookFilter('all')
              setWinLossFilter('all')
              setDateFrom('')
              setDateTo('')
            }}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="cursor-pointer select-none px-3 py-2.5" onClick={() => toggleSort('date')}>
                Date{sortIndicator('date')}
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5" onClick={() => toggleSort('symbol')}>
                Symbol{sortIndicator('symbol')}
              </th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Side</th>
              <th className="px-3 py-2.5 text-right">Qty</th>
              <th className="px-3 py-2.5 text-right">Entry</th>
              <th className="px-3 py-2.5 text-right">Exit</th>
              <th className="px-3 py-2.5 text-right">Ent Tot</th>
              <th className="px-3 py-2.5 text-right">Ext Tot</th>
              <th className="px-3 py-2.5 text-right">Pos</th>
              <th className="cursor-pointer select-none px-3 py-2.5" onClick={() => toggleSort('holdTime')}>
                Hold{sortIndicator('holdTime')}
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right" onClick={() => toggleSort('netPnl')}>
                Return{sortIndicator('netPnl')}
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right" onClick={() => toggleSort('returnPct')}>
                Return %{sortIndicator('returnPct')}
              </th>
            </tr>
          </thead>
          <tbody>
            {(dayGroups ?? [{ date: null, trades: sorted, netPnl: 0, closedCount: 0 }]).map((group) => (
              <Fragment key={group.date ?? 'all'}>
                {group.date && (
                  <tr className="border-b border-neutral-800/60 bg-neutral-800/30">
                    <td colSpan={11} className="px-3 py-1.5 text-xs font-medium text-neutral-400">
                      {dateFmt(group.date)}
                      <span className="ml-2 text-neutral-600">
                        {group.trades.length} trade{group.trades.length === 1 ? '' : 's'}
                        {group.closedCount > 0 ? ` · ${group.closedCount} closed` : ''}
                      </span>
                    </td>
                    <td colSpan={2} className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums">
                      {group.closedCount > 0 && (
                        <span className={group.netPnl >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                          {currency(group.netPnl)}
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {group.trades.map((t) => {
                  const returnPct = returnOnCapitalPct(t)
                  const date = t.status === 'CLOSED' ? t.last_out_at : t.first_in_at
                  const pos = posSize(t)
                  return (
                    <tr
                      key={t.id}
                      onClick={() => navigate(`/trades/${t.id}`)}
                      className="cursor-pointer border-b border-neutral-800/60 transition last:border-0 hover:bg-neutral-800/40"
                    >
                      <td className="px-3 py-2.5 text-neutral-400">{dateFmt(date)}</td>
                      <td className="px-3 py-2.5 font-medium text-neutral-100">
                        {t.symbol}
                        {t.options_detail && (
                          <span className="ml-1.5 text-xs font-normal text-neutral-500">
                            {optionLabel(t.options_detail.strike, t.options_detail.option_type)} {t.options_detail.expiration}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                            t.status === 'OPEN' ? 'bg-blue-950 text-blue-300' : 'bg-neutral-800 text-neutral-400'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 capitalize text-neutral-400">{t.side}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">{t.total_contracts ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">{priceFmt(t.avg_entry)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">
                        {t.status === 'CLOSED' ? priceFmt(t.avg_exit) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">{currency(entrySizeUsd(t))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                        {t.status === 'CLOSED' ? currency(exitSizeUsd(t)) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">{currency(pos)}</td>
                      <td className="px-3 py-2.5 text-neutral-400">{holdTimeFmt(t.hold_seconds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {t.status === 'OPEN' ? (
                          <span className="text-neutral-500">OPEN</span>
                        ) : (
                          <span className={(t.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                            {currency(t.realized_pnl_net)}
                            {t.fee_source === 'estimated' && <span className="ml-0.5 text-amber-400/80" title="fee estimated">*</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {t.status === 'OPEN' || returnPct === null ? (
                          <span className="text-neutral-500">—</span>
                        ) : (
                          <span className={returnPct >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                            {percentFmt(returnPct)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-4 py-8 text-center text-neutral-500">
                  No trades match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
