import type { Strategy } from '../lib/database.types'
import { tagChipStyle } from '../lib/tagColors'

export function StrategyChip({ strategy, onRemove }: { strategy: Strategy; onRemove?: () => void }) {
  return (
    <span
      style={tagChipStyle(strategy.color)}
      className="group flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
    >
      {strategy.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100" aria-label={`Remove ${strategy.name}`}>
          ×
        </button>
      )}
    </span>
  )
}
