import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { NetworthAccount, NetworthCategory } from '../lib/database.types'
import { createNetworthAccount, deleteNetworthAccount, saveMonthBalances, updateNetworthAccount } from '../lib/wealthQueries'
import { ACCOUNT_CATEGORIES, categoryLabel, isDebt, monthLabel } from '../lib/networth'
import { errorMessage, parseBalance } from '../lib/balanceInput'
import { currency } from '../lib/format'
import { INPUT, LABEL } from '../lib/ui'
import { useDialog, type DialogField } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { paymentFields, paymentPatch, usePaymentSetup } from '../lib/usePaymentSetup'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { Menu } from './ui/Menu'

/** One text box of the add form, drawn like the app's dialogs: label, optional "$", then the
 * error or the hint underneath. */
function Field({ field, value, error, onChange }: { field: Pick<DialogField, 'label' | 'optional' | 'prefix' | 'placeholder' | 'hint'>; value: string; error?: string | null; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>
        {field.label}
        {field.optional && <span className="font-normal text-neutral-600"> (optional)</span>}
      </span>
      <span className="relative">
        {field.prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">{field.prefix}</span>}
        <input
          inputMode="decimal"
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} ${field.prefix ? 'pl-7' : ''} ${error ? 'border-red-500/70' : ''}`}
        />
      </span>
      {error ? <span className="text-xs text-red-400">{error}</span> : field.hint && <span className="text-xs text-neutral-500">{field.hint}</span>}
    </label>
  )
}

/** Everything a new account needs in one form: name, category, opened month, the balance for
 * the month on screen and, for a debt, its payment. Saved in that order; if a later part
 * fails, the account is kept and the form says which parts went through. */
function AddAccount({ month, monthLocked, onChanged }: { month: string; monthLocked: boolean; onChanged: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<NetworthCategory>('cash')
  const [opened, setOpened] = useState(month.slice(0, 7))
  const [balance, setBalance] = useState('')
  const [pay, setPay] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [partial, setPartial] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const debt = isDebt(category)
  const payFields = debt ? paymentFields(category) : []
  // A balance only makes sense for a month the account is open in, and a closed month is locked.
  const balanceAllowed = opened !== '' && `${opened}-01` <= month && !monthLocked

  async function add(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!user || busy || !trimmed || opened === '') return

    const found: Record<string, string | null> = {}
    const amount = balanceAllowed ? parseBalance(balance) : null
    if (amount === undefined) found.balance = 'Enter a positive number, or leave it blank'
    const values = Object.fromEntries(payFields.map((f) => [f.name, (pay[f.name] ?? '').trim()]))
    for (const f of payFields) found[f.name] = f.validate?.(values[f.name], values) ?? null
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    const hasPayment = payFields.some((f) => values[f.name] !== '')

    setBusy(true)
    setPartial(null)
    let created: NetworthAccount
    try {
      created = await createNetworthAccount(user.id, { name: trimmed, category, opened_month: `${opened}-01` })
    } catch (err) {
      toast(errorMessage(err), 'error')
      setBusy(false)
      return
    }
    const saved = ['the account']
    const failed: string[] = []
    if (amount != null) {
      try {
        await saveMonthBalances(user.id, month, [{ accountId: created.id, balance: amount }])
        saved.push(`its ${monthLabel(month)} balance`)
      } catch (err) {
        failed.push(`its ${monthLabel(month)} balance (${errorMessage(err)})`)
      }
    }
    if (hasPayment) {
      try {
        await updateNetworthAccount(created.id, paymentPatch(values, false))
        saved.push('its payment details')
      } catch (err) {
        failed.push(`its payment details (${errorMessage(err)})`)
      }
    }
    if (failed.length === 0) {
      toast(`Added “${trimmed}”`)
    } else {
      const message = `Saved ${saved.join(' and ')} for “${trimmed}”. Not saved: ${failed.join(' and ')}.`
      setPartial(`${message} Add what’s missing from the Balances table or the account’s menu below.`)
      toast(message, 'error')
    }
    // The account exists either way, so the form clears: pressing Add again must not make a second one.
    setName('')
    setBalance('')
    setPay({})
    setBusy(false)
    onChanged()
  }

  return (
    <form onSubmit={add} className="flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--card-raised) p-4">
      <h3 className="text-sm font-semibold text-white">Add an account</h3>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase checking" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as NetworthCategory)} className={INPUT}>
          <optgroup label="What you own">
            {ACCOUNT_CATEGORIES.filter((c) => !c.debt).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="What you owe">
            {ACCOUNT_CATEGORIES.filter((c) => c.debt).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Opened</span>
          <input type="month" value={opened} onChange={(e) => setOpened(e.target.value)} className={INPUT} />
        </label>
        {balanceAllowed && (
          <Field
            field={{ label: `Balance for ${monthLabel(month)}`, optional: true, prefix: '$', placeholder: debt ? 'what you owe' : undefined }}
            value={balance}
            error={errors.balance}
            onChange={setBalance}
          />
        )}
      </div>
      <span className="-mt-1 text-xs text-neutral-500">
        It shows up in the monthly form from its opened month on.
        {!balanceAllowed && opened !== '' && (monthLocked ? ` ${monthLabel(month)} is closed, so its balance can’t be added here.` : ` It opens after ${monthLabel(month)}, so enter its balance once you’re on that month.`)}
      </span>

      {debt && (
        <div className="flex flex-col gap-3 border-t border-(--border) pt-3">
          <div>
            <div className="text-xs font-semibold text-neutral-200">Payment</div>
            <div className="text-xs text-neutral-500">
              {category === 'credit_card'
                ? 'Each month’s closing balance is due on this day the next month.'
                : 'Lists it under Monthly payments, due on this day the next month.'}
            </div>
          </div>
          {payFields.map((f) => (
            <Field key={f.name} field={f} value={pay[f.name] ?? ''} error={errors[f.name]} onChange={(v) => setPay((p) => ({ ...p, [f.name]: v }))} />
          ))}
        </div>
      )}

      <Button type="submit" variant="primary" disabled={!name.trim() || opened === '' || busy} icon={<Plus size={16} />}>
        {busy ? 'Adding…' : 'Add account'}
      </Button>
      {partial && <p className="text-xs text-red-400">{partial}</p>}
      <p className="text-xs text-neutral-500">
        401k, IRA and brokerage portfolios set up under{' '}
        <Link to="/portfolios" className="text-(--accent-text) hover:underline">
          Portfolios
        </Link>{' '}
        are added automatically — don’t add them here too.
      </p>
    </form>
  )
}

/** Side panel: add accounts, rename, close / reopen, delete. Closing keeps history but drops
 * the account from the monthly form from its closing month on. */
export function ManageAccounts({
  accounts,
  month,
  monthLocked,
  onChanged,
}: {
  accounts: NetworthAccount[]
  /** The month on screen: the default opened / closing month, and the month a new account's balance is for. */
  month: string
  monthLocked: boolean
  onChanged: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const editPayment = usePaymentSetup(onChanged)

  const run = async (p: Promise<unknown>, message: string) => {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
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
          defaultValue: month.slice(0, 7),
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
      <AddAccount month={month} monthLocked={monthLocked} onChanged={onChanged} />

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
