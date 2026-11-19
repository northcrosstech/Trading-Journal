// Fully self-contained on purpose -- no local relative imports. See the comment at
// the top of api/trigger-sync.ts for why: Vercel's Node.js builder does not reliably
// compile/bundle locally-imported .ts files. Duplicated in
// web/api/_lib/candleProviders.ts, which vite.config.ts's dev middleware still
// imports -- keep the two in sync if either changes.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// One ticker: letters, digits, dot, dash (BRK.B, BF-B). No commas, so never a batch.
const SYMBOL_RE = /^[A-Za-z0-9.-]{1,12}$/
// The chart asks for a trade's first fill to its last (or to now while it's open) plus 30
// minutes each side, so a long-held position is a long window. Past this it's not a chart.
const MAX_WINDOW_MS = 731 * 24 * 60 * 60_000
const GENERIC_ERROR = 'Could not load candles'

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

/** Whether the request carries a signed-in user's Supabase access token -- the same check
 * as api/trigger-sync.ts. 'unconfigured' when the server can't verify anyone. */
async function verifyUser(authHeader: string | string[] | undefined): Promise<'ok' | 'unauthorized' | 'unconfigured'> {
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice(7) : null
  if (!token) return 'unauthorized'

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return 'unconfigured'

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await supabase.auth.getUser(token)
  return error || !data.user ? 'unauthorized' : 'ok'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  try {
    const auth = await verifyUser(req.headers.authorization)
    if (auth === 'unauthorized') {
      res.status(401).json({ error: 'not signed in' })
      return
    }
    if (auth === 'unconfigured') {
      console.error('candles: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set')
      res.status(500).json({ error: GENERIC_ERROR })
      return
    }
  } catch (err) {
    console.error('candles: could not verify the session:', err)
    res.status(502).json({ error: GENERIC_ERROR })
    return
  }

  const { symbol, from, to, interval } = req.query

  if (typeof symbol !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
    res.status(400).json({ error: 'symbol, from, to query params are required' })
    return
  }
  if (!SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: 'symbol is not a valid ticker' })
    return
  }

  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs || toMs - fromMs > MAX_WINDOW_MS) {
    res.status(400).json({ error: 'from and to must be dates, from before to, at most two years apart' })
    return
  }

  const resolvedInterval: CandleInterval = interval === '5min' ? '5min' : '1min'

  try {
    const candles = await getCandlesFromProvider({
      symbol,
      from: new Date(fromMs),
      to: new Date(toMs),
      interval: resolvedInterval,
    })
    // A window that ended a while ago no longer changes; one still in progress does.
    const settled = toMs < Date.now() - 60 * 60_000
    res.setHeader('Cache-Control', `private, max-age=${settled ? 3600 : 60}`)
    res.status(200).json({ candles })
  } catch (err) {
    // The detail (provider message, missing configuration) stays in the server log.
    console.error('candles: provider call failed:', err)
    res.status(502).json({ error: GENERIC_ERROR })
  }
}
