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

const INPUT = 'rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-blue-500'
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
    <tr className="border-b border-neutral-800/60 bg-neutral-950/40">
      <td className="py-2 pr-2 font-medium text-neutral-100">{row.symbol}</td>
      <td colSpan={8} className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
            <input autoFocus inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="per share / yr" className={`${INPUT} w-32 pl-5`} />
          </span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as DividendFrequency)} className={INPUT}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {frequency !== 'monthly' && (
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={INPUT} title="A month it pays in">
              {MONTHS.map((_, i) => (
                <option key={i} value={i + 1}>
                  {cycleLabel(frequency, i + 1)}
                </option>
              ))}
            </select>
          )}
          <button onClick={save} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500">
            Save
          </button>
          <button onClick={onCancel} className="text-xs text-neutral-500 hover:text-neutral-300">
            Cancel
          </button>
          {row.info && (
            <button onClick={onRemove} className="text-xs text-neutral-600 hover:text-red-400">
              Doesn't pay
            </button>
          )}
          {error && <span className="text-xs text-(--status-critical)">{error}</span>}
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

  const run = (p: Promise<unknown>, after?: () => void) =>
    p
      .then(() => {
        after?.()
        load()
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))

  function record(r: DividendRow) {
    if (!portfolioId) return
    const raw = window.prompt(`${r.symbol} dividend received — amount`, r.perPayment.toFixed(2))
    if (raw === null) return
    const amount = Number(raw.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter the amount received.')
    run(portfolioCash({ portfolioId, kind: 'dividend', amount, symbol: r.symbol, on: today }), onRecorded)
  }

  if (holdings.length === 0) return null

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-200">Dividends{!singlePortfolio && ' · all portfolios'}</h2>
        <span className="text-xs text-neutral-500">
          Projected <span className="tabular-nums text-neutral-200">{currency(projected)}</span>/yr ·{' '}
          <span className="tabular-nums text-neutral-200">{currency(projected / 12)}</span>/mo
          {holdingsValue > 0 && projected > 0 && <> · {pct(projected / holdingsValue)} yield</>}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
        <span>
          Received {currency(receivedThisYear)} this year · {currency(received12m)} last 12 months
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--series-1)' }} /> received
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--series-1)', opacity: 0.4 }} /> expected
          </span>
        </span>
      </div>

      <DividendCalendarChart data={calendar} />

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="py-1.5 pr-2">Ticker</th>
              <th className="py-1.5 pr-2 text-right">$/share/yr</th>
              <th className="py-1.5 pr-2">Pays</th>
              <th className="py-1.5 pr-2 text-right" title="Yearly dividend ÷ today's price">Yield</th>
              <th className="py-1.5 pr-2 text-right" title="Yearly dividend ÷ your average cost">On cost</th>
              <th className="py-1.5 pr-2 text-right">Shares</th>
              <th className="py-1.5 pr-2 text-right">Per year</th>
              <th className="py-1.5 pr-2 text-right">Next</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              editing === r.symbol ? (
                <EditRow
                  key={r.symbol}
                  row={r}
                  onCancel={() => setEditing(null)}
                  onSave={(d) => user && run(saveDividendInfo(user.id, { symbol: r.symbol, ...d }), () => setEditing(null))}
                  onRemove={() => run(deleteDividendInfo(r.symbol), () => setEditing(null))}
                />
              ) : r.info ? (
                <tr key={r.symbol} className="border-b border-neutral-800/60 last:border-0">
                  <td className="py-2 pr-2 font-medium text-neutral-100">{r.symbol}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">${Number(r.info.annual_per_share).toFixed(2)}</td>
                  <td className="py-2 pr-2 text-xs text-neutral-400" title={cycleLabel(r.info.frequency, r.info.pay_month)}>
                    {FREQUENCIES.find((f) => f.value === r.info!.frequency)?.label}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">{pct(r.yield)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{pct(r.yieldOnCost)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{r.shares}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-100">{currency(r.perYear)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">
                    {r.nextMonth !== null && (
                      <>
                        <span className="text-neutral-500">{MONTHS[r.nextMonth - 1]}</span> {currency(r.perPayment)}
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <span className="flex justify-end gap-2 text-xs">
                      {singlePortfolio && (
                        <button onClick={() => record(r)} className="text-blue-400 hover:text-blue-300">
                          Record
                        </button>
                      )}
                      <button onClick={() => setEditing(r.symbol)} className="text-neutral-600 hover:text-neutral-300">
                        Edit
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={r.symbol} className="border-b border-neutral-800/60 last:border-0">
                  <td className="py-2 pr-2 font-medium text-neutral-500">{r.symbol}</td>
                  <td colSpan={8} className="py-2">
                    <button onClick={() => setEditing(r.symbol)} className="text-xs text-neutral-500 hover:text-neutral-300">
                      + add dividend <span className="text-neutral-600">(leave it if {r.symbol} doesn't pay)</span>
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-neutral-600">
          {singlePortfolio ? 'Enter each ticker’s dividend once — it applies to every portfolio holding it.' : 'Set up each ticker here once — every portfolio holding it uses it. Record payments on the portfolio’s own page.'} Monthly bars split the yearly amount evenly across its pay months; past months show what you recorded.
        </p>
      </div>
      {error && <p className="mt-2 text-xs text-(--status-critical)">{error}</p>}
    </div>
  )
}
