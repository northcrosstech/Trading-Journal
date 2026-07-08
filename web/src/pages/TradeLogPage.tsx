import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchTradesWithDetails } from '../lib/queries'
import type { TradeWithDetails } from '../lib/database.types'
import { currency, holdTimeFmt, optionLabel, dateFmt, percentFmt } from '../lib/format'
import { returnOnCapitalPct } from '../lib/metrics'

type SortKey = 'date' | 'holdTime' | 'netPnl' | 'symbol' | 'returnPct'
type WinLossFilter = 'all' | 'win' | 'loss'
type DatePreset = 'today' | 'yesterday' | 'week'

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function presetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date()
  if (preset === 'today') {
    const today = toDateStr(now)
    return { from: today, to: today }
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const ys = toDateStr(y)
    return { from: ys, to: ys }
  }
  // 'week' -- Sunday through today, matching the dashboard calendar's week convention
  const start = new Date(now)
  start.setDate(start.getDate() - start.getDay())
  return { from: toDateStr(start), to: toDateStr(now) }
}

export function TradeLogPage() {
  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [symbolFilter, setSymbolFilter] = useState('')
  const [strategyFilter, setStrategyFilter] = useState<string>('all')
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

  const allStrategies = useMemo(() => {
    if (!trades) return []
    const map = new Map<string, string>()
    for (const t of trades) {
      for (const ts of t.trade_strategies) {
        if (ts.strategies) map.set(ts.strategies.id, ts.strategies.name)
      }
    }
    return Array.from(map.entries())
  }, [trades])

  const filtered = useMemo(() => {
    if (!trades) return []
    return trades.filter((t) => {
      if (symbolFilter && !t.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false
      if (strategyFilter !== 'all' && !t.trade_strategies.some((ts) => ts.strategy_id === strategyFilter)) return false
      if (winLossFilter === 'win' && !(t.status === 'CLOSED' && (t.realized_pnl_net ?? 0) > 0)) return false
      if (winLossFilter === 'loss' && !(t.status === 'CLOSED' && (t.realized_pnl_net ?? 0) < 0)) return false
      if (dateFrom && (!t.first_in_at || t.first_in_at.slice(0, 10) < dateFrom)) return false
      if (dateTo && (!t.first_in_at || t.first_in_at.slice(0, 10) > dateTo)) return false
      return true
    })
  }, [trades, symbolFilter, strategyFilter, winLossFilter, dateFrom, dateTo])

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
  const activeDatePreset = useMemo<DatePreset | null>(() => {
    for (const preset of ['today', 'yesterday', 'week'] as const) {
      const r = presetRange(preset)
      if (r.from === dateFrom && r.to === dateTo) return preset
    }
    return null
  }, [dateFrom, dateTo])

  function applyDatePreset(preset: DatePreset) {
    if (activeDatePreset === preset) {
      setDateFrom('')
      setDateTo('')
      return
    }
    const r = presetRange(preset)
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
          value={strategyFilter}
          onChange={(e) => setStrategyFilter(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        >
          <option value="all">All strategies</option>
          {allStrategies.map(([id, name]) => (
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
        <div className="flex overflow-hidden rounded-md border border-neutral-700">
          {(['today', 'yesterday', 'week'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => applyDatePreset(preset)}
              className={`px-3 py-1.5 text-sm transition ${
                activeDatePreset === preset ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : 'This Week'}
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
        {(symbolFilter || strategyFilter !== 'all' || winLossFilter !== 'all' || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setSymbolFilter('')
              setStrategyFilter('all')
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

      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="cursor-pointer select-none px-4 py-2.5" onClick={() => toggleSort('symbol')}>
                Symbol{sortIndicator('symbol')}
              </th>
              <th className="px-4 py-2.5">Contract</th>
              <th className="cursor-pointer select-none px-4 py-2.5" onClick={() => toggleSort('date')}>
                Entry{sortIndicator('date')}
              </th>
              <th className="px-4 py-2.5">Exit</th>
              <th className="cursor-pointer select-none px-4 py-2.5" onClick={() => toggleSort('holdTime')}>
                Hold{sortIndicator('holdTime')}
              </th>
              <th className="px-4 py-2.5">Tags</th>
              <th className="cursor-pointer select-none px-4 py-2.5 text-right" onClick={() => toggleSort('netPnl')}>
                Net P&L{sortIndicator('netPnl')}
              </th>
              <th className="cursor-pointer select-none px-4 py-2.5 text-right" onClick={() => toggleSort('returnPct')}>
                Return %{sortIndicator('returnPct')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const returnPct = returnOnCapitalPct(t)
              return (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/trades/${t.id}`)}
                  className="cursor-pointer border-b border-neutral-800/60 transition last:border-0 hover:bg-neutral-800/40"
                >
                  <td className="px-4 py-2.5 font-medium text-neutral-100">{t.symbol}</td>
                  <td className="px-4 py-2.5 text-neutral-300">
                    {optionLabel(t.options_detail?.strike, t.options_detail?.option_type)}
                    <span className="ml-1 text-xs text-neutral-500">{t.options_detail?.expiration}</span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400">{dateFmt(t.first_in_at)}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{t.status === 'CLOSED' ? dateFmt(t.last_out_at) : '—'}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{holdTimeFmt(t.hold_seconds)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {t.trade_strategies.map((ts) =>
                        ts.strategies ? (
                          <span key={ts.strategy_id} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                            {ts.strategies.name}
                          </span>
                        ) : null,
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {t.status === 'OPEN' ? (
                      <span className="text-neutral-500">OPEN</span>
                    ) : (
                      <span className={(t.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                        {currency(t.realized_pnl_net)}
                        {t.fee_source === 'estimated' && <span className="ml-0.5 text-amber-400/80" title="fee estimated">*</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
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
