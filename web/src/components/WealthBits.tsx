import { centralDateStr, percentFmt } from '../lib/format'
import { timeWeightedReturn } from '../lib/portfolio'
import { StatCard } from './ui/StatCard'

/** Summary card used across Net worth and Portfolios -- the shared StatCard. */
export function Kpi({
  label,
  value,
  sub,
  tone,
  chip,
  chipTone,
  accent,
  warning,
}: {
  label: string
  value: string
  sub?: string
  tone?: number | null
  chip?: string
  chipTone?: number | null
  accent?: boolean
  warning?: boolean
}) {
  return <StatCard label={label} value={value} sub={sub} tone={tone} chip={chip} chipTone={chipTone} accent={accent} warning={warning} />
}

function ReturnCell({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="rounded-xl bg-(--card-raised) px-3.5 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          value === null ? 'text-neutral-600' : value > 0 ? 'text-(--status-good)' : value < 0 ? 'text-(--status-critical)' : 'text-neutral-200'
        }`}
      >
        {value === null ? '—' : percentFmt(value)}
      </div>
      {note && <div className="text-[11px] text-neutral-600">{note}</div>}
    </div>
  )
}

/** Time-weighted returns (deposits and withdrawals excluded) over the standard periods. */
export function ReturnsRow({ series }: { series: { date: string; total: number; netFlow: number }[] }) {
  const today = centralDateStr(new Date())
  const year = today.slice(0, 4)
  const oneYearAgo = `${Number(year) - 1}${today.slice(4)}`
  const ytd = timeWeightedReturn(series, `${Number(year) - 1}-12-31`)
  const oneYear = timeWeightedReturn(series, oneYearAgo)
  const all = timeWeightedReturn(series)
  const fullYear = all !== null && all.days >= 365

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReturnCell label="Year to date" value={ytd?.cumulative ?? null} />
        <ReturnCell label="Last 12 months" value={fullYear ? (oneYear?.cumulative ?? null) : null} note={fullYear ? undefined : 'needs a year of history'} />
        <ReturnCell label="Since start" value={all?.cumulative ?? null} note={all ? `${Math.round(all.days)} days` : undefined} />
        <ReturnCell label="Average per year" value={all?.annualized ?? null} note={all?.annualized == null ? 'not meaningful yet (< 1 year)' : undefined} />
      </div>
      <p className="mt-3 text-[11px] text-neutral-600">
        Time-weighted: measures how the investments did, ignoring money you added or took out. Built from each trading day's close.
      </p>
    </div>
  )
}
