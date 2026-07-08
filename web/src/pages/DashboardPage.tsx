import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fetchAllDailyJournal, upsertDailyJournal, fetchTargetSettings } from '../lib/queries'
import type { Trade, DailyJournal, TargetSettings } from '../lib/database.types'
import { computeEquityCurve, computeStatStrip, computeCalendarDays, computeDailyTargetStats } from '../lib/metrics'
import { filterTradesByDateRange, presetRange, toDateStr, type DateRangePreset } from '../lib/dateRange'
import { DateRangePresetBar } from '../components/DateRangePresetBar'
import { StatStripBar } from '../components/StatStripBar'
import { EquityCurveChart } from '../components/EquityCurveChart'
import { PnlCalendarHeatmap } from '../components/PnlCalendarHeatmap'
import { RecentTradesList } from '../components/RecentTradesList'
import { TodayTargetBenchmark } from '../components/TodayTargetBenchmark'

export function DashboardPage() {
  const { user } = useAuth()
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [journalByDate, setJournalByDate] = useState<Map<string, DailyJournal>>(new Map())
  const [targetSettings, setTargetSettings] = useState<TargetSettings | null>(null)
  const [preset, setPreset] = useState<DateRangePreset | null>(null)

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

    fetchAllDailyJournal().then((entries) => {
      if (cancelled) return
      setJournalByDate(new Map(entries.map((e) => [e.entry_date, e])))
    })

    fetchTargetSettings().then((s) => {
      if (!cancelled) setTargetSettings(s)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveNote = useCallback(
    (date: string, fields: { notes?: string; mood_rating?: number | null }) => {
      if (!user) return
      upsertDailyJournal(user.id, date, fields).then(() => {
        setJournalByDate((prev) => {
          const next = new Map(prev)
          const existing = next.get(date)
          next.set(date, {
            id: existing?.id ?? '',
            user_id: user.id,
            entry_date: date,
            notes: fields.notes ?? existing?.notes ?? null,
            mood_rating: fields.mood_rating !== undefined ? fields.mood_rating : (existing?.mood_rating ?? null),
            created_at: existing?.created_at ?? new Date().toISOString(),
          })
          return next
        })
      })
    },
    [user],
  )

  const filtered = useMemo(() => {
    if (!trades) return []
    return filterTradesByDateRange(trades, presetRange(preset))
  }, [trades, preset])

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

  const stripStats = computeStatStrip(filtered)
  const equityData = computeEquityCurve(filtered)
  const calendarData = computeCalendarDays(trades) // calendar is its own navigable view, unaffected by the range preset
  const targetsByDate = computeDailyTargetStats(trades, targetSettings) // all-time, same reasoning
  const today = targetsByDate.get(toDateStr(new Date()))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Dashboard</h1>
          {stripStats.estimatedFeeTradeCount > 0 && (
            <p className="mt-1 text-xs text-amber-400/90">
              {stripStats.estimatedFeeTradeCount} closed trade{stripStats.estimatedFeeTradeCount === 1 ? '' : 's'} still use
              estimated fees (actuals backfill in the background).
            </p>
          )}
        </div>
        <DateRangePresetBar value={preset} onChange={setPreset} />
      </div>

      {targetSettings && (
        <TodayTargetBenchmark
          settings={{ profit_target_value: targetSettings.profit_target_value, loss_limit_value: targetSettings.loss_limit_value }}
          today={today}
        />
      )}

      <StatStripBar stats={stripStats} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">Equity Curve</h2>
          <EquityCurveChart data={equityData} />
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <h2 className="mb-1 px-1 text-sm font-medium text-neutral-300">Recent Trades</h2>
          <RecentTradesList trades={trades} />
        </div>
      </div>

      <PnlCalendarHeatmap
        daysByDate={calendarData}
        journalByDate={journalByDate}
        targetsByDate={targetsByDate}
        onSaveNote={handleSaveNote}
      />
    </div>
  )
}
