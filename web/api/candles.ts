import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getCandlesFromProvider, type CandleInterval } from './_lib/candleProviders.ts'

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
