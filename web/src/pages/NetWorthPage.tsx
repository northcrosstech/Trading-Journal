import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { NetworthAccount, NetworthBalance, NetworthCategory, Portfolio, PortfolioDailyValue } from '../lib/database.types'
import {
  createNetworthAccount,
  deleteNetworthAccount,
  fetchDailyValues,
  fetchNetworthAccounts,
  fetchNetworthBalances,
  fetchPortfolios,
  saveMonthBalances,
  updateNetworthAccount,
} from '../lib/wealthQueries'
import { CATEGORIES, addMonths, categoryLabel, isDebt, isOpenIn, monthLabel, monthOf, monthTotals, yearTotals } from '../lib/networth'
import { centralDateStr, currency } from '../lib/format'
import { NetWorthChart } from '../components/WealthCharts'
import { Kpi } from '../components/WealthBits'
import { signedCurrency as signed } from '../lib/portfolio'

const INPUT =
  'rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'
const CARD = 'rounded-xl border border-neutral-800 bg-neutral-900 p-4'

/** Parses a balance box: blank = no balance this month, otherwise a non-negative number
 * (commas and $ allowed). undefined = not a valid number. */
function parseAmount(raw: string): number | null | undefined {
  const t = raw.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** The month's balances: open accounts only, pre-filled with this month's entry or the
 * most recent earlier one, so only what changed needs typing. Portfolio-fed lines are
 * shown read-only. */
function MonthForm({
  month,
  accounts,
  balances,
  portfolioLines,
  onSaved,
}: {
  month: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  portfolioLines: { key: string; name: string; category: NetworthCategory; amount: number }[]
  onSaved: () => void
}) {
  const { user } = useAuth()
  const open = useMemo(() => accounts.filter((a) => isOpenIn(a, month)), [accounts, month])
  const prefill = useMemo(() => {
    const out = new Map<string, { value: string; from: string | null }>()
    for (const a of open) {
      let best: NetworthBalance | null = null
      for (const b of balances) if (b.account_id === a.id && b.month <= month && (!best || b.month > best.month)) best = b
      out.set(a.id, { value: best ? String(Number(best.balance)) : '', from: best && best.month !== month ? best.month : null })
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

  async function save() {
    if (!user) return
    const entries: { accountId: string; balance: number | null }[] = []
    for (const a of open) {
      const parsed = parseAmount(draft.get(a.id) ?? '')
      if (parsed === undefined) {
        setError(`"${draft.get(a.id)}" isn't a valid amount for ${a.name}. Enter a positive number — debts are subtracted automatically.`)
        return
      }
      entries.push({ accountId: a.id, balance: parsed })
    }
    setSaving(true)
    setError(null)
    try {
      await saveMonthBalances(user.id, month, entries)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const group = (debt: boolean) => open.filter((a) => isDebt(a.category) === debt)
  const carried = Array.from(prefill.values()).some((p) => p.from)

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-medium text-neutral-200">Balances for {monthLabel(month)}</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Enter every balance as a positive number — debts are subtracted for you. Leave a box blank if there's no balance this month.
      </p>
      {open.length === 0 && portfolioLines.length === 0 ? (
        <p className="text-sm text-neutral-500">No accounts open this month — add one under Accounts.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {([false, true] as const).map((debt) => {
            const list = group(debt)
            const linked = portfolioLines.filter((l) => isDebt(l.category) === debt)
            if (list.length === 0 && linked.length === 0) return null
            return (
              <div key={String(debt)}>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">{debt ? 'Debts' : 'Assets'}</h3>
                <div className="flex flex-col gap-1.5">
                  {list.map((a) => {
                    const p = prefill.get(a.id)
                    return (
                      <label key={a.id} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-neutral-200">{a.name}</span>
                          <span className="text-[11px] text-neutral-500">
                            {categoryLabel(a.category)}
                            {p?.from && <span className="text-amber-500/80"> · carried from {monthLabel(p.from)}</span>}
                          </span>
                        </span>
                        <span className="relative w-36">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
                          <input
                            inputMode="decimal"
                            value={draft.get(a.id) ?? ''}
                            onChange={(e) => setDraft((d) => new Map(d).set(a.id, e.target.value))}
                            className={`${INPUT} w-full pl-5 text-right tabular-nums`}
                          />
                        </span>
                      </label>
                    )
                  })}
                  {linked.map((l) => (
                    <div key={l.key} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-200">{l.name}</span>
                        <span className="text-[11px] text-neutral-500">{categoryLabel(l.category)} · from Portfolios</span>
                      </span>
                      <span className="w-36 pr-2.5 text-right text-sm tabular-nums text-neutral-400">{currency(Math.abs(l.amount))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-500">{carried ? 'Amber rows are last month’s figure — saving keeps them for this month.' : ''}</span>
            <button
              onClick={save}
              disabled={saving || open.length === 0}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save month'}
            </button>
          </div>
          {error && <p className="text-xs text-(--status-critical)">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** Add, rename, close and reopen accounts. Closing keeps the history but drops the
 * account from the monthly form from its closing month on. */
function AccountsCard({ accounts, defaultMonth, onChanged }: { accounts: NetworthAccount[]; defaultMonth: string; onChanged: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<NetworthCategory>('cash')
  const [opened, setOpened] = useState(defaultMonth.slice(0, 7))
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closeMonth, setCloseMonth] = useState(defaultMonth.slice(0, 7))
  const [error, setError] = useState<string | null>(null)

  const run = (p: Promise<unknown>) =>
    p.then(onChanged).catch((e) => setError(e instanceof Error ? e.message : String(e)))

  async function add() {
    if (!user || !name.trim()) return
    setError(null)
    await run(createNetworthAccount(user.id, { name: name.trim(), category, opened_month: `${opened}-01` }).then(() => setName('')))
  }

  const openAccounts = accounts.filter((a) => a.closed_month === null)
  const closedAccounts = accounts.filter((a) => a.closed_month !== null)

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-medium text-neutral-200">Accounts</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Closing an account removes it from the monthly form from that month on — its past balances stay in your history.
      </p>

      <div className="flex flex-col divide-y divide-neutral-800/60">
        {[...openAccounts, ...closedAccounts].map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${a.closed_month ? 'text-neutral-500' : 'text-neutral-200'}`}>{a.name}</span>
              <span className="text-[11px] text-neutral-500">
                {categoryLabel(a.category)} · since {monthLabel(a.opened_month)}
                {a.closed_month && ` · closed ${monthLabel(a.closed_month)}`}
              </span>
            </span>
            {closingId === a.id ? (
              <span className="flex items-center gap-1.5">
                <input type="month" value={closeMonth} onChange={(e) => setCloseMonth(e.target.value)} className={`${INPUT} py-1 text-xs`} />
                <button
                  onClick={() => {
                    const m = `${closeMonth}-01`
                    if (m <= a.opened_month) {
                      setError('The closing month has to be after the month the account opened.')
                      return
                    }
                    setClosingId(null)
                    run(updateNetworthAccount(a.id, { closed_month: m }))
                  }}
                  className="rounded-md bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
                >
                  Close
                </button>
                <button onClick={() => setClosingId(null)} className="text-xs text-neutral-500 hover:text-neutral-300">
                  Cancel
                </button>
              </span>
            ) : a.closed_month ? (
              <button onClick={() => run(updateNetworthAccount(a.id, { closed_month: null }))} className="text-xs text-blue-400 hover:text-blue-300">
                Reopen
              </button>
            ) : (
              <span className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const next = window.prompt('Rename account', a.name)?.trim()
                    if (next && next !== a.name) run(updateNetworthAccount(a.id, { name: next }))
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Rename
                </button>
                <button onClick={() => setClosingId(a.id)} className="text-xs text-neutral-500 hover:text-neutral-300">
                  Close…
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${a.name}" and all its balances? To keep its history, close it instead.`)) run(deleteNetworthAccount(a.id))
                  }}
                  className="text-xs text-neutral-600 hover:text-red-400"
                >
                  Delete
                </button>
              </span>
            )}
          </div>
        ))}
        {accounts.length === 0 && <p className="py-2 text-sm text-neutral-500">No accounts yet.</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name, e.g. Chase checking" className={`${INPUT} min-w-0 flex-1`} />
        <select value={category} onChange={(e) => setCategory(e.target.value as NetworthCategory)} className={INPUT}>
          <optgroup label="Assets">
            {CATEGORIES.filter((c) => !c.debt).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Debts">
            {CATEGORIES.filter((c) => c.debt).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
        </select>
        <input type="month" value={opened} onChange={(e) => setOpened(e.target.value)} className={INPUT} title="Month the account opened" />
        <button
          onClick={add}
          disabled={!name.trim()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          Add account
        </button>
      </div>
      <p className="mt-2 text-[11px] text-neutral-600">
        401k, IRA and brokerage portfolios set up under <Link to="/portfolios" className="text-neutral-400 hover:text-neutral-200">Portfolios</Link> are
        added automatically — don't add them here too.
      </p>
      {error && <p className="mt-2 text-xs text-(--status-critical)">{error}</p>}
    </div>
  )
}

export function NetWorthPage() {
  const currentMonth = monthOf(centralDateStr(new Date()))
  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(Number(currentMonth.slice(0, 4)))
  const [accounts, setAccounts] = useState<NetworthAccount[] | null>(null)
  const [balances, setBalances] = useState<NetworthBalance[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [dailyValues, setDailyValues] = useState<PortfolioDailyValue[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchNetworthAccounts(), fetchNetworthBalances(), fetchPortfolios(), fetchDailyValues()])
      .then(([a, b, p, v]) => {
        setAccounts(a)
        setBalances(b)
        setPortfolios(p)
        setDailyValues(v)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  const totals = useMemo(
    () => (accounts ? monthTotals(month, accounts, balances, portfolios, dailyValues) : null),
    [month, accounts, balances, portfolios, dailyValues],
  )
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
    const first = Math.min(
      Number(currentMonth.slice(0, 4)),
      ...(accounts ?? []).map((a) => Number(a.opened_month.slice(0, 4))),
    )
    const out: number[] = []
    for (let y = Number(currentMonth.slice(0, 4)); y >= first; y--) out.push(y)
    return out
  }, [accounts, currentMonth])

  if (error) return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load net worth: {error}</div>
  if (!accounts || !totals) return <div className="text-neutral-500">Loading net worth…</div>

  const hasPrev = prev && prev.lines.length > 0
  const hasYearStart = yearStart && yearStart.lines.length > 0
  const portfolioLines = totals.lines.filter((l) => l.source === 'portfolio')

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Net worth</h1>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Month
          <input
            type="month"
            value={month.slice(0, 7)}
            max={currentMonth.slice(0, 7)}
            onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)}
            className={INPUT}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={`Net worth · ${monthLabel(month)}`} value={currency(totals.net)} sub={`${currency(totals.assets)} assets · ${currency(totals.debts)} debts`} />
        <Kpi
          label="Change from last month"
          value={hasPrev ? signed(totals.net - prev!.net) : '—'}
          tone={hasPrev ? totals.net - prev!.net : null}
        />
        <Kpi
          label="Change this year"
          value={hasYearStart ? signed(totals.net - yearStart!.net) : '—'}
          sub={hasYearStart ? `since December ${Number(month.slice(0, 4)) - 1}` : 'needs a December balance'}
          tone={hasYearStart ? totals.net - yearStart!.net : null}
        />
        <Kpi label="Excluding home" value={currency(totals.netExHome)} sub="net worth without home & mortgage" />
      </div>

      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-200">Net worth by month</h2>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${INPUT} py-1 text-xs`}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <NetWorthChart data={bars} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MonthForm month={month} accounts={accounts} balances={balances} portfolioLines={portfolioLines} onSaved={load} />
        <AccountsCard accounts={accounts} defaultMonth={month} onChanged={load} />
      </div>
    </div>
  )
}
