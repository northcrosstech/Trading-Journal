import { useEffect, useState } from 'react'
import { CalendarCheck2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { EMPTY_BOOK, closeStatus, type MonthBook } from '../lib/cashflow'
import { addMonths, monthLabel, monthOf } from '../lib/networth'
import { centralDateStr } from '../lib/format'
import { fetchCloseFromMonth, fetchMonthBook, setCloseFromMonth } from '../lib/wealthQueries'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Button, ButtonLink } from './ui/Button'

const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`)

/** Month-end reminder: from the 1st until last month is closed with its Close button, more
 * insistent after the 15th. Hidden for months before the one closing starts from (set with
 * "Start from {this month}"). */
export function CloseMonthBanner({
  accounts,
  balances,
  payments,
  showLink = true,
  viewing,
  onOpenMonth,
  book: givenBook,
}: {
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  payments: InstallmentPayment[]
  showLink?: boolean
  /** On the Net worth page: the month on screen, and how to switch to the one being closed. */
  viewing?: string
  onOpenMonth?: (month: string) => void
  /** The page's own copy of the closed months, so the banner follows a close at once. */
  book?: MonthBook
}) {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const [closeFrom, setCloseFrom] = useState<string | null | undefined>(undefined)

  const [ownBook, setOwnBook] = useState<MonthBook | undefined>(undefined)
  const book = givenBook ?? ownBook

  useEffect(() => {
    fetchCloseFromMonth()
      .then(setCloseFrom)
      .catch(() => setCloseFrom(null))
    if (!givenBook)
      fetchMonthBook()
        .then(setOwnBook)
        .catch(() => setOwnBook(EMPTY_BOOK))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const today = centralDateStr(new Date())
  const thisMonth = monthOf(today)
  if (closeFrom === undefined || !book) return null // don't flash the banner before the settings load
  const status = closeStatus(today, accounts, balances, payments, closeFrom, book)
  if (!status) return null
  // Past the 15th of the month after it, the close is late.
  const late = status.month < addMonths(thisMonth, -1) || Number(today.slice(8, 10)) > 15
  const total = accounts.filter((a) => a.opened_month <= status.month && (a.closed_month === null || status.month < a.closed_month)).length
  const done = total - status.missing.length
  const onClosingMonth = viewing === status.month
  // Says why Net worth opened where it did: last month is kept through the 5th, then the new month takes over.
  const why = !viewing
    ? null
    : onClosingMonth
      ? Number(today.slice(8, 10)) <= 5
        ? `Showing ${monthLabel(status.month)} until you close it, or through the 5th.`
        : null
      : viewing === thisMonth
        ? `Showing ${monthLabel(thisMonth)} since the 5th has passed, but ${monthLabel(status.month)} was never closed.`
        : null

  async function startFromThisMonth() {
    if (!user) return
    const ok = await dialog.confirm({
      title: `Start closing from ${monthLabel(thisMonth)}?`,
      message: `${monthLabel(status!.month)} and earlier won’t be asked to be closed. Your first close will be ${monthLabel(thisMonth)}, from the 1st of next month. Balances you’ve already entered are kept.`,
      confirmLabel: `Start from ${monthLabel(thisMonth, 'short')}`,
    })
    if (!ok) return
    try {
      await setCloseFromMonth(user.id, thisMonth)
      setCloseFrom(thisMonth)
      toast(`Month-end close starts from ${monthLabel(thisMonth)}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(/wealth_settings/.test(msg) ? 'Run the wealth_settings migration first' : msg, 'error')
    }
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 ${late ? 'border-amber-400/60 bg-amber-500/15' : 'border-amber-500/25 bg-amber-500/8'}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/15 p-2 text-amber-300">
          <CalendarCheck2 size={18} />
        </div>
        <div className="text-sm">
          <div className="font-semibold text-amber-100">
            {status.ready ? `${monthLabel(status.month)} is ready to close` : `Close ${monthLabel(status.month)} · ${done} of ${total} balances confirmed`}
            {late && ' · overdue'}
          </div>
          {why && <div className="mt-0.5 text-amber-100/90">{why}</div>}
          <div className="mt-0.5 text-amber-200/80">
            {status.missing.length > 0 && <>Still to update: {list(status.missing.map((a) => a.name))}.</>}
            {status.missing.length > 0 && status.unpaid.length > 0 && ' '}
            {status.unpaid.length > 0 && (
              <>
                {status.unpaid.length} payment{status.unpaid.length === 1 ? '' : 's'} not marked paid: {list(status.unpaid.map((a) => a.name))}.
              </>
            )}{' '}
            {status.ready ? 'Check the numbers, then press Close on the Net worth page.' : 'Use each account’s balance on the last day of the month.'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {closeFrom === null && (
          <Button size="sm" variant="ghost" className="text-amber-200/80" onClick={startFromThisMonth}>
            Start from {monthLabel(thisMonth, 'short')}
          </Button>
        )}
        {onOpenMonth && !onClosingMonth && (
          <Button size="sm" className="border-amber-500/40 text-amber-100" onClick={() => onOpenMonth(status.month)}>
            Open {monthLabel(status.month, 'short')}
          </Button>
        )}
        {showLink && !onOpenMonth && (
          <ButtonLink to={`/networth?month=${status.month.slice(0, 7)}`} size="sm" className="border-amber-500/40 text-amber-100">
            {status.ready ? `Review ${monthLabel(status.month, 'short')}` : `Update ${monthLabel(status.month, 'short')} balances`}
          </ButtonLink>
        )}
      </div>
    </div>
  )
}
