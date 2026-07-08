import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Trade } from '../lib/database.types'
import { computeDashboardMetrics, computeEquityCurve, computeCalendarDays } from '../lib/metrics'
import { StatCard } from '../components/StatCard'
import { EquityCurveChart } from '../components/EquityCurveChart'
import { PnlCalendarHeatmap } from '../components/PnlCalendarHeatmap'

const currency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function DashboardPage() {
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('trades')
      .select('*')
      .order('first_in_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setError(error.message)
          return
        }
        setTrades(data ?? [])
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load trades: {error}</div>
  }

  if (trades === null) {
    return <div className="text-neutral-500">Loading dashboard…</div>
  }

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-400">
        No trades synced yet. Once the worker runs, your dashboard will populate here.
      </div>
    )
  }

  const metrics = computeDashboardMetrics(trades)
  const equityData = computeEquityCurve(trades)
  const calendarData = computeCalendarDays(trades)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Dashboard</h1>
        {metrics.estimatedFeeTradeCount > 0 && (
          <p className="mt-1 text-xs text-amber-400/90">
            {metrics.estimatedFeeTradeCount} of {metrics.closedCount} closed trade
            {metrics.estimatedFeeTradeCount === 1 ? '' : 's'} still use estimated fees (actuals backfill in the
            background).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Total Net P&L"
          value={currency(metrics.totalNetPnl)}
          tone={metrics.totalNetPnl >= 0 ? 'good' : 'critical'}
        />
        <StatCard
          label="Win Rate"
          value={metrics.winRate === null ? '—' : `${(metrics.winRate * 100).toFixed(0)}%`}
          sub={`${metrics.closedCount} closed`}
        />
        <StatCard
          label="Profit Factor"
          value={
            metrics.profitFactor === null
              ? '—'
              : metrics.profitFactor === Infinity
                ? '∞'
                : metrics.profitFactor.toFixed(2)
          }
        />
        <StatCard
          label="Current Streak"
          value={metrics.currentStreak ? `${metrics.currentStreak.count} ${metrics.currentStreak.kind}${metrics.currentStreak.count > 1 ? 's' : ''}` : '—'}
          tone={metrics.currentStreak?.kind === 'win' ? 'good' : metrics.currentStreak?.kind === 'loss' ? 'critical' : 'neutral'}
        />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">Equity Curve</h2>
        <EquityCurveChart data={equityData} />
      </div>

      <PnlCalendarHeatmap daysByDate={calendarData} />
    </div>
  )
}
