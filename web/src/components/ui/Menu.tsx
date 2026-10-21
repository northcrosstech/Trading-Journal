import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export type MenuItem = { label: string; onClick: () => void; tone?: 'default' | 'danger' | 'warning'; icon?: ReactNode }

const MENU_WIDTH = 192

/** "⋯" button opening a small list of row actions. The list floats above the page (so a
 * scrolling table can't clip it), aligned to the button. Closes on pick, outside click,
 * Esc, scroll or resize. */
export function Menu({ items, label = 'Actions' }: { items: MenuItem[]; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  function toggle() {
    if (pos) return setPos(null)
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const listHeight = items.length * 38 + 8
    const below = r.bottom + 4 + listHeight <= window.innerHeight
    setPos({
      top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - listHeight),
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    })
  }

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos])

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        aria-label={label}
        aria-expanded={pos !== null}
        className="rounded-md p-1.5 text-neutral-500 transition hover:bg-(--card-raised) hover:text-white"
      >
        <MoreHorizontal size={16} />
      </button>
      {pos &&
        createPortal(
          <div
            ref={listRef}
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="ui-pop-in fixed z-50 overflow-hidden rounded-xl border border-(--border-strong) bg-(--card-raised) py-1 text-left shadow-2xl"
          >
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  setPos(null)
                  it.onClick()
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/5 ${
                  it.tone === 'danger' ? 'text-red-300' : it.tone === 'warning' ? 'text-amber-300' : 'text-neutral-200'
                }`}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
