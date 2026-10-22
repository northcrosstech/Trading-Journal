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
        description: 'For a card, set just the due day: what\u2019s due is the statement balance (nothing when it\u2019s $0). Clear both to remove it. Balances still come from your statements.',
        submitLabel: 'Save',
        fields: [
          {
            name: 'amount',
            label: 'Monthly payment (total, incl. escrow)',
            type: 'number',
            prefix: '$',
            optional: true,
            defaultValue: a.payment_amount != null ? String(Number(a.payment_amount)) : '',
            placeholder: 'blank = pays the statement balance',
            validate: validators.nonNegative,
          },
          {
            name: 'day',
            label: 'Due day of the month',
            type: 'number',
            optional: true,
            defaultValue: a.payment_day != null ? String(a.payment_day) : '',
            hint: '1–31. In shorter months, the 31st falls on the last day.',
            validate: (s) => {
              if (s.trim() === '') return null
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
          {
            name: 'escrow',
            label: 'Escrow (property tax + insurance)',
            type: 'number',
            prefix: '$',
            optional: true,
            defaultValue: a.escrow_amount != null ? String(Number(a.escrow_amount)) : '',
            placeholder: 'e.g. 450',
            hint: 'Optional — the part of the total above held in escrow, from your servicer’s statement. The payment minus escrow is what pays the loan.',
            validate: (s, all) => {
              const bad = validators.nonNegative(s)
              if (bad || s.trim() === '' || all.amount === '') return bad
              return parseAmount(s)! < (parseAmount(all.amount) ?? 0) ? null : 'Escrow must be less than the monthly payment'
            },
          },
        ],
      })
      if (!v) return
      const amount = v.amount === '' ? null : parseAmount(v.amount)
      const day = v.day.trim() === '' ? (amount === null ? null : 1) : Number(v.day)
      const escrow = amount === null || v.escrow === '' ? null : parseAmount(v.escrow)
      try {
        await updateNetworthAccount(a.id, {
          payment_amount: amount,
          payment_day: day,
          interest_rate: v.apr === '' ? null : parseAmount(v.apr),
          // Only send escrow when there is (or was) one, so saving still works before the
          // escrow migration has been run.
          ...(escrow !== null || a.escrow_amount != null ? { escrow_amount: escrow } : {}),
        })
        toast(amount === null && day === null ? `Removed the payment for ${a.name}` : `Saved the payment for ${a.name}`)
        onChanged()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [dialog, toast, onChanged],
  )
}
