import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export type AttentionItem = {
  key: string
  text: ReactNode
  /** Smaller second line, e.g. how to fix it. */
  detail?: ReactNode
  /** The control that deals with it, shown beside the text. */
  action?: ReactNode
}

/** The few things on a page that want doing now, one line each with its action beside it.
 * Renders nothing when the list is empty, so a healthy page stays quiet. */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null
  return (
    <ul aria-label="Needs attention" className="flex flex-col divide-y divide-amber-500/10 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-1 text-sm text-amber-200">
      {items.map((it) => (
        <li key={it.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2">
          <span className="flex min-w-0 items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
            <span className="min-w-0">
              {it.text}
              {it.detail && <span className="block text-xs text-amber-200/60">{it.detail}</span>}
            </span>
          </span>
          {it.action}
        </li>
      ))}
    </ul>
  )
}

/** A small amber button for a strip line, matching the Get prices button. */
export function AttentionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md border border-amber-700 px-2 py-0.5 text-xs font-medium text-amber-200 transition hover:bg-amber-900/40"
    >
      {children}
    </button>
  )
}
