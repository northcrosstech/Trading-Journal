import { CheckCircle2, Circle, Lock, LockOpen } from 'lucide-react'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { closeBlocker, closeChecklist, type MonthBook } from '../lib/cashflow'
import { addMonths, monthLabel } from '../lib/networth'
import { centralDateStr, dateFmt } from '../lib/format'
import { closeNetworthMonth, reopenNetworthMonth } from '../lib/wealthQueries'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'

const dayOf = (at: string) => dateFmt(centralDateStr(new Date(at)))

function Check({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : <Circle size={15} className="mt-0.5 shrink-0 text-neutral-500" />}
      <span className={done ? 'text-neutral-300' : 'text-neutral-100'}>
        {label}
        {detail && <span className="block text-xs text-neutral-500">{detail}</span>}
      </span>
    </li>
  )
}

/** The viewed month's place in the close: in progress, open with its checklist and Close, or
 * closed with Reopen. Closing locks the month's balances and payments; every close and reopen
 * stays in its history. */
export function MonthClosePanel({
  month,
  currentMonth,
  accounts,
  balances,
  payments,
  book,
  closeFrom,
  onChanged,
}: {
  month: string
  currentMonth: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  payments: InstallmentPayment[]
  book: MonthBook
  closeFrom: string | null
  onChanged: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  if (month > currentMonth) return null
  const name = monthLabel(month)
  const closedAt = book.closedAt.get(month) ?? null
  const history = book.log.filter((l) => l.month === month).slice(-5).reverse()

  async function run(p: Promise<unknown>, message: string) {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function close() {
    const ok = await dialog.confirm({
      title: `Close ${name}?`,
      message: `This locks ${name}'s balances and payments. You can reopen it later, with a reason, if something needs correcting.`,
      confirmLabel: `Close ${monthLabel(month, 'short')}`,
    })
    if (ok) run(closeNetworthMonth(month), `${name} closed`)
  }

  async function reopen() {
    const later = [...book.closedAt.keys()].filter((m) => m > month).sort()
    const next = monthLabel(addMonths(month, 1), 'short')
    const v = await dialog.form({
      title: `Reopen ${name}?`,
      description: `${later.length > 0 ? `This also reopens ${later.map((m) => monthLabel(m)).join(', ')}, since months close in order. ` : ''}Changing ${name} changes its cash flow and ${next}'s. Balances already saved for later months stay as they are.`,
      submitLabel: 'Reopen',
      tone: 'warning',
      fields: [{ name: 'reason', label: 'Why are you reopening it?', placeholder: 'e.g. Corrected statement from the bank', validate: (s) => (s.trim() ? null : 'Enter a reason') }],
    })
    if (v) run(reopenNetworthMonth(month, v.reason), `${name} reopened`)
  }

  const historyList = history.length > 0 && (
    <ul className="mt-3 flex flex-col gap-1 border-t border-(--border) pt-3 text-xs text-neutral-500">
      {history.map((l) => (
        <li key={l.id}>
          {l.action === 'close' ? 'Closed' : 'Reopened'} {dayOf(l.at)}
          {l.reason && <span> · {l.reason}</span>}
        </li>
      ))}
    </ul>
  )

  if (month === currentMonth) {
    return (
      <Card title={`${name} · month-end close`} subtitle={`In progress. You can close it from ${dateFmt(addMonths(month, 1))}.`} actions={<Pill tone="blue">In progress</Pill>} />
    )
  }

  if (closedAt) {
    return (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Lock size={14} className="text-emerald-400" /> {name} · closed
          </span>
        }
        subtitle={`Closed ${dayOf(closedAt)}. Its balances and payments are locked.`}
        actions={
          book.ready ? (
            <Button size="sm" icon={<LockOpen size={14} />} onClick={reopen}>
              Reopen
            </Button>
          ) : undefined
        }
      >
        {historyList || undefined}
      </Card>
    )
  }

  const { missing, unpaid } = closeChecklist(month, accounts, balances, payments)
  const blocker = closeBlocker(month, balances, book, closeFrom)
  const openCount = accounts.filter((a) => a.opened_month <= month && (a.closed_month === null || month < a.closed_month)).length
  const ready = missing.length === 0 && unpaid.length === 0 && blocker === null

  return (
    <Card
      title={`${name} · month-end close`}
      subtitle={ready ? 'Everything is in. Check the numbers, then close the month.' : 'Open. Finish the checklist to close the month.'}
      actions={
        <Button size="sm" variant="primary" icon={<Lock size={14} />} onClick={close} disabled={!ready}>
          Close {monthLabel(month, 'short')}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2">
        {blocker && <Check done={false} label={`Close ${monthLabel(blocker)} first`} detail="Months close in order." />}
        <Check
          done={missing.length === 0}
          label={`${openCount - missing.length} of ${openCount} balances confirmed`}
          detail={missing.length > 0 ? `Still to enter or confirm: ${missing.map((a) => a.name).join(', ')}` : undefined}
        />
        <Check done={unpaid.length === 0} label={unpaid.length === 0 ? 'All payments marked paid' : `${unpaid.length} payment${unpaid.length === 1 ? '' : 's'} not marked paid`} detail={unpaid.length > 0 ? unpaid.map((a) => a.name).join(', ') : undefined} />
      </ul>
      {historyList}
    </Card>
  )
}
