import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { getCandlesFromProvider, type CandleInterval } from './api/_lib/candleProviders.ts'
import { triggerSync, TriggerSyncError } from './api/_lib/triggerSync.ts'

// Mirrors web/api/candles.ts (the Vercel function) so `npm run dev` works without
// `vercel dev` -- same handler logic, just invoked via Vite's middleware instead of
// Vercel's Node runtime.
function candlesApiDevMiddleware(): Plugin {
  return {
    name: 'candles-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/candles', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const symbol = url.searchParams.get('symbol')
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        const interval: CandleInterval = url.searchParams.get('interval') === '5min' ? '5min' : '1min'

        if (!symbol || !from || !to) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'symbol, from, to query params are required' }))
          return
        }

        try {
          const candles = await getCandlesFromProvider({ symbol, from: new Date(from), to: new Date(to), interval })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ candles }))
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      })
    },
  }
}

// Mirrors web/api/trigger-sync.ts (the Vercel function).
function triggerSyncApiDevMiddleware(): Plugin {
  return {
    name: 'trigger-sync-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/trigger-sync', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }

        try {
          const { status, body } = await triggerSync(req.headers.authorization)
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        } catch (err) {
          const status = err instanceof TriggerSyncError ? err.status : 502
          const message = err instanceof Error ? err.message : String(err)
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix), not just VITE_-prefixed ones, so the dev
  // middleware above can see server-only vars like TWELVEDATA_API_KEY. These are
  // only ever read here in Node context -- never bundled into client code.
  const env = loadEnv(mode, process.cwd(), '')
  process.env.CANDLE_PROVIDER ??= env.CANDLE_PROVIDER
  process.env.TWELVEDATA_API_KEY ??= env.TWELVEDATA_API_KEY
  process.env.VITE_SUPABASE_URL ??= env.VITE_SUPABASE_URL
  process.env.VITE_SUPABASE_ANON_KEY ??= env.VITE_SUPABASE_ANON_KEY
  process.env.WORKER_SYNC_URL ??= env.WORKER_SYNC_URL
  process.env.SYNC_TRIGGER_SECRET ??= env.SYNC_TRIGGER_SECRET

  return {
    plugins: [react(), tailwindcss(), candlesApiDevMiddleware(), triggerSyncApiDevMiddleware()],
  }
})
