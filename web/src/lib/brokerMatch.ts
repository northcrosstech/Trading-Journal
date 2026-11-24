/**
 * Match my broker: compare a spreadsheet of what the broker shows with what the app holds,
 * and work out the fewest entries that make them match. Pure functions only -- the page
 * (pages/MatchBrokerPage.tsx) saves the plan through the existing portfolio functions.
 *
 * Sheet columns (one row per stock, option or cash balance, every portfolio in one sheet):
 *   Portfolio | Ticker | Shares | Avg cost | Call/Put | Strike | Expiry | Side | Contracts
 * Cash is a row with Ticker CASH and the balance under Shares. Options fill Call/Put,
 * Strike, Expiry, Side and Contracts, with the average price per share under Avg cost.
 *
 * Average cost: when the broker shows more shares, the buy is priced so the app's average
 * lands on the broker's. A sale never changes the app's average, so a sale whose broker
 * average differs is flagged to log by hand.
 */
import type { CspPosition, Holding, OptionPosition, Portfolio } from './database.types'

export const SHEET_HEADERS = ['Portfolio', 'Ticker', 'Shares', 'Avg cost', 'Call/Put', 'Strike', 'Expiry', 'Side', 'Contracts'] as const

type Field = 'portfolio' | 'ticker' | 'shares' | 'avg' | 'type' | 'strike' | 'expiry' | 'side' | 'contracts'

/** Header names people use for each column (compared without case, spaces or punctuation). */
const ALIASES: Record<Field, string[]> = {
  portfolio: ['portfolio', 'account', 'accountname', 'portfolioname'],
  ticker: ['ticker', 'symbol', 'stock', 'underlying'],
  shares: ['shares', 'qty', 'quantity', 'position', 'units'],
  avg: ['avgcost', 'averagecost', 'avgprice', 'averageprice', 'costpershare', 'costbasispershare', 'avg', 'unitcost'],
  type: ['callput', 'putcall', 'type', 'optiontype', 'option'],
  strike: ['strike', 'strikeprice'],
  expiry: ['expiry', 'expiration', 'exp', 'expirationdate', 'expirydate', 'expdate'],
  side: ['side', 'longshort', 'direction'],
  contracts: ['contracts', 'contract', 'optionqty'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export type SheetRow = { line: number; portfolio: string; ticker: string; shares: number | null; avg: number | null; type: string; strike: number | null; expiry: string | null; side: string; contracts: number | null; expiryRaw: string }

export type ParsedSheet = { rows: SheetRow[]; missingColumns: string[] }

/** Number from a cell: 1,234.50 / $1,234.50 / (12.5) for negative. Blank = null, junk = NaN. */
export function cellNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  let s = String(v).trim()
  if (s === '' || s === '-' || s === '--') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$,\s]/g, '')
  if (s.startsWith('-')) {
    neg = !neg
    s = s.slice(1)
  }
  if (!/^\d*\.?\d+$/.test(s)) return NaN
  return neg ? -Number(s) : Number(s)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** yyyy-mm-dd from 2026-12-19, 12/19/2026, 12/19/26, or an Excel date number. Null if unreadable. */
export function cellDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel day number (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  return null
}

function valid(y: number, mo: number, d: number): string | null {
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** Rows of cells (first non-empty row = headers) into sheet rows. Columns can be in any
 * order and extra columns are ignored. */
export function readSheet(cells: unknown[][]): ParsedSheet {
  const headerAt = cells.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (headerAt < 0) return { rows: [], missingColumns: ['Portfolio', 'Ticker', 'Shares'] }
  const headers = cells[headerAt].map((h) => norm(String(h ?? '')))
  const col = {} as Record<Field, number>
  for (const f of Object.keys(ALIASES) as Field[]) {
    col[f] = headers.findIndex((h) => ALIASES[f].map(norm).includes(h))
  }
  const missingColumns = (['portfolio', 'ticker', 'shares'] as Field[]).filter((f) => col[f] < 0).map((f) => SHEET_HEADERS[['portfolio', 'ticker', 'shares'].indexOf(f)])
  const get = (r: unknown[], f: Field) => (col[f] >= 0 ? r[col[f]] : undefined)
  const rows: SheetRow[] = []
  cells.slice(headerAt + 1).forEach((r, i) => {
    if (!r.some((c) => String(c ?? '').trim() !== '')) return
    const expiryCell = get(r, 'expiry')
    rows.push({
      line: headerAt + i + 2,
      portfolio: String(get(r, 'portfolio') ?? '').trim(),
      ticker: String(get(r, 'ticker') ?? '').trim().toUpperCase(),
      shares: cellNumber(get(r, 'shares')),
      avg: cellNumber(get(r, 'avg')),
      type: norm(String(get(r, 'type') ?? '')),
      strike: cellNumber(get(r, 'strike')),
      expiry: cellDate(expiryCell),
      expiryRaw: String(expiryCell ?? '').trim(),
      side: norm(String(get(r, 'side') ?? '')),
      contracts: cellNumber(get(r, 'contracts')),
    })
  })
  return { rows, missingColumns }
}

// ---------------------------------------------------------------------------
// What the app holds, and the download
// ---------------------------------------------------------------------------

export type Snapshot = {
  portfolio: Portfolio
  holdings: Holding[]
  /** open only */
  options: OptionPosition[]
  /** open only */
  csps: CspPosition[]
}

/** Rows for the download: what the app holds now, for the chosen portfolios. */
export function snapshotRows(snaps: Snapshot[]): (string | number)[][] {
  const out: (string | number)[][] = [[...SHEET_HEADERS]]
  for (const s of snaps) {
    const name = s.portfolio.name
    for (const h of [...s.holdings].filter((h) => Number(h.quantity) > 0).sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      out.push([name, h.symbol, Number(h.quantity), round(Number(h.avg_cost), 4), '', '', '', '', ''])
    }
    for (const g of groupPositions(s).values()) {
      out.push([name, g.symbol, '', round(g.price, 4), g.type === 'call' ? 'Call' : 'Put', g.strike, g.expiration, g.side === 'long' ? 'Long' : 'Short', g.contracts])
    }
    out.push([name, 'CASH', round(Number(s.portfolio.cash), 2), '', '', '', '', '', ''])
  }
  return out
}

// ---------------------------------------------------------------------------
// Options: lots in the app grouped by contract
// ---------------------------------------------------------------------------

export type OptionKind = { symbol: string; type: 'call' | 'put'; side: 'long' | 'short'; strike: number; expiration: string }
export type Lot = { id: string; isCsp: boolean; contracts: number; price: number }
export type PositionGroup = OptionKind & { key: string; contracts: number; price: number; lots: Lot[] }

export const optionKey = (o: OptionKind) => `${o.symbol}|${o.type}|${o.side}|${Number(o.strike)}|${o.expiration}`

export function groupPositions(s: Pick<Snapshot, 'options' | 'csps'>): Map<string, PositionGroup> {
  const out = new Map<string, PositionGroup>()
  const add = (k: OptionKind, lot: Lot) => {
    const key = optionKey(k)
    const g = out.get(key) ?? { ...k, key, contracts: 0, price: 0, lots: [] }
    g.price = (g.price * g.contracts + lot.price * lot.contracts) / (g.contracts + lot.contracts)
    g.contracts += lot.contracts
    g.lots.push(lot)
    out.set(key, g)
  }
  for (const o of s.options) {
    add({ symbol: o.symbol, type: o.option_type, side: o.side, strike: Number(o.strike), expiration: o.expiration }, { id: o.id, isCsp: false, contracts: o.contracts, price: Number(o.open_price) })
  }
  for (const c of s.csps) {
    add({ symbol: c.symbol, type: 'put', side: 'short', strike: Number(c.strike), expiration: c.expiration }, { id: c.id, isCsp: true, contracts: c.contracts, price: Number(c.premium) })
  }
  return out
}

/** How an option that left the broker ended. */
export type CloseOutcome = 'closed' | 'expired' | 'exercised' | 'assigned'
/** The person's answer for an option that left the broker; price is for Sold / Bought back. */
export type CloseAnswer = { outcome: CloseOutcome; price: number | null }
export const answered = (a: CloseAnswer | undefined) => !!a && (a.outcome !== 'closed' || (a.price != null && a.price >= 0))

export function outcomeChoices(g: OptionKind): { value: CloseOutcome; label: string }[] {
  if (g.side === 'long') {
    return [{ value: 'closed', label: 'Sold' }, { value: 'expired', label: 'Expired' }, ...(g.type === 'call' ? [{ value: 'exercised' as const, label: 'Exercised' }] : [])]
  }
  return [
    { value: 'closed', label: 'Bought back' },
    { value: 'expired', label: 'Expired' },
    { value: 'assigned', label: 'Assigned' },
  ]
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** One line on the review screen. `status`: log = saved by Log all; ok = already matches;
 * check = flagged, the person logs it by hand; ask = needs an answer (how an option ended). */
export type StockLine = {
  kind: 'stock'
  symbol: string
  status: 'log' | 'ok' | 'check'
  appQty: number
  appAvg: number
  brokerQty: number
  brokerAvg: number | null
  side?: 'buy' | 'sell'
  quantity?: number
  price?: number
  /** plain-language reason or working */
  note: string
  notInFile?: boolean
}

export type OptionLine = {
  kind: 'option'
  key: string
  group: OptionKind
  status: 'log' | 'ok' | 'check' | 'ask'
  appContracts: number
  brokerContracts: number
  /** open new contracts */
  open?: { contracts: number; price: number }
  /** close contracts that left the broker (all lots, or part of a single lot) */
  close?: { lots: Lot[]; contracts: number; partial: boolean }
  note: string
}

export type CashLine = { kind: 'cash'; status: 'log' | 'ok'; app: number; broker: number }

export type PortfolioPlan = {
  portfolio: Portfolio
  /** Set when a row for this portfolio couldn't be read: nothing in it is logged until the
   * file is fixed, so a mistyped row is never taken as a sale. */
  blocked?: string
  stocks: StockLine[]
  options: OptionLine[]
  cash: CashLine | null
}

export type RowProblem = { line: number; message: string }

/** `blockedAll`: a row names a portfolio the app can't place, so nothing is logged (its rows
 * could belong to any portfolio, and leaving them out would read as sales). */
export type MatchPlan = { plans: PortfolioPlan[]; problems: RowProblem[]; skippedPortfolios: number; blockedAll: boolean }

type StockTarget = { qty: number; avg: number | null; line: number }
type OptionTarget = OptionKind & { contracts: number; price: number | null; line: number }
type Targets = { stocks: Map<string, StockTarget>; options: Map<string, OptionTarget>; cash: number | null }

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp
const EPS = 0.000001

/** Averages that differ by a rounding amount (a cent, or 0.1%) count as the same. */
export const sameAvg = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.001)

function closest(name: string, names: string[]): string | null {
  const n = norm(name)
  if (!n) return null
  return names.find((x) => norm(x).startsWith(n) || n.startsWith(norm(x))) ?? names.find((x) => norm(x).includes(n) || n.includes(norm(x))) ?? null
}

/** Sort the sheet's rows into targets per portfolio; rows that don't make sense become problems. */
export function sheetTargets(rows: SheetRow[], portfolios: Portfolio[]): { targets: Map<string, Targets>; problems: RowProblem[]; blocked: Set<string>; blockedAll: boolean } {
  const active = portfolios.filter((p) => !p.archived)
  const byName = new Map(active.map((p) => [norm(p.name), p]))
  const targets = new Map<string, Targets>()
  const problems: RowProblem[] = []
  const blocked = new Set<string>()
  let blockedAll = false
  let current: string | null = null
  const bad = (line: number, message: string) => {
    problems.push({ line, message })
    if (current) blocked.add(current)
  }

  for (const r of rows) {
    current = null
    if (!r.portfolio) {
      blockedAll = true
      bad(r.line, 'No portfolio name')
      continue
    }
    const p = byName.get(norm(r.portfolio))
    if (!p) {
      const guess = active.find((x) => x.name === closest(r.portfolio, active.map((y) => y.name)))
      if (guess) current = guess.id
      else blockedAll = true
      bad(r.line, `No portfolio called "${r.portfolio}"${guess ? `. Did you mean ${guess.name}?` : ''}`)
      continue
    }
    current = p.id
    const t = targets.get(p.id) ?? { stocks: new Map(), options: new Map(), cash: null }
    targets.set(p.id, t)
    if (!r.ticker) {
      bad(r.line, 'No ticker')
      continue
    }

    if (r.ticker === 'CASH') {
      if (r.shares == null || Number.isNaN(r.shares)) bad(r.line, 'Put the cash balance under Shares')
      else if (t.cash != null) bad(r.line, `${p.name} has two CASH rows; keep one`)
      else t.cash = r.shares
      continue
    }

    const isOption = r.type !== '' || r.strike != null || r.expiryRaw !== '' || r.contracts != null
    if (isOption) {
      const type = r.type.startsWith('c') ? 'call' : r.type.startsWith('p') ? 'put' : null
      const side = r.side.startsWith('l') || r.side === 'buy' || r.side === 'bought' ? 'long' : r.side.startsWith('s') ? 'short' : null
      if (!type) bad(r.line, `${r.ticker}: put Call or Put under Call/Put`)
      else if (r.strike == null || Number.isNaN(r.strike) || r.strike <= 0) bad(r.line, `${r.ticker}: add the strike`)
      else if (!r.expiry) bad(r.line, `${r.ticker}: add the expiry as a date, e.g. 2026-12-19`)
      else if (!side) bad(r.line, `${r.ticker}: put Long (bought) or Short (sold) under Side`)
      else if (r.contracts == null || Number.isNaN(r.contracts) || r.contracts < 0 || !Number.isInteger(r.contracts)) bad(r.line, `${r.ticker}: Contracts must be a whole number`)
      else if (r.avg != null && (Number.isNaN(r.avg) || r.avg < 0)) bad(r.line, `${r.ticker}: Avg cost must be a number`)
      else {
        const k: OptionKind = { symbol: r.ticker, type, side, strike: r.strike, expiration: r.expiry }
        const key = optionKey(k)
        if (t.options.has(key)) bad(r.line, `${r.ticker} ${r.strike} ${type} ${r.expiry} is listed twice in ${p.name}; keep one row`)
        else t.options.set(key, { ...k, contracts: r.contracts, price: r.avg, line: r.line })
      }
      continue
    }

    if (r.shares == null || Number.isNaN(r.shares) || r.shares < 0) bad(r.line, `${r.ticker}: Shares must be a number`)
    else if (r.avg != null && (Number.isNaN(r.avg) || r.avg < 0)) bad(r.line, `${r.ticker}: Avg cost must be a number`)
    else if (t.stocks.has(r.ticker)) bad(r.line, `${r.ticker} is listed twice in ${p.name}; keep one row`)
    else t.stocks.set(r.ticker, { qty: r.shares, avg: r.avg, line: r.line })
  }
  return { targets, problems, blocked, blockedAll }
}

/** Shares after the option closes the person picked (assigned calls deliver shares,
 * exercised calls and assigned puts bring them in), so the stock lines start from there. */
export function holdingsAfterCloses(holdings: Holding[], closes: { group: OptionKind; outcome: CloseOutcome; contracts: number; lots: Lot[] }[]): Map<string, { qty: number; avg: number }> {
  const out = new Map(holdings.map((h) => [h.symbol, { qty: Number(h.quantity), avg: Number(h.avg_cost) }]))
  for (const c of closes) {
    const shares = 100 * c.contracts
    const premium = c.lots.reduce((s, l) => s + l.price * l.contracts, 0) / Math.max(1, c.lots.reduce((s, l) => s + l.contracts, 0))
    const h = out.get(c.group.symbol) ?? { qty: 0, avg: 0 }
    if (c.outcome === 'assigned' && c.group.type === 'call') {
      h.qty = Math.max(0, h.qty - shares)
    } else if ((c.outcome === 'exercised' && c.group.type === 'call') || (c.outcome === 'assigned' && c.group.type === 'put')) {
      const basis = c.group.type === 'call' ? c.group.strike + premium : Math.max(c.group.strike - premium, 0)
      h.avg = (h.qty * h.avg + shares * basis) / (h.qty + shares)
      h.qty += shares
    } else continue
    out.set(c.group.symbol, h)
  }
  return out
}

/** One stock: what to log so the app matches the broker. `close` is today's price (null if none). */
export function planStock(symbol: string, app: { qty: number; avg: number }, target: { qty: number; avg: number | null } | null, close: number | null): StockLine {
  const base = { kind: 'stock' as const, symbol, appQty: app.qty, appAvg: app.avg }
  if (!target) {
    // In the app, missing from the file: sold
    const price = close ?? app.avg
    return { ...base, brokerQty: 0, brokerAvg: null, status: 'log', side: 'sell', quantity: app.qty, price, notInFile: true, note: `Not in the file, so sold. Priced at ${close != null ? 'today’s close' : 'its average cost (no close saved)'}; you can change it.` }
  }
  const t = { ...base, brokerQty: target.qty, brokerAvg: target.avg }
  const diff = round(target.qty - app.qty, 6)

  if (Math.abs(diff) < EPS) {
    if (target.avg == null || app.qty === 0 || sameAvg(app.avg, target.avg)) return { ...t, status: 'ok', note: '' }
    return { ...t, status: 'check', note: `Same shares, but the averages differ (${money(app.avg)} in the app, ${money(target.avg)} at the broker). Check this ticker's entries in Activity.` }
  }

  if (diff > 0) {
    if (target.avg == null) {
      if (close == null) return { ...t, status: 'check', note: 'No average cost in the file and no price saved yet. Add the Avg cost.' }
      return { ...t, status: 'log', side: 'buy', quantity: diff, price: close, note: 'No average cost in the file, so bought at today’s close.' }
    }
    const price = (target.qty * target.avg - app.qty * app.avg) / diff
    const realistic = price > 0 && (close == null || (price <= close * 3 && price >= close / 3))
    if (!realistic) {
      return { ...t, status: 'check', note: `To reach an average of ${money(target.avg)}, the ${qty(diff)} new shares would need a price of ${money(price)}${close != null ? `, far from today’s ${money(close)}` : ''}. Log this trade by hand with its real price.` }
    }
    const working = app.qty > 0 ? `(${qty(target.qty)} × ${money(target.avg)} − ${qty(app.qty)} × ${money(app.avg)}) ÷ ${qty(diff)} = ${money(price)}` : 'New holding, bought at the broker’s average.'
    return { ...t, status: 'log', side: 'buy', quantity: diff, price: round(price, 6), note: working }
  }

  // Fewer shares at the broker: a sale. It keeps the app's average.
  const sell = -diff
  if (target.qty > 0 && target.avg != null && !sameAvg(app.avg, target.avg)) {
    return { ...t, status: 'check', note: `A sale keeps the app’s average at ${money(app.avg)}, but the broker shows ${money(target.avg)}. Your broker may sell the oldest shares first. Log this sale by hand.` }
  }
  const price = close ?? app.avg
  return { ...t, status: 'log', side: 'sell', quantity: sell, price, note: `Average cost stays ${money(app.avg)}. Priced at ${close != null ? 'today’s close' : 'its average cost (no close saved)'}; you can change it.` }
}

/** One option contract: open new contracts, close ones that left, or nothing. */
export function planOption(key: string, g: PositionGroup | null, target: OptionTarget | null, today: string): OptionLine {
  const group: OptionKind = g ?? target!
  const appC = g?.contracts ?? 0
  const brokerC = target?.contracts ?? 0
  const base = { kind: 'option' as const, key, group, appContracts: appC, brokerContracts: brokerC }
  if (appC === brokerC) return { ...base, status: 'ok', note: '' }

  if (brokerC > appC) {
    const diff = brokerC - appC
    if (target?.price == null) return { ...base, status: 'check', note: 'Add the average price per share under Avg cost.' }
    const price = appC > 0 && g ? (brokerC * target.price - appC * g.price) / diff : target.price
    if (!(price >= 0)) return { ...base, status: 'check', note: `Reaching the broker's average would need a negative price. Log these contracts by hand.` }
    const opening = group.side === 'short' ? (group.type === 'put' ? 'Sell to open (cash-secured put)' : 'Sell to open (covered call)') : 'Buy to open'
    return { ...base, status: 'log', open: { contracts: diff, price: round(price, 6) }, note: `${opening}: ${diff} at ${money(price)}` }
  }

  // Fewer contracts at the broker: some or all closed.
  const lots = g!.lots
  const gone = appC - brokerC
  if (brokerC > 0 && lots.length > 1) {
    return { ...base, status: 'check', note: `${gone} of ${appC} contracts closed, but the app holds them as ${lots.length} separate entries. Close them by hand on the portfolio page.` }
  }
  const expired = group.expiration < today
  return {
    ...base,
    status: 'ask',
    close: { lots, contracts: gone, partial: brokerC > 0 },
    note: brokerC === 0 ? (target ? 'Contracts set to 0, so closed.' : 'Not in the file, so closed.') + (expired ? ' It has passed its expiry.' : '') : `${gone} of ${appC} contracts closed.`,
  }
}

/** The full plan for every portfolio named in the file. Portfolios not in the file are left alone. */
export function buildPlan(
  rows: SheetRow[],
  portfolios: Portfolio[],
  snaps: Map<string, Snapshot>,
  closes: Map<string, number>,
  today: string,
  answers: Map<string, CloseAnswer> = new Map(),
): MatchPlan {
  const { targets, problems, blocked, blockedAll } = sheetTargets(rows, portfolios)
  const plans: PortfolioPlan[] = []
  for (const p of portfolios.filter((x) => targets.has(x.id) || blocked.has(x.id))) {
    if (blocked.has(p.id) || blockedAll) {
      plans.push({ portfolio: p, stocks: [], options: [], cash: null, blocked: blocked.has(p.id) ? 'A row for this portfolio couldn’t be read, so nothing here is logged. Fix it in the file and upload again.' : 'Fix the portfolio names in the file first.' })
      continue
    }
    const t = targets.get(p.id)!
    const snap = snaps.get(p.id) ?? { portfolio: p, holdings: [], options: [], csps: [] }
    const plan = optionAndStockLines(snap, t, closes, today, answers)
    plans.push({ portfolio: p, ...plan, cash: t.cash == null ? null : { kind: 'cash', status: Math.abs(t.cash - Number(snap.portfolio.cash)) < 0.005 ? 'ok' : 'log', app: Number(snap.portfolio.cash), broker: t.cash } })
  }
  return { plans, problems, blockedAll, skippedPortfolios: portfolios.filter((p) => !p.archived && !targets.has(p.id) && !blocked.has(p.id)).length }
}

function optionAndStockLines(snap: Snapshot, t: Targets, closes: Map<string, number>, today: string, answers: Map<string, CloseAnswer>) {
  const groups = groupPositions(snap)
  const keys = [...new Set([...groups.keys(), ...t.options.keys()])].sort()
  const options = keys.map((k) => planOption(k, groups.get(k) ?? null, t.options.get(k) ?? null, today))

  // Shares as they will be once the chosen option closes are saved
  const chosen = options
    .filter((o) => o.close && answered(answers.get(lineKey(snap.portfolio.id, o.key))))
    .map((o) => ({ group: o.group, outcome: answers.get(lineKey(snap.portfolio.id, o.key))!.outcome, contracts: o.close!.contracts, lots: o.close!.lots }))
  const held = holdingsAfterCloses(snap.holdings, chosen)

  const symbols = [...new Set([...[...held.entries()].filter(([, h]) => h.qty > EPS).map(([s]) => s), ...t.stocks.keys()])].sort()
  const stocks = symbols.map((s) => planStock(s, held.get(s) ?? { qty: 0, avg: 0 }, t.stocks.get(s) ?? null, closes.get(s) ?? manualPrice(snap, s)))

  // Covered calls still open (or opened by this plan) need their shares
  const callsNeed = new Map<string, number>()
  for (const o of options) {
    if (o.group.side !== 'short' || o.group.type !== 'call') continue
    const staying = o.brokerContracts
    callsNeed.set(o.group.symbol, (callsNeed.get(o.group.symbol) ?? 0) + 100 * staying)
  }
  for (const s of stocks) {
    const need = callsNeed.get(s.symbol) ?? 0
    if (s.status === 'log' && s.side === 'sell' && s.brokerQty < need) {
      Object.assign(s, { status: 'check', note: `Open covered calls need ${qty(need)} shares, but the file shows ${qty(s.brokerQty)}. Close those calls first, or log this sale by hand.` })
    }
  }
  for (const o of options) {
    if (o.status !== 'log' || !o.open || o.group.side !== 'short' || o.group.type !== 'call') continue
    const stock = stocks.find((s) => s.symbol === o.group.symbol)
    const shares = stock ? (stock.status === 'check' ? stock.appQty : stock.brokerQty) : 0
    const need = callsNeed.get(o.group.symbol) ?? 0
    if (shares < need) Object.assign(o, { status: 'check', note: `Covered calls need ${qty(need)} ${o.group.symbol} shares; the portfolio will hold ${qty(shares)}. Log these calls by hand.` })
  }
  return { stocks, options }
}

function manualPrice(snap: Snapshot, symbol: string): number | null {
  const h = snap.holdings.find((x) => x.symbol === symbol)
  return h?.manual_price != null ? Number(h.manual_price) : null
}

export const lineKey = (portfolioId: string, key: string) => `${portfolioId}|${key}`

/** Entries Log all will save, for the summary. */
export function countEntries(plan: MatchPlan, answers: Map<string, CloseAnswer>): { entries: number; toCheck: number; toAnswer: number } {
  let entries = 0
  let toCheck = 0
  let toAnswer = 0
  for (const p of plan.plans) {
    if (p.blocked) continue
    for (const s of p.stocks) {
      if (s.status === 'log') entries++
      if (s.status === 'check') toCheck++
    }
    for (const o of p.options) {
      if (o.status === 'log') entries++
      if (o.status === 'check') toCheck++
      if (o.status === 'ask') {
        if (answered(answers.get(lineKey(p.portfolio.id, o.key)))) entries++
        else toAnswer++
      }
    }
    if (p.cash?.status === 'log') entries++
  }
  return { entries, toCheck, toAnswer }
}

function money(n: number) {
  return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function qty(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}
