import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Right-hand slide-in panel for forms (trading actions, managing accounts). Esc or a click
 * on the backdrop closes it; the page behind stays put. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="ui-fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        className={`ui-slide-in relative flex h-full w-full ${width} flex-col border-l border-(--border) bg-(--card) shadow-2xl`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-(--border) px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-neutral-500 transition hover:bg-(--card-raised) hover:text-white">
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
