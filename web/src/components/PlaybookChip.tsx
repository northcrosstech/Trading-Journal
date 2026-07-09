import type { Playbook } from '../lib/database.types'
import { tagChipStyle } from '../lib/tagColors'

export function PlaybookChip({ playbook, onRemove }: { playbook: Playbook; onRemove?: () => void }) {
  return (
    <span
      style={tagChipStyle(playbook.color)}
      className="group flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
    >
      {playbook.icon && <span>{playbook.icon}</span>}
      {playbook.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100" aria-label={`Remove ${playbook.name}`}>
          ×
        </button>
      )}
    </span>
  )
}
