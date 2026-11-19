import { ArrowDown, ArrowRight, CheckCircle2, Circle, Lock, LockOpen } from 'lucide-react'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { closeBlocker, closeChecklist, type MonthBook } from '../lib/cashflow'
import { addMonths, isDebt, isOpenIn, monthLabel } from '../lib/networth'
import { expectedPayment, hasPaymentPlan } from '../lib/installments'
import { centralDateStr, dateFmt } from '../lib/format'
import { closeNetworthMonth, reopenNetworthMonth } from '../lib/wealthQueries'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'

const dayOf = (at: string) => dateFmt(centralDateStr(new Date(at)))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One checklist line. A line that still needs doing is a button that takes you to the work:
 * down the page to the first row it's about, or across to another month. */
function Check({ done, label, detail, onClick, across = false }: { done: boolean; label: string; detail?: string; onClick?: () => void; across?: boolean }) {
  const Arrow = across ? ArrowRight : ArrowDown
  const body = (
    <>
      {done ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : <Circle size={15} className="mt-0.5 shrink-0 text-neutral-500" />}
      <span className={`min-w-0 flex-1 ${done ? 'text-neutral-300' : 'text-neutral-100'}`}>
        {label}
        {detail && <span className="block text-xs text-neutral-500">{detail}</span>}
      </span>
    </>
  )
  if (done || !onClick) return <li className="flex items-start gap-2 px-2 py-1 text-sm">{body}</li>
  return (
    <li>
      <button onClick={onClick} className="group flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-sm transition hover:bg-white/5">
        {body}
        <Arrow size={14} className="mt-0.5 shrink-0 text-neutral-500 transition group-hover:text-(--accent-text)" />
      </button>
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
  onJumpToBalances,
  onJumpToPayments,
  onOpenMonth,
  late = false,
  note,
  startFrom,
}: {
  month: string
  currentMonth: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  payments: InstallmentPayment[]
  book: MonthBook
  closeFrom: string | null
  onChanged: () => void
  /** Take the user to the first of these accounts' balance fields / payment rows. */
  onJumpToBalances?: (accountIds: string[]) => void
  onJumpToPayments?: (accountIds: string[]) => void
  /** Switch the page to the month that has to close first. */
  onOpenMonth?: (month: string) => void
  /** The page shows this card instead of the close banner, so it carries the banner's extras:
   * the overdue mark, why the page opened on this month, and "Start from {this month}". */
  late?: boolean
  note?: string | null
  startFrom?: { label: string; onClick: () => void }
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
  const open = accounts.filter((a) => isOpenIn(a, month))
  const openCount = open.length
  // Display only: the payments the checklist asks about, to say "3 of 4". What's still unpaid
  // comes from closeChecklist.
  const payable = open.filter((a) => isDebt(a.category) && hasPaymentPlan(a) && expectedPayment(a, balances, month).amount > 0).length
  const ready = missing.length === 0 && unpaid.length === 0 && blocker === null
  const progress = `${openCount - missing.length} of ${openCount} balances${payable > 0 ? ` · ${payable - unpaid.length} of ${payable} payments` : ''}`

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {name} · month-end close {late && <Pill tone="amber">Overdue</Pill>}
        </span>
      }
      subtitle={
        <>
          <span className="text-sm font-medium tabular-nums text-neutral-200">{progress}</span>
          <span className="block">{ready ? 'Everything is in. Check the numbers, then close the month.' : 'Finish the list below to close the month.'}</span>
          {note && <span className="block">{note}</span>}
        </>
      }
      actions={
        <>
          {startFrom && (
            <Button size="sm" variant="ghost" onClick={startFrom.onClick}>
              {startFrom.label}
            </Button>
          )}
          <Button size="sm" variant="primary" icon={<Lock size={14} />} onClick={close} disabled={!ready}>
            Close {monthLabel(month, 'short')}
          </Button>
        </>
      }
    >
      <ul className="-mx-2 flex flex-col gap-0.5">
        {blocker && <Check done={false} label={`Close ${monthLabel(blocker)} first`} detail="Months close in order." onClick={onOpenMonth ? () => onOpenMonth(blocker) : undefined} across />}
        <Check
          done={missing.length === 0}
          label={missing.length > 0 ? `${plural(missing.length, 'balance')} to enter or confirm` : openCount > 0 ? 'All balances confirmed' : 'No balances to enter'}
          detail={missing.length > 0 ? missing.map((a) => a.name).join(', ') : undefined}
          onClick={onJumpToBalances ? () => onJumpToBalances(missing.map((a) => a.id)) : undefined}
        />
        <Check
          done={unpaid.length === 0}
          label={unpaid.length === 0 ? (payable > 0 ? 'All payments marked paid' : 'No payments to mark paid') : `${plural(unpaid.length, 'payment')} not marked paid`}
          detail={unpaid.length > 0 ? unpaid.map((a) => a.name).join(', ') : undefined}
          onClick={onJumpToPayments ? () => onJumpToPayments(unpaid.map((a) => a.id)) : undefined}
        />
      </ul>
      {historyList}
    </Card>
  )
}
