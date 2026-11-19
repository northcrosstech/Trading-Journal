import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck2 } from 'lucide-react'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { EMPTY_BOOK, closeStatus, type MonthBook } from '../lib/cashflow'
import { monthLabel, monthOf } from '../lib/networth'
import { centralDateStr } from '../lib/format'
import { fetchCloseFromMonth, fetchMonthBook } from '../lib/wealthQueries'
import { closeIsLate, useStartCloseFrom } from '../lib/closeReminder'
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
  closeFrom: givenCloseFrom,
  onChanged,
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
  /** The page's own copy of the month closing starts from (null = not set), so the banner
   * doesn't load it again. Pass onChanged with it, to reload it after "Start from". */
  closeFrom?: string | null
  /** Called after "Start from {this month}" has been saved. */
  onChanged?: () => void
}) {
  const [ownCloseFrom, setCloseFrom] = useState<string | null | undefined>(undefined)
  const closeFrom = givenCloseFrom !== undefined ? givenCloseFrom : ownCloseFrom

  const [ownBook, setOwnBook] = useState<MonthBook | undefined>(undefined)
  const book = givenBook ?? ownBook

  useEffect(() => {
    if (givenCloseFrom === undefined)
      fetchCloseFromMonth()
        .then(setCloseFrom)
        .catch(() => setCloseFrom(null))
    if (!givenBook)
      fetchMonthBook()
        .then(setOwnBook)
        .catch(() => setOwnBook(EMPTY_BOOK))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startFrom = useStartCloseFrom(
    useCallback(
      (m: string) => {
        setCloseFrom(m)
        onChanged?.()
      },
      [onChanged],
    ),
  )

  const today = centralDateStr(new Date())
  const thisMonth = monthOf(today)
  if (closeFrom === undefined || !book) return null // don't flash the banner before the settings load
  const status = closeStatus(today, accounts, balances, payments, closeFrom, book)
  if (!status) return null
  const late = closeIsLate(today, status.month)
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
          <Button size="sm" variant="ghost" className="text-amber-200/80" onClick={() => startFrom(status.month)}>
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
