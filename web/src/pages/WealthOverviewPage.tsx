import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Landmark, PieChart } from 'lucide-react'
import type { DividendInfo, InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { fetchDividendInfo, fetchInstallmentPayments, fetchNetworthAccounts, fetchNetworthBalances } from '../lib/wealthQueries'
import { CloseMonthBanner } from '../components/CloseMonthBanner'
import { addMonths, categoryLabel, isDebt, monthLabel, monthOf, monthTotals, yearTotals } from '../lib/networth'
import { KIND_TONE, kindLabel, signedCurrency as signed } from '../lib/portfolio'
import { dividendRows } from '../lib/dividends'
import { centralDateStr, currency, percentFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { useWealthPortfolios } from '../lib/useWealthPortfolios'
import { AllocationDonut, NetWorthChart } from '../components/WealthCharts'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { ButtonLink } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { EmptyState } from '../components/ui/EmptyState'

/** Wealth home: net worth, investments and dividend income on one screen, with links into
 * the detail pages. Read-only. */
export function WealthOverviewPage() {
  const today = centralDateStr(new Date())
  const month = monthOf(today)
  const year = Number(today.slice(0, 4))
  const w = useWealthPortfolios()
  const [accounts, setAccounts] = useState<NetworthAccount[] | null>(null)
  const [balances, setBalances] = useState<NetworthBalance[]>([])
  const [dividends, setDividends] = useState<Map<string, DividendInfo>>(new Map())
  const [payments, setPayments] = useState<InstallmentPayment[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchNetworthAccounts(), fetchNetworthBalances(), fetchDividendInfo(), fetchInstallmentPayments()])
      .then(([a, b, d, ip]) => {
        setAccounts(a)
        setBalances(b)
        setPayments(ip)
        setDividends(new Map(d.map((x) => [x.symbol, x])))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const portfolios = useMemo(() => w.portfolios ?? [], [w.portfolios])
  const totals = useMemo(() => (accounts ? monthTotals(month, accounts, balances, portfolios, w.values) : null), [accounts, balances, portfolios, w.values, month])
  const prev = useMemo(
    () => (accounts ? monthTotals(addMonths(month, -1), accounts, balances, portfolios, w.values) : null),
    [accounts, balances, portfolios, w.values, month],
  )
  const bars = useMemo(
    () =>
      accounts
        ? yearTotals(year, month, accounts, balances, portfolios, w.values).map((t) => ({
            month: t.month,
            label: monthLabel(t.month, 'short'),
            net: t.net,
            assets: t.assets,
            debts: t.debts,
          }))
        : [],
    [accounts, balances, portfolios, w.values, year, month],
  )
  const projectedDividends = useMemo(
    () => dividendRows(w.activeHoldings, dividends, w.prices, Number(today.slice(5, 7))).reduce((s, r) => s + r.perYear, 0),
    [w.activeHoldings, dividends, w.prices, today],
  )

  // Net worth by category for this month, largest first.
  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of totals?.lines ?? []) m.set(l.category, (m.get(l.category) ?? 0) + l.amount)
    return Array.from(m, ([category, amount]) => ({ category, amount })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  }, [totals])

  const loadError = error ?? w.error
  if (loadError) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load: {loadError}</div>
  if (!totals || !w.portfolios) return <div className="text-neutral-500">Loading…</div>

  const hasPrev = prev !== null && prev.lines.length > 0
  const change = hasPrev ? totals.net - prev!.net : null
  const nothingYet = totals.lines.length === 0 && w.active.length === 0
  const maxCategory = Math.max(1, ...byCategory.map((c) => Math.abs(c.amount)))

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Wealth" subtitle={`${monthLabel(month)} · net worth, investments and income at a glance`} />

      <CloseMonthBanner accounts={accounts ?? []} balances={balances} payments={payments} />

      {nothingYet ? (
        <Card>
          <EmptyState
            icon={<Landmark size={22} />}
            title="Start tracking your wealth"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to="/portfolios" variant="primary" icon={<PieChart size={16} />}>
                  Add a portfolio
                </ButtonLink>
                <ButtonLink to="/networth" icon={<Landmark size={16} />}>
                  Add net worth accounts
                </ButtonLink>
              </div>
            }
          >
            Add your investment portfolios and the accounts you own or owe (home, cash, cards, loans) to see everything in one place.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Net worth" value={currency(totals.net)} sub={`${currency(totals.assets)} assets · ${currency(totals.debts)} debts`} accent />
            <StatCard
              label="Change from last month"
              value={change === null ? '—' : signed(change)}
              tone={change}
              chip={change !== null && prev!.net !== 0 ? percentFmt(change / Math.abs(prev!.net)) : undefined}
              chipTone={change}
              sub={change === null ? 'needs last month’s balances' : undefined}
            />
            <StatCard
              label="Investments"
              value={currency(w.combined.total)}
              chip={w.combined.total - w.combined.dayChange > 0 ? percentFmt(w.combined.dayChange / (w.combined.total - w.combined.dayChange)) : undefined}
              chipTone={w.combined.dayChange}
              sub="today"
            />
            <StatCard label="Dividend income" value={`${currency(projectedDividends)}/yr`} sub={`≈ ${currency(projectedDividends / 12)} a month`} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <Card
              title={`Net worth · ${year}`}
              subtitle="Month by month"
              className="xl:col-span-3"
              actions={
                <ButtonLink to="/networth" size="sm" icon={<ArrowRight size={14} />}>
                  Update balances
                </ButtonLink>
              }
            >
              <NetWorthChart data={bars} />
            </Card>
            <Card
              title="Investments allocation"
              className="xl:col-span-2"
              actions={
                <ButtonLink to="/portfolios" size="sm" icon={<ArrowRight size={14} />}>
                  Portfolios
                </ButtonLink>
              }
            >
              {w.active.length === 0 ? (
                <EmptyState title="No portfolios yet" action={<ButtonLink to="/portfolios" variant="primary" size="sm">Add a portfolio</ButtonLink>} />
              ) : (
                <AllocationDonut allocation={w.allocation} centerLabel="Invested" />
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Where your net worth is" subtitle={monthLabel(month)}>
              {byCategory.length === 0 ? (
                <p className="text-sm text-neutral-500">No balances for this month yet.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {byCategory.map((c) => {
                    const debt = isDebt(c.category as NetworthAccount['category'])
                    return (
                      <div key={c.category} className="flex items-center gap-3 text-sm">
                        <span className="w-40 shrink-0 text-neutral-300">{categoryLabel(c.category as NetworthAccount['category'])}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
                          <span
                            className={`block h-full rounded-full ${debt ? 'bg-red-400/80' : 'bg-teal-400/80'}`}
                            style={{ width: `${(Math.abs(c.amount) / maxCategory) * 100}%` }}
                          />
                        </span>
                        <span className={`w-28 shrink-0 text-right font-medium tabular-nums ${debt ? 'text-red-300' : 'text-neutral-100'}`}>{currency(c.amount)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
            <Card title="Portfolios">
              {w.perPortfolio.length === 0 ? (
                <p className="text-sm text-neutral-500">No portfolios yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-(--border)">
                  {w.perPortfolio.map(({ portfolio: p, snap }) => (
                    <Link key={p.id} to={`/portfolios/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-(--card-raised)">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">{p.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <Pill tone={KIND_TONE[p.kind]}>{kindLabel(p.kind)}</Pill>
                          {snap.cash < 0 && <Pill tone="amber">{currency(-snap.cash)} margin</Pill>}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular-nums text-white">{currency(snap.total)}</span>
                        <span className={`text-xs tabular-nums ${toneClass(snap.dayChange)}`}>{signed(snap.dayChange)} today</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
