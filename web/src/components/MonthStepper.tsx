import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, monthLabel } from '../lib/networth'
import type { MonthStatus } from '../lib/monthLink'
import { Pill, type PillTone } from './ui/Pill'

const STATUS: Record<MonthStatus, { label: string; tone: PillTone }> = {
  closed: { label: 'Closed', tone: 'green' },
  'to-close': { label: 'To close', tone: 'amber' },
  'in-progress': { label: 'In progress', tone: 'blue' },
}

const PICKER_WIDTH = 256
const ARROW = 'flex shrink-0 items-center justify-center text-neutral-400 transition hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30'

/** The month a page is showing: "‹ October 2026 ›". The arrows step a month at a time; the
 * name opens a small picker to jump to any month. Months are yyyy-mm-01; `max` is the latest
 * month that can be chosen: the current one. */
export function MonthStepper({
  month,
  onChange,
  max,
  status,
}: {
  month: string
  onChange: (month: string) => void
  max: string
  status?: MonthStatus | null
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const anchorRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  function toggle() {
    if (pos) return setPos(null)
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(PICKER_WIDTH, window.innerWidth - 16)
    setYear(Number(month.slice(0, 4)))
    // Centred under the stepper, kept inside the window.
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)) })
  }

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!pickerRef.current?.contains(t) && !anchorRef.current?.contains(t)) close()
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

  const pick = (m: string) => {
    setPos(null)
    if (m !== month) onChange(m)
  }
  const maxYear = Number(max.slice(0, 4))
  const s = status ? STATUS[status] : null

  return (
    <>
      <div ref={anchorRef} className="inline-flex max-w-full items-center overflow-hidden rounded-lg border border-(--border-strong) bg-(--card-raised)">
        <button aria-label="Previous month" title={monthLabel(addMonths(month, -1))} onClick={() => onChange(addMonths(month, -1))} className={`${ARROW} h-9 w-9`}>
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={pos !== null}
          aria-label={`${monthLabel(month)}${s ? `, ${s.label}` : ''}. Choose another month`}
          className="flex h-9 min-w-0 items-center gap-2 border-x border-(--border-strong) px-3 text-sm font-medium text-neutral-100 transition hover:bg-white/5"
        >
          <span className="truncate tabular-nums">{monthLabel(month)}</span>
          {s && <Pill tone={s.tone}>{s.label}</Pill>}
          <ChevronDown size={14} className="shrink-0 text-neutral-500" />
        </button>
        <button aria-label="Next month" title={month < max ? monthLabel(addMonths(month, 1)) : undefined} disabled={month >= max} onClick={() => onChange(addMonths(month, 1))} className={`${ARROW} h-9 w-9`}>
          <ChevronRight size={16} />
        </button>
      </div>
      {pos &&
        createPortal(
          <div
            ref={pickerRef}
            role="dialog"
            aria-label="Choose a month"
            style={{ top: pos.top, left: pos.left, width: Math.min(PICKER_WIDTH, window.innerWidth - 16) }}
            className="ui-pop-in fixed z-50 rounded-xl border border-(--border-strong) bg-(--card-raised) p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <button aria-label="Previous year" onClick={() => setYear((y) => y - 1)} className={`${ARROW} h-8 w-8 rounded-md`}>
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold tabular-nums text-white">{year}</span>
              <button aria-label="Next year" disabled={year >= maxYear} onClick={() => setYear((y) => y + 1)} className={`${ARROW} h-8 w-8 rounded-md`}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`).map((m) => (
                <button
                  key={m}
                  disabled={m > max}
                  aria-current={m === month ? 'date' : undefined}
                  onClick={() => pick(m)}
                  className={`rounded-md py-1.5 text-sm transition disabled:pointer-events-none disabled:opacity-30 ${
                    m === month ? 'bg-(--accent) font-medium text-white' : m === max ? 'text-neutral-100 ring-1 ring-inset ring-(--border-strong) hover:bg-white/5' : 'text-neutral-300 hover:bg-white/5'
                  }`}
                >
                  {monthLabel(m, 'short')}
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-between border-t border-(--border) pt-2 text-xs">
              <button onClick={() => pick(addMonths(max, -1))} className="rounded px-1.5 py-1 text-(--accent-text) hover:bg-white/5">
                Last month
              </button>
              <button onClick={() => pick(max)} className="rounded px-1.5 py-1 text-(--accent-text) hover:bg-white/5">
                This month
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
