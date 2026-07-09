import { useEffect, useRef, useState } from 'react'
import { upsertDailyPlan, addDailyPlanStrategy, removeDailyPlanStrategy } from '../lib/queries'
import type { DailyPlanWithStrategies, Strategy } from '../lib/database.types'
import { StrategyTagPicker } from './StrategyTagPicker'

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
  initialPlan: DailyPlanWithStrategies | null
  allStrategies: Strategy[]
  onClose: () => void
  onSaved: (plan: DailyPlanWithStrategies) => void
}

/** The pre-market 30-second check-in: max trades, max loss, planned setups, a short
 * note. Creates the daily_plans row on first field touch (needed before setups can
 * be attached, same two-step shape as trades + trade_strategies) so the setup picker
 * always has a plan id to attach to, even for a brand new day. */
export function PlanEntryModal({ date, userId, initialPlan, allStrategies, onClose, onSaved }: Props) {
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
      // Preserve setups already loaded locally -- the upsert's own select doesn't
      // race with them since strategy add/remove hit the join table separately.
      const merged = { ...next, daily_plan_strategies: plan?.daily_plan_strategies ?? next.daily_plan_strategies }
      setPlan(merged)
      onSaved(merged)
      setSaved(true)
    }, 500)
  }

  async function ensurePlanExists(): Promise<DailyPlanWithStrategies> {
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

  async function handleAddSetup(strategyId: string) {
    const current = await ensurePlanExists()
    await addDailyPlanStrategy(current.id, strategyId)
    const strategy = allStrategies.find((s) => s.id === strategyId) ?? null
    const next = { ...current, daily_plan_strategies: [...current.daily_plan_strategies, { strategy_id: strategyId, strategies: strategy }] }
    setPlan(next)
    onSaved(next)
  }

  async function handleRemoveSetup(strategyId: string) {
    if (!plan) return
    await removeDailyPlanStrategy(plan.id, strategyId)
    const next = { ...plan, daily_plan_strategies: plan.daily_plan_strategies.filter((s) => s.strategy_id !== strategyId) }
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
          <label className="mb-1 block text-xs text-neutral-500">Planned Setups</label>
          <StrategyTagPicker
            assigned={plan?.daily_plan_strategies ?? []}
            allStrategies={allStrategies}
            onAdd={handleAddSetup}
            onRemove={handleRemoveSetup}
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
