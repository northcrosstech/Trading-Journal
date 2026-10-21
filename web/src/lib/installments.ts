import { addMonths } from './networth'

/** The due date (yyyy-mm-dd) of a payment in a given month (yyyy-mm-01). A due day past the
 * month's end -- the 31st in a 30-day month -- falls on the month's last day. */
export function dueDateIn(month: string, paymentDay: number): string {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month.slice(0, 8)}${String(Math.min(paymentDay, lastDay)).padStart(2, '0')}`
}

/** Whole days from `from` to `to` (both yyyy-mm-dd); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export type Payoff =
  | { kind: 'paid_off' }
  | { kind: 'never' } // the payment doesn't cover the monthly interest
  | { kind: 'months'; months: number; payoffMonth: string; interest: number }

/** Standard amortization: months to pay off `balance` at `aprPct` with a fixed monthly
 * `payment`, the month it ends (counting from `fromMonth`), and the interest still to pay.
 * n = -ln(1 - r*B/P) / ln(1 + r), with r the monthly rate; with no rate, B / P. */
export function payoff(balance: number, aprPct: number | null, payment: number, fromMonth: string): Payoff | null {
  if (!(payment > 0)) return null
  if (balance <= 0) return { kind: 'paid_off' }
  const r = (aprPct ?? 0) / 100 / 12
  let n: number
  if (r === 0) {
    n = balance / payment
  } else {
    if (payment <= balance * r) return { kind: 'never' }
    n = -Math.log(1 - (r * balance) / payment) / Math.log(1 + r)
  }
  // A final sliver under 1% of a payment (from cent-rounded payments) folds into the last one.
  const months = Math.max(1, Math.ceil(n - 0.01))
  return { kind: 'months', months, payoffMonth: addMonths(fromMonth, months), interest: Math.max(0, n * payment - balance) }
}

/** "3y 4m" / "11m" -- how long until a debt is paid off. */
export function durationLabel(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  return y === 0 ? `${m}m` : m === 0 ? `${y}y` : `${y}y ${m}m`
}
