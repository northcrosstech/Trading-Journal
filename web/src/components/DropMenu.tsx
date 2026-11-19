import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { buttonClass, type ButtonSize, type ButtonVariant } from '../lib/ui'

export type DropMenuItem = {
  label: string
  /** Smaller second line saying what the item is for. */
  hint?: string
  onClick?: () => void
  /** Shown greyed out and does nothing: use the label to say why. */
  disabled?: boolean
}
export type DropMenuGroup = { label?: string; items: DropMenuItem[] }

const WIDTH = 248

/** A button that opens a short list of actions, grouped under plain headings. Enter or
 * Space opens it (it is a real button), the arrow keys or Tab move through the items, and
 * Esc, a click outside or tabbing away closes it. The list floats above the page so a
 * table or header can't clip it. */
export function DropMenu({
  groups,
  label,
  children,
  icon,
  variant = 'secondary',
  size = 'md',
  triggerClassName,
  title,
}: {
  groups: DropMenuGroup[]
  /** Read out for the button when its content is only an icon. */
  label?: string
  children: ReactNode
  icon?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  /** Replaces the standard button look (for a small icon trigger in a table row). */
  triggerClassName?: string
  title?: string
}) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  function show() {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8))
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    // Open downwards unless there is clearly more room above (a button low on the page).
    if (below >= 240 || below >= above) setPos({ left, top: r.bottom + 4, maxHeight: Math.max(120, below) })
    else setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.max(120, above) })
  }
  const close = (refocus = false) => {
    setPos(null)
    if (refocus) buttonRef.current?.focus()
  }

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-item]') ?? [])

  // Focus starts on the first item, so the keyboard works straight away.
  useEffect(() => {
    if (open) items()[0]?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(null)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPos(null)
      buttonRef.current?.focus()
    }
    // The page moving under a floating list would leave it detached; the list's own
    // scrolling (a long list on a short screen) must not close it.
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setPos(null)
    }
    const onResize = () => setPos(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  function onListKey(e: KeyboardEvent) {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number) => {
      e.preventDefault()
      all[(i + all.length) % all.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            show()
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title}
        className={triggerClassName ?? buttonClass(variant, size)}
      >
        {icon}
        {children}
      </button>
      {pos &&
        createPortal(
          <div
            ref={listRef}
            role="menu"
            aria-label={label}
            onKeyDown={onListKey}
            // A click inside must not move focus: browsers that don't focus a clicked button
            // would blur the list and close it before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            // Tabbing past either end leaves the list: close it rather than trap focus.
            onBlur={(e) => {
              const to = e.relatedTarget as Node | null
              if (!to || (!listRef.current?.contains(to) && !buttonRef.current?.contains(to))) close()
            }}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: WIDTH, maxHeight: pos.maxHeight, maxWidth: 'calc(100vw - 16px)' }}
            className="ui-pop-in fixed z-50 overflow-y-auto rounded-xl border border-(--border-strong) bg-(--card-raised) py-1 text-left shadow-2xl"
          >
            {groups.map((g, gi) => (
              <div key={g.label ?? gi} role="group" aria-label={g.label} className={gi > 0 ? 'mt-1 border-t border-(--border) pt-1' : ''}>
                {g.label && <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{g.label}</div>}
                {g.items.map((it) => (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    data-item
                    aria-disabled={it.disabled || undefined}
                    onClick={() => {
                      if (it.disabled) return
                      close()
                      it.onClick?.()
                    }}
                    className={`flex w-full flex-col px-3 py-2 text-left text-sm outline-none transition ${
                      it.disabled ? 'cursor-default text-neutral-400 focus-visible:bg-white/5' : 'text-neutral-200 hover:bg-white/5 focus-visible:bg-white/8'
                    }`}
                  >
                    {it.label}
                    {it.hint && <span className="text-xs text-neutral-500">{it.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
