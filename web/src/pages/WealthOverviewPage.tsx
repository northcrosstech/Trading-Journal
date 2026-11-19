import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, PieChart } from 'lucide-react'
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
import { PageError, PageLoading } from '../components/ui/PageState'
import { toneClass } from '../lib/ui'
import { useUrlState } from '../lib/useUrlState'
import { useWealthPortfolios } from '../lib/useWealthPortfolios'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { ButtonLink } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { EmptyState } from '../components/ui/EmptyState'

/** Wealth home: what needs you (month to close, things to fix) and how you are doing (freedom
 * gauge, three headline numbers, why last month's net worth changed, each portfolio). The
 * detail lives on its own pages: each headline number is a link to the page behind it, and
 * the change card links to Cash flow. Read-only. */
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

  const load = useCallback(() => {
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
  useEffect(load, [load])

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
  if (loadError)
    return (
      <PageError
        what="your overview"
        message={loadError}
        onRetry={() => {
          setError(null)
          load()
          w.retry()
        }}
      />
    )
  if (!totals || !w.portfolios) return <PageLoading label="Loading your overview" tiles={3} />

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

          {/* Each number opens the page that explains it. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Net worth"
              value={currency(totals.net)}
              chip={change === null ? undefined : `${signed(change)} since ${monthLabel(lastMonth).split(' ')[0]}`}
              chipTone={change}
              sub={`${currency(totals.assets)} assets · ${currency(totals.debts)} debts`}
              accent
              to="/networth"
            />
            <StatCard
              label="Investments"
              to="/portfolios"
              value={currency(w.combined.total)}
              chip={w.combined.total - w.combined.dayChange > 0 ? percentFmt(w.combined.dayChange / (w.combined.total - w.combined.dayChange)) : undefined}
              chipTone={w.combined.dayChange}
              sub={dayChangeLabel(w.combined.asOf) === 'Today' ? 'today' : `last close · ${dayChangeLabel(w.combined.asOf)}`}
            />
            <StatCard
              label="Expected dividends"
              value={`${currency(projectedDividends)}/yr`}
              sub={`≈ ${currency(projectedDividends / 12)} a month`}
              to="/portfolios?tab=income"
            />
          </div>

          {lastChange && <NetWorthChangeCard change={lastChange} allMonthsTo={cashFlowLink(lastMonth, month)} />}

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
