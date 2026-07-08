import type { Trade, TradeWithDetails, Strategy, Rule } from './database.types'

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
      date: t.last_out_at!.slice(0, 10),
      timestamp: new Date(t.last_out_at!).getTime(),
      cumulativeNetPnl: cumulative,
      tradeNetPnl: t.realized_pnl_net ?? 0,
      feeSource: t.fee_source,
      symbol: t.symbol,
    }
  })
}

export type DailyFeedEntry = {
  date: string // yyyy-mm-dd
  trades: TradeWithDetails[] // all trades touching this day (open or closed)
  closedTrades: TradeWithDetails[] // closed trades that resolved on this day, time-ordered
  netPnl: number
  grossPnl: number
  fees: number
  wins: number
  losses: number
  winRate: number | null
  profitFactor: number | null
  anyEstimated: boolean
  equityPoints: { idx: number; cumulative: number }[]
}

/** Groups trades by day (closed trades bucket under their close date, open trades
 * under their entry date -- matches the calendar/journal bucketing rule used
 * elsewhere) and rolls up the per-day stats a daily journal feed card needs. */
export function computeDailyFeed(trades: TradeWithDetails[]): DailyFeedEntry[] {
  const byDate = new Map<string, TradeWithDetails[]>()
  for (const t of trades) {
    const date = t.status === 'CLOSED' ? t.last_out_at?.slice(0, 10) : t.first_in_at?.slice(0, 10)
    if (!date) continue
    const list = byDate.get(date)
    if (list) list.push(t)
    else byDate.set(date, [t])
  }

  const entries: DailyFeedEntry[] = []
  for (const [date, dayTrades] of byDate) {
    const closed = dayTrades
      .filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.last_out_at)
      .sort((a, b) => new Date(a.last_out_at!).getTime() - new Date(b.last_out_at!).getTime())

    const netPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
    const grossPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_gross ?? 0), 0)
    const fees = closed.reduce((sum, t) => sum + (t.fee_source === 'actual' ? (t.actual_fee ?? 0) : t.estimated_fee), 0)

    const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0)
    const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0)
    const winRate = closed.length > 0 ? wins.length / closed.length : null

    const grossWin = wins.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null

    const anyEstimated = closed.some((t) => t.fee_source === 'estimated')

    let cumulative = 0
    const equityPoints = closed.map((t, idx) => {
      cumulative += t.realized_pnl_net ?? 0
      return { idx, cumulative }
    })

    entries.push({
      date,
      trades: dayTrades,
      closedTrades: closed,
      netPnl,
      grossPnl,
      fees,
      wins: wins.length,
      losses: losses.length,
      winRate,
      profitFactor,
      anyEstimated,
      equityPoints,
    })
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date))
}

/** Capital-weighted return: sum(net P&L) / sum(capital deployed), across trades with
 * defined capital. More honest than averaging each trade's own % -- a $10 trade at
 * +100% doesn't get to outweigh a $10,000 trade at -2% in the blended figure. */
export function blendedReturnPct(trades: Pick<Trade, 'avg_entry' | 'total_contracts' | 'realized_pnl_net'>[]): number | null {
  let pnl = 0
  let capital = 0
  for (const t of trades) {
    if (t.avg_entry === null || t.total_contracts === null || t.realized_pnl_net === null) continue
    pnl += t.realized_pnl_net
    capital += t.avg_entry * t.total_contracts * ASSUMED_OPTION_MULTIPLIER
  }
  return capital > 0 ? pnl / capital : null
}

export type StatStrip = {
  totalCount: number
  wins: number
  winPct: number | null
  losses: number
  lossPct: number | null
  open: number
  openPct: number | null
  wash: number
  washPct: number | null
  avgWin: number | null
  avgLoss: number | null
  netPnl: number
  netPnlReturnPct: number | null
  estimatedFeeTradeCount: number
}

/** Condensed top-of-dashboard tile strip (StonkJournal density). Wins/Losses/Open/
 * Wash partition ALL trades in the range (mutually exclusive, sums to totalCount) so
 * each tile's "+%" is its share of everything, not just of closed trades. */
export function computeStatStrip(trades: Trade[]): StatStrip {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null)
  const open = trades.filter((t) => t.status === 'OPEN')
  const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0)
  const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0)
  const wash = closed.filter((t) => (t.realized_pnl_net ?? 0) === 0)

  const totalCount = trades.length
  const netPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0) / wins.length : null
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0) / losses.length : null
  const estimatedFeeTradeCount = closed.filter((t) => t.fee_source === 'estimated').length

  const pct = (n: number) => (totalCount > 0 ? n / totalCount : null)

  return {
    totalCount,
    wins: wins.length,
    winPct: pct(wins.length),
    losses: losses.length,
    lossPct: pct(losses.length),
    open: open.length,
    openPct: pct(open.length),
    wash: wash.length,
    washPct: pct(wash.length),
    avgWin,
    avgLoss,
    netPnl,
    netPnlReturnPct: blendedReturnPct(closed),
    estimatedFeeTradeCount,
  }
}

export type StrategyStat = {
  strategy: Strategy
  tradeCount: number
  winRate: number | null
  netPnl: number
  pnlPct: number | null // blended return-on-capital for this group
  pnlContributionPct: number | null // this group's share of total net P&L across all closed trades
  profitFactor: number | null
}

/** Per-strategy rollup for the Stats page -- only strategies actually used on a
 * closed trade show up (an unused tag has nothing to report). */
export function computeStrategyStats(trades: TradeWithDetails[], strategies: Strategy[]): StrategyStat[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null)
  const totalNetPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)

  return strategies
    .map((strategy) => {
      const assigned = closed.filter((t) => t.trade_strategies.some((ts) => ts.strategy_id === strategy.id))
      const wins = assigned.filter((t) => (t.realized_pnl_net ?? 0) > 0)
      const losses = assigned.filter((t) => (t.realized_pnl_net ?? 0) < 0)
      const netPnl = assigned.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
      const grossWin = wins.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0))
      const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null

      return {
        strategy,
        tradeCount: assigned.length,
        winRate: assigned.length > 0 ? wins.length / assigned.length : null,
        netPnl,
        pnlPct: blendedReturnPct(assigned),
        pnlContributionPct: totalNetPnl !== 0 ? netPnl / Math.abs(totalNetPnl) : null,
        profitFactor,
      }
    })
    .filter((s) => s.tradeCount > 0)
    .sort((a, b) => b.netPnl - a.netPnl)
}

export type SymbolStat = {
  symbol: string
  tradeCount: number
  winRate: number | null
  netPnl: number
  pnlPct: number | null
  pnlContributionPct: number | null
  profitFactor: number | null
}

/** Same rollup shape as computeStrategyStats but grouped by underlying symbol. */
export function computeSymbolStats(trades: Trade[]): SymbolStat[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null)
  const totalNetPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)

  const bySymbol = new Map<string, Trade[]>()
  for (const t of closed) {
    const list = bySymbol.get(t.symbol)
    if (list) list.push(t)
    else bySymbol.set(t.symbol, [t])
  }

  const stats: SymbolStat[] = []
  for (const [symbol, group] of bySymbol) {
    const wins = group.filter((t) => (t.realized_pnl_net ?? 0) > 0)
    const losses = group.filter((t) => (t.realized_pnl_net ?? 0) < 0)
    const netPnl = group.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
    const grossWin = wins.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null

    stats.push({
      symbol,
      tradeCount: group.length,
      winRate: group.length > 0 ? wins.length / group.length : null,
      netPnl,
      pnlPct: blendedReturnPct(group),
      pnlContributionPct: totalNetPnl !== 0 ? netPnl / Math.abs(totalNetPnl) : null,
      profitFactor,
    })
  }

  return stats.sort((a, b) => b.netPnl - a.netPnl)
}

export type RuleStat = {
  rule: Rule
  followedCount: number
  brokenCount: number
  naCount: number
  followRate: number | null // followed / (followed + broken) -- N/A trades don't count
  pnlFollowed: number
  pnlBroken: number
  winRateFollowed: number | null
  winRateBroken: number | null
  profitFactorFollowed: number | null
  profitFactorBroken: number | null
}

/** Per-rule rollup: how often a rule was followed, and the P&L/win-rate/profit-factor
 * delta between trades where it was followed vs. broken -- the discipline-to-outcome
 * link (e.g. "I make money when I follow X and lose when I break it"). */
export function computeRuleStats(trades: TradeWithDetails[], rules: Rule[]): RuleStat[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null)

  return rules.map((rule) => {
    let followedCount = 0
    let brokenCount = 0
    let naCount = 0
    let pnlFollowed = 0
    let pnlBroken = 0
    let winsFollowed = 0
    let winsBroken = 0
    let grossWinFollowed = 0
    let grossLossFollowed = 0
    let grossWinBroken = 0
    let grossLossBroken = 0

    for (const t of closed) {
      const link = t.trade_rules.find((tr) => tr.rule_id === rule.id)
      const status = link?.status ?? 'na'
      const pnl = t.realized_pnl_net ?? 0
      if (status === 'followed') {
        followedCount++
        pnlFollowed += pnl
        if (pnl > 0) {
          winsFollowed++
          grossWinFollowed += pnl
        } else if (pnl < 0) {
          grossLossFollowed += Math.abs(pnl)
        }
      } else if (status === 'broken') {
        brokenCount++
        pnlBroken += pnl
        if (pnl > 0) {
          winsBroken++
          grossWinBroken += pnl
        } else if (pnl < 0) {
          grossLossBroken += Math.abs(pnl)
        }
      } else {
        naCount++
      }
    }

    const applicable = followedCount + brokenCount
    return {
      rule,
      followedCount,
      brokenCount,
      naCount,
      followRate: applicable > 0 ? followedCount / applicable : null,
      pnlFollowed,
      pnlBroken,
      winRateFollowed: followedCount > 0 ? winsFollowed / followedCount : null,
      winRateBroken: brokenCount > 0 ? winsBroken / brokenCount : null,
      profitFactorFollowed: grossLossFollowed > 0 ? grossWinFollowed / grossLossFollowed : grossWinFollowed > 0 ? Infinity : null,
      profitFactorBroken: grossLossBroken > 0 ? grossWinBroken / grossLossBroken : grossWinBroken > 0 ? Infinity : null,
    }
  })
}

export type BucketStat = {
  label: string
  tradeCount: number
  winRate: number | null
  netPnl: number
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Bucketed by the weekday the trade's P&L booked (close date) -- Mon-Fri only,
 * always present even at zero trades so the week reads as a fixed axis. */
export function computeDayOfWeekStats(trades: Trade[]): BucketStat[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.last_out_at)
  const byWeekday = new Map<number, Trade[]>()

  for (const t of closed) {
    const day = new Date(t.last_out_at!).getDay()
    const list = byWeekday.get(day)
    if (list) list.push(t)
    else byWeekday.set(day, [t])
  }

  return [1, 2, 3, 4, 5].map((day) => {
    const list = byWeekday.get(day) ?? []
    const wins = list.filter((t) => (t.realized_pnl_net ?? 0) > 0)
    const netPnl = list.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
    return { label: WEEKDAY_LABELS[day], tradeCount: list.length, winRate: list.length > 0 ? wins.length / list.length : null, netPnl }
  })
}

/** Bucketed by entry hour-of-day (browser-local time). Hours with zero trades are
 * omitted rather than padding the view with 24 mostly-empty rows. */
export function computeHourOfDayStats(trades: Trade[]): BucketStat[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.first_in_at)
  const byHour = new Map<number, Trade[]>()

  for (const t of closed) {
    const hour = new Date(t.first_in_at!).getHours()
    const list = byHour.get(hour)
    if (list) list.push(t)
    else byHour.set(hour, [t])
  }

  return Array.from(byHour.keys())
    .sort((a, b) => a - b)
    .map((hour) => {
      const list = byHour.get(hour)!
      const wins = list.filter((t) => (t.realized_pnl_net ?? 0) > 0)
      const netPnl = list.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
      const label = new Date(2000, 0, 1, hour).toLocaleTimeString('en-US', { hour: 'numeric' })
      return { label, tradeCount: list.length, winRate: list.length > 0 ? wins.length / list.length : null, netPnl }
    })
}

export type StatsTiles = {
  winRate: number | null
  expectancy: number | null // avg net P&L per closed trade
  profitFactor: number | null
  avgWinHoldSeconds: number | null
  avgLossHoldSeconds: number | null
  avgWin: number | null
  avgLoss: number | null
  maxWinStreak: number
  maxLossStreak: number
  topWin: number | null
  topLoss: number | null
  avgDailyVolume: number | null // avg trades per trading day
  avgSize: number | null // avg entry position size $
}

/** The Stats page tile row -- broader, more historical-analysis-oriented metrics
 * than the Dashboard's at-a-glance strip. */
export function computeStatsTiles(trades: TradeWithDetails[]): StatsTiles {
  const closed = closedTradesByCloseDate(trades)
  const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0)
  const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0)

  const netPnl = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
  const grossWin = wins.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null

  const winHolds = wins.map((t) => t.hold_seconds).filter((v): v is number => v !== null)
  const lossHolds = losses.map((t) => t.hold_seconds).filter((v): v is number => v !== null)

  let maxWinStreak = 0
  let maxLossStreak = 0
  let curWin = 0
  let curLoss = 0
  for (const t of closed) {
    const pnl = t.realized_pnl_net ?? 0
    if (pnl > 0) {
      curWin++
      curLoss = 0
    } else if (pnl < 0) {
      curLoss++
      curWin = 0
    } else {
      curWin = 0
      curLoss = 0
    }
    maxWinStreak = Math.max(maxWinStreak, curWin)
    maxLossStreak = Math.max(maxLossStreak, curLoss)
  }

  const tradingDays = new Set(closed.map((t) => t.last_out_at!.slice(0, 10)))
  const sizes = closed.map((t) => entrySizeUsd(t)).filter((v): v is number => v !== null)

  return {
    winRate: closed.length > 0 ? wins.length / closed.length : null,
    expectancy: closed.length > 0 ? netPnl / closed.length : null,
    profitFactor,
    avgWinHoldSeconds: winHolds.length > 0 ? winHolds.reduce((a, b) => a + b, 0) / winHolds.length : null,
    avgLossHoldSeconds: lossHolds.length > 0 ? lossHolds.reduce((a, b) => a + b, 0) / lossHolds.length : null,
    avgWin: wins.length > 0 ? grossWin / wins.length : null,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    maxWinStreak,
    maxLossStreak,
    topWin: wins.length > 0 ? Math.max(...wins.map((t) => t.realized_pnl_net ?? 0)) : null,
    topLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.realized_pnl_net ?? 0)) : null,
    avgDailyVolume: tradingDays.size > 0 ? closed.length / tradingDays.size : null,
    avgSize: sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null,
  }
}

export type DailyTargetStatus = 'hit_target' | 'gave_it_back' | 'breached_loss' | 'neutral'

export type DailyTargetResult = {
  date: string
  netPnlClose: number // end-of-day realized net P&L
  intradayPeakRealized: number // max cumulative realized P&L seen while walking the day's closes in order
  hitTargetClosed: boolean
  reachedTargetIntraday: boolean // peak >= target but close < target -- "gave it back"
  breachedLossLimit: boolean
  status: DailyTargetStatus // single marker for calendar display; breach > hit > gave-back
}

export type TargetSettingsInput = { profit_target_value: number | null; loss_limit_value: number | null }

/**
 * Realized-P&L-only approximation of intraday performance -- NOT mark-to-market
 * unrealized P&L. `intradayPeakRealized` only moves when a trade actually closes and
 * books P&L, so it can't reflect an open position's paper gains/losses; it answers
 * "how far ahead did booked profit get before end of day," which is enough to detect
 * "was green then gave it back" without needing any live/unrealized price feed.
 */
export function computeDailyTargetStats(
  trades: Trade[],
  settings: TargetSettingsInput | null,
): Map<string, DailyTargetResult> {
  const result = new Map<string, DailyTargetResult>()
  if (!settings || (settings.profit_target_value === null && settings.loss_limit_value === null)) return result

  const target = settings.profit_target_value
  const lossLimit = settings.loss_limit_value

  const closed = trades.filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.last_out_at)
  const byDate = new Map<string, Trade[]>()
  for (const t of closed) {
    const date = t.last_out_at!.slice(0, 10)
    const list = byDate.get(date)
    if (list) list.push(t)
    else byDate.set(date, [t])
  }

  for (const [date, dayTrades] of byDate) {
    const ordered = [...dayTrades].sort((a, b) => new Date(a.last_out_at!).getTime() - new Date(b.last_out_at!).getTime())
    let cumulative = 0
    let peak = 0 // starts at 0 (the day's baseline), not -Infinity, since "peak" means best point reached
    for (const t of ordered) {
      cumulative += t.realized_pnl_net ?? 0
      peak = Math.max(peak, cumulative)
    }

    const netPnlClose = cumulative
    const intradayPeakRealized = peak
    const hitTargetClosed = target !== null && netPnlClose >= target
    const reachedTargetIntraday = target !== null && intradayPeakRealized >= target && netPnlClose < target
    const breachedLossLimit = lossLimit !== null && netPnlClose <= -lossLimit

    let status: DailyTargetStatus = 'neutral'
    if (breachedLossLimit) status = 'breached_loss'
    else if (hitTargetClosed) status = 'hit_target'
    else if (reachedTargetIntraday) status = 'gave_it_back'

    result.set(date, { date, netPnlClose, intradayPeakRealized, hitTargetClosed, reachedTargetIntraday, breachedLossLimit, status })
  }

  return result
}

export type TargetSummary = {
  totalDays: number
  hitDays: number
  hitPct: number | null
  gaveBackDays: number
}

/** Rolled up over whatever set of daily results is passed in -- callers filter by
 * date range first (Stats page) or pass the full set (all-time). */
export function computeTargetSummary(dailyResults: Map<string, DailyTargetResult>): TargetSummary {
  const days = Array.from(dailyResults.values())
  const hitDays = days.filter((d) => d.hitTargetClosed).length
  const gaveBackDays = days.filter((d) => d.reachedTargetIntraday).length
  return {
    totalDays: days.length,
    hitDays,
    hitPct: days.length > 0 ? hitDays / days.length : null,
    gaveBackDays,
  }
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
