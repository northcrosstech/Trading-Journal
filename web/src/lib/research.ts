import type { FundamentalsRow, MacroIndicatorRow, ResearchOverrideField } from './database.types'

/** Graham's revised formula: fair value = EPS x (7 + growth) x 4.4 / AAA yield.
 *  7   = the P/E a company with no growth deserves
 *  4.4 = the AAA bond yield when the formula was written (fixed)
 *  AAA = today's AAA corporate bond yield -- higher rates, lower fair value */
export const NO_GROWTH_PE = 7
export const BASE_YIELD = 4.4
export const FALLBACK_AAA = 4.8
export const DEFAULT_GROWTH_CAP = 30
export const MARGIN_OF_SAFETY = 0.85 // buy below 85% of fair value

export function fairValue(eps: number | null, growth: number | null, aaa: number): number | null {
  if (eps === null || growth === null || !(eps > 0) || !(aaa > 0)) return null
  // Shrinking earnings count as no growth: the company is worth its no-growth P/E (7x),
  // never a negative number. (The growth score still marks it down.)
  return (eps * (NO_GROWTH_PE + Math.max(growth, 0)) * BASE_YIELD) / aaa
}

export type GrowthSource = 'forecast' | '5y' | '3y'

/** Growth for fair value: analysts' forecast EPS growth when there is one, capped. Without
 * one, the lower of past 5-year and 3-year EPS growth, capped. */
export function growthUsed(
  f: Pick<FundamentalsRow, 'eps_growth_5y' | 'eps_growth_3y' | 'eps_growth_forecast'> | null,
  cap: number,
): { value: number | null; capped: boolean; from: GrowthSource | null } {
  const fc = f?.eps_growth_forecast ?? null
  if (fc !== null) return { value: Math.min(Number(fc), cap), capped: Number(fc) > cap, from: 'forecast' }
  return conservativeGrowth(f, cap)
}

/** Conservative past growth: the lower of the 5-year and 3-year EPS growth, capped. */
export function conservativeGrowth(f: Pick<FundamentalsRow, 'eps_growth_5y' | 'eps_growth_3y'> | null, cap: number): { value: number | null; capped: boolean; from: '5y' | '3y' | null } {
  const g5 = f?.eps_growth_5y ?? null
  const g3 = f?.eps_growth_3y ?? null
  const options = [g5 !== null ? { v: Number(g5), from: '5y' as const } : null, g3 !== null ? { v: Number(g3), from: '3y' as const } : null].filter((x) => x !== null)
  if (options.length === 0) return { value: null, capped: false, from: null }
  const low = options.reduce((a, b) => (b.v < a.v ? b : a))
  return { value: Math.min(low.v, cap), capped: low.v > cap, from: low.from }
}

// --- Score (100) ----------------------------------------------------------------------------

/** Valuation (20): price as a share of fair value. Same table as the reference sheet. */
export const VALUATION_TABLE: [number, number][] = [
  [0, 20], [0.7, 19], [0.75, 18], [0.8, 17], [0.85, 16], [0.9, 15], [0.95, 14], [1.06, 13], [1.16, 12],
  [1.26, 11], [1.36, 10], [1.46, 9], [1.56, 8], [1.66, 7], [1.76, 6], [1.86, 5], [1.96, 4],
]
export function valuationPoints(pctOfFair: number): number {
  let pts = VALUATION_TABLE[0][1]
  for (const [from, p] of VALUATION_TABLE) if (pctOfFair >= from) pts = p
  return pts
}

/** Growth (20): the growth fair value uses (forecast, else past), % per year. */
export const GROWTH_TABLE: [number, number][] = [[40, 20], [30, 18], [20, 16], [15, 15], [10, 13], [5, 11], [0, 8]]
export function growthPoints(growth: number): number {
  for (const [from, p] of GROWTH_TABLE) if (growth >= from) return p
  return 4 // shrinking earnings
}

/** Moat (20): gross margin points + return-on-equity points (10 each). Without a gross
 * margin (banks), return on equity counts twice. */
export const GROSS_MARGIN_TABLE: [number, number][] = [[60, 10], [40, 8], [25, 6], [10, 4]]
export const ROE_TABLE: [number, number][] = [[30, 10], [20, 8], [12, 6], [5, 4]]
const band = (v: number, table: [number, number][], floor = 2) => {
  for (const [from, p] of table) if (v >= from) return p
  return floor
}
export function moatPoints(grossMargin: number | null, roe: number | null): number | null {
  if (grossMargin === null && roe === null) return null
  if (grossMargin === null) return band(roe!, ROE_TABLE) * 2
  if (roe === null) return band(grossMargin, GROSS_MARGIN_TABLE) * 2
  return band(grossMargin, GROSS_MARGIN_TABLE) + band(roe, ROE_TABLE)
}

/** Execution risk (10, higher = safer): profitable 4, low debt up to 3, can pay
 * short-term bills up to 3. Missing debt or current ratio (e.g. banks) counts as middling. */
export function executionPoints(netMargin: number | null, debtToEquity: number | null, currentRatio: number | null): number | null {
  if (netMargin === null && debtToEquity === null && currentRatio === null) return null
  const profit = netMargin !== null && netMargin > 0 ? 4 : 0
  const debt = debtToEquity === null ? 1 : debtToEquity < 0.5 ? 3 : debtToEquity <= 1.5 ? 2 : 0
  const bills = currentRatio === null ? 2 : currentRatio >= 1.5 ? 3 : currentRatio >= 1 ? 2 : 0
  return profit + debt + bills
}

/** Economy (30, same for every stock): starts at 30, less for rising unemployment and a
 * high 10-year Treasury yield. */
export type Macro = { aaa: number | null; aaaAsOf: string | null; t10: number | null; unemployment: number | null; unemploymentLow: number | null }
export function macroFrom(rows: MacroIndicatorRow[]): Macro {
  const get = (k: string) => rows.find((r) => r.key === k)
  return {
    aaa: get('aaa_yield') ? Number(get('aaa_yield')!.value) : null,
    aaaAsOf: get('aaa_yield')?.as_of ?? null,
    t10: get('treasury_10y') ? Number(get('treasury_10y')!.value) : null,
    unemployment: get('unemployment_rate') ? Number(get('unemployment_rate')!.value) : null,
    unemploymentLow: get('unemployment_12m_low') ? Number(get('unemployment_12m_low')!.value) : null,
  }
}
export function economyPoints(m: Macro): { points: number | null; jobsPenalty: number; ratesPenalty: number; rise: number | null } {
  if (m.unemployment === null && m.t10 === null) return { points: null, jobsPenalty: 0, ratesPenalty: 0, rise: null }
  const rise = m.unemployment !== null && m.unemploymentLow !== null ? Math.round((m.unemployment - m.unemploymentLow) * 10) / 10 : null
  const jobsPenalty = rise === null ? 0 : rise >= 0.5 ? 10 : rise >= 0.3 ? 5 : rise >= 0.1 ? 2 : 0
  const ratesPenalty = m.t10 === null ? 0 : m.t10 > 5.5 ? 8 : m.t10 >= 5 ? 5 : m.t10 >= 4.5 ? 3 : 0
  return { points: 30 - jobsPenalty - ratesPenalty, jobsPenalty, ratesPenalty, rise }
}

export type ScoreLabel = 'Strong' | 'Good' | 'Fair' | 'Weak'
export const scoreLabel = (total: number): ScoreLabel => (total >= 80 ? 'Strong' : total >= 70 ? 'Good' : total >= 60 ? 'Fair' : 'Weak')

// --- One ticker, everything together ----------------------------------------------------------

/** Tickers that are funds: no EPS of their own, so no fair value or score. */
const KNOWN_ETFS = new Set([
  'VOO', 'SPY', 'IVV', 'VTI', 'QQQ', 'QQQM', 'RSP', 'SCHD', 'SCHG', 'SCHB', 'VUG', 'VTV', 'VGT', 'XLK', 'SMH', 'SOXX', 'DIA', 'IWM', 'VXUS',
  'VEA', 'VWO', 'BND', 'AGG', 'BLV', 'TLT', 'IEF', 'SHY', 'SGOV', 'BIL', 'VNQ', 'GLD', 'SLV', 'JEPI', 'JEPQ', 'VYM', 'DGRO', 'ARKK', 'VXX', 'UVXY',
  'SQQQ', 'TQQQ', 'SOXL', 'SPXL', 'DRAM', 'IBIT', 'FBTC',
])
export const isEtf = (symbol: string) => KNOWN_ETFS.has(symbol.toUpperCase())

/** Your number for a field, the automatic number it replaced, and when an EPS edit ends. */
export type OverrideInput = { value: number; autoValue: number | null; expiresOn: string | null }
export type Overrides = Partial<Record<ResearchOverrideField, OverrideInput>>
export type Part = {
  key: 'valuation' | 'growth_score' | 'moat' | 'execution' | 'economy'
  label: string
  max: number
  points: number | null
  edited: boolean
  /** The points without your edit. */
  auto: number | null
  detail: string
}

/** An edit worth a second look: the automatic number has moved since you made it, or an EPS
 * edit ended with an earnings report (the automatic EPS is back in use). */
export type EditCheck = {
  field: ResearchOverrideField
  label: string
  value: number
  auto: number | null
  autoThen: number | null
  status: 'changed' | 'ended'
  endedOn: string | null
}

export const OVERRIDE_LABEL: Record<ResearchOverrideField, string> = {
  eps: 'EPS',
  growth: 'Growth',
  valuation: 'Valuation points',
  growth_score: 'Growth points',
  moat: 'Moat points',
  execution: 'Execution points',
}

/** EPS changes with every report, so an EPS edit ends 3 days after the next one (time for the
 * new numbers to arrive). Null = no report date known: it lasts until you change it. */
export function epsEditEnds(nextEarnings: string | null): string | null {
  if (!nextEarnings) return null
  const d = new Date(`${nextEarnings}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  return d.toISOString().slice(0, 10)
}

/** Has the automatic number really moved? Small daily drift isn't worth a flag: EPS within
 * 2%, growth within half a point. Score points are whole numbers, so any change counts. An
 * edit made before tracking (autoThen null) is flagged once, so it gets checked. */
export function autoMoved(field: ResearchOverrideField, now: number | null, then: number | null): boolean {
  if (now === null || then === null) return now !== then
  if (field === 'eps') return Math.abs(now - then) > Math.max(0.02 * Math.abs(then), 0.01)
  if (field === 'growth') return Math.abs(now - then) > 0.5
  return now !== then
}

export type Research = {
  symbol: string
  name: string | null
  kind: 'stock' | 'etf' | 'no_data'
  price: number | null
  /** foreign: the company reports in another currency, so EPS is price / P/E instead. */
  eps: { value: number | null; edited: boolean; auto: number | null; foreign: { currency: string; pe: number | null } | null }
  growth: {
    value: number | null
    edited: boolean
    auto: number | null
    capped: boolean
    from: GrowthSource | null
    raw5y: number | null
    raw3y: number | null
    forecast: { value: number; fromYear: number | null; toYear: number | null; analysts: number | null } | null
  }
  aaa: number
  fair: number | null
  pct: number | null // price / fair value
  buyBelow: number | null
  parts: Part[]
  total: number | null
  partial: boolean
  label: ScoreLabel | null
  earnings: { date: string; hour: string | null; estimate: number | null; days: number } | null
  checks: EditCheck[]
}

const fmtPct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 10) / 10}%`)

export function research(
  symbol: string,
  f: FundamentalsRow | null,
  price: number | null,
  macro: Macro,
  overrides: Overrides,
  settings: { growthCap: number; economyOverride: number | null },
  today: string,
): Research {
  const etf = isEtf(symbol) || ['ETP', 'Closed-End Fund'].includes(f?.security_type ?? '')
  const aaa = macro.aaa ?? FALLBACK_AAA
  // An edit applies unless it has ended (EPS edits end after the next earnings report).
  const ended = (o: OverrideInput | undefined) => o !== undefined && o.expiresOn !== null && today > o.expiresOn
  const mine = (k: ResearchOverrideField) => {
    const o = overrides[k]
    return o && !ended(o) ? o.value : undefined
  }
  const epsRaw = f?.eps_ttm !== null && f?.eps_ttm !== undefined ? Number(f.eps_ttm) : null
  // A company reporting in another currency (TSM: Taiwan dollars per ordinary share, 5 to an
  // ADR) has an EPS that isn't $ per share held; its P/E is, so EPS = price / P/E.
  const currency = f?.reporting_currency ?? null
  const peTtm = f?.pe_ttm !== null && f?.pe_ttm !== undefined ? Number(f.pe_ttm) : null
  const foreign = currency !== null && currency !== 'USD' ? { currency, pe: peTtm } : null
  const epsAuto = foreign ? (price !== null && peTtm !== null && peTtm > 0 ? price / peTtm : null) : epsRaw
  const epsMine = mine('eps')
  const eps = epsMine !== undefined ? { value: epsMine, edited: true, auto: epsAuto, foreign } : { value: epsAuto, edited: false, auto: epsAuto, foreign }
  const auto = growthUsed(f, settings.growthCap)
  const forecast =
    f?.eps_growth_forecast !== null && f?.eps_growth_forecast !== undefined
      ? { value: Number(f.eps_growth_forecast), fromYear: f.forecast_from_year ?? null, toYear: f.forecast_to_year ?? null, analysts: f.forecast_analysts ?? null }
      : null
  const known = { raw5y: f?.eps_growth_5y ?? null, raw3y: f?.eps_growth_3y ?? null, forecast }
  const growthMine = mine('growth')
  const growth =
    growthMine !== undefined
      ? { value: growthMine, edited: true, auto: auto.value, capped: false, from: null, ...known }
      : { ...auto, edited: false, auto: auto.value, ...known }
  const fair = etf && epsMine === undefined ? null : fairValue(eps.value, growth.value, aaa)
  const pct = fair !== null && price !== null ? price / fair : null

  const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v))
  const gm = num(f?.gross_margin)
  const roe = num(f?.roe)
  const nm = num(f?.net_margin)
  const de = num(f?.debt_to_equity)
  const cr = num(f?.current_ratio)
  const econ = economyPoints(macro)
  const part = (key: Part['key'], label: string, max: number, autoPts: number | null, detail: string, override?: number): Part =>
    override !== undefined ? { key, label, max, points: override, edited: true, auto: autoPts, detail } : { key, label, max, points: autoPts, edited: false, auto: autoPts, detail }

  const stockData = !etf && f !== null
  const parts: Part[] = [
    part('valuation', 'Valuation', 20, pct !== null ? valuationPoints(pct) : null, pct !== null ? `${Math.round(pct * 100)}% of fair value` : 'no fair value', mine('valuation')),
    part('growth_score', 'Growth', 20, stockData && growth.value !== null ? growthPoints(growth.value) : null, growth.value !== null ? `${fmtPct(growth.value)}/yr` : 'no growth data', mine('growth_score')),
    part('moat', 'Moat', 20, stockData ? moatPoints(gm, roe) : null, `margin ${fmtPct(gm)}, ROE ${fmtPct(roe)}`, mine('moat')),
    part(
      'execution',
      'Execution',
      10,
      stockData ? executionPoints(nm, de, cr) : null,
      `${nm === null ? 'profit —' : nm > 0 ? 'profitable' : 'losing money'}, debt/equity ${de === null ? '—' : de.toFixed(2)}, current ratio ${cr === null ? '—' : cr.toFixed(1)}`,
      mine('execution'),
    ),
    settings.economyOverride !== null
      ? { key: 'economy', label: 'Economy', max: 30, points: settings.economyOverride, edited: true, auto: econ.points, detail: 'same for every stock' }
      : { key: 'economy', label: 'Economy', max: 30, points: econ.points, edited: false, auto: econ.points, detail: 'same for every stock' },
  ]
  const scored = parts.filter((p) => p.points !== null)
  const hasCompanyScore = parts.slice(0, 4).some((p) => p.points !== null)
  const total = hasCompanyScore ? scored.reduce((s, p) => s + (p.points ?? 0), 0) : null

  let earnings: Research['earnings'] = null
  if (f?.next_earnings_date) {
    const days = Math.round((Date.parse(`${f.next_earnings_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    // Same currency and share basis as the reported EPS, so scale it the same way.
    const estimate = num(f.next_eps_estimate)
    const scaled = foreign ? (estimate !== null && epsAuto !== null && epsRaw ? (estimate * epsAuto) / epsRaw : null) : estimate
    if (days >= 0) earnings = { date: f.next_earnings_date, hour: f.next_earnings_hour, estimate: scaled, days }
  }

  // Edits to look at again: ended, or the automatic number has moved since they were made.
  const autoOf: Record<ResearchOverrideField, number | null> = {
    eps: epsAuto,
    growth: auto.value,
    valuation: parts[0].auto,
    growth_score: parts[1].auto,
    moat: parts[2].auto,
    execution: parts[3].auto,
  }
  const checks: EditCheck[] = []
  for (const k of Object.keys(OVERRIDE_LABEL) as ResearchOverrideField[]) {
    const o = overrides[k]
    if (!o) continue
    const base = { field: k, label: OVERRIDE_LABEL[k], value: o.value, auto: autoOf[k], autoThen: o.autoValue }
    if (ended(o)) checks.push({ ...base, status: 'ended', endedOn: o.expiresOn })
    else if (autoMoved(k, autoOf[k], o.autoValue)) checks.push({ ...base, status: 'changed', endedOn: null })
  }

  return {
    symbol,
    name: f?.name ?? null,
    kind: etf ? 'etf' : f === null || eps.value === null ? 'no_data' : 'stock',
    price,
    eps,
    growth,
    aaa,
    fair,
    pct,
    buyBelow: fair !== null ? fair * MARGIN_OF_SAFETY : null,
    parts,
    total,
    partial: total !== null && scored.length < parts.length,
    label: total !== null ? scoreLabel(total) : null,
    earnings,
    checks,
  }
}

// --- Colours -----------------------------------------------------------------------------------

export type Tone = 'green' | 'neutral' | 'amber' | 'red' | 'teal'
/** % of fair value: under 85% cheap, 85-105% fair, 105-130% pricey, over 130% expensive. */
export const fairTone = (pct: number): Tone => (pct < 0.85 ? 'green' : pct <= 1.05 ? 'neutral' : pct <= 1.3 ? 'amber' : 'red')
export const fairWord = (pct: number) => (pct < 0.85 ? 'cheap' : pct <= 1.05 ? 'fair' : pct <= 1.3 ? 'pricey' : 'expensive')
export const scoreTone = (label: ScoreLabel): Tone => (label === 'Strong' ? 'green' : label === 'Good' ? 'teal' : label === 'Fair' ? 'neutral' : 'amber')
