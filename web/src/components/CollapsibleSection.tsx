import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/** A part of a page that stays folded to one line until it's asked for, so the page leads
 * with the work. Whether it's open is remembered per browser under `storageKey`; until a
 * choice has been made it starts as `defaultOpen` says (folded unless told otherwise). Nothing
 * inside is drawn while it's folded. */
export function CollapsibleSection({
  storageKey,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  storageKey: string
  title: string
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? defaultOpen : stored === '1'
    } catch {
      return defaultOpen
    }
  })
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(storageKey, v ? '0' : '1')
      } catch {
        // storage blocked: just don't remember
      }
      return !v
    })
  }

  return (
    <>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-2xl border border-(--border) bg-(--card) px-5 py-3.5 text-left transition hover:border-(--border-strong)"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          <ChevronRight size={16} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`} />
          {title}
        </span>
        {hint && <span className="text-xs text-neutral-500">{hint}</span>}
        <span className="ml-auto text-xs text-neutral-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && children}
    </>
  )
}
