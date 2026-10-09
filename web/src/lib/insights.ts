import type { Trade, TradeWithDetails } from './database.types'
import { TRADING_TIMEZONE } from './format'
import { MISTAKE_TAGS } from './mistakes'

/** Closed trades with a booked P&L, in close order -- the population every metric here uses. */
export function closedTrades<T extends Trade>(trades: T[]): T[] {
  return trades
    .filter((t) => t.status === 'CLOSED' && t.realized_pnl_net !== null && t.last_out_at)
    .sort((a, b) => a.last_out_at!.localeCompare(b.last_out_at!))
}

const pnl = (t: Trade) => t.realized_pnl_net ?? 0

export type Summary = {
  count: number
  netPnl: number
  winRate: number | null
  profitFactor: number | null
  avgWin: number | null
  avgLoss: number | null // negative
  payoffRatio: number | null // avg win / |avg loss|
  expectancy: number | null // avg net P&L per trade
  maxDrawdown: number // most negative peak-to-trough of the closed-trade equity curve (<= 0)
}

/** The six numbers that actually describe an edge: is it profitable, how often it wins,
 * how big wins are vs losses, what each trade is worth, and the worst pain on the way. */
export function summarize(trades: Trade[]): Summary {
  const closed = closedTrades(trades)
  const wins = closed.filter((t) => pnl(t) > 0)
  const losses = closed.filter((t) => pnl(t) < 0)
  const grossWin = wins.reduce((s, t) => s + pnl(t), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + pnl(t), 0))
  const netPnl = closed.reduce((s, t) => s + pnl(t), 0)
  const avgWin = wins.length ? grossWin / wins.length : null
  const avgLoss = losses.length ? -grossLoss / losses.length : null

  let equity = 0
  let peak = 0
  let maxDrawdown = 0
  for (const t of closed) {
    equity += pnl(t)
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity - peak)
  }

  return {
    count: closed.length,
    netPnl,
    winRate: closed.length ? wins.length / closed.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgWin,
    avgLoss,
    payoffRatio: avgWin !== null && avgLoss !== null ? avgWin / Math.abs(avgLoss) : null,
    expectancy: closed.length ? netPnl / closed.length : null,
    maxDrawdown,
  }
}

export type GroupRow = {
  key: string
  label: string
  count: number
  winRate: number | null
  netPnl: number
  expectancy: number | null
}

function row(key: string, label: string, list: Trade[]): GroupRow {
  const net = list.reduce((s, t) => s + pnl(t), 0)
  return {
    key,
    label,
    count: list.length,
    winRate: list.length ? list.filter((t) => pnl(t) > 0).length / list.length : null,
    netPnl: net,
    expectancy: list.length ? net / list.length : null,
  }
}

function groupBy<T extends Trade>(trades: T[], keyOf: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const t of trades) {
    const k = keyOf(t)
    if (k === null) continue
    const list = out.get(k)
    if (list) list.push(t)
    else out.set(k, [t])
  }
  return out
}

/** Planned vs unplanned, over reviewed trades only (planned is null until reviewed). */
export function plannedVsUnplanned(trades: TradeWithDetails[]): { rows: GroupRow[]; untagged: number } {
  const closed = closedTrades(trades)
  const planned = closed.filter((t) => t.planned === true)
  const unplanned = closed.filter((t) => t.planned === false)
  const rows = [row('planned', 'Planned', planned), row('unplanned', 'Unplanned', unplanned)].filter((r) => r.count > 0)
  return { rows, untagged: closed.length - planned.length - unplanned.length }
}

/** What each mistake cost: the net P&L of the trades carrying it, worst first, with
 * clean reviewed trades (no mistakes) as the baseline to compare against. */
export function mistakeCost(trades: TradeWithDetails[]): { rows: GroupRow[]; clean: GroupRow | null } {
  const closed = closedTrades(trades)
  const known = new Set<string>(MISTAKE_TAGS)
  const tags = [...MISTAKE_TAGS, ...new Set(closed.flatMap((t) => t.mistakes).filter((m) => !known.has(m)))]
  const rows = tags
    .map((tag) => row(tag, tag, closed.filter((t) => t.mistakes.includes(tag))))
    .filter((r) => r.count > 0)
    .sort((a, b) => a.netPnl - b.netPnl)
  const cleanTrades = closed.filter((t) => t.reviewed_at && t.mistakes.length === 0)
  return { rows, clean: cleanTrades.length ? row('clean', 'No mistakes', cleanTrades) : null }
}

export function bySetup(trades: TradeWithDetails[]): GroupRow[] {
  const closed = closedTrades(trades)
  const groups = groupBy(closed, (t) => t.trade_playbooks?.playbook_id ?? 'none')
  return Array.from(groups, ([id, list]) =>
    row(id, id === 'none' ? 'No setup' : (list[0].trade_playbooks?.playbooks?.name ?? 'Setup'), list),
  ).sort((a, b) => b.netPnl - a.netPnl)
}

const ctClock = new Intl.DateTimeFormat('en-US', { timeZone: TRADING_TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: false })

/** Entry time in 30-minute Central Time buckets -- day traders' edge is usually
 * concentrated in specific windows (the open, lunch chop, power hour). */
export function byTimeOfDay(trades: Trade[]): GroupRow[] {
  const closed = closedTrades(trades).filter((t) => t.first_in_at)
  const groups = groupBy(closed, (t) => {
    const parts = ctClock.formatToParts(new Date(t.first_in_at!))
    const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value)
    return `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`
  })
  return Array.from(groups.keys())
    .sort()
    .map((k) => {
      const [h, m] = k.split(':').map(Number)
      const label = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
      return row(k, label, groups.get(k)!)
    })
}

const HOLD_BUCKETS: { label: string; max: number }[] = [
  { label: '< 1m', max: 60 },
  { label: '1–5m', max: 300 },
  { label: '5–15m', max: 900 },
  { label: '15–60m', max: 3600 },
  { label: '1h+', max: Infinity },
]

/** Hold time buckets -- shows whether you're cutting winners short or sitting in losers. */
export function byHoldTime(trades: Trade[]): GroupRow[] {
  const closed = closedTrades(trades).filter((t) => t.hold_seconds !== null)
  return HOLD_BUCKETS.map((b, i) => {
    const min = i === 0 ? -Infinity : HOLD_BUCKETS[i - 1].max
    return row(b.label, b.label, closed.filter((t) => t.hold_seconds! >= min && t.hold_seconds! < b.max))
  }).filter((r) => r.count > 0)
}

/** Symbols traded at least `minTrades` times (fewer is noise), best to worst. */
export function bySymbol(trades: Trade[], minTrades = 3): GroupRow[] {
  const groups = groupBy(closedTrades(trades), (t) => t.symbol)
  return Array.from(groups, ([sym, list]) => row(sym, sym, list))
    .filter((r) => r.count >= minTrades)
    .sort((a, b) => b.netPnl - a.netPnl)
}
