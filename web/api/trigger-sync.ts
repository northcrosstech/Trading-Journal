// Fully self-contained on purpose -- no local relative imports. Vercel's Node.js
// builder does not reliably compile/bundle locally-imported .ts files (confirmed the
// hard way in production, twice: first at web/server/triggerSync.ts, then again after
// moving it to web/api/_lib/triggerSync.ts -- both crashed with the deployed function
// trying to `import` a raw, uncompiled .ts file under native Node ESM resolution and
// failing with ERR_MODULE_NOT_FOUND / FUNCTION_INVOCATION_FAILED). npm package
// imports (like @supabase/supabase-js below) are unaffected -- only local file
// imports hit this. The logic here is intentionally duplicated in
// web/api/_lib/triggerSync.ts, which vite.config.ts's dev middleware still imports
// (Vite bundles/transforms on the fly, so it doesn't have this problem) -- keep the
// two in sync if either changes.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

class TriggerSyncError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function triggerSync(authHeader: string | string[] | undefined): Promise<{ status: number; body: unknown }> {
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice(7) : null
  if (!token) throw new TriggerSyncError('missing authorization', 401)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const workerUrl = process.env.WORKER_SYNC_URL
  const triggerSecret = process.env.SYNC_TRIGGER_SECRET

  if (!supabaseUrl || !supabaseAnonKey || !workerUrl || !triggerSecret) {
    throw new TriggerSyncError('trigger-sync is not configured on the server (missing env vars)', 500)
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new TriggerSyncError('invalid session', 401)

  const workerRes = await fetch(`${workerUrl}/sync/trigger`, {
    method: 'POST',
    headers: { 'X-Sync-Secret': triggerSecret },
  })
  const body: unknown = await workerRes.json().catch(() => ({}))
  return { status: workerRes.status, body }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  try {
    const { status, body } = await triggerSync(req.headers.authorization)
    res.status(status).json(body)
  } catch (err) {
    if (err instanceof TriggerSyncError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
