import { useEffect, useRef, useState } from 'react'
import { upsertDailyPlan, addDailyPlanPlaybook, removeDailyPlanPlaybook } from '../lib/queries'
import type { DailyPlanWithPlaybooks, Playbook } from '../lib/database.types'
import { PlaybookTagPicker } from './PlaybookTagPicker'

function dateHeading(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

type Props = {
  date: string
  userId: string
  initialPlan: DailyPlanWithPlaybooks | null
  allPlaybooks: Playbook[]
  onClose: () => void
  onSaved: (plan: DailyPlanWithPlaybooks) => void
}

/** The pre-market 30-second check-in: max trades, max loss, watched playbooks, a
 * short note. Creates the daily_plans row on first field touch (needed before
 * playbooks can be attached, same two-step shape as trades + trade_playbooks) so the
 * picker always has a plan id to attach to, even for a brand new day. */
export function PlanEntryModal({ date, userId, initialPlan, allPlaybooks, onClose, onSaved }: Props) {
  const [plan, setPlan] = useState(initialPlan)
  const [maxTrades, setMaxTrades] = useState(initialPlan?.planned_max_trades?.toString() ?? '')
  const [maxLoss, setMaxLoss] = useState(initialPlan?.planned_max_loss?.toString() ?? '')
  const [notes, setNotes] = useState(initialPlan?.plan_notes ?? '')
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function scheduleSave(fields: { planned_max_trades?: number | null; planned_max_loss?: number | null; plan_notes?: string | null }) {
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const next = await upsertDailyPlan(userId, date, fields)
      // Preserve playbooks already loaded locally -- the upsert's own select doesn't
      // race with them since playbook add/remove hit the join table separately.
      const merged = { ...next, daily_plan_playbooks: plan?.daily_plan_playbooks ?? next.daily_plan_playbooks }
      setPlan(merged)
      onSaved(merged)
      setSaved(true)
    }, 500)
  }

  async function ensurePlanExists(): Promise<DailyPlanWithPlaybooks> {
    if (plan) return plan
    const created = await upsertDailyPlan(userId, date, {
      planned_max_trades: maxTrades.trim() === '' ? null : Number(maxTrades),
      planned_max_loss: maxLoss.trim() === '' ? null : Number(maxLoss),
      plan_notes: notes.trim() === '' ? null : notes,
    })
    setPlan(created)
    onSaved(created)
    return created
  }

  async function handleAddPlaybook(playbookId: string) {
    const current = await ensurePlanExists()
    await addDailyPlanPlaybook(current.id, playbookId)
    const playbook = allPlaybooks.find((p) => p.id === playbookId) ?? null
    const next = { ...current, daily_plan_playbooks: [...current.daily_plan_playbooks, { playbook_id: playbookId, playbooks: playbook }] }
    setPlan(next)
    onSaved(next)
  }

  async function handleRemovePlaybook(playbookId: string) {
    if (!plan) return
    await removeDailyPlanPlaybook(plan.id, playbookId)
    const next = { ...plan, daily_plan_playbooks: plan.daily_plan_playbooks.filter((p) => p.playbook_id !== playbookId) }
    setPlan(next)
    onSaved(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-neutral-200">Today's Plan</div>
            <div className="text-xs text-neutral-500">{dateHeading(date)}</div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Max Trades</label>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={maxTrades}
              onChange={(e) => {
                setMaxTrades(e.target.value)
                scheduleSave({ planned_max_trades: e.target.value.trim() === '' ? null : Number(e.target.value) })
              }}
              placeholder="e.g. 3"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Max Loss</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={maxLoss}
                onChange={(e) => {
                  setMaxLoss(e.target.value)
                  scheduleSave({ planned_max_loss: e.target.value.trim() === '' ? null : Number(e.target.value) })
                }}
                placeholder="e.g. 250"
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 py-2 pl-6 pr-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs text-neutral-500">Watching Today</label>
          <PlaybookTagPicker
            assigned={plan?.daily_plan_playbooks ?? []}
            allPlaybooks={allPlaybooks}
            onAdd={handleAddPlaybook}
            onRemove={handleRemovePlaybook}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-neutral-500">Notes</label>
            <span className="text-[11px] text-neutral-600">{saved ? 'Saved' : 'Saving…'}</span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              scheduleSave({ plan_notes: e.target.value.trim() === '' ? null : e.target.value })
            }}
            placeholder="What's the thesis today? What would make you stop early?"
            rows={3}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  )
}
