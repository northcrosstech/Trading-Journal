import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Portfolio } from '../lib/database.types'
import { kindLabel } from '../lib/portfolio'
import { NavDialog } from './NavDialog'
import { Segmented } from './ui/Tabs'
import { Button } from './ui/Button'

/** What the portfolio page opens: its quick buy/sell form, its Deposit form, or its option form. */
export type LogKind = 'trade' | 'cash' | 'option'

const KINDS: { value: LogKind; label: string }[] = [
  { value: 'trade', label: 'Buy or sell' },
  { value: 'cash', label: 'Deposit or dividend' },
  { value: 'option', label: 'Option' },
]

/** Asks which portfolio to log to, when the Log button can't tell. Buy or sell is the usual
 * case, so picking a portfolio is all it takes; the other two are one click away first. */
export function LogPicker({
  portfolios,
  failed,
  onPick,
  onCreate,
  onClose,
}: {
  /** Open portfolios; null while they load, or when loading them failed. */
  portfolios: Portfolio[] | null
  failed: boolean
  onPick: (portfolioId: string, kind: LogKind) => void
  onCreate: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<LogKind>('trade')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const list = portfolios ?? []
  const at = Math.min(active, list.length - 1)

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  function onKeyDown(e: KeyboardEvent) {
    const step = (n: number, len: number, from: number) => (from + n + len) % len
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (list.length > 0) setActive(step(e.key === 'ArrowDown' ? 1 : -1, list.length, Math.max(at, 0)))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const i = KINDS.findIndex((k) => k.value === kind)
      setKind(KINDS[step(e.key === 'ArrowRight' ? 1 : -1, KINDS.length, i)].value)
    } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) {
      // Enter on one of the buttons presses that button instead.
      e.preventDefault()
      if (list[at]) onPick(list[at].id, kind)
    }
  }

  return (
    <NavDialog label="Log to a portfolio" onClose={onClose} width="max-w-sm">
      <div onKeyDown={onKeyDown}>
        <div className="flex flex-col gap-2.5 border-b border-(--border) px-4 py-3.5">
          <h2 className="text-sm font-semibold text-white">Log to which portfolio?</h2>
          <Segmented size="sm" options={KINDS} value={kind} onChange={setKind} />
        </div>
        <div
          ref={listRef}
          data-autofocus
          tabIndex={0}
          role="listbox"
          aria-label="Portfolios"
          aria-activedescendant={list[at] ? `log-${list[at].id}` : undefined}
          className="max-h-[min(20rem,50vh)] overflow-y-auto p-1.5 outline-none"
        >
          {list.map((p, i) => (
            <div
              key={p.id}
              id={`log-${p.id}`}
              role="option"
              aria-selected={i === at}
              onMouseMove={() => i !== at && setActive(i)}
              onClick={() => onPick(p.id, kind)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                i === at ? 'bg-(--accent-soft) text-(--accent-text)' : 'text-neutral-300'
              }`}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs text-neutral-500">{kindLabel(p.kind)}</span>
            </div>
          ))}
          {portfolios === null && !failed && <div className="px-3 py-5 text-center text-sm text-neutral-500">Loading…</div>}
          {(failed ? portfolios === null : list.length === 0 && portfolios !== null) && (
            <div className="flex flex-col items-center gap-3 px-3 py-5 text-sm text-neutral-500">
              {failed ? 'Couldn’t load your portfolios.' : 'No portfolios yet.'}
              <Button size="sm" onClick={onCreate}>
                Go to Portfolios
              </Button>
            </div>
          )}
        </div>
        <div className="hidden border-t border-(--border) px-4 py-2 text-[11px] text-neutral-600 sm:block">↑ ↓ portfolio · ← → what to log · Enter to open</div>
      </div>
    </NavDialog>
  )
}
