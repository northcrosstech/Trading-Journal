import type { ReactNode } from 'react'

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number; icon?: ReactNode }

/** Underline tabs for switching views within a page. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabItem<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-(--border)" role="tablist">
      {tabs.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              active ? 'border-(--accent) text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? 'bg-(--accent-soft) text-(--accent-text)' : 'bg-neutral-800 text-neutral-400'}`}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Compact pill-style toggle for 2-5 options (filters, form modes). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-(--border-strong) bg-(--card-raised) p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-md font-medium transition ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${
            o.value === value ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
