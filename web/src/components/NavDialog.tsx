import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The small dialog near the top of the screen used by Search and the Log picker. Esc or a
 * click outside closes it. Focus moves to the element marked `data-autofocus`, stays inside
 * while it's open, and goes back to where it was on close. */
export function NavDialog({ label, onClose, children, width = 'max-w-lg' }: { label: string; onClose: () => void; children: ReactNode; width?: string }) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      before?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Tab cycles through the dialog's own controls instead of reaching the page behind it.
  function keepFocusInside(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1
    e.preventDefault()
    items[next].focus()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="ui-fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={keepFocusInside}
        className={`ui-pop-in relative w-full ${width} overflow-hidden rounded-2xl border border-(--border-strong) bg-(--card) shadow-2xl`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
