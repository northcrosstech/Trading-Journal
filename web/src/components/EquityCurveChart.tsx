import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import type { EquityPoint } from '../lib/metrics'

const axisTickCurrency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const currency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: EquityPoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <div className="text-neutral-400">
        {new Date(p.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
      <div className="mt-1 font-medium text-neutral-100">
        Cumulative: <span className="tabular-nums">{currency(p.cumulativeNetPnl)}</span>
      </div>
      <div className="text-neutral-400">
        {p.symbol}: <span className="tabular-nums">{currency(p.tradeNetPnl)}</span>
      </div>
      {p.feeSource === 'estimated' && (
        <div className="mt-1 text-amber-400/90">fee estimated, not yet confirmed</div>
      )}
    </div>
  )
}

export function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-neutral-500">
        No closed trades yet.
      </div>
    )
  }

  // A plain calendar-date x-axis collapses every point onto one tick when a range is
  // narrowed to a single day (e.g. "Today"/"Yesterday"), which reads as noise rather
  // than a curve. Use the real timestamp on a continuous scale instead, and format
  // ticks as time-of-day when every point falls on the same day, or as a date
  // otherwise -- so the axis stays meaningful at any zoom level.
  const sameDay = new Date(data[0].timestamp).toDateString() === new Date(data[data.length - 1].timestamp).toDateString()
  const tickFormatter = (ts: number) =>
    sameDay
      ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={tickFormatter}
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          stroke="var(--baseline)"
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          stroke="var(--baseline)"
          tickLine={false}
          tickFormatter={(v: number) => axisTickCurrency(v)}
          width={64}
        />
        <ReferenceLine y={0} stroke="var(--baseline)" />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1 }} />
        <Line
          type="monotone"
          dataKey="cumulativeNetPnl"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
