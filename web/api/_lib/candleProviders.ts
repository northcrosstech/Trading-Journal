// Server-side only -- imported by web/api/candles.ts (Vercel function) and by
// vite.config.ts's dev middleware (so local dev works without `vercel dev`). Never
// import this from client code: it reads API keys from process.env that must not
// reach the browser bundle.
//
// Lives under api/_lib (not web/server) on purpose: Vercel's Node.js builder only
// reliably compiles TypeScript that lives inside the api/ tree. A sibling directory
// like web/server/ gets traced as a raw file dependency but never transpiled, so the
// deployed function tries to `import` a literal .ts file at runtime and crashes with
// ERR_MODULE_NOT_FOUND -- see api/_lib/triggerSync.ts, which hit this in production.
// The leading underscore keeps Vercel from treating this file itself as a routable
// function.

export type Candle = {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
}

export type CandleInterval = '1min' | '5min'

export class CandleProviderError extends Error {}

async function fetchTwelveData(symbol: string, from: Date, to: Date, interval: CandleInterval, apiKey: string): Promise<Candle[]> {
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

  const url = new URL('https://api.twelvedata.com/time_series')
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('start_date', fmt(from))
  url.searchParams.set('end_date', fmt(to))
  url.searchParams.set('timezone', 'UTC')
  url.searchParams.set('outputsize', '5000')
  url.searchParams.set('format', 'JSON')
  url.searchParams.set('apikey', apiKey)

  const res = await fetch(url.toString())

  // Twelve Data returns a JSON body with the actual reason even on non-200 responses
  // (400 = bad params, 429 = rate limit, etc.) -- read it before deciding to throw so
  // the real cause is visible instead of just an HTTP status code.
  const data = (await res.json().catch(() => null)) as {
    status?: string
    code?: number
    message?: string
    values?: { datetime: string; open: string; high: string; low: string; close: string }[]
  } | null

  if (!res.ok || data?.status === 'error' || data?.code) {
    throw new CandleProviderError(`Twelve Data error (HTTP ${res.status}): ${data?.message ?? JSON.stringify(data)}`)
  }

  if (!data) {
    throw new CandleProviderError(`Twelve Data returned an unparseable response (HTTP ${res.status})`)
  }

  const values = data.values ?? []
  return values
    .map((v) => ({
      time: Math.floor(Date.parse(v.datetime + 'Z') / 1000),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .sort((a, b) => a.time - b.time)
}

/**
 * Configurable via env vars, server-side only:
 *   CANDLE_PROVIDER=twelvedata   (currently the only live provider; add more here)
 *   TWELVEDATA_API_KEY=...
 * Neither var is VITE_-prefixed on purpose -- they must never be bundled client-side.
 */
export async function getCandlesFromProvider(params: {
  symbol: string
  from: Date
  to: Date
  interval: CandleInterval
}): Promise<Candle[]> {
  const provider = process.env.CANDLE_PROVIDER

  if (provider === 'twelvedata') {
    const apiKey = process.env.TWELVEDATA_API_KEY
    if (!apiKey) throw new CandleProviderError('TWELVEDATA_API_KEY is not set')
    return fetchTwelveData(params.symbol, params.from, params.to, params.interval, apiKey)
  }

  throw new CandleProviderError(`CANDLE_PROVIDER is not configured (got ${JSON.stringify(provider)})`)
}
