import { ASSET_TYPES, type AssetType, type Targets, type TickerType } from './allocationPlan'

/** A portfolio's position plan: a target % per ticker. What's left of 100% is the cash target. */
export type PlanTarget = { symbol: string; pct: number }

export const planTotal = (targets: PlanTarget[]) => targets.reduce((s, t) => s + t.pct, 0)
/** The cash target: whatever the tickers leave of 100%. */
export const cashTarget = (targets: PlanTarget[]) => Math.max(0, Number((100 - planTotal(targets)).toFixed(4)))

export type PlanStatus = 'on' | 'over' | 'under' | 'missing' | 'unplanned'
export type PlanRow = {
  key: string
  symbol: string // 'Cash' / 'Options' for those rows
  kind: 'ticker' | 'cash' | 'options'
  value: number
  price: number | null
  pct: number
  target: number | null
  diff: number
  /** Dollars to add (+) or trim (-) to hit the target; 0 when not in the plan. */
  move: number
  status: PlanStatus
}

/** Each holding against the plan. The base is everything held (shares, long options, positive
 * cash), the same base the holdings table's weights use. A ticker in the plan you don't own
 * yet is "missing"; a holding not in the plan is "unplanned" (not counted as off target). */
export function comparePlan(
  holdings: { symbol: string; value: number; price: number | null }[],
  longOptions: number,
  cash: number,
  plan: PlanTarget[],
  tolerance: number,
): { rows: PlanRow[]; base: number; off: number; unplanned: number } {
  const held = new Map<string, { value: number; price: number | null }>()
  for (const h of holdings) {
    const cur = held.get(h.symbol)
    held.set(h.symbol, { value: (cur?.value ?? 0) + h.value, price: h.price ?? cur?.price ?? null })
  }
  const cashValue = Math.max(cash, 0)
  const optValue = Math.max(longOptions, 0)
  const base = [...held.values()].reduce((s, h) => s + Math.max(h.value, 0), 0) + optValue + cashValue
  const planned = new Map(plan.map((t) => [t.symbol, t.pct]))

  const row = (key: string, symbol: string, kind: PlanRow['kind'], value: number, price: number | null, target: number | null): PlanRow => {
    const pct = base > 0 ? (Math.max(value, 0) / base) * 100 : 0
    if (target === null) return { key, symbol, kind, value, price, pct, target, diff: 0, move: 0, status: 'unplanned' }
    const diff = pct - target
    const move = (target / 100) * base - Math.max(value, 0)
    const status: PlanStatus = kind === 'ticker' && value <= 0 ? 'missing' : Math.abs(diff) <= tolerance ? 'on' : diff > 0 ? 'over' : 'under'
    return { key, symbol, kind, value, price, pct, target, diff, move, status }
  }

  const rows: PlanRow[] = []
  for (const t of plan) rows.push(row(t.symbol, t.symbol, 'ticker', held.get(t.symbol)?.value ?? 0, held.get(t.symbol)?.price ?? null, t.pct))
  const extra = [...held].filter(([s]) => !planned.has(s)).sort((a, b) => b[1].value - a[1].value)
  for (const [s, h] of extra) rows.push(row(s, s, 'ticker', h.value, h.price, null))
  if (optValue > 0) rows.push(row('options', 'Options', 'options', optValue, null, null))
  if (plan.length > 0) rows.push(row('cash', 'Cash', 'cash', cashValue, null, cashTarget(plan)))

  const off = rows.filter((r) => r.status === 'over' || r.status === 'under' || r.status === 'missing').length
  return { rows, base, off, unplanned: rows.filter((r) => r.status === 'unplanned' && r.kind === 'ticker').length }
}

export type Buy = { symbol: string; amount: number; price: number | null }

/** Buys only (no selling): where `amount` should go to get closest to the plan. The money
 * comes out of `spendable` cash first (cash not set aside for puts); anything beyond it is
 * new money, which grows the base. It goes to
 * the most underweight tickers first; once every ticker is at its target, the rest is split by
 * target. The cash target counts too: money it needs stays as cash. */
export function suggestBuys(rows: PlanRow[], base: number, cash: number, amount: number, spendable = cash): { buys: Buy[]; keepCash: number } {
  if (!(amount > 0)) return { buys: [], keepCash: 0 }
  const fromCash = Math.min(amount, Math.max(Math.min(spendable, cash), 0))
  const after = base + (amount - fromCash) // new money grows the base
  const planned = rows.filter((r) => r.target !== null && r.target > 0)
  if (planned.length === 0) return { buys: [], keepCash: amount }

  // What each planned row is short of its target once the money is in. Cash is short by its
  // target less what's left in cash after spending `amount`.
  const cashLeft = Math.max(cash, 0) - fromCash
  const need = planned.map((r) => {
    const value = r.kind === 'cash' ? cashLeft : Math.max(r.value, 0)
    return { r, short: Math.max(0, ((r.target as number) / 100) * after - value) }
  })
  const totalShort = need.reduce((s, n) => s + n.short, 0)
  const totalTarget = planned.reduce((s, r) => s + (r.target as number), 0)
  const give = need.map(({ r, short }) => ({
    r,
    amount: totalShort >= amount ? (totalShort > 0 ? (amount * short) / totalShort : 0) : short + ((amount - totalShort) * (r.target as number)) / totalTarget,
  }))
  const keepCash = give.filter((g) => g.r.kind === 'cash').reduce((s, g) => s + g.amount, 0)
  const buys = give
    .filter((g) => g.r.kind === 'ticker' && g.amount >= 0.005)
    .map((g) => ({ symbol: g.r.symbol, amount: g.amount, price: g.r.price }))
    .sort((a, b) => b.amount - a.amount)
  return { buys, keepCash }
}

/** The mix by type a position plan adds up to (each ticker by its type, the rest as cash). */
export function planTypeTargets(plan: PlanTarget[], typeOf: (symbol: string) => { type: TickerType }): Targets {
  const t = Object.fromEntries(ASSET_TYPES.map((k) => [k, 0])) as Targets
  for (const p of plan) t[typeOf(p.symbol).type as AssetType] += p.pct
  t.cash += cashTarget(plan)
  for (const k of ASSET_TYPES) t[k] = Number(t[k].toFixed(2))
  return t
}
