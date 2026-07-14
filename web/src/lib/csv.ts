/** Minimal CSV parser: handles quoted fields (with escaped "" for a literal quote)
 * and commas inside quotes, e.g. broker exports that quote dollar amounts like
 * "$1,234.56". Does not support embedded newlines inside a quoted field -- uncommon
 * in trade-log exports, not worth the added complexity here. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.length > 0)

  for (const line of lines) {
    const row: string[] = []
    let field = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            field += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          field += c
        }
      } else if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        row.push(field)
        field = ''
      } else {
        field += c
      }
    }
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** First row is headers, the rest are data rows. */
export function parseCsvWithHeader(text: string): { headers: string[]; rows: string[][] } {
  const [headers, ...rows] = parseCsv(text)
  return { headers: headers ?? [], rows }
}
