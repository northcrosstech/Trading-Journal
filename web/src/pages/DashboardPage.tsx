import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import {
  fetchTrades,
  fetchAllDailyJournal,
  upsertDailyJournal,
  fetchTargetSettings,
  fetchTradesWithPlaybook,
  fetchTradesWithDetails,
  fetchPlaybooks,
  fetchAllPlaybookRules,
  fetchDailyPlan,
  fetchAllDailyPlans,
} from '../lib/queries'
import type {
  Trade,
  DailyJournal,
  TargetSettings,
  TradeWithPlaybook,
  TradeWithDetails,
  Playbook,
  PlaybookRule,
  DailyPlanWithPlaybooks,
} from '../lib/database.types'
import {
  computeEquityCurve,
  computeStatStrip,
  computeCalendarDays,
  computeDailyTargetStats,
  computePlanVsActual,
  computePlaybookRuleStats,
  computeMostExpensiveRule,
} from '../lib/metrics'
import { filterTradesByDateRange, presetRange, toDateStr, type DateRangePreset } from '../lib/dateRange'
import { DateRangePresetBar } from '../components/DateRangePresetBar'
import { StatStripBar } from '../components/StatStripBar'
import { EquityCurveChart } from '../components/EquityCurveChart'
import { PnlCalendarHeatmap } from '../components/PnlCalendarHeatmap'
import { RecentTradesList } from '../components/RecentTradesList'
import { TodayTargetBenchmark } from '../components/TodayTargetBenchmark'
import { TodayPlanCard } from '../components/TodayPlanCard'
import { MostExpensiveRuleCard } from '../components/MostExpensiveRuleCard'
import { DailyRulesChecklist } from '../components/DailyRulesChecklist'

export function DashboardPage() {
  const { user } = useAuth()
  const { selectedAccountId } = useAccountFilter()
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [journalByDate, setJournalByDate] = useState<Map<string, DailyJournal>>(new Map())
  const [targetSettings, setTargetSettings] = useState<TargetSettings | null>(null)
  const [preset, setPreset] = useState<DateRangePreset | null>(null)

  // Pre-market plan feature -- kept as its own state/effect, independent of the
  // trades/journal/target-settings fetch above, so nothing about the existing
  // dashboard load path changes.
  const [tradesWithPlaybook, setTradesWithPlaybook] = useState<TradeWithPlaybook[] | null>(null)
  const [allPlaybooks, setAllPlaybooks] = useState<Playbook[]>([])
  const [dailyPlan, setDailyPlan] = useState<DailyPlanWithPlaybooks | null>(null)
  const [plannedDates, setPlannedDates] = useState<Set<string>>(new Set())
  const todayStr = toDateStr(new Date())

  // Cross-playbook "most expensive broken rule" headline -- its own state/effect,
  // independent of the trades/journal/target-settings fetch above.
  const [tradesWithDetails, setTradesWithDetails] = useState<TradeWithDetails[] | null>(null)
  const [allPlaybookRules, setAllPlaybookRules] = useState<PlaybookRule[]>([])

  useEffect(() => {
    let cancelled = false
    fetchTradesWithPlaybook(selectedAccountId).then((t) => {
      if (!cancelled) setTradesWithPlaybook(t)
    })
    fetchPlaybooks().then((p) => {
      if (!cancelled) setAllPlaybooks(p ?? [])
    })
    fetchDailyPlan(todayStr).then((p) => {
      if (!cancelled) setDailyPlan(p)
    })
    fetchAllDailyPlans().then((plans) => {
      if (!cancelled) setPlannedDates(new Set(plans.map((p) => p.plan_date)))
    })
    fetchTradesWithDetails(selectedAccountId).then((t) => {
      if (!cancelled) setTradesWithDetails(t)
    })
    fetchAllPlaybookRules().then((r) => {
      if (!cancelled) setAllPlaybookRules(r)
    })
    return () => {
      cancelled = true
    }
  }, [todayStr, selectedAccountId])

  const handlePlanSaved = useCallback(
    (plan: DailyPlanWithPlaybooks) => {
      setDailyPlan(plan)
      setPlannedDates((prev) => (prev.has(plan.plan_date) ? prev : new Set(prev).add(plan.plan_date)))
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    fetchTrades(selectedAccountId)
      .then((data) => {
        if (!cancelled) setTrades(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
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
  }, [selectedAccountId])

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
  const today = targetsByDate.get(todayStr)
  const todayPlanComparison = tradesWithPlaybook ? computePlanVsActual(todayStr, tradesWithPlaybook, dailyPlan) : null
  const mostExpensiveRule = tradesWithDetails
    ? computeMostExpensiveRule(computePlaybookRuleStats(tradesWithDetails, allPlaybookRules))
    : null

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

      {user && todayPlanComparison && (
        <TodayPlanCard
          date={todayStr}
          userId={user.id}
          plan={dailyPlan}
          allPlaybooks={allPlaybooks}
          comparison={todayPlanComparison}
          onSaved={handlePlanSaved}
        />
      )}

      {user && <DailyRulesChecklist userId={user.id} date={todayStr} />}

      <StatStripBar stats={stripStats} />

      <MostExpensiveRuleCard stat={mostExpensiveRule} />

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
        plannedDates={plannedDates}
        onSaveNote={handleSaveNote}
      />
    </div>
  )
}
