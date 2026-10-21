import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { useAuth } from '../auth/AuthContext'
import type { DividendFrequency, DividendInfo, Holding, PortfolioActivity } from '../lib/database.types'
import {
  deleteDividendInfo,
  fetchDividendInfo,
  fetchDividendsReceived,
  portfolioCash,
  saveDividendInfo,
  type SymbolPrice,
} from '../lib/wealthQueries'
import { FREQUENCIES, MONTHS, cycleLabel, dividendCalendar, dividendRows, receivedSince, type CalendarMonth, type DividendRow } from '../lib/dividends'
import { centralDateStr, currency, percentFmt } from '../lib/format'
import { INPUT_SM as INPUT } from '../lib/ui'
import { parseAmount, useDialog, validators } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Plus } from 'lucide-react'
const pct = (n: number | null) => (n === null ? '—' : percentFmt(n).replace('+', ''))

function CalendarTooltip({ active, payload }: { active?: boolean; payload?: { payload: CalendarMonth }[] }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <div className="text-neutral-400">
        {m.label} · {m.kind === 'received' ? 'received' : 'expected'}
      </div>
      {m.breakdown.length === 0 ? (
        <div className="mt-1 text-neutral-500">Nothing {m.kind === 'received' ? 'recorded' : 'expected'}</div>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5">
          {m.breakdown.map((b) => (
            <div key={b.symbol} className="flex justify-between gap-4 text-neutral-300">
              <span>{b.symbol}</span>
              <span className="tabular-nums">{currency(b.amount)}</span>
            </div>
          ))}
          <div className="mt-0.5 flex justify-between gap-4 border-t border-neutral-800 pt-0.5 font-medium text-neutral-100">
            <span>Total</span>
            <span className="tabular-nums">{currency(m.amount)}</span>
          </div>
        </div>
      )}
      {m.kind === 'received' && m.expected > 0 && <div className="mt-1 text-neutral-500">expected was {currency(m.expected)}</div>}
      {m.kind === 'expected' && m.received > 0 && <div className="mt-1 text-neutral-500">recorded so far {currency(m.received)}</div>}
    </div>
  )
}

/** One series (dividend income per month); bars for months gone by are solid (received),
 * the rest lighter (expected) -- explained in the key above the chart. */
function DividendCalendarChart({ data }: { data: CalendarMonth[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} stroke="var(--baseline)" tickLine={false} />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          stroke="var(--baseline)"
          tickLine={false}
          width={48}
          tickFormatter={(v: number) => `$${Math.round(v)}`}
        />
        <Tooltip content={<CalendarTooltip />} cursor={{ fill: 'var(--gridline)', opacity: 0.4 }} />
        <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={32}>
          {data.map((m) => (
            <Cell key={m.month} fill="var(--series-1)" fillOpacity={m.kind === 'received' ? 1 : 0.4} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function EditRow({ row, onSave, onRemove, onCancel }: { row: DividendRow; onSave: (d: Pick<DividendInfo, 'annual_per_share' | 'frequency' | 'pay_month'>) => void; onRemove: () => void; onCancel: () => void }) {
  const [annual, setAnnual] = useState(row.info ? String(Number(row.info.annual_per_share)) : '')
  const [frequency, setFrequency] = useState<DividendFrequency>(row.info?.frequency ?? 'quarterly')
  const [month, setMonth] = useState<number>(row.info?.pay_month ?? new Date().getMonth() + 1)
  const [error, setError] = useState<string | null>(null)

  function save() {
    const n = Number(annual.replace(/[$,\s]/g, ''))
    if (annual.trim() === '' || !Number.isFinite(n) || n < 0) return setError('Enter the yearly dividend per share, e.g. 6.88')
    onSave({ annual_per_share: n, frequency, pay_month: frequency === 'monthly' ? null : month })
  }

  return (
    <tr className="border-b border-(--border) bg-(--accent-soft)/40">
      <td className="px-5 py-3 font-semibold text-white">{row.symbol}</td>
      <td colSpan={8} className="px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="relative w-36">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
            <input autoFocus inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="per share / yr" className={`${INPUT} pl-6`} />
          </span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as DividendFrequency)} className={`${INPUT} w-auto`}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {frequency !== 'monthly' && (
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={`${INPUT} w-auto`} title="A month it pays in">
              {MONTHS.map((_, i) => (
                <option key={i} value={i + 1}>
                  {cycleLabel(frequency, i + 1)}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" variant="primary" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {row.info && (
            <Button size="sm" variant="ghost" onClick={onRemove} className="text-neutral-500 hover:text-red-300">
              Doesn't pay
            </Button>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </td>
    </tr>
  )
}

/** Projected dividend income: a Jan-Dec calendar (received for months gone by, expected
 * ahead), totals, and -- on a portfolio's page -- the per-ticker table where the yearly
 * dividend, frequency and pay month are entered once per ticker, plus one-tap Record.
 * `portfolioId` set = one portfolio (with Record); unset = all of `portfolioIds` combined --
 * the one place to set up every ticker's dividend. Either way a ticker's dividend is saved
 * once per user and applies to every portfolio holding it. */
export function DividendsCard({
  holdings,
  prices,
  holdingsValue,
  portfolioId,
  portfolioIds,
  onRecorded,
}: {
  holdings: Holding[]
  prices: Map<string, SymbolPrice>
  holdingsValue: number
  portfolioId?: string
  portfolioIds?: Set<string>
  onRecorded?: () => void
}) {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const today = centralDateStr(new Date())
  const year = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  const yearAgo = `${year - 1}${today.slice(4)}`
  const since = `${year - 1}${today.slice(4, 7)}-01` // covers both "this year" and "last 12 months"

  const [info, setInfo] = useState<Map<string, DividendInfo>>(new Map())
  const [received, setReceived] = useState<PortfolioActivity[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchDividendInfo(), fetchDividendsReceived(since, portfolioId)])
      .then(([i, r]) => {
        setInfo(new Map(i.map((d) => [d.symbol, d])))
        setReceived(portfolioIds ? r.filter((a) => portfolioIds.has(a.portfolio_id)) : r)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [since, portfolioId, portfolioIds])
  useEffect(load, [load])

  const rows = useMemo(() => dividendRows(holdings, info, prices, currentMonth), [holdings, info, prices, currentMonth])
  const calendar = useMemo(() => dividendCalendar(rows, received, year, currentMonth), [rows, received, year, currentMonth])
  const projected = rows.reduce((s, r) => s + r.perYear, 0)
  const receivedThisYear = receivedSince(received, `${year}-01-01`)
  const received12m = receivedSince(received, yearAgo)
  const singlePortfolio = !!portfolioId

  const run = (p: Promise<unknown>, after?: () => void, message?: string) =>
    p
      .then(() => {
        after?.()
        if (message) toast(message)
        load()
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))

  async function record(r: DividendRow) {
    if (!portfolioId) return
    const v = await dialog.form({
      title: `Record ${r.symbol} dividend`,
      description: 'Adds it to this portfolio’s cash as earnings.',
      submitLabel: 'Record dividend',
      fields: [
        { name: 'amount', label: 'Amount received', type: 'number', prefix: '$', defaultValue: r.perPayment.toFixed(2), validate: validators.positive },
        { name: 'on', label: 'Date', type: 'date', defaultValue: today },
      ],
    })
    if (!v) return
    const amount = parseAmount(v.amount)!
    run(portfolioCash({ portfolioId, kind: 'dividend', amount, symbol: r.symbol, on: v.on }), onRecorded, `Recorded ${r.symbol} dividend of ${currency(amount)}`)
  }

  if (holdings.length === 0) return null

  const configured = rows.filter((r) => r.info).length
  const stat = (label: string, value: string, sub?: string) => (
    <div className="rounded-xl bg-(--card-raised) px-3.5 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  )

  return (
    <Card
      title={singlePortfolio ? 'Dividends' : 'Dividends · all portfolios'}
      subtitle={
        singlePortfolio
          ? 'Each ticker’s dividend is set once and applies to every portfolio holding it.'
          : 'Set up each ticker’s dividend here once — every portfolio holding it uses it. Record payments on each portfolio’s page.'
      }
      flush
    >
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-4">
        {stat('Projected', `${currency(projected)}/yr`, `${configured} of ${rows.length} tickers set up`)}
        {stat('Per month', currency(projected / 12), 'on average')}
        {stat('Yield', holdingsValue > 0 && projected > 0 ? pct(projected / holdingsValue) : '—', 'on today’s value')}
        {stat('Received', currency(receivedThisYear), `${currency(received12m)} last 12 months`)}
      </div>

      <div className="px-5">
        <div className="mb-1 flex items-center justify-end gap-3 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'var(--series-1)' }} /> received
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'var(--series-1)', opacity: 0.4 }} /> expected
          </span>
        </div>
        <DividendCalendarChart data={calendar} />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <th className="px-5 py-2.5">Ticker</th>
              <th className="px-3 py-2.5 text-right">$/share/yr</th>
              <th className="px-3 py-2.5">Pays</th>
              <th className="px-3 py-2.5 text-right" title="Yearly dividend ÷ today's price">Yield</th>
              <th className="px-3 py-2.5 text-right" title="Yearly dividend ÷ your average cost">On cost</th>
              <th className="px-3 py-2.5 text-right">Shares</th>
              <th className="px-3 py-2.5 text-right">Per year</th>
              <th className="px-3 py-2.5 text-right">Next</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              editing === r.symbol ? (
                <EditRow
                  key={r.symbol}
                  row={r}
                  onCancel={() => setEditing(null)}
                  onSave={(d) => user && run(saveDividendInfo(user.id, { symbol: r.symbol, ...d }), () => setEditing(null), `${r.symbol} dividend saved`)}
                  onRemove={() => run(deleteDividendInfo(r.symbol), () => setEditing(null), `${r.symbol} marked as not paying`)}
                />
              ) : r.info ? (
                <tr key={r.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/2">
                  <td className="px-5 py-3 font-semibold text-white">{r.symbol}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-200">${Number(r.info.annual_per_share).toFixed(2)}</td>
                  <td className="px-3 py-3 text-neutral-300">
                    {FREQUENCIES.find((f) => f.value === r.info!.frequency)?.label}
                    <div className="text-xs text-neutral-500">{cycleLabel(r.info.frequency, r.info.pay_month)}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-200">{pct(r.yield)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-400">{pct(r.yieldOnCost)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-400">{Number(r.shares.toFixed(6))}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-white">{currency(r.perYear)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-200">
                    {r.nextMonth !== null && (
                      <>
                        {currency(r.perPayment)}
                        <div className="text-xs text-neutral-500">{MONTHS[r.nextMonth - 1]}</div>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="flex justify-end gap-1">
                      {singlePortfolio && (
                        <Button size="sm" variant="ghost" onClick={() => record(r)} className="text-(--accent-text)">
                          Record
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r.symbol)}>
                        Edit
                      </Button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={r.symbol} className="border-b border-(--border) last:border-0">
                  <td className="px-5 py-3 font-semibold text-neutral-400">{r.symbol}</td>
                  <td colSpan={8} className="px-3 py-3">
                    <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEditing(r.symbol)}>
                      Add dividend
                    </Button>
                    <span className="ml-1 text-xs text-neutral-600">— skip it if {r.symbol} doesn't pay one</span>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-(--border) px-5 py-3 text-xs text-neutral-500">
        Monthly bars split each ticker’s yearly amount evenly across its pay months; past months show what you recorded.
      </p>
      {error && <p className="px-5 pb-4 text-sm text-red-400">{error}</p>}
    </Card>
  )
}
