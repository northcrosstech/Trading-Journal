/** Shared fill math for manual trade entry and CSV import -- both funnel through this
 * so the live form preview and the actual saved trade can never disagree. Mirrors how
 * the sync worker groups executions into a trade (transform.py), simplified to a
 * single blended avg entry/exit per trade (matching how avg_entry/avg_exit are
 * already stored: one number each, not per-lot) rather than true FIFO lot tracking. */

export type FillAction = 'open' | 'add' | 'trim' | 'close'

export type FillInput = {
  action: FillAction
  time: string // ISO
  price: number
  quantity: number
}

export type FillSummary = {
  avgEntry: number | null
  avgExit: number | null
  entryQty: number
  exitQty: number
  netQty: number
  closed: boolean // exitQty >= entryQty (and entryQty > 0)
  firstFillTime: string | null
  lastExitFillTime: string | null
}

const isEntryAction = (a: FillAction) => a === 'open' || a === 'add'
const isExitAction = (a: FillAction) => a === 'trim' || a === 'close'

export function summarizeFills(fills: FillInput[]): FillSummary {
  const entryFills = fills.filter((f) => isEntryAction(f.action))
  const exitFills = fills.filter((f) => isExitAction(f.action))
  const entryQty = entryFills.reduce((s, f) => s + f.quantity, 0)
  const exitQty = exitFills.reduce((s, f) => s + f.quantity, 0)
  const avgEntry = entryQty > 0 ? entryFills.reduce((s, f) => s + f.quantity * f.price, 0) / entryQty : null
  const avgExit = exitQty > 0 ? exitFills.reduce((s, f) => s + f.quantity * f.price, 0) / exitQty : null

  const byTime = [...fills].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const exitsByTime = [...exitFills].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const closed = entryQty > 0 && exitQty >= entryQty

  return {
    avgEntry,
    avgExit,
    entryQty,
    exitQty,
    netQty: entryQty - exitQty,
    closed,
    firstFillTime: byTime[0]?.time ?? null,
    lastExitFillTime: closed ? (exitsByTime[exitsByTime.length - 1]?.time ?? null) : null,
  }
}

/** Only meaningful once summary.closed -- the realized P&L on the (fully closed)
 * position. multiplier is 100 for options, 1 for stock; direction is +1 long, -1
 * short. */
export function computeRealizedPnlGross(summary: FillSummary, multiplier: number, direction: 1 | -1): number | null {
  if (!summary.closed || summary.avgEntry === null || summary.avgExit === null) return null
  return (summary.avgExit - summary.avgEntry) * summary.entryQty * multiplier * direction
}

/** buy/sell for a single fill, given the trade's overall side -- a long trade buys to
 * open/add and sells to trim/close; a short trade does the reverse. */
export function executionSide(action: FillAction, tradeSide: 'long' | 'short'): 'buy' | 'sell' {
  const entering = isEntryAction(action)
  if (tradeSide === 'long') return entering ? 'buy' : 'sell'
  return entering ? 'sell' : 'buy'
}
