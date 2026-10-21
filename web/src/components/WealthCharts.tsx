import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { currency, percentFmt } from '../lib/format'

const axisCurrency = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 1_000
      ? `$${Math.round(n / 1_000)}k`
      : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const AXIS = { fill: 'var(--text-muted)', fontSize: 11 }

export type NetWorthBar = { month: string; label: string; net: number; assets: number; debts: number }

function NetWorthTooltip({ active, payload }: { active?: boolean; payload?: { payload: NetWorthBar }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <div className="text-neutral-400">{p.label}</div>
      <div className="mt-1 font-medium text-neutral-100">
        Net worth: <span className="tabular-nums">{currency(p.net)}</span>
      </div>
      <div className="text-neutral-400">
        Assets <span className="tabular-nums text-neutral-300">{currency(p.assets)}</span> · Debts{' '}
        <span className="tabular-nums text-neutral-300">{currency(p.debts)}</span>
      </div>
    </div>
  )
}

/** One bar per month -- net worth is the single series, so no legend; assets and debts
 * are in the tooltip rather than as extra series on the same axis. */
export function NetWorthChart({ data }: { data: NetWorthBar[] }) {
  if (data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-neutral-500">No balances entered for this year yet.</div>
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke="var(--baseline)" tickLine={false} />
        <YAxis tick={AXIS} stroke="var(--baseline)" tickLine={false} tickFormatter={axisCurrency} width={60} />
        <ReferenceLine y={0} stroke="var(--baseline)" />
        <Tooltip content={<NetWorthTooltip />} cursor={{ fill: 'var(--gridline)', opacity: 0.4 }} />
        <Bar dataKey="net" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export type ValuePoint = { date: string; total: number }

function ValueTooltip({ active, payload }: { active?: boolean; payload?: { payload: ValuePoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <div className="text-neutral-400">{new Date(`${p.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      <div className="mt-1 font-medium tabular-nums text-neutral-100">{currency(p.total)}</div>
    </div>
  )
}

/** Daily portfolio value -- one line. */
export function ValueHistoryChart({ data }: { data: ValuePoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-center text-sm text-neutral-500">
        The value history builds up from the daily close — check back after a couple of trading days.
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS}
          stroke="var(--baseline)"
          tickLine={false}
          minTickGap={40}
          tickFormatter={(d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        />
        <YAxis tick={AXIS} stroke="var(--baseline)" tickLine={false} tickFormatter={axisCurrency} width={60} domain={['auto', 'auto']} />
        <Tooltip content={<ValueTooltip />} cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1 }} />
        <Line type="monotone" dataKey="total" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export type AllocationRow = { key: string; label: string; sub?: string; value: number }

/** Share of the total, largest first: one bar per row in a single hue (the row label
 * carries identity), which reads close values far better than a donut. */
export function AllocationList({ rows, total }: { rows: AllocationRow[]; total: number }) {
  if (rows.length === 0 || total <= 0) return <p className="text-sm text-neutral-500">Nothing to allocate yet.</p>
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value)
  return (
    <table className="w-full text-sm">
      <tbody>
        {sorted.map((r) => {
          const share = r.value / total
          return (
            <tr key={r.key} className="border-b border-neutral-800/60 last:border-0">
              <td className="w-28 py-1.5 pr-2">
                <div className="font-medium text-neutral-200">{r.label}</div>
                {r.sub && <div className="text-[11px] text-neutral-500">{r.sub}</div>}
              </td>
              <td className="py-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, backgroundColor: 'var(--series-1)' }} />
                </div>
              </td>
              <td className="w-16 py-1.5 pl-3 text-right tabular-nums text-neutral-300">{percentFmt(share).replace('+', '')}</td>
              <td className="w-24 py-1.5 pl-3 text-right tabular-nums text-neutral-500">{currency(r.value)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
