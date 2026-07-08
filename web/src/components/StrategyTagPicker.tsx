import { useState } from 'react'
import type { Strategy } from '../lib/database.types'
import { StrategyChip } from './StrategyChip'

type Props = {
  assigned: { strategy_id: string; strategies: Strategy | null }[]
  allStrategies: Strategy[]
  onAdd: (strategyId: string) => void | Promise<void>
  onRemove: (strategyId: string) => void | Promise<void>
}

export function StrategyTagPicker({ assigned, allStrategies, onAdd, onRemove }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const assignedIds = new Set(assigned.map((a) => a.strategy_id))
  const available = allStrategies.filter((s) => !s.archived && !assignedIds.has(s.id))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((a) =>
        a.strategies ? (
          <StrategyChip key={a.strategy_id} strategy={a.strategies} onRemove={() => onRemove(a.strategy_id)} />
        ) : null,
      )}

      <div className="relative">
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="rounded-full border border-dashed border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          + Tag
        </button>
        {pickerOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-neutral-700 bg-neutral-800 p-1 shadow-xl">
            {available.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-neutral-500">No more strategies</div>
            ) : (
              available.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    onAdd(s.id)
                    setPickerOpen(false)
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
                >
                  {s.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
