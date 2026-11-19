import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, Rectangle, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, type BarShapeProps } from 'recharts'
import { fetchIncomeEntries } from '../lib/wealthQueries'
import type { IncomeEntry } from '../lib/income'
import { INCOME_FULL_MONTHS, incomeSince, incomeSummary, type IncomeMonth, type IncomeTotals } from '../lib/incomeSummary'
import { SLICE_COLORS } from '../lib/allocation'
import { monthLabel } from '../lib/networth'
import { centralDateStr, compactCurrency, currency } from '../lib/format'
import { Card } from './ui/Card'

type ChartMonth = IncomeMonth & { label: string }

const DIVIDEND_COLOR = 'var(--series-1)'
const PREMIUM_COLOR = SLICE_COLORS[1]
const AXIS = { fill: 'var(--text-muted)', fontSize: 11 }
const BAR_END: [number, number, number, number] = [4, 4, 0, 0]
const SEGMENT_GAP = 2
/** The month still running is drawn lighter, like other part-finished months in the app. */
const SO_FAR_OPACITY = 0.45

/** "Nov 2025" */
const monthYear = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** Axis label: the short month, with the year on the first bar and each January. */
const axisLabel = (month: string, first: boolean) => `${monthLabel(month, 'short')}${first || month.slice(5, 7) === '01' ? ` ’${month.slice(2, 4)}` : ''}`

/** Dividends sit on the baseline. With premium stacked on top the bar's rounded end is the
 * premium's, and a small gap separates the two. */
function DividendSegment(p: BarShapeProps) {
  const m = p.payload as ChartMonth
  const under = m.premium > 0 && m.dividends > 0
  const gap = under && p.height > SEGMENT_GAP + 1 ? SEGMENT_GAP : 0
  return <Rectangle {...p} y={p.y + gap} height={p.height - gap} radius={under ? 0 : BAR_END} fillOpacity={m.current ? SO_FAR_OPACITY : 1} />
}

/** Premium: above the dividends, or hanging below zero in a month more was bought back than sold. */
function PremiumSegment(p: BarShapeProps) {
  const m = p.payload as ChartMonth
  return <Rectangle {...p} radius={BAR_END} fillOpacity={m.current ? SO_FAR_OPACITY : 1} />
}

function IncomeTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartMonth }[] }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  const row = (label: string, v: number, color?: string) => (
    <div className="flex items-center justify-between gap-6 text-neutral-300">
      <span className="flex items-center gap-1.5">
        {color && <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />}
        {label}
      </span>
      <span className="tabular-nums">{currency(v)}</span>
    </div>
  )
  return (
    <div className="rounded-lg border border-(--border-strong) bg-(--card-raised) px-3 py-2 text-xs shadow-lg">
      <div className="text-neutral-400">
        {monthLabel(m.month)}
        {m.current && ' · so far'}
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {row('Dividends', m.dividends, DIVIDEND_COLOR)}
        {row('Option premium', m.premium, PREMIUM_COLOR)}
        <div className="mt-0.5 border-t border-(--border) pt-0.5 font-medium text-neutral-100">{row('Total', m.total)}</div>
      </div>
      {m.premium < 0 && <div className="mt-1 text-neutral-500">More was paid to buy options back than came in from selling them.</div>}
    </div>
  )
}

function Figure({ label, note, totals }: { label: string; note?: string; totals: IncomeTotals }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">
        {label}
        {note && <span className="text-neutral-600"> · {note}</span>}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{currency(totals.total)}</div>
      <div className="text-xs tabular-nums text-neutral-500">
        {currency(totals.dividends)} dividends · {currency(totals.premium)} premium
      </div>
    </div>
  )
}

const Swatch = ({ color, opacity = 1 }: { color: string; opacity?: number }) => <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color, opacity }} />

const TITLE = 'Income received'
const SUBTITLE = 'Dividends and option premium, month by month'

/** Income from investments across the given portfolios: dividends received and option
 * premium (net of buy-backs) for the last 12 full months and the current one, with the
 * year so far, the 12-month total and the monthly average. A new `refreshKey` reads the
 * entries again (after a dividend is recorded on the same page). */
export function IncomeCard({ portfolioIds, refreshKey = 0 }: { portfolioIds: Set<string>; refreshKey?: number }) {
  const today = centralDateStr(new Date())
  const since = incomeSince(today)
  const [entries, setEntries] = useState<IncomeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetchIncomeEntries(since)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [since, refreshKey])

  const mine = useMemo(() => (entries ?? []).filter((e) => portfolioIds.has(e.portfolio_id)), [entries, portfolioIds])
  const summary = useMemo(() => incomeSummary(mine, today), [mine, today])
  const bars: ChartMonth[] = summary.months.map((m, i) => ({ ...m, label: axisLabel(m.month, i === 0) }))

  if (error) return <Card title={TITLE}><p className="text-sm text-red-400">Couldn’t load income: {error}</p></Card>
  if (entries === null) return <Card title={TITLE} subtitle={SUBTITLE}><div className="h-44 animate-pulse rounded-xl bg-(--card-raised)" role="status" aria-label="Loading income" /></Card>
  if (mine.length === 0)
    return (
      <Card title={TITLE}>
        <p className="py-6 text-center text-sm text-neutral-500">
          No income recorded since {monthYear(summary.firstMonth)}. Dividends you record and premium from options you sell show up here, month by month.
        </p>
      </Card>
    )

  return (
    <Card title={TITLE} subtitle={SUBTITLE}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="grid shrink-0 grid-cols-3 gap-4 lg:w-72 lg:grid-cols-1 lg:gap-3">
          <Figure label={`${today.slice(0, 4)} so far`} totals={summary.yearToDate} />
          <Figure label="Last 12 months" note={`${monthYear(summary.firstMonth)} – ${monthYear(summary.lastFullMonth)}`} totals={summary.lastYear} />
          <Figure
            label="Average a month"
            note={summary.averagedMonths === INCOME_FULL_MONTHS ? 'same 12 months' : `since ${monthYear(summary.averagedFrom)}, your first income here`}
            totals={summary.monthlyAverage}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span className="flex items-center gap-1.5">
              <Swatch color={DIVIDEND_COLOR} /> dividends
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch color={PREMIUM_COLOR} /> option premium
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch color={DIVIDEND_COLOR} opacity={SO_FAR_OPACITY} /> this month so far
            </span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={bars} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid stroke="var(--gridline)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} stroke="var(--baseline)" tickLine={false} interval={0} />
              <YAxis tick={AXIS} stroke="var(--baseline)" tickLine={false} width={52} tickFormatter={(v: number) => compactCurrency(v)} />
              <ReferenceLine y={0} stroke="var(--baseline)" />
              <Tooltip content={<IncomeTooltip />} cursor={{ fill: 'var(--gridline)', opacity: 0.4 }} />
              <Bar dataKey="dividends" stackId="income" fill={DIVIDEND_COLOR} maxBarSize={32} shape={DividendSegment} />
              <Bar dataKey="premium" stackId="income" fill={PREMIUM_COLOR} maxBarSize={32} shape={PremiumSegment} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}
