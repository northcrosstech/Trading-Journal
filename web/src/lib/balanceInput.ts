/** Parses a balance box: blank = no balance this month, otherwise a non-negative number
 * (commas and $ allowed). undefined = not a valid number. */
export function parseBalance(raw: string): number | null | undefined {
  const t = raw.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Shows a balance with thousands separators (inputs accept commas back). */
export const fmtBalance = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
