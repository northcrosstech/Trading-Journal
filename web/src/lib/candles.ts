export type Candle = {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
}

export type CandleInterval = '1min' | '5min'

export type CandleResult = {
  candles: Candle[]
  source: 'live' | 'stub'
  error?: string
}

/**
 * Fetches the UNDERLYING ticker's candles (not the option's price) from the server
 * proxy (web/api/candles.ts in prod, the matching Vite dev middleware locally), which
 * calls Twelve Data server-side -- the API key never reaches the browser.
 *
 * Falls back to a synthetic stub series if the live call fails for any reason (no API
 * key configured, provider error, rate limit, etc.) so the chart layout never blocks
 * on live data being available.
 */
export async function fetchCandles(params: {
  symbol: string
  from: Date
  to: Date
  interval: CandleInterval
  anchorLow: number
  anchorHigh: number
}): Promise<CandleResult> {
  try {
    const url = `/api/candles?symbol=${encodeURIComponent(params.symbol)}&from=${encodeURIComponent(
      params.from.toISOString(),
    )}&to=${encodeURIComponent(params.to.toISOString())}&interval=${params.interval}`

    const res = await fetch(url)
    const body = await res.json()

    if (!res.ok) {
      throw new Error(body?.error ?? `candles API returned ${res.status}`)
    }
    if (!Array.isArray(body.candles) || body.candles.length === 0) {
      throw new Error('no candle data returned for this window')
    }

    return { candles: body.candles as Candle[], source: 'live' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('Falling back to stub candles:', message)
    return { candles: generateStubCandles(params), source: 'stub', error: message }
  }
}

function generateStubCandles(params: {
  symbol: string
  from: Date
  to: Date
  interval: CandleInterval
  anchorLow: number
  anchorHigh: number
}): Candle[] {
  const { symbol, from, to, interval, anchorLow, anchorHigh } = params

  const spanMs = Math.max(to.getTime() - from.getTime(), 5 * 60_000)
  const barMinutes = interval === '5min' ? 5 : 1
  const spanMinutes = spanMs / 60_000
  const barCount = Math.min(300, Math.max(20, Math.round(spanMinutes / barMinutes)))
  const barMs = barMinutes * 60_000

  const rand = seededRandom(hashSeed(symbol + from.toISOString()))
  const startPrice = Math.max(0.01, anchorLow)
  const endPrice = Math.max(0.01, anchorHigh)
  const volatility = Math.max(startPrice, endPrice, 1) * 0.003
  const drift = (endPrice - startPrice) / barCount

  const candles: Candle[] = []
  let price = startPrice

  for (let i = 0; i < barCount; i++) {
    const open = price
    const noise = (rand() - 0.5) * volatility
    price = Math.max(0.01, open + drift + noise)
    const high = Math.max(open, price) + rand() * volatility * 0.4
    const low = Math.max(0.01, Math.min(open, price) - rand() * volatility * 0.4)
    const time = Math.floor((from.getTime() + i * barMs) / 1000)
    candles.push({ time, open, high, low, close: price })
  }

  return candles
}

function hashSeed(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h) || 1
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
