import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchTradesWithDetails } from '../lib/queries'
import type { TradeWithDetails } from '../lib/database.types'
import { computeEquityCurve } from '../lib/metrics'
import {
  summarize,
  plannedVsUnplanned,
  mistakeCost,
  bySetup,
  byTimeOfDay,
  byHoldTime,
  bySymbol,
  strengthStats,
  executionSummary,
  type ExecutionSummary,
  type GroupRow,
} from '../lib/insights'
import { rFmt } from '../lib/whatIf'
import { filterTradesByDateRange, presetRange, type DateRangePreset } from '../lib/dateRange'
import { currency } from '../lib/format'
import { DateRangePresetBar } from '../components/DateRangePresetBar'
import { EquityCurveChart } from '../components/EquityCurveChart'
import { MagnitudeBar } from '../components/MagnitudeBar'

function pnlClass(v: number | null) {
  if (v === null) return 'text-neutral-100'
  return v > 0 ? 'text-(--status-good)' : v < 0 ? 'text-(--status-critical)' : 'text-neutral-100'
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const ratio = (v: number | null) => (v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2))

function Kpi({ label, value, sub, tone = null }: { label: string; value: string; sub?: string; tone?: number | null }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${pnlClass(tone)}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-500">{sub}</div>}
    </div>
  )
}

function GroupTable({ title, hint, rows, footer }: { title: string; hint?: string; rows: GroupRow[]; footer?: GroupRow | null }) {
  const all = footer ? [...rows, footer] : rows
  const maxAbs = Math.max(1, ...all.map((r) => Math.abs(r.netPnl)))

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2">
        <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-neutral-600">Not enough data yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="pb-1.5 font-normal" />
              <th className="pb-1.5 text-right font-normal">Trades</th>
              <th className="pb-1.5 text-right font-normal">Win</th>
              <th className="pb-1.5 text-right font-normal">Avg</th>
              <th className="w-1/4 pb-1.5" />
              <th className="pb-1.5 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.key} className={`border-t border-neutral-800/60 ${r === footer ? 'text-neutral-400' : ''}`}>
                <td className="py-1.5 pr-2 text-neutral-200">{r.label}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-400">{r.count}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-400">{pct(r.winRate)}</td>
                <td className={`py-1.5 text-right tabular-nums ${pnlClass(r.expectancy)}`}>{currency(r.expectancy)}</td>
                <td className="px-3 py-1.5">
                  <MagnitudeBar value={r.netPnl} maxAbs={maxAbs} />
                </td>
                <td className={`py-1.5 text-right font-medium tabular-nums ${pnlClass(r.netPnl)}`}>{currency(r.netPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Plain-language takeaways from the review data -- the point of journaling is these
 * sentences, not the tables. */
function Takeaways({
  planned,
  mistakes,
  strengths,
  execution,
}: {
  planned: GroupRow[]
  mistakes: GroupRow[]
  strengths: GroupRow[]
  execution: ExecutionSummary
}) {
  const lines: { text: string; tone: 'good' | 'bad' }[] = []
  const p = planned.find((r) => r.key === 'planned')
  const u = planned.find((r) => r.key === 'unplanned')
  if (u && u.netPnl < 0) {
    lines.push({ text: `Unplanned trades cost you ${currency(Math.abs(u.netPnl))} over ${u.count} trade${u.count === 1 ? '' : 's'}.`, tone: 'bad' })
  }
  if (p && u && p.expectancy !== null && u.expectancy !== null && p.expectancy > u.expectancy) {
    lines.push({
      text: `A planned trade is worth ${currency(p.expectancy)} on average vs ${currency(u.expectancy)} unplanned. Trade your plan.`,
      tone: 'good',
    })
  }
  const worst = mistakes[0]
  if (worst && worst.netPnl < 0) {
    lines.push({ text: `Your costliest mistake is ${worst.label}: ${currency(worst.netPnl)} across ${worst.count} trade${worst.count === 1 ? '' : 's'}.`, tone: 'bad' })
  }
  const best = [...strengths].filter((r) => r.count >= 2).sort((a, b) => (b.expectancy ?? 0) - (a.expectancy ?? 0))[0]
  if (best && best.expectancy !== null && best.expectancy > 0) {
    lines.push({ text: `When you ${best.label.toLowerCase()}, a trade averages ${currency(best.expectancy)}. Do more of that.`, tone: 'good' })
  }
  const leaks = execution.byKind.left_on_table.total + execution.byKind.cost_of_ignoring_stop.total
  if (leaks > 0) {
    lines.push({ text: `Execution leaks: ${currency(leaks)} left vs your planned exits and stops.`, tone: 'bad' })
  }
  if (execution.rCaptured !== null) {
    lines.push({
      text: `You capture ${Math.round(execution.rCaptured * 100)}% of the R you plan for.`,
      tone: execution.rCaptured >= 0.8 ? 'good' : 'bad',
    })
  }

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-sm text-neutral-500">
        Review your trades (planned? done right? mistakes?) and this is where the lessons show up.{' '}
        <Link to="/journal" className="text-blue-400 hover:underline">
          Go to Journal
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      {lines.map((l) => (
        <div key={l.text} className="flex gap-2 text-sm">
          <span className={l.tone === 'bad' ? 'text-red-400' : 'text-emerald-400'}>{l.tone === 'bad' ? '▼' : '▲'}</span>
          <span className="text-neutral-200">{l.text}</span>
        </div>
      ))}
    </div>
  )
}

function ExecutionCard({ e }: { e: ExecutionSummary }) {
  const k = e.byKind
  const cell = (label: string, total: number, count: number, tone: string, hint?: string) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${count ? tone : 'text-neutral-600'}`}>{count ? currency(total) : '—'}</span>
      <span className="text-[11px] text-neutral-600">{count ? `${count} trade${count === 1 ? '' : 's'}` : (hint ?? 'none logged')}</span>
    </div>
  )
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-neutral-200">Execution</h2>
        <p className="text-xs text-neutral-500">From the stop / target / alt-exit prices you log in review. Cost of discipline is the price of good process, not a mistake.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        {cell('Left on table', k.left_on_table.total, k.left_on_table.count, 'text-(--status-critical)')}
        {cell('Ignored stops', k.cost_of_ignoring_stop.total, k.cost_of_ignoring_stop.count, 'text-(--status-critical)')}
        {cell('Saved by discipline', k.saved_by_discipline.total, k.saved_by_discipline.count, 'text-(--status-good)')}
        {cell('Cost of discipline', k.cost_of_discipline.total, k.cost_of_discipline.count, 'text-neutral-400')}
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Planned R</span>
          <span className="text-lg font-semibold tabular-nums text-neutral-100">{rFmt(e.avgPlannedR)}</span>
          <span className="text-[11px] text-neutral-600">avg target</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Realized R</span>
          <span className={`text-lg font-semibold tabular-nums ${pnlClass(e.avgRealizedR)}`}>{rFmt(e.avgRealizedR)}</span>
          <span className="text-[11px] text-neutral-600">{e.rTrades ? `${e.rTrades} trades with a stop` : 'log stops to see R'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">R captured</span>
          <span className="text-lg font-semibold tabular-nums text-neutral-100">{e.rCaptured === null ? '—' : `${Math.round(e.rCaptured * 100)}%`}</span>
          <span className="text-[11px] text-neutral-600">realized ÷ planned</span>
        </div>
      </div>
    </div>
  )
}

export function InsightsPage() {
  const { selectedAccountId } = useAccountFilter()
  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [preset, setPreset] = useState<DateRangePreset | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchTradesWithDetails(selectedAccountId).then((t) => !cancelled && setTrades(t))
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const filtered = useMemo(() => (trades ? filterTradesByDateRange(trades, presetRange(preset)) : []), [trades, preset])
  const s = useMemo(() => summarize(filtered), [filtered])
  const equity = useMemo(() => computeEquityCurve(filtered), [filtered])
  const planned = useMemo(() => plannedVsUnplanned(filtered), [filtered])
  const mistakes = useMemo(() => mistakeCost(filtered), [filtered])
  const setups = useMemo(() => bySetup(filtered), [filtered])
  const timeOfDay = useMemo(() => byTimeOfDay(filtered), [filtered])
  const hold = useMemo(() => byHoldTime(filtered), [filtered])
  const symbols = useMemo(() => bySymbol(filtered), [filtered])
  const strengths = useMemo(() => strengthStats(filtered), [filtered])
  const execution = useMemo(() => executionSummary(filtered), [filtered])

  if (trades === null) return <div className="text-neutral-500">Loading insights…</div>

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Insights</h1>
        <DateRangePresetBar value={preset} onChange={setPreset} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Net P&L" value={currency(s.netPnl)} sub={`${s.count} trades`} tone={s.netPnl} />
        <Kpi label="Win rate" value={pct(s.winRate)} />
        <Kpi label="Profit factor" value={ratio(s.profitFactor)} sub="gross win ÷ gross loss" />
        <Kpi
          label="Avg win / loss"
          value={ratio(s.payoffRatio)}
          sub={`${currency(s.avgWin)} / ${currency(s.avgLoss)}`}
        />
        <Kpi label="Expectancy" value={currency(s.expectancy)} sub="per trade" tone={s.expectancy} />
        <Kpi label="Max drawdown" value={currency(s.maxDrawdown)} tone={s.maxDrawdown < 0 ? -1 : null} />
      </div>

      <Takeaways planned={planned.rows} mistakes={mistakes.rows} strengths={strengths} execution={execution} />

      <ExecutionCard e={execution} />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-2 text-sm font-medium text-neutral-200">Equity curve</h2>
        <EquityCurveChart data={equity} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GroupTable
          title="Planned vs unplanned"
          hint={planned.untagged > 0 ? `${planned.untagged} trade${planned.untagged === 1 ? '' : 's'} not tagged yet` : undefined}
          rows={planned.rows}
        />
        <GroupTable title="What's working" hint="Net P&L of trades where you did it right" rows={strengths} />
        <GroupTable title="Cost of mistakes" hint="Net P&L of trades carrying each mistake" rows={mistakes.rows} footer={mistakes.clean} />
        <GroupTable title="By setup" rows={setups} />
        <GroupTable title="By time of day" hint="Entry time, Central" rows={timeOfDay} />
        <GroupTable title="By hold time" rows={hold} />
        <GroupTable title="By symbol" hint="Symbols with 3+ trades" rows={symbols} />
      </div>
    </div>
  )
}
