import type { PortfolioActivity } from './database.types'

type Kind = PortfolioActivity['kind']

/** Entries that changed a holding. The server (portfolio_entry_delete) only lets one be
 * undone or edited while no newer live entry of BLOCKING kinds exists for the same ticker. */
const HOLDING_KINDS: Kind[] = ['buy', 'sell', 'transfer_in', 'option_exercise', 'option_assign', 'csp_assign', 'split']
const BLOCKING: Kind[] = [...HOLDING_KINDS, 'transfer_out']

/** Timestamps come back in one format and time zone, so text order settles a tie within a
 * millisecond. */
const newer = (x: PortfolioActivity, a: PortfolioActivity) => {
  const d = Date.parse(x.created_at) - Date.parse(a.created_at)
  return Number.isNaN(d) || d === 0 ? x.created_at > a.created_at : d > 0
}

/** Why each locked entry can't be undone or edited, by entry id. For display only, so a row
 * says up front what the server would answer; the server stays the authority. Pass one
 * portfolio's activity. */
export function entryLocks(activity: PortfolioActivity[]): Map<string, string> {
  const live = activity.filter((a) => a.voided_at === null)
  const bySymbol = new Map<string, PortfolioActivity[]>()
  for (const a of live) {
    if (a.symbol === null || !BLOCKING.includes(a.kind)) continue
    bySymbol.set(a.symbol, [...(bySymbol.get(a.symbol) ?? []), a])
  }
  const locks = new Map<string, string>()
  for (const a of live) {
    if (a.kind === 'transfer_out') {
      locks.set(a.id, 'Can’t be undone. Transfer the shares back, or use “Shares I already own”.')
      continue
    }
    if (a.symbol === null || !HOLDING_KINDS.includes(a.kind)) continue
    const after = (bySymbol.get(a.symbol) ?? []).filter((x) => x.id !== a.id && newer(x, a))
    if (after.length === 0) continue
    // A transfer out can never be undone, so nothing before it can be either.
    if (after.some((x) => x.kind === 'transfer_out')) locks.set(a.id, `Locked by a later ${a.symbol} transfer`)
    else locks.set(a.id, `${after.length} newer ${a.symbol} ${after.length === 1 ? 'entry: undo it first' : 'entries: undo those first'}`)
  }
  return locks
}
