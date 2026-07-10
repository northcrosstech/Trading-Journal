// Fully self-contained on purpose -- no local relative imports. See the comment at
// the top of api/trigger-sync.ts for why: Vercel's Node.js builder does not reliably
// compile/bundle locally-imported .ts files. Duplicated in
// web/api/_lib/candleProviders.ts, which vite.config.ts's dev middleware still
// imports -- keep the two in sync if either changes.
import type { VercelRequest, VercelResponse } from '@vercel/node'

type Candle = {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
}

type CandleInterval = '1min' | '5min'

class CandleProviderError extends Error {}

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

async function getCandlesFromProvider(params: { symbol: string; from: Date; to: Date; interval: CandleInterval }): Promise<Candle[]> {
  const provider = process.env.CANDLE_PROVIDER

  if (provider === 'twelvedata') {
    const apiKey = process.env.TWELVEDATA_API_KEY
    if (!apiKey) throw new CandleProviderError('TWELVEDATA_API_KEY is not set')
    return fetchTwelveData(params.symbol, params.from, params.to, params.interval, apiKey)
  }

  throw new CandleProviderError(`CANDLE_PROVIDER is not configured (got ${JSON.stringify(provider)})`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol, from, to, interval } = req.query

  if (typeof symbol !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
    res.status(400).json({ error: 'symbol, from, to query params are required' })
    return
  }

  const resolvedInterval: CandleInterval = interval === '5min' ? '5min' : '1min'

  try {
    const candles = await getCandlesFromProvider({
      symbol,
      from: new Date(from),
      to: new Date(to),
      interval: resolvedInterval,
    })
    res.status(200).json({ candles })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
