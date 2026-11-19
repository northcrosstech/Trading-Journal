import type { AuditProblem } from './database.types'

/** Plain names for the Health check's checks. */
export const CHECK_LABEL: Record<AuditProblem['check_name'], string> = {
  shares: 'Shares',
  avg_cost: 'Average cost',
  cash: 'Cash',
  position: 'Option / put',
  covered_call: 'Covered call',
  price: 'Price',
  daily_value: 'Daily value',
}
