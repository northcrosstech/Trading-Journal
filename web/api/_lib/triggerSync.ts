// Server-side only -- imported by web/api/trigger-sync.ts (Vercel function) and by
// vite.config.ts's dev middleware, mirroring the api/_lib/candleProviders.ts split.
// Never import this from client code: it reads SYNC_TRIGGER_SECRET from process.env,
// which must never reach the browser bundle.
//
// Lives under api/_lib (not web/server) on purpose: Vercel's Node.js builder only
// reliably compiles TypeScript that lives inside the api/ tree. A sibling directory
// like web/server/ gets traced as a raw file dependency but never transpiled, so the
// deployed function tries to `import` a literal .ts file at runtime and crashes with
// ERR_MODULE_NOT_FOUND -- confirmed the hard way in production. The leading
// underscore keeps Vercel from treating this file itself as a routable function.

import { createClient } from '@supabase/supabase-js'

export class TriggerSyncError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Verifies the caller is a logged-in Supabase user (via their access token, not a
 * fresh password check -- the frontend already holds a session), then forwards the
 * request to the worker's secret-protected /sync/trigger endpoint. The worker secret
 * lives only here (server-side env), never in the browser -- this function is the
 * one place that proves "a real logged-in user asked for this" before spending it.
 */
export async function triggerSync(authHeader: string | string[] | undefined): Promise<{ status: number; body: unknown }> {
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
