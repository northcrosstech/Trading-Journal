import type { RhExecutionInput, RhSide } from './robinhoodTrades'

/** Dedicated Robinhood "Activity" CSV import path -- deliberately separate from the
 * generic column-mapper (CsvImportPage): this file's structure (multi-line quoted
 * Description cells, an activity ledger mixed with real trades, option details packed
 * into a description string) doesn't fit a user-driven column mapping. */

// ---------------------------------------------------------------------------
// RFC-4180 tokenizer -- hand-rolled because the generic csv.ts parser splits on
// newlines first and can't handle a quoted field (Description) that itself contains
// embedded newlines, which is Robinhood's actual export format for every share row.
// ---------------------------------------------------------------------------
export function parseRfc4180(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export type RhRawRow = Record<string, string>

/** Header-keyed objects, one per non-header row. Extra trailing fields beyond the
 * header (the disclaimer row has one more column than the header) are silently
 * dropped rather than erroring -- the row classifier below rejects it anyway (its
 * Trans Code is blank). */
export function csvRowsToObjects(rows: string[][]): RhRawRow[] {
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: RhRawRow = {}
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim()
    })
    return obj
  })
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

/** "$129.56" -> 129.56, "($420.04)" -> -420.04, "" -> null. */
export function parseMoney(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const negative = trimmed.startsWith('(') && trimmed.endsWith(')')
  const cleaned = trimmed.replace(/[()$,]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isNaN(value) ? null : negative ? -value : value
}

export function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, '')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isNaN(value) ? null : value
}

/** "7/24/2026" -> "2026-07-24". */
export function parseMdyDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mo, d, y] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

const OPTION_DESC_RE = /^(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Call|Put)\s+\$([\d,]+(?:\.\d+)?)$/
const OEXP_DESC_RE = /^Option Expiration for (\S+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Call|Put)\s+\$([\d,]+(?:\.\d+)?)$/

type OptionDesc = { symbol: string; expiration: string; optionType: 'call' | 'put'; strike: number }

function parseOptionDesc(desc: string, re: RegExp): OptionDesc | null {
  const m = desc.trim().match(re)
  if (!m) return null
  const expiration = parseMdyDate(m[2])
  if (!expiration) return null
  return { symbol: m[1], expiration, optionType: m[3].toLowerCase() as 'call' | 'put', strike: Number(m[4].replace(/,/g, '')) }
}

function contractKey(d: OptionDesc): string {
  return `${d.symbol}|${d.strike}|${d.expiration}|${d.optionType}`
}

// Options: BTO/STC/STO/BTC self-label side + open/close. Shares: Buy/Sell only give
// side -- open/close is inferred later by groupRobinhoodExecutions from the running
// position.
const OPTION_TRANS_CODES: Record<string, { side: RhSide; action: 'open' | 'close' }> = {
  BTO: { side: 'buy', action: 'open' },
  STC: { side: 'sell', action: 'close' },
  STO: { side: 'sell', action: 'open' },
  BTC: { side: 'buy', action: 'close' },
}

// Ledger entries that never represent a trade fill -- skipped with a reason so
// nothing silently vanishes from the dry-run's row count.
const NON_TRADE_REASON: Record<string, string> = {
  CDIV: 'cash dividend',
  MDIV: 'manufactured dividend (payment-in-lieu)',
  MINT: 'margin interest',
}

export type RhSkippedRow = { csvRowNumber: number; reason: string; raw: RhRawRow }

export type RhParseResult = {
  /** Oldest-first (the file itself is sorted newest-first; same-day blocks appear to
   * follow the same convention -- see robinhoodTrades.ts's header comment / the
   * verification this assumption was checked against). */
  executions: RhExecutionInput[]
  skipped: RhSkippedRow[]
}

/** Synthesizes a distinct, increasing intraday timestamp per row so same-day fills
 * keep a stable relative order for display and hold-time math. Robinhood's Activity
 * export has no fill time, only a date -- these timestamps carry no real precision
 * and must never be read as actual execution times. */
function syntheticFilledAt(dateIso: string, indexWithinDay: number): string {
  const base = new Date(`${dateIso}T09:30:00.000Z`).getTime()
  return new Date(base + indexWithinDay * 1000).toISOString()
}

export function parseRobinhoodActivityCsv(text: string): RhParseResult {
  const rows = csvRowsToObjects(parseRfc4180(text))

  const skipped: RhSkippedRow[] = []
  // Oldest-first: the whole file (and, per the confirmed assumption, same-day blocks
  // too) is sorted newest-first.
  const ordered = [...rows].reverse()
  const total = ordered.length

  const dayCounters = new Map<string, number>()
  const nextIndexInDay = (dateIso: string) => {
    const n = dayCounters.get(dateIso) ?? 0
    dayCounters.set(dateIso, n + 1)
    return n
  }

  const executions: RhExecutionInput[] = []

  ordered.forEach((raw, orderedIdx) => {
    // csvRowNumber: position in the original (unreversed) file, 1 = header, so data
    // row 1 is csvRowNumber 2 -- matches what a user sees opening the file in Excel.
    const csvRowNumber = total - orderedIdx + 1
    const transCode = (raw['Trans Code'] ?? '').trim()
    const description = raw['Description'] ?? ''
    const instrument = (raw['Instrument'] ?? '').trim()
    const activityDate = parseMdyDate(raw['Activity Date'] ?? '')

    if (transCode === '') {
      skipped.push({ csvRowNumber, reason: 'blank row or trailing disclaimer', raw })
      return
    }
    if (!activityDate) {
      skipped.push({ csvRowNumber, reason: 'unparseable Activity Date', raw })
      return
    }
    if (transCode in NON_TRADE_REASON) {
      skipped.push({ csvRowNumber, reason: NON_TRADE_REASON[transCode], raw })
      return
    }

    if (transCode === 'OEXP') {
      const opt = parseOptionDesc(description, OEXP_DESC_RE)
      if (!opt) {
        skipped.push({ csvRowNumber, reason: 'OEXP row: could not parse option description', raw })
        return
      }
      const qty = parseQuantity(raw['Quantity'] ?? '')
      if (qty === null) {
        skipped.push({ csvRowNumber, reason: 'OEXP row: missing quantity', raw })
        return
      }
      executions.push({
        key: contractKey(opt),
        assetType: 'option',
        symbol: opt.symbol,
        optionType: opt.optionType,
        strike: opt.strike,
        expiration: opt.expiration,
        side: 'sell', // placeholder -- resolved dynamically by groupRobinhoodExecutions
        intendedAction: 'close',
        forceCloseAtZeroPrice: true,
        quantity: qty,
        price: 0,
        amount: null,
        filledAt: syntheticFilledAt(activityDate, nextIndexInDay(activityDate)),
        note: 'Expired worthless',
        sourceRowIndexes: [csvRowNumber],
      })
      return
    }

    if (transCode === 'OASGN') {
      const opt = parseOptionDesc(description, OPTION_DESC_RE)
      if (!opt) {
        skipped.push({ csvRowNumber, reason: 'OASGN row: could not parse option description', raw })
        return
      }
      const qty = parseQuantity(raw['Quantity'] ?? '')
      if (qty === null) {
        skipped.push({ csvRowNumber, reason: 'OASGN row: missing quantity', raw })
        return
      }
      executions.push({
        key: contractKey(opt),
        assetType: 'option',
        symbol: opt.symbol,
        optionType: opt.optionType,
        strike: opt.strike,
        expiration: opt.expiration,
        side: 'sell', // placeholder -- resolved dynamically
        intendedAction: 'close',
        forceCloseAtZeroPrice: true,
        quantity: qty,
        price: 0,
        amount: null,
        filledAt: syntheticFilledAt(activityDate, nextIndexInDay(activityDate)),
        note: 'Assigned -- the resulting stock trade is a separate Buy/Sell row, imported normally',
        sourceRowIndexes: [csvRowNumber],
      })
      return
    }

    if (transCode in OPTION_TRANS_CODES) {
      const opt = parseOptionDesc(description, OPTION_DESC_RE)
      if (!opt) {
        skipped.push({ csvRowNumber, reason: `${transCode} row: could not parse option description "${description}"`, raw })
        return
      }
      const qty = parseQuantity(raw['Quantity'] ?? '')
      const price = parseMoney(raw['Price'] ?? '')
      if (qty === null || price === null) {
        skipped.push({ csvRowNumber, reason: `${transCode} row: missing quantity or price`, raw })
        return
      }
      const { side, action } = OPTION_TRANS_CODES[transCode]
      executions.push({
        key: contractKey(opt),
        assetType: 'option',
        symbol: opt.symbol,
        optionType: opt.optionType,
        strike: opt.strike,
        expiration: opt.expiration,
        side,
        intendedAction: action,
        quantity: qty,
        price,
        amount: parseMoney(raw['Amount'] ?? ''),
        filledAt: syntheticFilledAt(activityDate, nextIndexInDay(activityDate)),
        sourceRowIndexes: [csvRowNumber],
      })
      return
    }

    if (transCode === 'Buy' || transCode === 'Sell') {
      if (!description.includes('CUSIP:')) {
        skipped.push({ csvRowNumber, reason: `${transCode} row: expected a share row (CUSIP) but description didn't match`, raw })
        return
      }
      const qty = parseQuantity(raw['Quantity'] ?? '')
      const price = parseMoney(raw['Price'] ?? '')
      if (qty === null || price === null || !instrument) {
        skipped.push({ csvRowNumber, reason: `${transCode} row: missing quantity, price, or instrument`, raw })
        return
      }
      executions.push({
        key: instrument,
        assetType: 'stock',
        symbol: instrument,
        side: transCode === 'Buy' ? 'buy' : 'sell',
        // No intendedAction -- shares carry no open/close label; the grouping engine
        // infers it from the running position.
        quantity: qty,
        price,
        amount: parseMoney(raw['Amount'] ?? ''),
        filledAt: syntheticFilledAt(activityDate, nextIndexInDay(activityDate)),
        sourceRowIndexes: [csvRowNumber],
      })
      return
    }

    skipped.push({ csvRowNumber, reason: `unrecognized trans code "${transCode}"`, raw })
  })

  return { executions, skipped }
}
