import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, ChevronRight, Landmark, PieChart } from 'lucide-react'
import type { AuditProblem, CspPosition, DividendInfo, InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { fetchAuditProblems, fetchCsps, fetchDividendInfo, fetchExternalFlows, fetchInstallmentPayments, fetchNetworthAccounts, fetchNetworthBalances } from '../lib/wealthQueries'
import { CloseMonthBanner } from '../components/CloseMonthBanner'
import { FreedomGauge } from '../components/FreedomGauge'
import { NeedsAttention } from '../components/NeedsAttention'
import { NetWorthChangeCard } from '../components/NetWorthChangeCard'
import { addMonths, monthLabel, monthOf, monthTotals } from '../lib/networth'
import { KIND_TONE, dayChangeLabel, kindLabel, signedCurrency as signed } from '../lib/portfolio'
import { dividendRows } from '../lib/dividends'
import { expiryItems, healthItems, priceItems } from '../lib/attention'
import { cashFlowLink, netWorthChange, type ExternalFlow } from '../lib/netWorthChange'
import { centralDateStr, currency, percentFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { useUrlState } from '../lib/useUrlState'
import { useWealthPortfolios } from '../lib/useWealthPortfolios'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { ButtonLink } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { EmptyState } from '../components/ui/EmptyState'

// The detail lives on its own page; Overview only points at it.
const MORE = [
  { to: '/networth', icon: Landmark, title: 'Net worth by month', sub: 'Balances, the year so far and where it sits' },
  { to: '/portfolios', icon: PieChart, title: 'Allocation and targets', sub: 'What you hold and what is off target' },
  { to: '/networth?view=cashflow', icon: ArrowLeftRight, title: 'Cash flow', sub: 'What came in, went out and was kept' },
]

/** Wealth home: how you are doing (freedom gauge, why last month's net worth changed, four
 * headline numbers) and what needs you
 * (month to close, things to fix), with links into the detail pages. Read-only. */
export function WealthOverviewPage() {
  const today = centralDateStr(new Date())
  const month = monthOf(today)
  const w = useWealthPortfolios()
  const [accounts, setAccounts] = useState<NetworthAccount[] | null>(null)
  const [balances, setBalances] = useState<NetworthBalance[]>([])
  const [dividends, setDividends] = useState<Map<string, DividendInfo>>(new Map())
  const [payments, setPayments] = useState<InstallmentPayment[]>([])
  const [problems, setProblems] = useState<AuditProblem[] | null>(null)
  const [csps, setCsps] = useState<CspPosition[]>([])
  // Null until loaded, and if the read fails: the "why it changed" card then stays off the page.
  const [flows, setFlows] = useState<ExternalFlow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // /wealth?details=freedom opens the freedom details; closing them takes it off the link.
  const [details, setDetails] = useUrlState<'' | 'freedom'>('details', '', ['', 'freedom'])

  useEffect(() => {
    Promise.all([fetchNetworthAccounts(), fetchNetworthBalances(), fetchDividendInfo(), fetchInstallmentPayments()])
      .then(([a, b, d, ip]) => {
        setAccounts(a)
        setBalances(b)
        setPayments(ip)
        setDividends(new Map(d.map((x) => [x.symbol, x])))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    // Only feed the "Needs attention" list, so a failure here leaves the page as it is.
    fetchAuditProblems()
      .then(setProblems)
      .catch(() => setProblems(null))
    fetchCsps()
      .then(setCsps)
      .catch(() => setCsps([]))
    fetchExternalFlows()
      .then(setFlows)
      .catch(() => setFlows(null))
  }, [])

  const portfolios = useMemo(() => w.portfolios ?? [], [w.portfolios])
  const totals = useMemo(() => (accounts ? monthTotals(month, accounts, balances, portfolios, w.values) : null), [accounts, balances, portfolios, w.values, month])
  const prev = useMemo(
    () => (accounts ? monthTotals(addMonths(month, -1), accounts, balances, portfolios, w.values) : null),
    [accounts, balances, portfolios, w.values, month],
  )
  const projectedDividends = useMemo(
    () => dividendRows(w.activeHoldings, dividends, w.prices, Number(today.slice(5, 7))).reduce((s, r) => s + r.perYear, 0),
    [w.activeHoldings, dividends, w.prices, today],
  )
  // Last month, the month Cash flow opens on: the latest one that can have all its balances in.
  const lastMonth = addMonths(month, -1)
  const lastChange = useMemo(
    () => (accounts && w.portfolios && flows ? netWorthChange(lastMonth, accounts, balances, w.portfolios, w.values, flows) : null),
    [accounts, balances, w.portfolios, w.values, flows, lastMonth],
  )
  // The month waiting to be closed is the banner's job, so it isn't repeated in this list.
  const attention = useMemo(
    () => [
      ...healthItems(problems),
      ...expiryItems(
        today,
        w.active,
        w.openOptions,
        csps.filter((c) => c.status === 'open'),
      ),
      ...priceItems(w.pending),
    ],
    [problems, today, w.active, w.openOptions, csps, w.pending],
  )

  const loadError = error ?? w.error
  if (loadError) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load: {loadError}</div>
  if (!totals || !w.portfolios) return <div className="text-neutral-500">Loading…</div>

  const hasPrev = prev !== null && prev.lines.length > 0
  const change = hasPrev ? totals.net - prev!.net : null
  const nothingYet = totals.lines.length === 0 && w.active.length === 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Wealth" subtitle={`${monthLabel(month)} · net worth, investments and income at a glance`} />

      <CloseMonthBanner accounts={accounts ?? []} balances={balances} payments={payments} />

      <NeedsAttention items={attention} />

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
                  Add balances
                </ButtonLink>
              </div>
            }
          >
            Add your investment portfolios and the balances of what you own or owe (home, cash, cards, loans) to see everything in one place.
          </EmptyState>
        </Card>
      ) : (
        <>
          <FreedomGauge
            today={today}
            month={month}
            accounts={accounts ?? []}
            balances={balances}
            portfolios={portfolios}
            values={w.values}
            detailsOpen={details === 'freedom'}
            onDetailsClose={details === 'freedom' ? () => setDetails(null) : undefined}
          />

          {lastChange && <NetWorthChangeCard change={lastChange} allMonthsTo={cashFlowLink(lastMonth, month)} />}

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
              sub={dayChangeLabel(w.combined.asOf) === 'Today' ? 'today' : `last close · ${dayChangeLabel(w.combined.asOf)}`}
            />
            <StatCard label="Dividend income" value={`${currency(projectedDividends)}/yr`} sub={`≈ ${currency(projectedDividends / 12)} a month`} />
          </div>

          <nav aria-label="More detail" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {MORE.map(({ to, icon: Icon, title, sub }) => (
              <Link
                key={to}
                to={to}
                className="group flex items-center gap-3 rounded-xl border border-(--border) bg-(--card) px-4 py-3 transition hover:border-(--accent)/50 hover:bg-(--card-raised)"
              >
                <Icon size={18} className="shrink-0 text-(--accent-text)" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-neutral-100">{title}</span>
                  <span className="block text-xs text-neutral-500">{sub}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300" />
              </Link>
            ))}
          </nav>

          <Card title="Portfolios">
            {w.perPortfolio.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No portfolios yet.{' '}
                <Link to="/portfolios" className="text-(--accent-text) hover:underline">
                  Add a portfolio
                </Link>
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-(--border)">
                {w.perPortfolio.map(({ portfolio: p, snap }) => (
                  <Link key={p.id} to={`/portfolios/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-(--card-raised)">
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-medium text-white">{p.name}</span>
                      <Pill tone={KIND_TONE[p.kind]}>{kindLabel(p.kind)}</Pill>
                    </span>
                    <span className="flex shrink-0 flex-col items-end sm:flex-row sm:items-baseline sm:gap-4">
                      <span className="text-sm font-semibold tabular-nums text-white">{currency(snap.total)}</span>
                      <span className={`text-xs tabular-nums whitespace-nowrap sm:w-44 sm:text-right ${toneClass(snap.dayChange)}`}>
                        {signed(snap.dayChange)} {dayChangeLabel(snap.asOf) === 'Today' ? 'today' : dayChangeLabel(snap.asOf)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
