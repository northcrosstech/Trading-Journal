/** Where a month stands in the month-end close, as the month stepper labels it. */
export type MonthStatus = 'closed' | 'to-close' | 'in-progress'

/** The current month is in progress; an earlier one is closed or still to close. */
export function monthStatus(month: string, currentMonth: string, closed: boolean): MonthStatus | null {
  if (month === currentMonth) return 'in-progress'
  if (closed) return 'closed'
  return month < currentMonth ? 'to-close' : null
}

/** A month as pages keep it in their link: ?month=yyyy-mm. */
export const isLinkMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
