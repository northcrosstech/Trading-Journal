import { useCallback } from 'react'
import { useAuth } from '../auth/AuthContext'
import { addMonths, monthLabel, monthOf } from './networth'
import { centralDateStr } from './format'
import { setCloseFromMonth } from './wealthQueries'
import { useDialog } from './dialogContext'
import { useToast } from './toastContext'

/** Past the 15th of the month after it, a month's close is late. */
export function closeIsLate(today: string, month: string): boolean {
  return month < addMonths(monthOf(today), -1) || Number(today.slice(8, 10)) > 15
}

/** "Start from {this month}": asks, then sets the month closing starts from, so `waiting`
 * and earlier months are no longer asked to be closed. Shared by the close banner and the
 * close card, which stands in for the banner on Net worth. */
export function useStartCloseFrom(onStarted: (month: string) => void) {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()

  return useCallback(
    async (waiting: string) => {
      if (!user) return
      const thisMonth = monthOf(centralDateStr(new Date()))
      const ok = await dialog.confirm({
        title: `Start closing from ${monthLabel(thisMonth)}?`,
        message: `${monthLabel(waiting)} and earlier won’t be asked to be closed. Your first close will be ${monthLabel(thisMonth)}, from the 1st of next month. Balances you’ve already entered are kept.`,
        confirmLabel: `Start from ${monthLabel(thisMonth, 'short')}`,
      })
      if (!ok) return
      try {
        await setCloseFromMonth(user.id, thisMonth)
        onStarted(thisMonth)
        toast(`Month-end close starts from ${monthLabel(thisMonth)}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast(/wealth_settings/.test(msg) ? 'Run the wealth_settings migration first' : msg, 'error')
      }
    },
    [user, dialog, toast, onStarted],
  )
}
