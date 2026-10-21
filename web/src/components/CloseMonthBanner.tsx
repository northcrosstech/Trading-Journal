import { useEffect, useState } from 'react'
import { CalendarCheck2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { InstallmentPayment, NetworthAccount, NetworthBalance } from '../lib/database.types'
import { closeStatus } from '../lib/cashflow'
import { monthLabel, monthOf } from '../lib/networth'
import { centralDateStr } from '../lib/format'
import { fetchCloseFromMonth, setCloseFromMonth } from '../lib/wealthQueries'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Button, ButtonLink } from './ui/Button'

const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`)

/** Month-end checklist: from the 1st, until last month's balances are all entered and its
 * payments marked paid. Hidden once the month is closed, or for months before the one
 * closing starts from (set with "Start from {this month}"). */
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
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const [closeFrom, setCloseFrom] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    fetchCloseFromMonth()
      .then(setCloseFrom)
      .catch(() => setCloseFrom(null))
  }, [])

  const today = centralDateStr(new Date())
  const thisMonth = monthOf(today)
  if (closeFrom === undefined) return null // don't flash the banner before the setting loads
  const status = closeStatus(today, accounts, balances, payments, closeFrom)
  if (!status) return null
  const total = accounts.filter((a) => a.opened_month <= status.month && (a.closed_month === null || status.month < a.closed_month)).length
  const done = total - status.missing.length

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
      <div className="flex items-center gap-2">
        {closeFrom === null && (
          <Button size="sm" variant="ghost" className="text-amber-200/80" onClick={startFromThisMonth}>
            Start from {monthLabel(thisMonth, 'short')}
          </Button>
        )}
        {showLink && (
          <ButtonLink to={`/networth?month=${status.month.slice(0, 7)}`} size="sm" className="border-amber-500/40 text-amber-100">
            Update {monthLabel(status.month, 'short')} balances
          </ButtonLink>
        )}
      </div>
    </div>
  )
}
