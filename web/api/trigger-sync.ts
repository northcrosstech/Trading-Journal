import type { VercelRequest, VercelResponse } from '@vercel/node'
import { triggerSync, TriggerSyncError } from './_lib/triggerSync.ts'

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
