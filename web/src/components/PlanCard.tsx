import { useEffect, useState, type FormEvent } from 'react'
import type { DailyPlanWithPlaybooks } from '../lib/database.types'
import { upsertDailyPlan } from '../lib/queries'
import { currency } from '../lib/format'

const inputClass =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'

function numOrNull(v: string): number | null {
  return v.trim() === '' ? null : Number(v)
}

/** The 2-minute pre-market plan: market read, watchlist with triggers, max loss, max
 * trades, and one focus (usually carried over from the last review). Shows as a form
 * until the plan has a watchlist or market read, then as a compact summary. */
export function PlanCard({
  date,
  userId,
  plan,
  defaultMaxLoss,
  onSaved,
}: {
  date: string
  userId: string
  plan: DailyPlanWithPlaybooks | null
  defaultMaxLoss: number | null
  onSaved: (plan: DailyPlanWithPlaybooks) => void
}) {
  const hasPlan = !!(plan?.plan_notes?.trim() || plan?.market_read?.trim())
  const [editing, setEditing] = useState(!hasPlan)
  const [marketRead, setMarketRead] = useState('')
  const [watchlist, setWatchlist] = useState('')
  const [maxLoss, setMaxLoss] = useState('')
  const [maxTrades, setMaxTrades] = useState('')
  const [focus, setFocus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMarketRead(plan?.market_read ?? '')
    setWatchlist(plan?.plan_notes ?? '')
    const loss = plan?.planned_max_loss ?? defaultMaxLoss
    setMaxLoss(loss === null || loss === undefined ? '' : String(loss))
    setMaxTrades(plan?.planned_max_trades == null ? '' : String(plan.planned_max_trades))
    setFocus(plan?.focus ?? '')
  }, [plan, defaultMaxLoss])

  useEffect(() => {
    if (hasPlan) setEditing(false)
  }, [hasPlan])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const saved = await upsertDailyPlan(userId, date, {
        market_read: marketRead.trim() || null,
        plan_notes: watchlist.trim() || null,
        planned_max_loss: numOrNull(maxLoss),
        planned_max_trades: numOrNull(maxTrades),
        focus: focus.trim() || null,
      })
      onSaved(saved)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing && plan) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Today's Plan</h2>
          <button onClick={() => setEditing(true)} className="text-xs text-blue-400 hover:underline">
            Edit
          </button>
        </div>
        {plan.focus && (
          <div className="mb-3 rounded-lg border border-violet-800/60 bg-violet-950/30 px-3 py-2 text-sm text-violet-200">
            <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-violet-400">Focus</span>
            {plan.focus}
          </div>
        )}
        {plan.market_read && <p className="mb-2 text-sm text-neutral-300">{plan.market_read}</p>}
        {plan.plan_notes && (
          <pre className="mb-3 whitespace-pre-wrap font-sans text-sm text-neutral-200">{plan.plan_notes}</pre>
        )}
        <div className="flex gap-4 text-xs text-neutral-500">
          <span>
            Max loss <span className="text-neutral-300">{plan.planned_max_loss == null ? '—' : currency(plan.planned_max_loss)}</span>
          </span>
          <span>
            Max trades <span className="text-neutral-300">{plan.planned_max_trades ?? '—'}</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-xl border border-blue-900/60 bg-neutral-900 p-4">
      <div>
        <h2 className="text-sm font-medium text-neutral-200">Plan your day</h2>
        <p className="text-xs text-neutral-500">Two minutes before the open. Only trade what's on this list.</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Market read</span>
        <input
          value={marketRead}
          onChange={(e) => setMarketRead(e.target.value)}
          placeholder="SPY gapping up into yesterday's high — bias long above 575"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Watchlist & triggers</span>
        <textarea
          value={watchlist}
          onChange={(e) => setWatchlist(e.target.value)}
          rows={3}
          placeholder={'NVDA long over 132.50 on volume, stop 131.80, target 134\nTSLA short under 240 if SPY weak'}
          className={`${inputClass} resize-y`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Max loss ($)</span>
          <input type="number" min="0" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Max trades</span>
          <input type="number" min="0" value={maxTrades} onChange={(e) => setMaxTrades(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">One focus for today</span>
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="No entries in the first 5 minutes"
          className={inputClass}
        />
      </label>
      <div className="flex justify-end gap-2">
        {plan && hasPlan && (
          <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save plan'}
        </button>
      </div>
    </form>
  )
}
