import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchTradesWithDetails, fetchPlaybooks, fetchTargetSettings, fetchDailyRules, fetchAllDailyRuleChecks } from '../lib/queries'
import type { TradeWithDetails, Playbook, TargetSettings, DailyRule } from '../lib/database.types'
import {
  computeStatsTiles,
  computeEquityCurve,
  computeDayOfWeekStats,
  computeHourOfDayStats,
  computePlaybookStats,
  computeSymbolStats,
  computeDailyTargetStats,
  computeTargetSummary,
  computeDailyRuleConsistency,
  type BucketStat,
} from '../lib/metrics'
import { filterTradesByDateRange, presetRange, type DateRangePreset } from '../lib/dateRange'
import { DateRangePresetBar } from '../components/DateRangePresetBar'
import { StatTile } from '../components/StatStripBar'
import { EquityCurveChart } from '../components/EquityCurveChart'
import { MagnitudeBar } from '../components/MagnitudeBar'
import { PlaybookChip } from '../components/PlaybookChip'
import { currency, percentFmt, holdTimeFmt } from '../lib/format'

function pf(v: number | null): string {
  return v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

function BucketTable({ title, buckets }: { title: string; buckets: BucketStat[] }) {
  const active = buckets.filter((b) => b.tradeCount > 0)
  const maxAbs = Math.max(1, ...active.map((b) => Math.abs(b.netPnl)))

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-300">{title}</h2>
      {active.length === 0 ? (
        <div className="py-6 text-center text-sm text-neutral-500">No data yet.</div>
      ) : (
        <div className="flex flex-col divide-y divide-neutral-800/60">
          {active.map((b) => (
            <div key={b.label} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="w-12 shrink-0 text-neutral-400">{b.label}</span>
              <span className="w-14 shrink-0 text-right text-xs text-neutral-500">{b.tradeCount} trd</span>
              <span className="w-12 shrink-0 text-right text-xs text-neutral-500">
                {b.winRate === null ? '—' : `${(b.winRate * 100).toFixed(0)}%`}
              </span>
              <MagnitudeBar value={b.netPnl} maxAbs={maxAbs} />
              <span
                className={`w-20 shrink-0 text-right text-xs font-medium tabular-nums ${b.netPnl >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}
              >
                {currency(b.netPnl)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupTable({
  title,
  rows,
}: {
  title: string
  rows: { key: string; label: ReactNode; tradeCount: number; netPnl: number; pnlPct: number | null; pnlContributionPct: number | null }[]
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">
        No closed trades for {title.toLowerCase()} yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300">{title}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-2"> </th>
            <th className="px-4 py-2 text-right">Trades</th>
            <th className="px-4 py-2 text-right">PnL %</th>
            <th className="px-4 py-2 text-right">Contribution %</th>
            <th className="px-4 py-2 text-right">PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-neutral-800/60 last:border-0">
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{r.tradeCount}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{percentFmt(r.pnlPct)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">
                {r.pnlContributionPct === null ? '—' : `${(r.pnlContributionPct * 100).toFixed(0)}%`}
              </td>
              <td
                className={`px-4 py-2 text-right font-medium tabular-nums ${r.netPnl >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}
              >
                {currency(r.netPnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StatsPage() {
  const { selectedAccountId } = useAccountFilter()
  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [targetSettings, setTargetSettings] = useState<TargetSettings | null>(null)
  const [preset, setPreset] = useState<DateRangePreset | null>(null)
  const [dailyRules, setDailyRules] = useState<DailyRule[]>([])
  const [dailyRuleChecks, setDailyRuleChecks] = useState<{ check_date: string; rule_id: string; checked: boolean }[]>([])

  useEffect(() => {
    fetchTradesWithDetails(selectedAccountId).then(setTrades)
    fetchPlaybooks().then((p) => setPlaybooks(p ?? []))
    fetchTargetSettings().then(setTargetSettings)
    fetchDailyRules().then(setDailyRules)
    fetchAllDailyRuleChecks().then(setDailyRuleChecks)
  }, [selectedAccountId])

  const filtered = useMemo(() => {
    if (!trades) return []
    return filterTradesByDateRange(trades, presetRange(preset))
  }, [trades, preset])

  const tiles = useMemo(() => computeStatsTiles(filtered), [filtered])
  const equityData = useMemo(() => computeEquityCurve(filtered), [filtered])
  const dayOfWeek = useMemo(() => computeDayOfWeekStats(filtered), [filtered])
  const hourOfDay = useMemo(() => computeHourOfDayStats(filtered), [filtered])
  const playbookStats = useMemo(() => computePlaybookStats(filtered, playbooks), [filtered, playbooks])
  const symbolStats = useMemo(() => computeSymbolStats(filtered), [filtered])
  const targetSummary = useMemo(
    () => computeTargetSummary(computeDailyTargetStats(filtered, targetSettings)),
    [filtered, targetSettings],
  )
  const ruleConsistency = useMemo(
    () => computeDailyRuleConsistency(dailyRuleChecks, dailyRules, presetRange(preset)),
    [dailyRuleChecks, dailyRules, preset],
  )

  if (trades === null) {
    return <div className="text-neutral-500">Loading stats…</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Stats</h1>
        <DateRangePresetBar value={preset} onChange={setPreset} />
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
        <StatTile label="Win Rate" value={tiles.winRate === null ? '—' : `${(tiles.winRate * 100).toFixed(0)}%`} />
        <StatTile label="Expectancy" value={tiles.expectancy === null ? '—' : currency(tiles.expectancy)} tone={tiles.expectancy !== null && tiles.expectancy >= 0 ? 'good' : 'critical'} />
        <StatTile label="Profit Factor" value={pf(tiles.profitFactor)} />
        <StatTile label="Avg Win Hold" value={holdTimeFmt(tiles.avgWinHoldSeconds)} />
        <StatTile label="Avg Loss Hold" value={holdTimeFmt(tiles.avgLossHoldSeconds)} />
        <StatTile label="Avg Win" value={tiles.avgWin === null ? '—' : currency(tiles.avgWin)} tone="good" />
        <StatTile label="Avg Loss" value={tiles.avgLoss === null ? '—' : currency(tiles.avgLoss)} tone="critical" />
        <StatTile label="Win Streak" value={String(tiles.maxWinStreak)} tone="good" />
        <StatTile label="Loss Streak" value={String(tiles.maxLossStreak)} tone="critical" />
        <StatTile label="Top Win" value={tiles.topWin === null ? '—' : currency(tiles.topWin)} tone="good" />
        <StatTile label="Top Loss" value={tiles.topLoss === null ? '—' : currency(tiles.topLoss)} tone="critical" />
        <StatTile label="Avg Daily Vol" value={tiles.avgDailyVolume === null ? '—' : tiles.avgDailyVolume.toFixed(1)} />
        <StatTile label="Avg Size" value={tiles.avgSize === null ? '—' : currency(tiles.avgSize)} />
        {dailyRules.length > 0 && (
          <StatTile
            label="Rules Followed"
            value={
              ruleConsistency.totalDays === 0
                ? '—'
                : `${ruleConsistency.allFollowedDays}/${ruleConsistency.totalDays} (${Math.round((ruleConsistency.allFollowedPct ?? 0) * 100)}%)`
            }
            tone="good"
          />
        )}
        {targetSettings?.profit_target_value !== null && targetSettings?.profit_target_value !== undefined && (
          <>
            <StatTile
              label="Target Hit"
              value={
                targetSummary.totalDays === 0
                  ? '—'
                  : `${targetSummary.hitDays}/${targetSummary.totalDays} (${Math.round((targetSummary.hitPct ?? 0) * 100)}%)`
              }
              tone="good"
            />
            <StatTile label="Gave It Back" value={String(targetSummary.gaveBackDays)} tone={targetSummary.gaveBackDays > 0 ? 'critical' : 'neutral'} />
          </>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">Equity Curve</h2>
        <EquityCurveChart data={equityData} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <BucketTable title="Performance by Day of Week" buckets={dayOfWeek} />
        <BucketTable title="Performance by Hour" buckets={hourOfDay} />
      </div>

      <GroupTable
        title="By Playbook"
        rows={playbookStats.map((s) => ({
          key: s.playbook.id,
          label: <PlaybookChip playbook={s.playbook} />,
          tradeCount: s.tradeCount,
          netPnl: s.netPnl,
          pnlPct: s.pnlPct,
          pnlContributionPct: s.pnlContributionPct,
        }))}
      />

      <GroupTable
        title="By Symbol"
        rows={symbolStats.map((s) => ({
          key: s.symbol,
          label: <span className="font-medium text-neutral-200">{s.symbol}</span>,
          tradeCount: s.tradeCount,
          netPnl: s.netPnl,
          pnlPct: s.pnlPct,
          pnlContributionPct: s.pnlContributionPct,
        }))}
      />
    </div>
  )
}
