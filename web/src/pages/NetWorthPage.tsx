import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { InstallmentPayment, NetworthAccount, NetworthBalance, Portfolio, PortfolioDailyValue } from '../lib/database.types'
import {
  fetchCloseFromMonth,
  fetchDailyValues,
  fetchExternalFlows,
  fetchInstallmentPayments,
  fetchMonthBook,
  fetchNetworthAccounts,
  fetchNetworthBalances,
  fetchPortfolios,
} from '../lib/wealthQueries'
import { addMonths, monthLabel, monthOf, monthTotals, yearTotals } from '../lib/networth'
import { centralDateStr, currency, percentFmt } from '../lib/format'
import { INPUT_SM } from '../lib/ui'
import { errorMessage } from '../lib/balanceInput'
import { useDialog } from '../lib/dialogContext'
import { useUrlState } from '../lib/useUrlState'
import { isLinkMonth, monthStatus } from '../lib/monthLink'
import { closeIsLate, useStartCloseFrom } from '../lib/closeReminder'
import { signedCurrency as signed } from '../lib/portfolio'
import { EMPTY_BOOK, closeStatus, netWorthOpenMonth, type MonthBook } from '../lib/cashflow'
import { NetWorthChart } from '../components/WealthCharts'
import { NetWorthComposition } from '../components/NetWorthComposition'
import { InstallmentsCard, type InstallmentsCardHandle } from '../components/InstallmentsCard'
import { CloseMonthBanner } from '../components/CloseMonthBanner'
import { MonthClosePanel } from '../components/MonthClosePanel'
import { MonthRecap } from '../components/MonthRecap'
import { BalancesTable, type BalancesTableHandle } from '../components/BalancesTable'
import { ManageAccounts } from '../components/ManageAccounts'
import { MonthStepper } from '../components/MonthStepper'
import { CollapsibleSection } from '../components/CollapsibleSection'
import { Kpi } from '../components/WealthBits'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Tabs } from '../components/ui/Tabs'
import { Drawer } from '../components/ui/Drawer'
import { CashFlowView, type CashFlowFlow } from './CashFlowPage'

const VIEWS = ['balances', 'cashflow'] as const
type View = (typeof VIEWS)[number]

/** Wealth → Net worth. Two tabs share one month, kept in the link as ?month=yyyy-mm:
 * "Balances" (the month's balances, payments and month-end close) and "Cash flow"
 * (?view=cashflow). With no month in the link each tab opens on its own: Balances on the
 * month being worked on, Cash flow on last month. While a finished month is waiting to be
 * closed the page leads with the close: the close card, the balances table, then the payments. */
export function NetWorthPage() {
  const today = centralDateStr(new Date())
  const currentMonth = monthOf(today)
  const dialog = useDialog()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useUrlState<View>('view', 'balances', VIEWS)
  // Without ?month Balances shows the month picked on the first load (see netWorthOpenMonth).
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  const fallbackMonth = (openMonth ?? currentMonth).slice(0, 7)
  // Without ?month Cash flow shows last month, as it did as a page of its own.
  const cashFlowFallback = addMonths(currentMonth, -1).slice(0, 7)
  const [, setLinkMonth] = useUrlState('month', view === 'cashflow' ? cashFlowFallback : fallbackMonth)
  const linkParam = params.get('month')
  const linkMonth = linkParam !== null && isLinkMonth(linkParam) ? linkParam : null
  // The Balances month. It stays where it is while Cash flow shows its own default, so the
  // balances table (and anything typed in it) isn't swapped for another month's.
  const month = `${linkMonth ?? fallbackMonth}-01`
  // The month in the header, and the one Cash flow shows.
  const shownMonth = view === 'cashflow' ? `${linkMonth ?? cashFlowFallback}-01` : month
  // The chart follows the month on screen until a year is picked from its list.
  const [chosenYear, setYear] = useState<number | null>(null)
  const year = chosenYear ?? Number(month.slice(0, 4))
  const [accounts, setAccounts] = useState<NetworthAccount[] | null>(null)
  const [balances, setBalances] = useState<NetworthBalance[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [dailyValues, setDailyValues] = useState<PortfolioDailyValue[]>([])
  const [payments, setPayments] = useState<InstallmentPayment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [book, setBook] = useState<MonthBook>(EMPTY_BOOK)
  const [closeFromMonth, setCloseFromMonthValue] = useState<string | null>(null)
  // Portfolio deposits and withdrawals: only the Cash flow tab and the month recap need them,
  // so they load when either is first opened.
  const [flows, setFlows] = useState<CashFlowFlow[] | null>(null)
  const [flowsError, setFlowsError] = useState<string | null>(null)
  // The closed month whose recap is showing: set by a close, or by "Recap" on a closed month.
  const [recapMonth, setRecapMonth] = useState<string | null>(null)
  const closeRecap = useCallback(() => setRecapMonth(null), [])
  const tableRef = useRef<BalancesTableHandle>(null)
  const paymentsRef = useRef<InstallmentsCardHandle>(null)

  const load = useCallback(
    () =>
      Promise.all([
        fetchNetworthAccounts(),
        fetchNetworthBalances(),
        fetchPortfolios(),
        fetchDailyValues(),
        fetchInstallmentPayments(),
        fetchCloseFromMonth().catch(() => null),
        fetchMonthBook().catch(() => EMPTY_BOOK),
      ])
        .then(([a, b, p, v, ip, closeFrom, mb]) => {
          // Decided once: a later reload (say, after closing the month) doesn't move the page.
          setOpenMonth((m) => m ?? netWorthOpenMonth(centralDateStr(new Date()), a, b, ip, closeFrom, mb))
          setAccounts(a)
          setBalances(b)
          setPortfolios(p)
          setDailyValues(v)
          setPayments(ip)
          setBook(mb)
          setCloseFromMonthValue(closeFrom)
        })
        .catch((e) => setError(errorMessage(e))),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if ((view !== 'cashflow' && recapMonth === null) || flows !== null) return
    fetchExternalFlows()
      .then(setFlows)
      .catch((e) => setFlowsError(errorMessage(e)))
  }, [view, recapMonth, flows])

  const startCloseFrom = useStartCloseFrom(load)

  const totals = useMemo(() => (accounts ? monthTotals(month, accounts, balances, portfolios, dailyValues) : null), [month, accounts, balances, portfolios, dailyValues])
  const prev = useMemo(
    () => (accounts ? monthTotals(addMonths(month, -1), accounts, balances, portfolios, dailyValues) : null),
    [month, accounts, balances, portfolios, dailyValues],
  )
  const yearStart = useMemo(
    () => (accounts ? monthTotals(`${Number(month.slice(0, 4)) - 1}-12-01`, accounts, balances, portfolios, dailyValues) : null),
    [month, accounts, balances, portfolios, dailyValues],
  )
  const bars = useMemo(
    () =>
      accounts
        ? yearTotals(year, currentMonth, accounts, balances, portfolios, dailyValues).map((t) => ({
            month: t.month,
            label: monthLabel(t.month, 'short'),
            net: t.net,
            assets: t.assets,
            debts: t.debts,
          }))
        : [],
    [year, currentMonth, accounts, balances, portfolios, dailyValues],
  )
  const years = useMemo(() => {
    const first = Math.min(Number(currentMonth.slice(0, 4)), ...(accounts ?? []).map((a) => Number(a.opened_month.slice(0, 4))))
    const out: number[] = []
    for (let y = Number(currentMonth.slice(0, 4)); y >= first; y--) out.push(y)
    return out
  }, [accounts, currentMonth])
  const closedMonths = useMemo(() => new Set(book.closedAt.keys()), [book])

  if (error) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load net worth: {error}</div>
  if (!accounts || !totals) return <div className="text-neutral-500">Loading net worth…</div>

  const hasPrev = prev !== null && prev.lines.length > 0
  const hasYearStart = yearStart !== null && yearStart.lines.length > 0
  const monthChange = hasPrev ? totals.net - prev!.net : null
  const yearChange = hasYearStart ? totals.net - yearStart!.net : null
  const portfolioLines = totals.lines.filter((l) => l.source === 'portfolio')

  // Which earlier months the carried balances in the headline come from.
  const carriedFrom = totals.lines
    .filter((l) => l.source === 'carried')
    .map((l) => {
      const opened = accounts.find((a) => a.id === l.key)?.opened_month ?? ''
      let from = ''
      for (const b of balances) if (b.account_id === l.key && b.month <= month && b.month >= opened && b.month > from) from = b.month
      return from
    })
  const carriedNote =
    carriedFrom.length === 0
      ? null
      : `includes ${carriedFrom.length} balance${carriedFrom.length === 1 ? '' : 's'} carried from ${new Set(carriedFrom).size === 1 ? monthLabel(carriedFrom[0]) : 'earlier months'}`

  const locked = book.closedAt.has(month)
  // Finished and not yet closed: the close card is the thing to act on, so it leads the page.
  const closing = month < currentMonth && !locked
  // The month the close banner would ask for. While its close card is on screen the card
  // stands in for the banner, and carries the banner's extras.
  const reminder = closeStatus(today, accounts, balances, payments, closeFromMonth, book)
  const isReminderMonth = closing && reminder?.month === month
  const cardStandsIn = view === 'balances' && isReminderMonth

  /** Typed balances belong to the month on screen, so leaving it asks first: save, or discard. */
  async function mayLeaveMonth(): Promise<boolean> {
    const n = tableRef.current?.unsavedCount() ?? 0
    if (n === 0) return true
    const what = `${n} unsaved balance${n === 1 ? '' : 's'}`
    if (await dialog.confirm({ title: `Save ${monthLabel(month)} balances first?`, message: `You have ${what}. Save ${n === 1 ? 'it' : 'them'} before leaving ${monthLabel(month)}?`, confirmLabel: 'Save' })) {
      const saved = (await tableRef.current?.save()) ?? false
      if (!saved && view !== 'balances') setView('balances') // the table says what went wrong
      return saved
    }
    const discard = await dialog.confirm({
      title: `Discard the ${what}?`,
      message: `Discard ${n === 1 ? 'it' : 'them'} and leave ${monthLabel(month)}, or cancel to stay and keep typing.`,
      confirmLabel: 'Discard',
      tone: 'danger',
    })
    // Also drops the copy the table keeps for coming back to this month.
    if (discard) tableRef.current?.discard()
    return discard
  }

  async function goToMonth(m: string, toBalances = false) {
    // Left out of the link when it's the default of the tab it opens in.
    const link = m.slice(0, 7) === (toBalances || view === 'balances' ? fallbackMonth : cashFlowFallback) ? null : m.slice(0, 7)
    // Typed balances go with the Balances month, which a default Cash flow month doesn't move.
    if (`${link ?? fallbackMonth}-01` !== month && !(await mayLeaveMonth())) return
    if (!toBalances || view === 'balances') return setLinkMonth(link)
    // Tab and month together: two separate link updates would overwrite each other.
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('view')
        if (link === null) next.delete('month')
        else next.set('month', link)
        return next
      },
      { replace: true },
    )
  }

  /** From the recap: the Cash flow tab on the recap's month. Tab and month go in one link update. */
  function openCashFlow(m: string) {
    setRecapMonth(null)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set('view', 'cashflow')
        next.set('month', m.slice(0, 7))
        return next
      },
      { replace: true },
    )
  }

  const kpis = (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label={`Net worth · ${monthLabel(month)}`}
        value={currency(totals.net)}
        sub={
          <>
            {currency(totals.assets)} assets · {currency(totals.debts)} debts
            {carriedNote && <span className="mt-0.5 block text-amber-400/90">{carriedNote}</span>}
          </>
        }
        accent
      />
      <Kpi
        label="Change from last month"
        value={monthChange === null ? '—' : signed(monthChange)}
        tone={monthChange}
        chip={monthChange !== null && prev!.net !== 0 ? percentFmt(monthChange / Math.abs(prev!.net)) : undefined}
        chipTone={monthChange}
        sub={monthChange === null ? 'needs last month’s balances' : undefined}
      />
      <Kpi
        label="Change this year"
        value={yearChange === null ? '—' : signed(yearChange)}
        tone={yearChange}
        sub={yearChange === null ? 'needs a December balance' : `since December ${Number(month.slice(0, 4)) - 1}`}
      />
      <Kpi label="Excluding home" value={currency(totals.netExHome)} sub="without home & mortgage" />
    </div>
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Net worth"
        subtitle="Everything you own minus everything you owe, month by month."
        actions={<MonthStepper month={shownMonth} max={currentMonth} onChange={(m) => void goToMonth(m)} status={monthStatus(shownMonth, currentMonth, book.closedAt.has(shownMonth))} />}
      />

      <Tabs
        tabs={[
          { value: 'balances', label: 'Balances' },
          { value: 'cashflow', label: 'Cash flow' },
        ]}
        value={view}
        onChange={setView}
      />

      {!cardStandsIn && (
        <CloseMonthBanner
          accounts={accounts}
          balances={balances}
          payments={payments}
          book={book}
          closeFrom={closeFromMonth}
          onChanged={load}
          viewing={view === 'balances' ? month : undefined}
          onOpenMonth={(m) => void goToMonth(m, true)}
        />
      )}

      {/* Kept on the page while Cash flow is showing, so balances typed but not saved yet survive a look at the other tab. */}
      <div className={view === 'balances' ? 'flex flex-col gap-6' : 'hidden'}>
        {!closing && kpis}

        <MonthClosePanel
          month={month}
          currentMonth={currentMonth}
          accounts={accounts}
          balances={balances}
          payments={payments}
          book={book}
          closeFrom={closeFromMonth}
          onChanged={load}
          onJumpToBalances={(ids) => tableRef.current?.focusFirst(ids)}
          onJumpToPayments={(ids) => paymentsRef.current?.focusFirst(ids)}
          onOpenMonth={(m) => void goToMonth(m)}
          onRecap={setRecapMonth}
          late={isReminderMonth && closeIsLate(today, month)}
          note={isReminderMonth && Number(today.slice(8, 10)) <= 5 ? `Showing ${monthLabel(month)} until you close it, or through the 5th.` : null}
          startFrom={isReminderMonth && closeFromMonth === null ? { label: `Start from ${monthLabel(currentMonth, 'short')}`, onClick: () => void startCloseFrom(month) } : undefined}
        />

        {/* A new key per month: what's typed belongs to that month and starts clean on the next. */}
        <BalancesTable
          key={month}
          ref={tableRef}
          month={month}
          accounts={accounts}
          balances={balances}
          portfolioLines={portfolioLines}
          onSaved={load}
          onManage={() => setManageOpen(true)}
          locked={locked}
        />

        <InstallmentsCard ref={paymentsRef} month={month} today={today} accounts={accounts} balances={balances} payments={payments} onChanged={load} locked={locked} />

        <CollapsibleSection
          storageKey="networth-breakdown-open"
          title="Breakdown"
          hint={closing ? 'Headline numbers, net worth by month and what it’s made of' : 'Net worth by month and what it’s made of'}
        >
          {view === 'balances' && (
            <>
              {closing && kpis}
              <Card
                title="Net worth by month"
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
                <NetWorthChart data={bars} />
              </Card>
              <NetWorthComposition lines={totals.lines} monthName={monthLabel(month)} />
            </>
          )}
        </CollapsibleSection>
      </div>

      {view === 'cashflow' &&
        (flowsError ? (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load cash flow: {flowsError}</div>
        ) : flows === null ? (
          <div className="text-neutral-500">Loading cash flow…</div>
        ) : (
          <CashFlowView
            month={shownMonth}
            currentMonth={currentMonth}
            accounts={accounts}
            balances={balances}
            portfolios={portfolios}
            dailyValues={dailyValues}
            flows={flows}
            closedMonths={closedMonths}
            onMonth={(m) => void goToMonth(m)}
          />
        ))}

      <Drawer open={manageOpen} onClose={() => setManageOpen(false)} title="Manage accounts" subtitle="What you own and what you owe" width="max-w-lg">
        <ManageAccounts accounts={accounts} month={month} monthLocked={locked} onChanged={load} />
      </Drawer>

      <MonthRecap
        month={recapMonth}
        closedAt={recapMonth ? (book.closedAt.get(recapMonth) ?? null) : null}
        accounts={accounts}
        balances={balances}
        portfolios={portfolios}
        dailyValues={dailyValues}
        payments={payments}
        flows={flows}
        flowsError={flowsError}
        onClose={closeRecap}
        onCashFlow={openCashFlow}
      />
    </div>
  )
}
