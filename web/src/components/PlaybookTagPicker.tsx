import { useState } from 'react'
import type { Playbook } from '../lib/database.types'
import { PlaybookChip } from './PlaybookChip'

type Props = {
  assigned: { playbook_id: string; playbooks: Playbook | null }[]
  allPlaybooks: Playbook[]
  onAdd: (playbookId: string) => void | Promise<void>
  onRemove: (playbookId: string) => void | Promise<void>
}

/** Multi-select playbook picker -- used where more than one playbook can apply at
 * once, e.g. the pre-market plan's "watching these setups today" (daily_plan_playbooks).
 * NOT used for a single trade's playbook link, which is one-at-a-time (see the
 * single-select picker in the per-trade linking phase). */
export function PlaybookTagPicker({ assigned, allPlaybooks, onAdd, onRemove }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const assignedIds = new Set(assigned.map((a) => a.playbook_id))
  const available = allPlaybooks.filter((p) => !p.archived && !assignedIds.has(p.id))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((a) =>
        a.playbooks ? (
          <PlaybookChip key={a.playbook_id} playbook={a.playbooks} onRemove={() => onRemove(a.playbook_id)} />
        ) : null,
      )}

      <div className="relative">
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="rounded-full border border-dashed border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          + Playbook
        </button>
        {pickerOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-neutral-700 bg-neutral-800 p-1 shadow-xl">
            {available.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-neutral-500">No more playbooks</div>
            ) : (
              available.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onAdd(p.id)
                    setPickerOpen(false)
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
                >
                  {p.icon && <span className="mr-1">{p.icon}</span>}
                  {p.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
