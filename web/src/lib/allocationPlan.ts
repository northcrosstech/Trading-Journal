import type { FundamentalsRow, PortfolioKind } from './database.types'
import { isEtf } from './research'

/** Where money can be moved between accounts it's one pool: every brokerage portfolio
 * together. Each retirement account (401k, IRAs) is its own pool -- never part of the split,
 * but with its own mix by type. */
export const isRetirement = (kind: PortfolioKind) => kind !== 'brokerage'

export type AssetType = 'etf' | 'stock' | 'bond' | 'option' | 'cash'
export const ASSET_TYPES: AssetType[] = ['etf', 'stock', 'bond', 'option', 'cash']
export const TYPE_LABEL: Record<AssetType, string> = { etf: 'ETFs', stock: 'Stocks', bond: 'Bonds', option: 'Options', cash: 'Cash' }
export type TickerType = 'stock' | 'etf' | 'bond'
export type Targets = Record<AssetType, number>

/** Ready-made mixes (from the reference sheet's sample portfolios, our own names). */
export const PRESETS: { name: string; targets: Targets }[] = [
  { name: 'Aggressive', targets: { etf: 70, stock: 20, option: 10, bond: 0, cash: 0 } },
  { name: 'Growth', targets: { etf: 80, stock: 15, option: 5, bond: 0, cash: 0 } },
  { name: 'Balanced', targets: { etf: 80, stock: 10, option: 0, bond: 10, cash: 0 } },
  { name: 'Cautious', targets: { etf: 70, stock: 0, option: 0, bond: 30, cash: 0 } },
  { name: 'Defensive', targets: { etf: 50, stock: 0, option: 0, bond: 50, cash: 0 } },
]

const KNOWN_BONDS = new Set(['BND', 'AGG', 'TLT', 'IEF', 'SHY', 'SGOV', 'BIL', 'BLV', 'BSV', 'BIV', 'VGIT', 'VGSH', 'VGLT', 'VCIT', 'VCSH', 'LQD', 'HYG', 'JNK', 'MUB', 'TIP', 'SCHZ', 'GOVT', 'USFR', 'TFLO', 'SHV', 'BNDX'])
const BOND_WORDS = /\b(BOND|BD|BDS|TREASURY|TREAS|T-BILL|TBILL|BILLS?|FIXED INC|FIXED INCOME|AGGREGATE|AGG|MUNI|MUNICIPAL|INCOME SECURITIES)\b/
const FUND_TYPES = new Set(['ETP', 'Closed-End Fund', 'ETF'])

/** Stock, ETF or bond for a ticker: your choice if you made one, else from Finnhub's type
 * (ETP / closed-end fund = ETF, and an ETF whose name says bond / treasury / T-bill = bond),
 * else from a built-in list, else stock. */
export function classify(symbol: string, f: Pick<FundamentalsRow, 'security_type' | 'description'> | null | undefined, override?: TickerType): { type: TickerType; edited: boolean } {
  if (override) return { type: override, edited: true }
  const t = f?.security_type ?? null
  if (t && FUND_TYPES.has(t)) return { type: BOND_WORDS.test((f?.description ?? '').toUpperCase()) ? 'bond' : 'etf', edited: false }
  if (t) return { type: 'stock', edited: false }
  if (KNOWN_BONDS.has(symbol)) return { type: 'bond', edited: false }
  return { type: isEtf(symbol) ? 'etf' : 'stock', edited: false }
}

export type TickerSlice = { symbol: string; value: number; type: TickerType; edited: boolean }
export type Mix = { values: Record<AssetType, number>; tickers: Record<TickerType, TickerSlice[]>; base: number; margin: number }

/** A pool's mix: holdings by type, long options at their value, and cash. Margin (negative
 * cash) isn't a type -- it's reported separately and left out of the base. Sold options are
 * obligations, not holdings, so they're not in the mix. */
export function mixOf(holdings: { symbol: string; value: number }[], longOptions: number, cash: number, typeOf: (symbol: string) => { type: TickerType; edited: boolean }): Mix {
  const values: Record<AssetType, number> = { etf: 0, stock: 0, bond: 0, option: Math.max(longOptions, 0), cash: Math.max(cash, 0) }
  const bySymbol = new Map<string, number>()
  for (const h of holdings) bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + h.value)
  const tickers: Record<TickerType, TickerSlice[]> = { etf: [], stock: [], bond: [] }
  for (const [symbol, value] of bySymbol) {
    const t = typeOf(symbol)
    values[t.type] += value
    tickers[t.type].push({ symbol, value, ...t })
  }
  for (const k of ['etf', 'stock', 'bond'] as const) tickers[k].sort((a, b) => b.value - a.value)
  const base = ASSET_TYPES.reduce((s, k) => s + values[k], 0)
  return { values, tickers, base, margin: Math.max(-cash, 0) }
}

/** How far a share can drift from its target and still be on target (the 5/25 rule): the
 * tolerance in percentage points, or a quarter of the target if that's smaller -- so a 5%
 * target is off below 3.75% or above 6.25%, while a 40% target keeps the full ±5. Never under
 * half a point, so rounding alone doesn't flag a 0% target. */
export const driftBand = (target: number, tolerance: number) => Math.min(tolerance, Math.max(target * 0.25, 0.5))
/** The rule in words, for subtitles. */
export const bandText = (tolerance: number) => `±${tolerance}%, or ¼ of the target if less`

export type Status = 'on' | 'over' | 'under' | 'none'
export type TargetRow = { key: string; label: string; value: number; pct: number; target: number | null; status: Status; diff: number; move: number }

/** Current share vs target for each row. `move` is the dollars to add (+) or trim (-) to
 * hit the target; a row is on target within its drift band (see driftBand). */
export function compareToTargets(rows: { key: string; label: string; value: number }[], targets: Record<string, number> | null, tolerance: number): { rows: TargetRow[]; base: number; off: number } {
  const base = rows.reduce((s, r) => s + Math.max(r.value, 0), 0)
  const out = rows.map((r) => {
    const pct = base > 0 ? (Math.max(r.value, 0) / base) * 100 : 0
    const target = targets ? (targets[r.key] ?? 0) : null
    if (target === null) return { ...r, pct, target, status: 'none' as Status, diff: 0, move: 0 }
    const diff = pct - target
    const status: Status = Math.abs(diff) <= driftBand(target, tolerance) ? 'on' : diff > 0 ? 'over' : 'under'
    return { ...r, pct, target, status, diff, move: (target / 100) * base - Math.max(r.value, 0) }
  })
  return { rows: out, base, off: out.filter((r) => r.status === 'over' || r.status === 'under').length }
}

export const sumTargets = (t: Partial<Targets>) => ASSET_TYPES.reduce((s, k) => s + (t[k] ?? 0), 0)
