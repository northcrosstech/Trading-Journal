import { CalendarClock, CheckCircle2, Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { markInstallmentPaid, unmarkInstallmentPaid } from '../lib/wealthQueries'
import { categoryLabel, isDebt, isOpenIn, monthLabel } from '../lib/networth'
import { balanceUpTo, daysBetween, dueDateIn, durationLabel, expectedPayment, hasPaymentPlan, payoff } from '../lib/installments'
import { currency, dateFmt } from '../lib/format'
import { parseAmount, useDialog, validators } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { usePaymentSetup } from '../lib/usePaymentSetup'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { Menu } from './ui/Menu'
import { EmptyState } from './ui/EmptyState'

/** Monthly payments on debts for the selected month: due date, amount, APR, balance, the
 * payoff estimate, and a paid / due soon / overdue status with Mark paid. Status words only
 * apply to the current month; past months show paid or not, future ones just the schedule. */
export function InstallmentsCard({
  month,
  today,
  accounts,
  balances,
  payments,
  onChanged,
}: {
  month: string
  today: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  payments: InstallmentPayment[]
  onChanged: () => void
}) {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const editPayment = usePaymentSetup(onChanged)
  const currentMonth = `${today.slice(0, 7)}-01`

  const debts = accounts.filter((a) => isDebt(a.category) && isOpenIn(a, month))
  const withPayment = debts.filter(hasPaymentPlan)
  const withoutPayment = debts.filter((a) => !hasPaymentPlan(a))

  const rows = withPayment
    .map((a) => {
      const due = dueDateIn(month, a.payment_day ?? 1)
      const paid = payments.find((p) => p.account_id === a.id && p.month === month) ?? null
      const balance = balanceUpTo(a, balances, month)
      const { amount: expected, fixed } = expectedPayment(a, balances, month)
      // Escrow (property tax + insurance) doesn't pay down the loan: payoff uses principal + interest only.
      const escrow = fixed ? Number(a.escrow_amount ?? 0) : 0
      const principalAndInterest = expected - escrow
      const monthlyInterest = balance !== null && a.interest_rate ? (balance * Number(a.interest_rate)) / 1200 : 0
      // A card paid off each statement has no payoff schedule.
      const plan = fixed && balance !== null ? payoff(balance, a.interest_rate ?? null, principalAndInterest, month) : null
      return { a, due, paid, balance, plan, escrow, principalAndInterest, monthlyInterest, expected, fixed, nothingDue: !fixed && expected === 0 }
    })
    .sort((x, y) => x.due.localeCompare(y.due))

  const total = rows.reduce((s, r) => s + r.expected, 0)
  const paidTotal = rows.reduce((s, r) => s + (r.paid ? Number(r.paid.amount) : 0), 0)
  const left = rows.filter((r) => !r.paid).reduce((s, r) => s + r.expected, 0)

  async function markPaid(r: (typeof rows)[number]) {
    if (!user) return
    const v = await dialog.form({
      title: `Mark ${r.a.name} paid`,
      description: `${monthLabel(month)} payment, due ${dateFmt(r.due)}.`,
      submitLabel: 'Mark paid',
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'number', prefix: '$', defaultValue: String(r.expected), validate: validators.positive },
        { name: 'on', label: 'Paid on', type: 'date', defaultValue: month === currentMonth ? today : r.due },
      ],
    })
    if (!v) return
    try {
      await markInstallmentPaid(user.id, { accountId: r.a.id, month, amount: parseAmount(v.amount)!, paidOn: v.on })
      toast(`${r.a.name} marked paid`)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function undo(r: (typeof rows)[number]) {
    try {
      await unmarkInstallmentPaid(r.a.id, month)
      toast(`${r.a.name} marked unpaid`)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  function status(r: (typeof rows)[number]) {
    if (r.paid) return <Pill tone="green"><CheckCircle2 size={12} /> Paid {dateFmt(r.paid.paid_on)}</Pill>
    if (r.nothingDue) return <Pill>Nothing due</Pill>
    if (month < currentMonth) return <Pill tone="red">Not marked paid</Pill>
    if (month > currentMonth) return <Pill>Scheduled</Pill>
    const days = daysBetween(today, r.due)
    if (days < 0) return <Pill tone="red">Overdue {-days}d</Pill>
    if (days === 0) return <Pill tone="amber">Due today</Pill>
    if (days <= 7) return <Pill tone="amber">Due in {days}d</Pill>
    return <Pill>Due in {days}d</Pill>
  }

  if (debts.length === 0) return null

  return (
    <Card
      title="Monthly payments"
      subtitle={
        rows.length > 0 ? (
          <>
            {monthLabel(month)} · {currency(total)} total · <span className="text-emerald-300">{currency(paidTotal)} paid</span> ·{' '}
            <span className={left > 0 ? 'text-amber-300' : 'text-neutral-400'}>{currency(left)} left</span>
          </>
        ) : (
          'Track the monthly payment on each debt, when it’s due, and when it’ll be paid off.'
        )
      }
      flush
    >
      {rows.length === 0 ? (
        <EmptyState icon={<CalendarClock size={20} />} title="No payments set up yet">
          Add the monthly payment, due day and rate for your mortgage, loans and cards below.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                <th className="px-5 py-2.5">Due</th>
                <th className="px-3 py-2.5">Account</th>
                <th className="px-3 py-2.5 text-right">Payment</th>
                <th className="px-3 py-2.5 text-right">APR</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
                <th className="px-3 py-2.5">Paid off</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="w-32 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.a.id} className="border-b border-(--border) last:border-0 hover:bg-white/2">
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-neutral-200">{dateFmt(r.due)}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-white">{r.a.name}</div>
                    <div className="text-xs text-neutral-500">{categoryLabel(r.a.category)}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div className={`font-medium ${r.nothingDue ? 'text-neutral-500' : 'text-white'}`}>{currency(r.expected)}</div>
                    {!r.fixed && <div className="whitespace-nowrap text-xs text-neutral-500">statement balance</div>}
                    {r.escrow > 0 && (
                      <div className="whitespace-nowrap text-xs text-neutral-500" title="Principal & interest · escrow (property tax + insurance)">
                        {currency(r.principalAndInterest)} P&amp;I · {currency(r.escrow)} escrow
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-400">{r.a.interest_rate != null ? `${Number(r.a.interest_rate)}%` : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-300">{r.balance !== null ? currency(r.balance) : '—'}</td>
                  <td className="px-3 py-3">
                    {!r.fixed ? (
                      <span className="text-xs text-neutral-600">paid each statement</span>
                    ) : r.plan === null ? (
                      <span className="text-xs text-neutral-600">{r.balance === null ? 'needs a balance' : '—'}</span>
                    ) : r.plan.kind === 'paid_off' ? (
                      <span className="text-emerald-300">Paid off</span>
                    ) : r.plan.kind === 'never' ? (
                      <span className="text-xs text-red-300" title="Check the payment is the total you pay including escrow, and the rate is the yearly APR">
                        Payment doesn’t cover interest
                        <span className="block text-neutral-500">
                          {r.escrow > 0 ? 'P&I' : 'Payment'} {currency(r.principalAndInterest)} vs {currency(r.monthlyInterest)} interest/mo
                        </span>
                      </span>
                    ) : (
                      <>
                        <div className="text-neutral-200">{monthLabel(r.plan.payoffMonth)}</div>
                        <div className="text-xs text-neutral-500">
                          {durationLabel(r.plan.months)}
                          {r.a.interest_rate ? ` · ${currency(r.plan.interest)} interest` : ''}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3">{status(r)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="flex items-center justify-end gap-1">
                      {!r.paid && !r.nothingDue && (
                        <Button size="sm" variant="primary" onClick={() => markPaid(r)}>
                          Mark paid
                        </Button>
                      )}
                      <Menu
                        label={`Actions for ${r.a.name}`}
                        items={[
                          ...(r.paid ? [{ label: 'Mark unpaid', onClick: () => undo(r) }] : []),
                          { label: 'Payment details…', onClick: () => editPayment(r.a) },
                        ]}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {withoutPayment.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-(--border) px-5 py-3 text-sm">
          <span className="text-neutral-500">Add a payment for:</span>
          {withoutPayment.map((a) => (
            <Button key={a.id} size="sm" icon={<Plus size={13} />} onClick={() => editPayment(a)}>
              {a.name}
            </Button>
          ))}
        </div>
      )}
    </Card>
  )
}
