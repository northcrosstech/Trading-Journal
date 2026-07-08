import { DATE_RANGE_PRESETS, type DateRangePreset } from '../lib/dateRange'

type Props = {
  value: DateRangePreset | null
  onChange: (preset: DateRangePreset | null) => void
}

/** Shared date-range preset bar driving Dashboard, Stats, and Trade Log -- a single
 * source of truth for "what period am I looking at" across the three pages that
 * report on trades. `null` means Reset / all-time. */
export function DateRangePresetBar({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
      {DATE_RANGE_PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(value === p.value ? null : p.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === p.value ? 'bg-neutral-700 text-neutral-50' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          {p.label}
        </button>
      ))}
      <button
        onClick={() => onChange(null)}
        disabled={value === null}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
      >
        Reset
      </button>
    </div>
  )
}
