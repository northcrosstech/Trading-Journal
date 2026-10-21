import { CalendarCheck2 } from 'lucide-react'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { closeStatus } from '../lib/cashflow'
import { monthLabel } from '../lib/networth'
import { centralDateStr } from '../lib/format'
import { ButtonLink } from './ui/Button'

const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`)

/** Month-end checklist: from the 1st, until last month's balances are all entered and its
 * payments marked paid. Hidden once the month is closed. */
export function CloseMonthBanner({
  accounts,
  balances,
  payments,
  showLink = true,
}: {
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  payments: InstallmentPayment[]
  showLink?: boolean
}) {
  const status = closeStatus(centralDateStr(new Date()), accounts, balances, payments)
  if (!status) return null
  const total = accounts.filter((a) => a.opened_month <= status.month && (a.closed_month === null || status.month < a.closed_month)).length
  const done = total - status.missing.length
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/15 p-2 text-amber-300">
          <CalendarCheck2 size={18} />
        </div>
        <div className="text-sm">
          <div className="font-semibold text-amber-100">
            Close {monthLabel(status.month)} · {done} of {total} balances updated
          </div>
          <div className="mt-0.5 text-amber-200/80">
            {status.missing.length > 0 && <>Still to update: {list(status.missing.map((a) => a.name))}.</>}
            {status.missing.length > 0 && status.unpaid.length > 0 && ' '}
            {status.unpaid.length > 0 && (
              <>
                {status.unpaid.length} payment{status.unpaid.length === 1 ? '' : 's'} not marked paid: {list(status.unpaid.map((a) => a.name))}.
              </>
            )}{' '}
            Use each account’s balance on the last day of the month.
          </div>
        </div>
      </div>
      {showLink && (
        <ButtonLink to={`/networth?month=${status.month.slice(0, 7)}`} size="sm" className="border-amber-500/40 text-amber-100">
          Update {monthLabel(status.month, 'short')} balances
        </ButtonLink>
      )}
    </div>
  )
}
