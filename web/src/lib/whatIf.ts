import type { Trade } from './database.types'
import { strengthsOf } from './strengths'

/** How an exit compares with its "what if" alternative, judged by the trade's tags --
 * so a stop that was honored and then reversed reads as an acceptable cost of
 * discipline, not as a mistake to fix. */
export type OutcomeKind =
  | 'left_on_table' // exited early (or untagged) and a better exit existed -- a process leak
  | 'cost_of_ignoring_stop' // held too long / no stop, and the stop would have lost less
  | 'cost_of_discipline' // cut fast / honored stop and it then worked -- right call, didn't pay
  | 'saved_by_discipline' // cut fast / honored stop and it kept going against you
  | 'beat_alternative' // your actual exit was better than the alternative

export const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  left_on_table: 'Left on table',
  cost_of_ignoring_stop: 'Cost of ignoring stop',
  cost_of_discipline: 'Cost of discipline',
  saved_by_discipline: 'Saved by discipline',
  beat_alternative: 'Beat the alternative',
}

export type TradeOutcome = {
  risk: number | null // 1R in dollars: |entry - stop| x size
  plannedR: number | null // target distance in R
  realizedR: number | null // actual gross P&L in R
  whatIfPnl: number | null // gross P&L had the whole position exited at alt_exit_price
  delta: number | null // whatIfPnl - actual gross P&L; > 0 means the alternative was better
  kind: OutcomeKind | null
}

type OutcomeInput = Pick<
  Trade,
  'asset_type' | 'side' | 'avg_entry' | 'total_contracts' | 'realized_pnl_gross' | 'mistakes' | 'stop_price' | 'target_price' | 'alt_exit_price'
> & { strengths?: string[] | null }

/** All prices are the traded instrument's own price (option premium for options), the
 * same units as avg_entry, so contracts x 100 converts them to dollars. Gross of fees,
 * so planned and realized R compare like for like. */
export function tradeOutcome(t: OutcomeInput): TradeOutcome {
  const entry = t.avg_entry
  const qty = t.total_contracts
  const mult = t.asset_type === 'option' ? 100 : 1
  const dir = t.side === 'short' ? -1 : 1
  const stop = t.stop_price ?? null
  const target = t.target_price ?? null
  const alt = t.alt_exit_price ?? null
  const actual = t.realized_pnl_gross

  const dollars = (price: number) => (entry === null || qty === null ? null : dir * (price - entry) * qty * mult)

  const riskRaw = stop !== null && entry !== null && qty !== null ? Math.abs(entry - stop) * qty * mult : null
  const risk = riskRaw ? riskRaw : null // a zero-width stop has no meaningful R
  const plannedDollars = target !== null ? dollars(target) : null
  const whatIfPnl = alt !== null ? dollars(alt) : null
  const delta = whatIfPnl !== null && actual !== null ? whatIfPnl - actual : null

  return {
    risk,
    plannedR: risk && plannedDollars !== null ? plannedDollars / risk : null,
    realizedR: risk && actual !== null ? actual / risk : null,
    whatIfPnl,
    delta,
    kind: delta === null || Math.abs(delta) < 0.005 ? null : classify(delta, t.mistakes ?? [], strengthsOf(t)),
  }
}

function classify(delta: number, mistakes: string[], strengths: string[]): OutcomeKind {
  if (mistakes.includes('Exited Early') && delta > 0) return 'left_on_table'
  if ((mistakes.includes('Held Too Long') || mistakes.includes('No Stop')) && delta > 0) return 'cost_of_ignoring_stop'
  if (strengths.includes('Cut Loser Fast') || strengths.includes('Honored Stop')) {
    return delta > 0 ? 'cost_of_discipline' : 'saved_by_discipline'
  }
  return delta > 0 ? 'left_on_table' : 'beat_alternative'
}

export function rFmt(r: number | null): string {
  return r === null ? '—' : `${r >= 0 ? '' : '−'}${Math.abs(r).toFixed(1)}R`
}
