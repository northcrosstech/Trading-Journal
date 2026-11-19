/** One trade read from pasted text. */
export type PastedTrade = { symbol: string; side: 'buy' | 'sell'; qty: number; price: number }

const SIDE_WORDS = /\b(buy|bought|sell|sold)\b/gi
const SELL_WORD = /\b(sell|sold)\b/i
const TICKER = /^[A-Za-z][A-Za-z0-9./-]{0,9}$/
const UPPER_TICKER = /^[A-Z][A-Z0-9./-]{0,9}$/

/** "1,234.50", "$12", "(5)" and "-5" as numbers; anything else (dates, names) is null. */
function toNumber(cell: string): number | null {
  let t = cell.trim()
  const bracketed = /^\(.*\)$/.test(t)
  if (bracketed) t = t.slice(1, -1)
  t = t.replace(/[$,\s]/g, '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  return bracketed ? -n : n
}

/** Splits on commas, keeping quoted cells such as "1,234.50" whole. */
function splitCommas(row: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of row) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** The ways a row may be cut into cells, most specific first. */
function splits(row: string): string[][] {
  if (row.includes('\t')) return [row.split('\t')]
  const out: string[][] = []
  if (/\S\s{2,}\S/.test(row)) out.push(row.trim().split(/\s{2,}/))
  if (row.includes(',')) out.push(splitCommas(row))
  out.push(row.trim().split(/\s+/))
  return out
}

function readCells(raw: string[], sell: boolean): PastedTrade | null {
  const cells = raw.map((c) => c.replace(SIDE_WORDS, '').trim()).filter((c) => c !== '')
  let at = cells.findIndex((c) => UPPER_TICKER.test(c))
  if (at < 0) at = cells.findIndex((c) => TICKER.test(c))
  if (at < 0) return null
  const numbersIn = (list: string[]) => list.map(toNumber).filter((n): n is number => n !== null)
  // Shares and price normally follow the ticker; a row number or date before it is skipped.
  let numbers = numbersIn(cells.slice(at + 1))
  if (numbers.length < 2) numbers = numbersIn(cells)
  if (numbers.length < 2) return null
  const [shares, price] = numbers
  if (shares === 0) return null
  return { symbol: cells[at].toUpperCase(), side: sell || shares < 0 ? 'sell' : 'buy', qty: Math.abs(shares), price: Math.abs(price) }
}

function readRow(row: string): PastedTrade | null {
  const sell = SELL_WORD.test(row)
  for (const cells of splits(row)) {
    const t = readCells(cells, sell)
    if (t) return t
  }
  return null
}

/** Reads rows copied from a broker or a spreadsheet: one trade per line, cells separated by
 * tabs, commas or runs of spaces, in the order ticker, shares, price. A word like buy / sell /
 * bought / sold, or a negative share count, marks a sale. Returns null when the text holds no
 * such row (a single ticker or number), so the caller lets the normal paste happen. */
export function parsePastedTrades(text: string): { trades: PastedTrade[]; skipped: number } | null {
  const rows = text.split(/\r?\n/).filter((r) => r.trim() !== '')
  const trades: PastedTrade[] = []
  let skipped = 0
  for (const r of rows) {
    const t = readRow(r)
    if (t) trades.push(t)
    else skipped++
  }
  return trades.length > 0 ? { trades, skipped } : null
}
