import { useState } from 'react'
import type { DailyPlanWithStrategies, Strategy } from '../lib/database.types'
import type { PlanVsActual } from '../lib/metrics'
import { currency } from '../lib/format'
import { PlanEntryModal } from './PlanEntryModal'
import { StrategyChip } from './StrategyChip'

type Props = {
  date: string
  userId: string
  plan: DailyPlanWithStrategies | null
  allStrategies: Strategy[]
  comparison: PlanVsActual
  onSaved: (plan: DailyPlanWithStrategies) => void
}

/** Dashboard's live "did I stick to the plan so far today" card. Mirrors
 * TodayTargetBenchmark's placement/role but for the pre-market plan rather than the
 * profit-target/loss-limit settings. */
export function TodayPlanCard({ date, userId, plan, allStrategies, comparison, onSaved }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  if (!plan) {
    return (
      <>
        <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-300">Today's Plan</h2>
            <p className="mt-0.5 text-xs text-neutral-500">No plan set yet -- 30 seconds before the open pays off.</p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
          >
            Set today's plan
          </button>
        </div>
        {modalOpen && (
          <PlanEntryModal date={date} userId={userId} initialPlan={null} allStrategies={allStrategies} onClose={() => setModalOpen(false)} onSaved={onSaved} />
        )}
      </>
    )
  }

  const tradesOver = comparison.plannedMaxTrades !== null && comparison.actualTradeCount > comparison.plannedMaxTrades
  const lossOver = comparison.followedLossLimit === false

  return (
    <>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Today's Plan</h2>
          <button onClick={() => setModalOpen(true)} className="text-xs text-neutral-500 hover:text-neutral-300">
            Edit
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Trades</div>
            <div className={`text-sm font-semibold tabular-nums ${tradesOver ? 'text-(--status-critical)' : 'text-neutral-200'}`}>
              {comparison.actualTradeCount}
              {comparison.plannedMaxTrades !== null && <span className="text-neutral-500"> / {comparison.plannedMaxTrades}</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Worst Point</div>
            <div className={`text-sm font-semibold tabular-nums ${lossOver ? 'text-(--status-critical)' : 'text-neutral-200'}`}>
              {currency(comparison.actualWorstPoint)}
              {comparison.plannedMaxLoss !== null && <span className="text-neutral-500"> / {currency(-comparison.plannedMaxLoss)}</span>}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Net So Far</div>
            <div className={`text-sm font-semibold tabular-nums ${comparison.actualNetPnl >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
              {currency(comparison.actualNetPnl)}
            </div>
          </div>
        </div>

        {(comparison.plannedSetupIds.length > 0 || comparison.actualSetupIds.length > 0) && (
          <div className="mt-3 border-t border-neutral-800 pt-3">
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Setups</div>
            <div className="flex flex-wrap gap-1.5">
              {plan.daily_plan_strategies.map((ps) =>
                ps.strategies ? (
                  <span key={ps.strategy_id} className={comparison.untradedSetupIds.includes(ps.strategy_id) ? 'opacity-40' : ''}>
                    <StrategyChip strategy={ps.strategies} />
                  </span>
                ) : null,
              )}
              {comparison.offPlanSetupIds.map((id) => {
                const strategy = allStrategies.find((s) => s.id === id)
                if (!strategy) return null
                return (
                  <span key={id} title="Traded but not planned" className="ring-1 ring-amber-500/50 rounded-full">
                    <StrategyChip strategy={strategy} />
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <PlanEntryModal date={date} userId={userId} initialPlan={plan} allStrategies={allStrategies} onClose={() => setModalOpen(false)} onSaved={onSaved} />
      )}
    </>
  )
}
