import type { Trade } from './database.types'

// Standard US equity option contract multiplier. Not currently persisted per-trade
// (options_detail stores strike/expiration/type/premium but not the multiplier), so
// this is an assumption -- correct for every real trade in this account so far, but
// would be wrong for an unusual adjusted contract. Revisit if that ever comes up.
const ASSUMED_OPTION_MULTIPLIER = 100

/**
 * Return on capital: net P&L / capital deployed. Capital deployed is the premium
 * paid for a long trade; for a short-premium trade this uses the premium collected
 * as a stand-in for true margin/collateral (which isn't tracked anywhere in the
 * schema yet) -- so it reads as "return relative to premium involved" rather than a
 * true margin-based ROI for shorts.
 */
export function returnOnCapitalPct(trade: Pick<Trade, 'avg_entry' | 'total_contracts' | 'realized_pnl_net'>): number | null {
  if (trade.avg_entry === null || trade.total_contracts === null || trade.realized_pnl_net === null) return null
  const capital = trade.avg_entry * trade.total_contracts * ASSUMED_OPTION_MULTIPLIER
  if (capital === 0) return null
  return trade.realized_pnl_net / capital
}

/** (avg_exit - avg_entry) / avg_entry -- the underlying contract's own price move,
 * independent of position size or fees. */
export function priceMovePct(trade: Pick<Trade, 'avg_entry' | 'avg_exit'>): number | null {
  if (trade.avg_entry === null || trade.avg_exit === null || trade.avg_entry === 0) return null
  return (trade.avg_exit - trade.avg_entry) / trade.avg_entry
}

/** Total dollar size at entry: avg_entry * contracts * multiplier. */
export function entrySizeUsd(trade: Pick<Trade, 'avg_entry' | 'total_contracts'>): number | null {
  if (trade.avg_entry === null || trade.total_contracts === null) return null
  return trade.avg_entry * trade.total_contracts * ASSUMED_OPTION_MULTIPLIER
}

/** Total dollar size at exit: avg_exit * contracts * multiplier. */
export function exitSizeUsd(trade: Pick<Trade, 'avg_exit' | 'total_contracts'>): number | null {
  if (trade.avg_exit === null || trade.total_contracts === null) return null
  return trade.avg_exit * trade.total_contracts * ASSUMED_OPTION_MULTIPLIER
}

export type DashboardMetrics = {
  totalNetPnl: number
  winRate: number | null
  profitFactor: number | null
  currentStreak: { count: number; kind: 'win' | 'loss' } | null
  closedCount: number
  estimatedFeeTradeCount: number
}

export type EquityPoint = {
  date: string // yyyy-mm-dd, the trade's close date
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

export function computeDashboardMetrics(trades: Trade[]): DashboardMetrics {
  const closed = closedTradesByCloseDate(trades)

  const totalNetPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)

  const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0)
  const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0)

  const winRate = closed.length > 0 ? wins.length / closed.length : null

  const grossWin = wins.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null

  let currentStreak: DashboardMetrics['currentStreak'] = null
  for (let i = closed.length - 1; i >= 0; i--) {
    const pnl = closed[i].realized_pnl_net ?? 0
    const kind: 'win' | 'loss' | null = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : null
    if (kind === null) break
    if (currentStreak === null) {
      currentStreak = { count: 1, kind }
    } else if (currentStreak.kind === kind) {
      currentStreak.count += 1
    } else {
      break
    }
  }

  const estimatedFeeTradeCount = closed.filter((t) => t.fee_source === 'estimated').length

  return {
    totalNetPnl,
    winRate,
    profitFactor,
    currentStreak,
    closedCount: closed.length,
    estimatedFeeTradeCount,
  }
}

export function computeEquityCurve(trades: Trade[]): EquityPoint[] {
  const closed = closedTradesByCloseDate(trades)
  let cumulative = 0
  return closed.map((t) => {
    cumulative += t.realized_pnl_net ?? 0
    return {
      date: t.last_out_at!.slice(0, 10),
      cumulativeNetPnl: cumulative,
      tradeNetPnl: t.realized_pnl_net ?? 0,
      feeSource: t.fee_source,
      symbol: t.symbol,
    }
  })
}

export function computeCalendarDays(trades: Trade[]): Map<string, CalendarDay> {
  const closed = closedTradesByCloseDate(trades)
  const byDay = new Map<string, CalendarDay>()

  for (const t of closed) {
    const date = t.last_out_at!.slice(0, 10)
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
