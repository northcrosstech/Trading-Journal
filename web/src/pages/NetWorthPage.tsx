import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Landmark, Plus, Settings2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { InstallmentPayment, NetworthAccount, NetworthBalance, NetworthCategory, Portfolio, PortfolioDailyValue } from '../lib/database.types'
import {
  createNetworthAccount,
  deleteNetworthAccount,
  fetchDailyValues,
  fetchInstallmentPayments,
  fetchNetworthAccounts,
  fetchNetworthBalances,
  fetchPortfolios,
  saveMonthBalances,
  updateNetworthAccount,
} from '../lib/wealthQueries'
import { CATEGORIES, addMonths, categoryLabel, categoryOrder, isDebt, isOpenIn, monthLabel, monthOf, monthTotals, yearTotals } from '../lib/networth'
import { centralDateStr, currency, percentFmt } from '../lib/format'
import { INPUT, INPUT_SM, LABEL } from '../lib/ui'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { signedCurrency as signed } from '../lib/portfolio'
import { NetWorthChart } from '../components/WealthCharts'
import { NetWorthComposition } from '../components/NetWorthComposition'
import { InstallmentsCard } from '../components/InstallmentsCard'
import { CloseMonthBanner } from '../components/CloseMonthBanner'
import { usePaymentSetup } from '../lib/usePaymentSetup'
import { Kpi } from '../components/WealthBits'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { Drawer } from '../components/ui/Drawer'
import { Menu } from '../components/ui/Menu'
import { EmptyState } from '../components/ui/EmptyState'

/** Parses a balance box: blank = no balance this month, otherwise a non-negative number
 * (commas and $ allowed). undefined = not a valid number. */
function parseBalance(raw: string): number | null | undefined {
  const t = raw.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Shows a balance with thousands separators (inputs accept commas back). */
const fmtBalance = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The month's balances as a table: open accounts only, pre-filled with this month's entry
 * or the most recent earlier one ("carried"), grouped into Assets and Debts with subtotals.
 * Portfolio-fed lines are read-only. A save bar appears once anything has changed. */
function BalancesTable({
  month,
  accounts,
  balances,
  portfolioLines,
  onSaved,
  onManage,
}: {
  month: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  portfolioLines: { key: string; name: string; category: NetworthCategory; amount: number }[]
  onSaved: () => void
  onManage: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const open = useMemo(() => accounts.filter((a) => isOpenIn(a, month)), [accounts, month])
  const prefill = useMemo(() => {
    const out = new Map<string, { value: string; from: string | null }>()
    for (const a of open) {
      let best: NetworthBalance | null = null
      for (const b of balances) if (b.account_id === a.id && b.month <= month && (!best || b.month > best.month)) best = b
      out.set(a.id, { value: best ? fmtBalance(Number(best.balance)) : '', from: best && best.month !== month ? best.month : null })
    }
    return out
  }, [open, balances, month])

  const [draft, setDraft] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(new Map(Array.from(prefill, ([id, p]) => [id, p.value])))
    setError(null)
  }, [prefill])

  // Changed vs what's stored for this month (a carried value counts as unsaved for this month).
  const dirty = open.some((a) => {
    const p = prefill.get(a.id)
    return (draft.get(a.id) ?? '') !== (p?.value ?? '') || (p?.from != null && (draft.get(a.id) ?? '') !== '')
  })

  async function save() {
    if (!user) return
    const entries: { accountId: string; balance: number | null }[] = []
    for (const a of open) {
      const parsed = parseBalance(draft.get(a.id) ?? '')
      if (parsed === undefined) {
        setError(`“${draft.get(a.id)}” isn’t a valid amount for ${a.name}. Enter a positive number — debts are subtracted for you.`)
        return
      }
      entries.push({ accountId: a.id, balance: parsed })
    }
    setSaving(true)
    setError(null)
    try {
      await saveMonthBalances(user.id, month, entries)
      toast(`Saved ${monthLabel(month)} balances`)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const amountOf = (a: NetworthAccount) => parseBalance(draft.get(a.id) ?? '') ?? 0
  type Item =
    | { kind: 'account'; key: string; category: NetworthCategory; name: string; account: NetworthAccount; amount: number }
    | { kind: 'portfolio'; key: string; category: NetworthCategory; name: string; amount: number }
  // Accounts and portfolio lines together, sorted by category, so each category's lines sit
  // side by side and can carry a subtotal.
  const groups = ([false, true] as const).map((debt) => {
    const items: Item[] = [
      ...open
        .filter((a) => isDebt(a.category) === debt)
        .map((a): Item => ({ kind: 'account', key: a.id, category: a.category, name: a.name, account: a, amount: amountOf(a) })),
      ...portfolioLines
        .filter((l) => isDebt(l.category) === debt)
        .map((l): Item => ({ kind: 'portfolio', key: l.key, category: l.category, name: l.name, amount: Math.abs(l.amount) })),
    ].sort((x, y) => categoryOrder(x.category) - categoryOrder(y.category) || x.name.localeCompare(y.name))
    const counts = new Map<NetworthCategory, number>()
    for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1)
    const subtotal = items.reduce((s, it) => s + it.amount, 0)
    return { debt, items, counts, subtotal }
  })
  const assets = groups[0].subtotal
  const debts = groups[1].subtotal
  const carriedCount = Array.from(prefill.values()).filter((p) => p.from).length

  if (open.length === 0 && portfolioLines.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Landmark size={22} />}
          title={`No accounts open in ${monthLabel(month)}`}
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={onManage}>
              Add an account
            </Button>
          }
        >
          Add what you own (home, cash, 401k…) and what you owe (mortgage, cards, loans). Portfolios fill their lines automatically.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card
      title={`Balances · ${monthLabel(month)}`}
      subtitle="Enter each balance as a positive number — debts are subtracted for you. Blank = no balance this month."
      flush
      actions={
        <Button size="sm" icon={<Settings2 size={14} />} onClick={onManage}>
          Manage accounts
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {groups.map((g) =>
              g.items.length === 0 ? null : (
                <GroupRows key={String(g.debt)} title={g.debt ? 'Debts' : 'Assets'} debt={g.debt} subtotal={g.subtotal}>
                  {g.items.map((it, i) => {
                    const lastOfCategory = g.items[i + 1]?.category !== it.category
                    const catCount = g.counts.get(it.category) ?? 0
                    const catTotal = g.items.filter((x) => x.category === it.category).reduce((s2, x) => s2 + x.amount, 0)
                    const p = it.kind === 'account' ? prefill.get(it.account.id) : undefined
                    return (
                      <Fragment key={it.key}>
                        <tr className="border-b border-(--border) hover:bg-white/2">
                          <td className="px-5 py-2.5">
                            <div className="font-medium text-neutral-100">{it.name}</div>
                            {it.kind === 'portfolio' ? (
                              <div className="text-xs text-neutral-500">
                                {it.key.startsWith('margin:') ? 'margin used · from Portfolios' : 'from Portfolios · last close'}
                              </div>
                            ) : (
                              p?.from && <div className="text-xs text-amber-400/90">carried from {monthLabel(p.from)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <Pill tone={g.debt ? 'red' : 'teal'}>{categoryLabel(it.category)}</Pill>
                          </td>
                          {it.kind === 'account' ? (
                            <td className="w-48 px-5 py-2">
                              <span className="relative block">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
                                <input
                                  inputMode="decimal"
                                  aria-label={`${it.name} balance`}
                                  value={draft.get(it.account.id) ?? ''}
                                  onChange={(e) => setDraft((d) => new Map(d).set(it.account.id, e.target.value))}
                                  onBlur={(e) => {
                                    const n = parseBalance(e.target.value)
                                    if (n !== null && n !== undefined) setDraft((d) => new Map(d).set(it.account.id, fmtBalance(n)))
                                  }}
                                  className={`${INPUT_SM} pl-6 text-right tabular-nums ${p?.from ? 'border-amber-500/40' : ''}`}
                                />
                              </span>
                            </td>
                          ) : (
                            <td className="w-48 px-5 py-2.5 text-right tabular-nums text-neutral-300">{currency(it.amount)}</td>
                          )}
                        </tr>
                        {lastOfCategory && catCount >= 2 && (
                          <tr className="border-b border-(--border) bg-white/2">
                            <td colSpan={2} className="px-5 py-2 text-xs text-neutral-400">
                              {categoryLabel(it.category)} · {catCount} accounts
                            </td>
                            <td className={`px-5 py-2 text-right text-sm font-semibold tabular-nums ${g.debt ? 'text-red-300' : 'text-neutral-100'}`}>
                              {g.debt ? '−' : ''}
                              {currency(catTotal)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </GroupRows>
              ),
            )}
            <tr className="bg-white/3">
              <td className="px-5 py-3 text-sm font-semibold text-white" colSpan={2}>
                Net worth
              </td>
              <td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-white">{currency(assets - debts)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {(dirty || error || carriedCount > 0) && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-(--border) bg-(--card-raised)/95 px-5 py-3 backdrop-blur">
          <span className="text-xs text-neutral-400">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : carriedCount > 0 ? (
              `${carriedCount} balance${carriedCount === 1 ? ' is' : 's are'} carried from an earlier month — saving keeps ${carriedCount === 1 ? 'it' : 'them'} for ${monthLabel(month)}.`
            ) : (
              'You have unsaved changes.'
            )}
          </span>
          <span className="flex gap-2">
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(new Map(Array.from(prefill, ([id, p]) => [id, p.value])))}>
                Discard
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={save} disabled={saving || open.length === 0}>
              {saving ? 'Saving…' : `Save ${monthLabel(month, 'short')}`}
            </Button>
          </span>
        </div>
      )}
    </Card>
  )
}

function GroupRows({ title, debt, subtotal, children }: { title: string; debt: boolean; subtotal: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-y border-(--border) bg-white/2">
        <td colSpan={2} className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${debt ? 'bg-red-400' : 'bg-teal-400'}`} />
          {title}
        </td>
        <td className={`px-5 py-2 text-right text-sm font-semibold tabular-nums ${debt ? 'text-red-300' : 'text-teal-300'}`}>
          {debt ? '−' : ''}
          {currency(subtotal)}
        </td>
      </tr>
      {children}
    </>
  )
}

/** Side panel: add accounts, rename, close / reopen, delete. Closing keeps history but drops
 * the account from the monthly form from its closing month on. */
function ManageAccounts({ accounts, defaultMonth, onChanged }: { accounts: NetworthAccount[]; defaultMonth: string; onChanged: () => void }) {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const editPayment = usePaymentSetup(onChanged)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<NetworthCategory>('cash')
  const [opened, setOpened] = useState(defaultMonth.slice(0, 7))
  const [busy, setBusy] = useState(false)

  const run = async (p: Promise<unknown>, message: string) => {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  async function add() {
    if (!user || !name.trim()) return
    setBusy(true)
    await run(
      createNetworthAccount(user.id, { name: name.trim(), category, opened_month: `${opened}-01` }).then(() => setName('')),
      `Added “${name.trim()}”`,
    )
    setBusy(false)
  }

  async function rename(a: NetworthAccount) {
    const v = await dialog.form({ title: 'Rename account', fields: [{ name: 'name', label: 'Name', defaultValue: a.name }] })
    if (v && v.name !== a.name) run(updateNetworthAccount(a.id, { name: v.name }), 'Account renamed')
  }

  async function close(a: NetworthAccount) {
    const v = await dialog.form({
      title: `Close “${a.name}”`,
      description: 'From this month on it’s gone from the monthly form. Past balances stay in your history.',
      submitLabel: 'Close account',
      fields: [
        {
          name: 'month',
          label: 'Closing month',
          type: 'month',
          defaultValue: defaultMonth.slice(0, 7),
          validate: (m) => (`${m}-01` <= a.opened_month ? 'Must be after the month it opened' : null),
        },
      ],
    })
    if (v) run(updateNetworthAccount(a.id, { closed_month: `${v.month}-01` }), `Closed “${a.name}”`)
  }

  async function remove(a: NetworthAccount) {
    if (
      await dialog.confirm({
        title: `Delete “${a.name}”?`,
        message: 'This deletes the account and all its balances. To keep its history, close it instead.',
        confirmLabel: 'Delete',
        tone: 'danger',
      })
    )
      run(deleteNetworthAccount(a.id), `Deleted “${a.name}”`)
  }

  const openAccounts = accounts.filter((a) => a.closed_month === null)
  const closedAccounts = accounts.filter((a) => a.closed_month !== null)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--card-raised) p-4">
        <h3 className="text-sm font-semibold text-white">Add an account</h3>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase checking" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as NetworthCategory)} className={INPUT}>
            <optgroup label="What you own">
              {CATEGORIES.filter((c) => !c.debt).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="What you owe">
              {CATEGORIES.filter((c) => c.debt).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Opened</span>
          <input type="month" value={opened} onChange={(e) => setOpened(e.target.value)} className={INPUT} />
          <span className="text-xs text-neutral-500">It shows up in the monthly form from this month on.</span>
        </label>
        <Button variant="primary" onClick={add} disabled={!name.trim() || busy} icon={<Plus size={16} />}>
          Add account
        </Button>
        <p className="text-xs text-neutral-500">
          401k, IRA and brokerage portfolios set up under{' '}
          <Link to="/portfolios" className="text-(--accent-text) hover:underline">
            Portfolios
          </Link>{' '}
          are added automatically — don’t add them here too.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-white">Your accounts</h3>
        {accounts.length === 0 ? (
          <p className="text-sm text-neutral-500">No accounts yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-(--border) rounded-2xl border border-(--border)">
            {[...openAccounts, ...closedAccounts].map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${a.closed_month ? 'text-neutral-500' : 'text-neutral-100'}`}>{a.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                    <Pill tone={isDebt(a.category) ? 'red' : 'teal'}>{categoryLabel(a.category)}</Pill>
                    since {monthLabel(a.opened_month)}
                    {a.closed_month && <Pill>closed {monthLabel(a.closed_month)}</Pill>}
                    {(a.payment_amount ?? 0) > 0 && <Pill tone="amber">{currency(Number(a.payment_amount))}/mo</Pill>}
                  </div>
                </div>
                <Menu
                  label={`Actions for ${a.name}`}
                  items={
                    a.closed_month
                      ? [
                          { label: 'Reopen', onClick: () => run(updateNetworthAccount(a.id, { closed_month: null }), `Reopened “${a.name}”`) },
                          { label: 'Rename', onClick: () => rename(a) },
                          { label: 'Delete…', tone: 'danger', onClick: () => remove(a) },
                        ]
                      : [
                          { label: 'Rename', onClick: () => rename(a) },
                          ...(isDebt(a.category) ? [{ label: 'Payment details…', onClick: () => editPayment(a) }] : []),
                          { label: 'Close account…', onClick: () => close(a) },
                          { label: 'Delete…', tone: 'danger', onClick: () => remove(a) },
                        ]
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function NetWorthPage() {
  const currentMonth = monthOf(centralDateStr(new Date()))
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('month')
  const [month, setMonth] = useState(requested && /^\d{4}-\d{2}$/.test(requested) ? `${requested}-01` : currentMonth)
  // The month-end checklist links here with ?month=yyyy-mm.
  useEffect(() => {
    if (requested && /^\d{4}-\d{2}$/.test(requested)) setMonth(`${requested}-01`)
  }, [requested])
  const [year, setYear] = useState(Number(currentMonth.slice(0, 4)))
  const [accounts, setAccounts] = useState<NetworthAccount[] | null>(null)
  const [balances, setBalances] = useState<NetworthBalance[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [dailyValues, setDailyValues] = useState<PortfolioDailyValue[]>([])
  const [payments, setPayments] = useState<InstallmentPayment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)

  const load = useCallback(() => {
    Promise.all([fetchNetworthAccounts(), fetchNetworthBalances(), fetchPortfolios(), fetchDailyValues(), fetchInstallmentPayments()])
      .then(([a, b, p, v, ip]) => {
        setAccounts(a)
        setBalances(b)
        setPortfolios(p)
        setDailyValues(v)
        setPayments(ip)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(load, [load])

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

  if (error) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load net worth: {error}</div>
  if (!accounts || !totals) return <div className="text-neutral-500">Loading net worth…</div>

  const hasPrev = prev !== null && prev.lines.length > 0
  const hasYearStart = yearStart !== null && yearStart.lines.length > 0
  const monthChange = hasPrev ? totals.net - prev!.net : null
  const yearChange = hasYearStart ? totals.net - yearStart!.net : null
  const portfolioLines = totals.lines.filter((l) => l.source === 'portfolio')

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Net worth"
        subtitle="Everything you own minus everything you owe, month by month."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-neutral-400">
              <span className="hidden sm:inline">Month</span>
              <input
                type="month"
                value={month.slice(0, 7)}
                max={currentMonth.slice(0, 7)}
                onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)}
                className={`${INPUT} w-auto`}
              />
            </label>
            <Button icon={<Settings2 size={15} />} onClick={() => setManageOpen(true)}>
              Accounts
            </Button>
          </>
        }
      />

      <CloseMonthBanner accounts={accounts} balances={balances} payments={payments} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={`Net worth · ${monthLabel(month)}`} value={currency(totals.net)} sub={`${currency(totals.assets)} assets · ${currency(totals.debts)} debts`} accent />
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

      <InstallmentsCard month={month} today={centralDateStr(new Date())} accounts={accounts} balances={balances} payments={payments} onChanged={load} />

      <BalancesTable
        month={month}
        accounts={accounts}
        balances={balances}
        portfolioLines={portfolioLines}
        onSaved={load}
        onManage={() => setManageOpen(true)}
      />

      <Drawer open={manageOpen} onClose={() => setManageOpen(false)} title="Accounts" subtitle="What you own and what you owe" width="max-w-lg">
        <ManageAccounts accounts={accounts} defaultMonth={month} onChanged={load} />
      </Drawer>
    </div>
  )
}
