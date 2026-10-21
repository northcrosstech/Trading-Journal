import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { Info } from 'lucide-react'
import type { InstallmentPayment, NetworthAccount, NetworthBalance, Portfolio, PortfolioActivity, PortfolioDailyValue } from '../lib/database.types'
import {
  fetchDailyValues,
  fetchExternalFlows,
  fetchInstallmentPayments,
  fetchNetworthAccounts,
  fetchNetworthBalances,
  fetchPortfolios,
} from '../lib/wealthQueries'
import { monthCashFlow, type MonthCashFlow } from '../lib/cashflow'
import { addMonths, monthLabel, monthOf } from '../lib/networth'
import { centralDateStr } from '../lib/format'
import { INPUT, INPUT_SM, toneClass } from '../lib/ui'
import { signedCurrency as signed } from '../lib/portfolio'
import { CloseMonthBanner } from '../components/CloseMonthBanner'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { Pill } from '../components/ui/Pill'
import { EmptyState } from '../components/ui/EmptyState'

type Flow = Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>
type Bar = MonthCashFlow & { label: string }

const axisCurrency = (n: number) => (Math.abs(n) >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`)

function KeptTooltip({ active, payload }: { active?: boolean; payload?: { payload: Bar }[] }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  const row = (label: string, v: number) => (
    <div className="flex justify-between gap-6">
      <span className="text-neutral-400">{label}</span>
      <span className={`tabular-nums ${toneClass(v)}`}>{signed(v)}</span>
    </div>
  )
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-neutral-300">
        {monthLabel(m.month)} {!m.complete && <span className="text-amber-400">· estimated</span>}
      </div>
      {row('Cash saved', m.cashSaved)}
      {row('Invested', m.invested)}
      {row('Debt paid down', m.debtPaidDown)}
      <div className="mt-1 flex justify-between gap-6 border-t border-neutral-800 pt-1 font-medium text-white">
        <span>Kept</span>
        <span className="tabular-nums">{signed(m.kept)}</span>
      </div>
    </div>
  )
}

/** Wealth → Cash flow: what you kept each month and where it went, derived only from your
 * month-end balances and portfolio deposits -- nothing extra to enter. */
export function CashFlowPage() {
  const today = centralDateStr(new Date())
  const currentMonth = monthOf(today)
  const [month, setMonth] = useState(addMonths(currentMonth, -1))
  const [year, setYear] = useState(Number(currentMonth.slice(0, 4)))
  const [accounts, setAccounts] = useState<NetworthAccount[] | null>(null)
  const [balances, setBalances] = useState<NetworthBalance[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [dailyValues, setDailyValues] = useState<PortfolioDailyValue[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [payments, setPayments] = useState<InstallmentPayment[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchNetworthAccounts(), fetchNetworthBalances(), fetchPortfolios(), fetchDailyValues(), fetchExternalFlows(), fetchInstallmentPayments()])
      .then(([a, b, p, v, f, ip]) => {
        setAccounts(a)
        setBalances(b)
        setPortfolios(p)
        setDailyValues(v)
        setFlows(f)
        setPayments(ip)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  const cf = useMemo(() => (accounts ? monthCashFlow(month, accounts, balances, portfolios, dailyValues, flows) : null), [month, accounts, balances, portfolios, dailyValues, flows])
  const bars = useMemo<Bar[]>(() => {
    if (!accounts) return []
    const out: Bar[] = []
    for (let m = 1; m <= 12; m++) {
      const mo = `${year}-${String(m).padStart(2, '0')}-01`
      if (mo > currentMonth) break
      const r = monthCashFlow(mo, accounts, balances, portfolios, dailyValues, flows)
      if (r.netWorthChange === 0 && r.kept === 0 && r.investmentGrowth === 0) continue
      out.push({ ...r, label: monthLabel(mo, 'short') })
    }
    return out
  }, [year, currentMonth, accounts, balances, portfolios, dailyValues, flows])
  const years = useMemo(() => {
    const first = Math.min(Number(currentMonth.slice(0, 4)), ...(accounts ?? []).map((a) => Number(a.opened_month.slice(0, 4))))
    const out: number[] = []
    for (let y = Number(currentMonth.slice(0, 4)); y >= first; y--) out.push(y)
    return out
  }, [accounts, currentMonth])

  if (error) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load cash flow: {error}</div>
  if (!accounts || !cf) return <div className="text-neutral-500">Loading cash flow…</div>

  const inProgress = month === currentMonth
  const maxAbs = Math.max(1, Math.abs(cf.kept), Math.abs(cf.investmentGrowth), Math.abs(cf.otherChanges), Math.abs(cf.netWorthChange))
  const bridge = [
    { label: 'Kept', sub: 'cash saved + invested + debt paid down', value: cf.kept },
    { label: 'Investment growth', sub: 'portfolio gains, not money you added', value: cf.investmentGrowth },
    { label: 'Other changes', sub: 'home / car values, manually entered retirement accounts, new accounts', value: cf.otherChanges },
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Cash flow"
        subtitle="Worked out from your month-end balances — nothing extra to enter."
        actions={
          <input
            type="month"
            value={month.slice(0, 7)}
            max={currentMonth.slice(0, 7)}
            onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)}
            className={`${INPUT} w-auto`}
            aria-label="Month"
          />
        }
      />

      <CloseMonthBanner accounts={accounts} balances={balances} payments={payments} />

      {accounts.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to work from yet">Add your accounts and monthly balances on Net worth — cash flow is worked out from them.</EmptyState>
        </Card>
      ) : (
        <>
          {(inProgress || !cf.complete) && (
            <div className="flex items-start gap-3 rounded-2xl border border-(--border) bg-(--card) px-4 py-3 text-sm text-neutral-300">
              <Info size={18} className="mt-0.5 shrink-0 text-(--accent-text)" />
              <span>
                {inProgress
                  ? `${monthLabel(month)} isn’t over yet — these figures settle once you enter month-end balances.`
                  : `Estimated: ${cf.carried.join(', ')} ${cf.carried.length === 1 ? 'uses a balance' : 'use balances'} carried from an earlier month, so part of the change may be missing.`}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={`Kept · ${monthLabel(month)}`} value={signed(cf.kept)} tone={cf.kept} sub="what you added to your wealth yourself" accent />
            <StatCard label="Cash saved" value={signed(cf.cashSaved)} tone={cf.cashSaved} sub="change in cash + emergency fund" />
            <StatCard label="Invested" value={signed(cf.invested)} tone={cf.invested} sub="deposits into portfolios" />
            <StatCard label="Debt paid down" value={signed(cf.debtPaidDown)} tone={cf.debtPaidDown} sub={cf.debtPaidDown < 0 ? 'debt grew this month' : 'loans and cards'} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <Card
              title={`Kept by month · ${year}`}
              subtitle="Cash saved + invested + debt paid down. Faded bars are estimates."
              className="xl:col-span-3"
              actions={
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${INPUT_SM} w-auto`} aria-label="Year">
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              }
            >
              {bars.length === 0 ? (
                <div className="flex h-56 items-center justify-center text-sm text-neutral-500">No months with balances in {year} yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                    <CartesianGrid stroke="var(--gridline)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} stroke="var(--baseline)" tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} stroke="var(--baseline)" tickLine={false} tickFormatter={axisCurrency} width={52} />
                    <ReferenceLine y={0} stroke="var(--baseline)" />
                    <Tooltip content={<KeptTooltip />} cursor={{ fill: 'var(--gridline)', opacity: 0.4 }} />
                    <Bar dataKey="kept" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {bars.map((b) => (
                        <Cell key={b.month} fill={b.kept >= 0 ? 'var(--status-good)' : 'var(--status-critical)'} fillOpacity={b.complete ? 1 : 0.4} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="How your net worth changed" subtitle={monthLabel(month)} className="xl:col-span-2">
              <div className="flex flex-col gap-3.5">
                {bridge.map((b) => (
                  <div key={b.label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-neutral-200">{b.label}</span>
                      <span className={`font-semibold tabular-nums ${toneClass(b.value)}`}>{signed(b.value)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className={`h-full rounded-full ${b.value >= 0 ? 'bg-(--status-good)' : 'bg-(--status-critical)'}`}
                        style={{ width: `${(Math.abs(b.value) / maxAbs) * 100}%` }}
                      />
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500">{b.sub}</div>
                  </div>
                ))}
                <div className="flex items-baseline justify-between border-t border-(--border) pt-3">
                  <span className="text-sm font-semibold text-white">Net worth change</span>
                  <span className={`text-lg font-semibold tabular-nums ${toneClass(cf.netWorthChange)}`}>{signed(cf.netWorthChange)}</span>
                </div>
              </div>
            </Card>
          </div>

          {bars.length > 0 && (
            <Card title={`Month by month · ${year}`} flush>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                      <th className="px-5 py-2.5">Month</th>
                      <th className="px-3 py-2.5 text-right">Cash saved</th>
                      <th className="px-3 py-2.5 text-right">Invested</th>
                      <th className="px-3 py-2.5 text-right">Debt paid down</th>
                      <th className="px-3 py-2.5 text-right">Kept</th>
                      <th className="px-3 py-2.5 text-right">Investment growth</th>
                      <th className="px-3 py-2.5 text-right">Net worth change</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...bars].reverse().map((b) => (
                      <tr
                        key={b.month}
                        onClick={() => setMonth(b.month)}
                        className={`cursor-pointer border-b border-(--border) last:border-0 hover:bg-white/2 ${b.month === month ? 'bg-(--accent-soft)/40' : ''}`}
                      >
                        <td className="px-5 py-2.5 font-medium text-neutral-100">{monthLabel(b.month)}</td>
                        {[b.cashSaved, b.invested, b.debtPaidDown].map((v, i) => (
                          <td key={i} className={`px-3 py-2.5 text-right tabular-nums ${toneClass(v)}`}>
                            {signed(v)}
                          </td>
                        ))}
                        <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${toneClass(b.kept)}`}>{signed(b.kept)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${toneClass(b.investmentGrowth)}`}>{signed(b.investmentGrowth)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${toneClass(b.netWorthChange)}`}>{signed(b.netWorthChange)}</td>
                        <td className="px-5 py-2.5 text-right">
                          {b.month === currentMonth ? <Pill tone="blue">In progress</Pill> : b.complete ? <Pill tone="green">Closed</Pill> : <Pill tone="amber">Estimated</Pill>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <p className="text-xs text-neutral-500">
            Why no income or spending? A balance is the net of everything that came in and went out, so income and spending can’t be told apart from
            balances alone — but what you kept can, exactly. Portfolio deposits count as invested, never as spending; shares you moved in and the month a
            portfolio was set up aren’t counted as new money. Day trading stays out of this entirely.
          </p>
        </>
      )}
    </div>
  )
}
