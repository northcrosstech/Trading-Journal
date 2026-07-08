import { TAG_COLORS } from '../lib/tagColors'

export function StrategyColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TAG_COLORS.map((hex) => (
        <button
          key={hex}
          onClick={() => onChange(hex)}
          title={hex}
          style={{ backgroundColor: hex }}
          className={`h-5 w-5 rounded-full transition ${
            value === hex ? 'ring-2 ring-neutral-100 ring-offset-2 ring-offset-neutral-900' : 'hover:scale-110'
          }`}
        />
      ))}
    </div>
  )
}
