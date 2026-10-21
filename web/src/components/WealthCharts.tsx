import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { useState } from 'react'
import { SLICE_THRESHOLD, type Allocation, type Slice } from '../lib/allocation'
import { currency } from '../lib/format'

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
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <Area type="monotone" dataKey="total" stroke="var(--series-1)" strokeWidth={2} fill="url(#valueFill)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

const pctOf = (w: number) => `${(w * 100).toFixed(1)}%`

function SliceTooltip({ active, payload }: { active?: boolean; payload?: { payload: Slice }[] }) {
  if (!active || !payload?.length) return null
  const s = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-neutral-100">
        {s.label} · {pctOf(s.weight)}
      </div>
      <div className="tabular-nums text-neutral-400">{currency(s.value)}</div>
      {s.role === 'other' && s.members.length > 1 && (
        <div className="mt-1 text-neutral-400">{s.members.map((m) => m.label).join(', ')}</div>
      )}
    </div>
  )
}

function Swatch({ color, small = false }: { color: string; small?: boolean }) {
  return <span className={`inline-block shrink-0 rounded-full ${small ? 'h-1.5 w-1.5' : 'h-3 w-3'}`} style={{ backgroundColor: color }} />
}

/** Allocation donut: positions at 5%+ get their own color, smaller ones share a grey
 * "Other" slice, cash is its own neutral slice; total in the center. The legend beside it
 * lists every holding -- including each one inside Other -- with weight and value, so no
 * position is ever hidden and identity never rests on color alone. Hovering a legend row
 * highlights its slice and vice versa. */
export function AllocationDonut({ allocation, centerLabel = 'Total' }: { allocation: Allocation; centerLabel?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const { total, slices } = allocation
  if (slices.length === 0) return <p className="text-sm text-neutral-500">Nothing to allocate yet.</p>
  const dim = (key: string) => (hover !== null && hover !== key ? 0.35 : 1)

  return (
    <div className="@container">
    <div className="flex flex-col items-center gap-5 @lg:flex-row @lg:items-center">
      <div className="relative h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="#141416"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setHover(slices[i].key)}
              onMouseLeave={() => setHover(null)}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} fillOpacity={dim(s.key)} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-neutral-500">{centerLabel}</span>
          <span className="text-lg font-semibold tabular-nums text-white">{compactUsd(total)}</span>
        </div>
      </div>

      <div className="w-full min-w-0 flex-1 text-sm">
        {slices.map((s) => (
          <div key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} className="rounded-lg px-2 hover:bg-(--card-raised)">
            <div className="flex items-center gap-2.5 py-1.5">
              <Swatch color={s.color} />
              <span className="min-w-0 flex-1 break-words font-medium text-neutral-100">
                {s.role === 'other' && s.members.length > 1 ? `Other (${s.members.length})` : s.label}
              </span>
              <span className="w-14 text-right tabular-nums text-neutral-300">{pctOf(s.weight)}</span>
              <span className="w-24 text-right tabular-nums text-neutral-500">{currency(s.value)}</span>
            </div>
            {s.role === 'other' &&
              s.members.length > 1 &&
              s.members.map((m) => (
                <div key={m.key} className="flex items-center gap-2 py-0.5 pl-4 text-xs">
                  <Swatch color={s.color} small />
                  <span className="min-w-0 flex-1 break-words text-neutral-400">{m.label}</span>
                  <span className="w-14 text-right tabular-nums text-neutral-500">{pctOf(m.value / total)}</span>
                  <span className="w-24 text-right tabular-nums text-neutral-600">{currency(m.value)}</span>
                </div>
              ))}
            {s.role === 'cash' && s.members[0] && <div className="pb-1 pl-4.5 text-[11px] text-neutral-500">{s.members[0].label}</div>}
          </div>
        ))}
        <p className="mt-2 px-2 text-[11px] text-neutral-600">Positions under {Math.round(SLICE_THRESHOLD * 100)}% are grouped as Other.</p>
      </div>
    </div>
    </div>
  )
}

const compactUsd = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : Math.abs(n) >= 10_000 ? `$${(n / 1_000).toFixed(1)}k` : currency(n)
