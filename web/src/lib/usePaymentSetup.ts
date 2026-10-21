import { useCallback } from 'react'
import type { NetworthAccount } from './database.types'
import { updateNetworthAccount } from './wealthQueries'
import { parseAmount, useDialog, validators } from './dialogContext'
import { useToast } from './toastContext'

/** Opens the "Payment details" dialog for a debt account (monthly payment, due day, APR)
 * and saves it. Leaving the payment blank removes the installment. */
export function usePaymentSetup(onChanged: () => void) {
  const dialog = useDialog()
  const toast = useToast()

  return useCallback(
    async (a: NetworthAccount) => {
      const v = await dialog.form({
        title: `Payment details · ${a.name}`,
        description: 'Leave the payment blank to remove it. Balances still come from your statements.',
        submitLabel: 'Save',
        fields: [
          {
            name: 'amount',
            label: 'Monthly payment',
            type: 'number',
            prefix: '$',
            optional: true,
            defaultValue: a.payment_amount != null ? String(Number(a.payment_amount)) : '',
            placeholder: 'e.g. 2,150',
            validate: validators.nonNegative,
          },
          {
            name: 'day',
            label: 'Due day of the month',
            type: 'number',
            optional: true,
            defaultValue: a.payment_day != null ? String(a.payment_day) : '1',
            hint: '1–31. In shorter months, the 31st falls on the last day.',
            validate: (s, all) => {
              if (all.amount === '') return null
              const n = Number(s)
              return Number.isInteger(n) && n >= 1 && n <= 31 ? null : 'Enter a day from 1 to 31'
            },
          },
          {
            name: 'apr',
            label: 'Interest rate (APR %)',
            type: 'number',
            optional: true,
            defaultValue: a.interest_rate != null ? String(Number(a.interest_rate)) : '',
            placeholder: 'e.g. 6.25',
            hint: 'Optional — used to estimate when it’s paid off and the interest left.',
            validate: validators.nonNegative,
          },
        ],
      })
      if (!v) return
      const amount = v.amount === '' ? null : parseAmount(v.amount)
      try {
        await updateNetworthAccount(a.id, {
          payment_amount: amount,
          payment_day: amount === null ? null : Number(v.day || 1),
          interest_rate: amount === null || v.apr === '' ? null : parseAmount(v.apr),
        })
        toast(amount === null ? `Removed the payment for ${a.name}` : `Saved the payment for ${a.name}`)
        onChanged()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [dialog, toast, onChanged],
  )
}
