import type { Trade, Execution } from './database.types'
import { centralDateStr } from './format'

// Standard US equity option contract multiplier. Not currently persisted per-trade
// (options_detail stores strike/expiration/type/premium but not the multiplier), so
// this is an assumption -- correct for every real trade in this account so far, but
// would be wrong for an unusual adjusted contract. Revisit if that ever comes up.
const ASSUMED_OPTION_MULTIPLIER = 100

function contractMultiplier(assetType: Trade['asset_type']): number {
  return assetType === 'option' ? ASSUMED_OPTION_MULTIPLIER : 1
}

export type TrimResult = {
  /** Gross -- no fee allocation. A trade's fee typically lands on one execution (see
   * buildFillExecutions in lib/queries.ts), so splitting it across trims would imply a
   * precision the data doesn't have. */
  realizedDollarGross: number
  /** Return relative to this trim's share of the running average cost basis -- null
   * if that cost basis is 0 (shouldn't happen for a real fill, but division by zero
   * is still division by zero). */
  realizedPct: number | null
  costBasis: number
}

export type CostBasisAnalysis = {
  /** Peak dollar capital actually committed to the position at any single moment --
   * replaces the old "max(entry total, exit total)" heuristic, which happened to
   * equal whichever of those two was numerically larger (driven purely by whether
   * price rose or fell) rather than anything about position size, since both used the
   * same total_contracts figure. This walks real fills, so it reflects true adds/trims. */
  peakExposureUsd: number | null
  /** Keyed by execution id -- only trim/exit (closing) fills have an entry. */
  trimResults: Map<string, TrimResult>
}

/** Walks a trade's fills in chronological order using running weighted-average-cost
 * accounting (not FIFO lots): every add blends into a single average cost per share,
 * and every trim/exit is priced against THAT average as of the moment it happens --
 * matching what a broker's live P&L display shows in real time, and what a trader
 * actually saw while making the decision to trim, rather than an after-the-fact FIFO
 * lot assignment that mostly matters for tax accounting. A trim's share of the
 * average cost is removed proportionally, which is what keeps the average cost of
 * whatever remains open unchanged -- the defining property of this method. A trade's
 * side is fixed for its whole life in this schema (a direction flip becomes two
 * separate trades upstream, e.g. in the Robinhood importer's grouping), so there's no
 * need to handle a running position changing sign here. */
export function computeCostBasisAnalysis(
  trade: Pick<Trade, 'side' | 'asset_type'> & { executions: Pick<Execution, 'id' | 'action' | 'quantity' | 'price' | 'filled_at'>[] },
): CostBasisAnalysis {
  const multiplier = contractMultiplier(trade.asset_type)
  const direction = trade.side === 'long' ? 1 : -1
  const sorted = [...trade.executions].sort((a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime())

  let runningQty = 0
  let runningCostBasis = 0
  let peakExposureUsd = 0
  const trimResults = new Map<string, TrimResult>()

  for (const e of sorted) {
    const isEntry = e.action === 'entry' || e.action === 'add'
    if (isEntry) {
      runningQty += e.quantity
      runningCostBasis += e.quantity * e.price * multiplier
      peakExposureUsd = Math.max(peakExposureUsd, runningCostBasis)
      continue
    }

    // Proportional share of the current average cost, not a fixed per-share price
    // times quantity -- equivalent, but avoids a separate division that could drift
    // from runningCostBasis's own rounding over many trims.
    const costBasis = runningQty > 0 ? runningCostBasis * (e.quantity / runningQty) : 0
    runningQty -= e.quantity
    runningCostBasis -= costBasis

    const proceeds = e.price * e.quantity * multiplier
    const realizedDollarGross = direction === 1 ? proceeds - costBasis : costBasis - proceeds
    trimResults.set(e.id, { realizedDollarGross, realizedPct: costBasis > 0 ? realizedDollarGross / costBasis : null, costBasis })
  }

  return { peakExposureUsd: sorted.length > 0 ? peakExposureUsd : null, trimResults }
}

/**
 * Return on capital: net P&L / capital deployed. Capital deployed is the premium
 * paid for a long trade; for a short-premium trade this uses the premium collected
 * as a stand-in for true margin/collateral (which isn't tracked anywhere in the
 * schema yet) -- so it reads as "return relative to premium involved" rather than a
 * true margin-based ROI for shorts.
 */
export function returnOnCapitalPct(trade: Pick<Trade, 'avg_entry' | 'total_contracts' | 'realized_pnl_net' | 'asset_type'>): number | null {
  if (trade.avg_entry === null || trade.total_contracts === null || trade.realized_pnl_net === null) return null
  const capital = trade.avg_entry * trade.total_contracts * contractMultiplier(trade.asset_type)
  if (capital === 0) return null
  return trade.realized_pnl_net / capital
}

/** Total dollar size at entry: avg_entry * contracts * multiplier. */
export function entrySizeUsd(trade: Pick<Trade, 'avg_entry' | 'total_contracts' | 'asset_type'>): number | null {
  if (trade.avg_entry === null || trade.total_contracts === null) return null
  return trade.avg_entry * trade.total_contracts * contractMultiplier(trade.asset_type)
}

/** Total dollar size at exit: avg_exit * contracts * multiplier. */
export function exitSizeUsd(trade: Pick<Trade, 'avg_exit' | 'total_contracts' | 'asset_type'>): number | null {
  if (trade.avg_exit === null || trade.total_contracts === null) return null
  return trade.avg_exit * trade.total_contracts * contractMultiplier(trade.asset_type)
}

export type EquityPoint = {
  date: string // yyyy-mm-dd, the trade's close date
  timestamp: number // epoch ms of close time -- lets the chart use a real time axis
  cumulativeNetPnl: number
  tradeNetPnl: number
  feeSource: 'estimated' | 'actual'
  symbol: string
}

export type CalendarDay = {
  date: string // yyyy-mm-dd
  netPnl: number
  tradeCount: number
  anyEstimated: boolean
}

/** Closed trades only, ordered by when the P&L became real (close time). */
function closedTradesByCloseDate(trades: Trade[]): Trade[] {
  return trades
    .filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.last_out_at)
    .sort((a, b) => new Date(a.last_out_at!).getTime() - new Date(b.last_out_at!).getTime())
}

export function computeEquityCurve(trades: Trade[]): EquityPoint[] {
  const closed = closedTradesByCloseDate(trades)
  let cumulative = 0
  return closed.map((t) => {
    cumulative += t.realized_pnl_net ?? 0
    return {
      date: centralDateStr(new Date(t.last_out_at!)),
      timestamp: new Date(t.last_out_at!).getTime(),
      cumulativeNetPnl: cumulative,
      tradeNetPnl: t.realized_pnl_net ?? 0,
      feeSource: t.fee_source,
      symbol: t.symbol,
    }
  })
}

export type DailyTargetStatus = 'hit_target' | 'gave_it_back' | 'breached_loss' | 'reversal_breach' | 'neutral'

export type DailyTargetResult = {
  date: string
  netPnlClose: number // end-of-day realized net P&L
  intradayPeakRealized: number // max cumulative realized P&L seen while walking the day's closes in order
  hitTargetClosed: boolean
  reachedTargetIntraday: boolean // peak >= target but close < target -- "gave it back" (also true for a reversal_breach day)
  breachedLossLimit: boolean
  // single marker for calendar display, priority: reversal (hit target, gave it back,
  // AND breached the loss limit) > plain breach > hit > gave-back
  status: DailyTargetStatus
}

export type TargetSettingsInput = { profit_target_value: number | null; loss_limit_value: number | null }

/**
 * Realized-P&L-only approximation of intraday performance -- NOT mark-to-market
 * unrealized P&L. `intradayPeakRealized` only moves when a trade actually closes and
 * books P&L, so it can't reflect an open position's paper gains/losses; it answers
 * "how far ahead did booked profit get before end of day," which is enough to detect
 * "was green then gave it back" without needing any live/unrealized price feed.
 */
/** Closed trades (with a defined P&L and close time) grouped by the date their P&L
 * booked -- the shared bucketing step behind both computeDailyTargetStats and
 * computePlanVsActual. */
function groupClosedTradesByDate(trades: Trade[]): Map<string, Trade[]> {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.last_out_at)
  const byDate = new Map<string, Trade[]>()
  for (const t of closed) {
    const date = centralDateStr(new Date(t.last_out_at!))
    const list = byDate.get(date)
    if (list) list.push(t)
    else byDate.set(date, [t])
  }
  return byDate
}

type DayWalk = { close: number; peak: number; trough: number }

/** Walks a day's closed trades in timestamp order, accumulating realized net P&L.
 * `peak`/`trough` both start at 0 (the day's flat baseline before any trade closes)
 * rather than the first trade's own P&L, so "best/worst point reached" stays
 * meaningful even for a day that only ever moved one direction. */
function walkDayCumulative(dayTrades: Pick<Trade, 'realized_pnl_net' | 'last_out_at'>[]): DayWalk {
  const ordered = [...dayTrades].sort((a, b) => new Date(a.last_out_at!).getTime() - new Date(b.last_out_at!).getTime())
  let cumulative = 0
  let peak = 0
  let trough = 0
  for (const t of ordered) {
    cumulative += t.realized_pnl_net ?? 0
    peak = Math.max(peak, cumulative)
    trough = Math.min(trough, cumulative)
  }
  return { close: cumulative, peak, trough }
}

export function computeDailyTargetStats(
  trades: Trade[],
  settings: TargetSettingsInput | null,
): Map<string, DailyTargetResult> {
  const result = new Map<string, DailyTargetResult>()
  if (!settings || (settings.profit_target_value === null && settings.loss_limit_value === null)) return result

  const target = settings.profit_target_value
  const lossLimit = settings.loss_limit_value
  const byDate = groupClosedTradesByDate(trades)

  for (const [date, dayTrades] of byDate) {
    const { close, peak } = walkDayCumulative(dayTrades)

    const netPnlClose = close
    const intradayPeakRealized = peak
    const hitTargetClosed = target !== null && netPnlClose >= target
    const reachedTargetIntraday = target !== null && intradayPeakRealized >= target && netPnlClose < target
    const breachedLossLimit = lossLimit !== null && netPnlClose <= -lossLimit

    let status: DailyTargetStatus = 'neutral'
    if (breachedLossLimit && reachedTargetIntraday) status = 'reversal_breach' // hit target, gave it back, kept going all the way to breach
    else if (breachedLossLimit) status = 'breached_loss'
    else if (hitTargetClosed) status = 'hit_target'
    else if (reachedTargetIntraday) status = 'gave_it_back'

    result.set(date, { date, netPnlClose, intradayPeakRealized, hitTargetClosed, reachedTargetIntraday, breachedLossLimit, status })
  }

  return result
}

export function computeCalendarDays(trades: Trade[]): Map<string, CalendarDay> {
  const closed = closedTradesByCloseDate(trades)
  const byDay = new Map<string, CalendarDay>()

  for (const t of closed) {
    const date = centralDateStr(new Date(t.last_out_at!))
    const existing = byDay.get(date)
    const netPnl = t.realized_pnl_net ?? 0
    if (existing) {
      existing.netPnl += netPnl
      existing.tradeCount += 1
      existing.anyEstimated = existing.anyEstimated || t.fee_source === 'estimated'
    } else {
      byDay.set(date, { date, netPnl, tradeCount: 1, anyEstimated: t.fee_source === 'estimated' })
    }
  }

  return byDay
}

/** Thresholds for flagging an unusually large position against the trader's own history. */
export const OVERSIZE_LOOKBACK_TRADES = 30
export const OVERSIZE_MIN_HISTORY = 10
export const OVERSIZE_RATIO = 1.5

/** "Usual" position size per asset type: the median peak exposure of the most recent
 * closed trades before `beforeDate` (yyyy-mm-dd, Central). Median rather than mean so
 * one oversized blowup doesn't drag the baseline up and hide the next one. Options and
 * stock are kept apart since their dollar sizes aren't comparable. Null until there's
 * enough history for the baseline to mean anything. */
export function typicalPositionSize(
  trades: (Pick<Trade, 'side' | 'asset_type' | 'status' | 'last_out_at'> & {
    executions: Pick<Execution, 'id' | 'action' | 'quantity' | 'price' | 'filled_at'>[]
  })[],
  beforeDate: string,
): Map<Trade['asset_type'], number> {
  const recent = trades
    .filter((t) => t.status === 'CLOSED' && t.last_out_at && centralDateStr(new Date(t.last_out_at)) < beforeDate)
    .sort((a, b) => (b.last_out_at ?? '').localeCompare(a.last_out_at ?? ''))

  const sizesByType = new Map<Trade['asset_type'], number[]>()
  for (const t of recent) {
    const sizes = sizesByType.get(t.asset_type) ?? []
    if (sizes.length >= OVERSIZE_LOOKBACK_TRADES) continue
    const size = computeCostBasisAnalysis(t).peakExposureUsd
    if (size === null || size <= 0) continue
    sizes.push(size)
    sizesByType.set(t.asset_type, sizes)
  }

  const result = new Map<Trade['asset_type'], number>()
  for (const [type, sizes] of sizesByType) {
    if (sizes.length < OVERSIZE_MIN_HISTORY) continue
    const s = [...sizes].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    result.set(type, s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2)
  }
  return result
}
