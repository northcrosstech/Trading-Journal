/** The exchange's own timezone -- all trade timestamps are displayed and bucketed
 * into trading days using Central Time, regardless of the viewer's own browser
 * timezone. Handles CST/CDT automatically. */
export const TRADING_TIMEZONE = 'America/Chicago'

/** yyyy-mm-dd calendar date in Central Time -- the canonical "which trading day"
 * bucket for a real timestamp, independent of the viewer's own browser timezone. */
export function centralDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TRADING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export const currency = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const priceFmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Compact currency for tight spaces (calendar cells): "$1.2K", "-$430". */
export const compactCurrency = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const formatted = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  return sign + formatted
}

export const percentFmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`
}

export function holdTimeFmt(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function optionLabel(strike: number | null | undefined, optionType: string | null | undefined): string {
  if (strike === null || strike === undefined || !optionType) return '—'
  return `${strike % 1 === 0 ? strike : strike.toFixed(1)}${optionType === 'call' ? 'C' : 'P'}`
}

export function dateFmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  if (isDateOnly(iso)) {
    // Plain calendar date (no time component, e.g. an option's expiration) -- format
    // the y/m/d directly rather than routing through Date+timezone conversion, which
    // would parse it as UTC midnight and could shift the displayed day.
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TRADING_TIMEZONE })
}

export function dateTimeFmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TRADING_TIMEZONE,
  })
}

export function timeOnlyFmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: TRADING_TIMEZONE })
}

/** "0DTE" / "1DTE" / ... for near-dated options (within a week of the trade's
 * entry) -- the more day-trading-relevant read than a bare expiration date.
 * Falls back to the plain date for anything further out. DTE is counted from the
 * trade's entry date, not "today", so a closed trade's label doesn't drift after
 * the option has since expired. */
export function dteLabel(entryIso: string | null | undefined, expiration: string | null | undefined): string {
  if (!expiration) return '—'
  if (!entryIso) return dateFmt(expiration)
  const entryDateStr = centralDateStr(new Date(entryIso))
  const days = Math.round((Date.parse(expiration) - Date.parse(entryDateStr)) / 86_400_000)
  if (days < 0 || days > 7) return dateFmt(expiration)
  return `${days}DTE`
}

export function relativeTimeFmt(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diffSeconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSeconds < 10) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
