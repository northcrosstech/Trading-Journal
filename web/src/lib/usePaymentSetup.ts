import { useCallback } from 'react'
import type { NetworthAccount, NetworthCategory } from './database.types'
import { updateNetworthAccount } from './wealthQueries'
import { parseAmount, useDialog, validators, type DialogField } from './dialogContext'
import { useToast } from './toastContext'

export type PaymentFieldName = 'amount' | 'day' | 'apr' | 'escrow'
type PaymentValues = Pick<NetworthAccount, 'payment_amount' | 'payment_day' | 'interest_rate' | 'escrow_amount'>

/** The payment fields that suit a debt. Only a mortgage has escrow. A card keeps the payment
 * and rate fields because a card on a fixed payment plan is tracked like a loan. */
function fieldNamesFor(category: NetworthCategory): PaymentFieldName[] {
  if (category === 'mortgage') return ['amount', 'day', 'apr', 'escrow']
  return ['amount', 'day', 'apr']
}

/** The payment fields to show for a debt, used by the "Payment details" dialog and the
 * add-account form. A field that already holds a value is always shown, so nothing saved
 * earlier is hidden or dropped. */
export function paymentFields(category: NetworthCategory, current?: PaymentValues): DialogField[] {
  const all: Record<PaymentFieldName, DialogField> = {
    amount: {
      name: 'amount',
      label: category === 'mortgage' ? 'Monthly payment (total, incl. escrow)' : category === 'credit_card' ? 'Fixed monthly payment (only if on a payment plan)' : 'Monthly payment',
      type: 'number',
      prefix: '$',
      optional: true,
      defaultValue: current?.payment_amount != null ? String(Number(current.payment_amount)) : '',
      placeholder: 'blank = pays the statement balance',
      validate: validators.nonNegative,
    },
    day: {
      name: 'day',
      label: 'Due day of the month',
      type: 'number',
      optional: true,
      defaultValue: current?.payment_day != null ? String(current.payment_day) : '',
      hint: '1–31. In shorter months, the 31st falls on the last day.',
      validate: (s) => {
        if (s.trim() === '') return null
        const n = Number(s)
        return Number.isInteger(n) && n >= 1 && n <= 31 ? null : 'Enter a day from 1 to 31'
      },
    },
    apr: {
      name: 'apr',
      label: 'Interest rate (APR %)',
      type: 'number',
      optional: true,
      defaultValue: current?.interest_rate != null ? String(Number(current.interest_rate)) : '',
      placeholder: 'e.g. 6.25',
      hint: 'Optional — used to estimate when it’s paid off and the interest left.',
      validate: validators.nonNegative,
    },
    escrow: {
      name: 'escrow',
      label: 'Escrow (property tax + insurance)',
      type: 'number',
      prefix: '$',
      optional: true,
      defaultValue: current?.escrow_amount != null ? String(Number(current.escrow_amount)) : '',
      placeholder: 'e.g. 450',
      hint: 'Optional — the part of the total above held in escrow, from your servicer’s statement. The payment minus escrow is what pays the loan.',
      validate: (s, all) => {
        const bad = validators.nonNegative(s)
        const amount = all.amount ?? ''
        if (bad || s.trim() === '' || amount === '') return bad
        return parseAmount(s)! < (parseAmount(amount) ?? 0) ? null : 'Escrow must be less than the monthly payment'
      },
    },
  }
  const suited = fieldNamesFor(category)
  const held: Record<PaymentFieldName, boolean> = {
    amount: current?.payment_amount != null,
    day: current?.payment_day != null,
    apr: current?.interest_rate != null,
    escrow: current?.escrow_amount != null,
  }
  return (['amount', 'day', 'apr', 'escrow'] as const).filter((n) => suited.includes(n) || held[n]).map((n) => all[n])
}

/** What the payment fields save. A field that wasn't shown counts as blank, which is what it
 * already holds. Escrow is only sent when there is (or was) one, so saving still works before
 * the escrow migration has been run. */
export function paymentPatch(v: Partial<Record<PaymentFieldName, string>>, hadEscrow: boolean) {
  const raw = (k: PaymentFieldName) => (v[k] ?? '').trim()
  const amount = raw('amount') === '' ? null : parseAmount(raw('amount'))
  const day = raw('day') === '' ? (amount === null ? null : 1) : Number(raw('day'))
  const escrow = amount === null || raw('escrow') === '' ? null : parseAmount(raw('escrow'))
  return {
    payment_amount: amount,
    payment_day: day,
    interest_rate: raw('apr') === '' ? null : parseAmount(raw('apr')),
    ...(escrow !== null || hadEscrow ? { escrow_amount: escrow } : {}),
  }
}

/** Opens the "Payment details" dialog for a debt account (the fields that suit its category:
 * due day for a card; payment, due day and APR for a loan; escrow too for a mortgage) and
 * saves it. Leaving the payment and due day blank removes the installment. */
export function usePaymentSetup(onChanged: () => void) {
  const dialog = useDialog()
  const toast = useToast()

  return useCallback(
    async (a: NetworthAccount) => {
      const fields = paymentFields(a.category, a)
      const card = a.category === 'credit_card'
      const v = await dialog.form({
        title: `Payment details · ${a.name}`,
        description: card
          ? 'For a card, set just the due day: each month’s closing balance is due on that day the next month (nothing when it’s $0). Clear both to remove it. Balances still come from your statements.'
          : 'The payment is due on this day the next month. Clear the payment and the due day to remove it. Balances still come from your statements.',
        submitLabel: 'Save',
        fields,
      })
      if (!v) return
      const patch = paymentPatch(v, a.escrow_amount != null)
      try {
        await updateNetworthAccount(a.id, patch)
        toast(patch.payment_amount === null && patch.payment_day === null ? `Removed the payment for ${a.name}` : `Saved the payment for ${a.name}`)
        onChanged()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [dialog, toast, onChanged],
  )
}
