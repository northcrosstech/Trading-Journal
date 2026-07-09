import { useState } from 'react'
import type { Playbook } from '../lib/database.types'
import { PlaybookChip } from './PlaybookChip'

type Props = {
  assigned: { playbook_id: string; playbooks: Playbook | null } | null
  allPlaybooks: Playbook[]
  onSelect: (playbookId: string) => void
  onClear: () => void
}

/** Single-select playbook picker for a TRADE (exactly one playbook per trade, per
 * trade_playbooks' primary key) -- distinct from PlaybookTagPicker, which is the
 * multi-select used for the pre-market plan's "watching several setups today." */
export function PlaybookPicker({ assigned, allPlaybooks, onSelect, onClear }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const available = allPlaybooks.filter((p) => !p.archived)

  return (
    <div className="relative flex items-center gap-2">
      {assigned?.playbooks ? (
        <PlaybookChip playbook={assigned.playbooks} onRemove={onClear} />
      ) : (
        <span className="text-xs text-neutral-500">No playbook linked</span>
      )}
      <button
        onClick={() => setPickerOpen((o) => !o)}
        className="rounded-full border border-dashed border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
      >
        {assigned ? 'Change' : '+ Set Playbook'}
      </button>
      {pickerOpen && (
        <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-neutral-700 bg-neutral-800 p-1 shadow-xl">
          {available.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-neutral-500">No playbooks yet</div>
          ) : (
            available.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onSelect(p.id)
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
  )
}
