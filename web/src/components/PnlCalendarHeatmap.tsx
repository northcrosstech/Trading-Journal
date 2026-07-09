import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarDay, DailyTargetResult } from '../lib/metrics'
import type { DailyJournal } from '../lib/database.types'
import { compactCurrency } from '../lib/format'
import { DayNoteModal } from './DayNoteModal'
import { TargetMarkerIcon } from './TargetMarkerIcon'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_LABELS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const currency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function buildMonthCells(year: number, month: number, daysByDate: Map<string, CalendarDay>): (CalendarDay | null)[] {
  const firstOfMonth = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startWeekday = firstOfMonth.getDay()

  const cells: (CalendarDay | null)[] = Array(startWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`
    cells.push(daysByDate.get(dateStr) ?? { date: dateStr, netPnl: 0, tradeCount: 0, anyEstimated: false })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** Soft tinted wash for the month view -- the P&L number itself (colored text) carries
 * the value, so the background only needs to be a faint directional hint, never a
 * saturated block competing with the text. */
function monthDayBg(netPnl: number, maxAbs: number): string {
  if (netPnl === 0 || maxAbs === 0) return 'var(--gridline)'
  const intensity = Math.min(1, Math.abs(netPnl) / maxAbs)
  const alpha = 0.05 + intensity * 0.15
  const hue = netPnl > 0 ? '12, 163, 12' : '208, 59, 59'
  return `rgba(${hue}, ${alpha})`
}

function pnlTextColor(netPnl: number): string {
  if (netPnl === 0) return 'var(--text-muted)'
  return netPnl > 0 ? 'var(--status-good)' : 'var(--status-critical)'
}

/** Year view cells carry no text, so color must do all the work -- a fuller
 * saturation range than the month view, deliberately a different visual language
 * (heatmap block vs. tinted card with a number). */
function yearDayBg(netPnl: number, maxAbs: number): string {
  if (netPnl === 0 || maxAbs === 0) return 'var(--gridline)'
  const intensity = Math.min(1, Math.abs(netPnl) / maxAbs)
  const alpha = 0.18 + intensity * 0.68
  const hue = netPnl > 0 ? '12, 163, 12' : '208, 59, 59'
  return `rgba(${hue}, ${alpha})`
}

function weekTextColor(netPnl: number): string {
  if (netPnl === 0) return 'var(--text-muted)'
  return netPnl > 0 ? 'var(--status-good)' : 'var(--status-critical)'
}

/** Small note-glyph button overlaid on a day cell. Filled/bright when a note already
 * exists so "which days did I journal" reads at a glance; muted outline otherwise.
 * Stops propagation so it opens the quick-edit modal instead of navigating away. */
function NoteIcon({ hasNote, onClick }: { hasNote: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      title={hasNote ? 'View/edit note' : 'Add note'}
      className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded transition ${
        hasNote
          ? 'text-blue-400 hover:bg-blue-500/20'
          : 'text-neutral-700 opacity-0 group-hover:opacity-100 hover:bg-neutral-700 hover:text-neutral-300'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M4 3h9l4 4v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
          stroke="currentColor"
          strokeWidth="1.5"
          fill={hasNote ? 'currentColor' : 'none'}
          fillOpacity={hasNote ? 0.15 : 0}
        />
        <path d="M13 3v4h4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 10.5h7M6.5 13.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/** Small clipboard glyph -- shown (violet, always-visible) when a pre-market plan
 * was set for that day, distinct from the note icon's document glyph and blue so the
 * two "did I write something today" signals stay visually separable. Purely
 * informational (not a button): clicking the day cell already navigates to the
 * Journal, where the full Plan vs Reality comparison lives. */
function PlanIcon() {
  return (
    <span title="Plan set for this day" className="text-violet-400">
      <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
        <rect x="4" y="3" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8h6M7 11h6M7 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function MonthView({
  cursor,
  setCursor,
  daysByDate,
  journalByDate,
  targetsByDate,
  plannedDates,
  onOpenNote,
}: {
  cursor: { year: number; month: number }
  setCursor: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>
  daysByDate: Map<string, CalendarDay>
  journalByDate: Map<string, DailyJournal>
  targetsByDate: Map<string, DailyTargetResult>
  plannedDates: Set<string>
  onOpenNote: (date: string) => void
}) {
  const navigate = useNavigate()

  const { weeks, monthTotal, maxAbs } = useMemo(() => {
    const cells = buildMonthCells(cursor.year, cursor.month, daysByDate)
    let total = 0
    let max = 0
    for (const day of cells) {
      if (!day) continue
      total += day.netPnl
      max = Math.max(max, Math.abs(day.netPnl))
    }
    const weekRows: (CalendarDay | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weekRows.push(cells.slice(i, i + 7))
    return { weeks: weekRows, monthTotal: total, maxAbs: max }
  }, [cursor, daysByDate])

  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 8 }, (_, i) => currentYear - 6 + i)

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))}
            className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Previous month"
          >
            ‹
          </button>
          <select
            value={cursor.month}
            onChange={(e) => setCursor((c) => ({ ...c, month: Number(e.target.value) }))}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
          >
            {MONTH_LABELS.map((label, i) => (
              <option key={label} value={i}>{label}</option>
            ))}
          </select>
          <select
            value={cursor.year}
            onChange={(e) => setCursor((c) => ({ ...c, year: Number(e.target.value) }))}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={() => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))}
            className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${monthTotal >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
          {currency(monthTotal)}
        </span>
      </div>

      <div className="flex items-stretch gap-3">
        <div className="grid flex-1 grid-cols-7 gap-1 text-center text-xs text-neutral-500">
          {DAY_LABELS.map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>
        <div className="w-24 shrink-0 py-1 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Week
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {weeks.map((week, wi) => {
          const weekTotal = week.reduce((sum, d) => sum + (d?.netPnl ?? 0), 0)
          const weekHasTrades = week.some((d) => (d?.tradeCount ?? 0) > 0)
          const weekAnyEstimated = week.some((d) => d?.anyEstimated)

          return (
            <div key={wi} className="flex items-stretch gap-3">
              <div className="grid flex-1 grid-cols-7 gap-1">
                {week.map((day, di) => {
                  if (!day) return <div key={`${wi}-${di}`} className="h-16" />
                  const dayNum = Number(day.date.slice(-2))
                  const hasTrades = day.tradeCount > 0
                  const hasNote = !!journalByDate.get(day.date)?.notes?.trim()
                  const targetStatus = targetsByDate.get(day.date)?.status ?? 'neutral'
                  const hasPlan = plannedDates.has(day.date)
                  return (
                    <div
                      key={day.date}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/journal?date=${day.date}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/journal?date=${day.date}`)
                      }}
                      title={
                        hasTrades
                          ? `${day.date}: ${currency(day.netPnl)} across ${day.tradeCount} trade${day.tradeCount > 1 ? 's' : ''}${day.anyEstimated ? ' (some fees estimated)' : ''} — click to journal`
                          : `${day.date} — click to journal`
                      }
                      style={{ background: monthDayBg(day.netPnl, maxAbs) }}
                      className="group relative flex h-16 cursor-pointer flex-col justify-between rounded-md p-1.5 text-left transition hover:ring-2 hover:ring-neutral-600"
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-neutral-500">{dayNum}</span>
                        <TargetMarkerIcon status={targetStatus} />
                        {hasPlan && <PlanIcon />}
                      </div>
                      <NoteIcon hasNote={hasNote} onClick={() => onOpenNote(day.date)} />
                      {hasTrades ? (
                        <span className="flex flex-col items-start leading-tight">
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{ color: pnlTextColor(day.netPnl) }}
                          >
                            {compactCurrency(day.netPnl)}
                            {day.anyEstimated && <span title="includes estimated fees">*</span>}
                          </span>
                          <span className="text-[11px] text-neutral-600">
                            {day.tradeCount} trade{day.tradeCount > 1 ? 's' : ''}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-800">·</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Week chip: neutral panel + left accent bar + colored text, deliberately
                  unlike the day tiles' tinted-wash language. */}
              <div
                title={weekHasTrades ? `Week total: ${currency(weekTotal)}` : 'No trades this week'}
                className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-md border-l-4 bg-neutral-800/70 px-1 text-center"
                style={{ borderLeftColor: weekHasTrades ? weekTextColor(weekTotal) : 'var(--baseline)' }}
              >
                {weekHasTrades ? (
                  <span
                    className="text-sm font-semibold tabular-nums leading-tight"
                    style={{ color: weekTextColor(weekTotal) }}
                  >
                    {currency(weekTotal)}
                    {weekAnyEstimated && <span title="includes estimated fees">*</span>}
                  </span>
                ) : (
                  <span className="text-xs text-neutral-600">—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function YearView({
  year,
  setYear,
  daysByDate,
}: {
  year: number
  setYear: React.Dispatch<React.SetStateAction<number>>
  daysByDate: Map<string, CalendarDay>
}) {
  const navigate = useNavigate()

  const { months, yearTotal, maxAbs } = useMemo(() => {
    let max = 0
    for (const day of daysByDate.values()) {
      if (day.date.slice(0, 4) === String(year)) max = Math.max(max, Math.abs(day.netPnl))
    }
    const monthData = Array.from({ length: 12 }, (_, month) => {
      const cells = buildMonthCells(year, month, daysByDate)
      const total = cells.reduce((sum, d) => sum + (d?.netPnl ?? 0), 0)
      return { month, cells, total }
    })
    const total = monthData.reduce((sum, m) => sum + m.total, 0)
    return { months: monthData, yearTotal: total, maxAbs: max }
  }, [year, daysByDate])

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setYear((y) => y - 1)}
          className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          aria-label="Previous year"
        >
          ‹
        </button>
        <div className="text-sm font-medium text-neutral-200">
          {year}{' '}
          <span className={`ml-2 tabular-nums ${yearTotal >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
            {currency(yearTotal)}
          </span>
        </div>
        <button
          onClick={() => setYear((y) => y + 1)}
          className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          aria-label="Next year"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {months.map(({ month, cells, total }) => (
          <div key={month} className="rounded-lg border border-neutral-800/70 bg-neutral-950/40 p-2">
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <span className="text-xs font-medium text-neutral-400">{MONTH_LABELS_SHORT[month]}</span>
              {total !== 0 && (
                <span
                  className="text-[11px] font-medium tabular-nums"
                  style={{ color: pnlTextColor(total) }}
                >
                  {compactCurrency(total)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-7 gap-0.75">
              {cells.map((day, i) => {
                if (!day) return <div key={i} className="aspect-square" />
                const hasTrades = day.tradeCount > 0
                return (
                  <button
                    key={day.date}
                    onClick={() => navigate(`/journal?date=${day.date}`)}
                    title={
                      hasTrades
                        ? `${day.date}: ${currency(day.netPnl)} across ${day.tradeCount} trade${day.tradeCount > 1 ? 's' : ''} — click to journal`
                        : day.date
                    }
                    style={{ background: yearDayBg(day.netPnl, maxAbs) }}
                    className="aspect-square rounded-xs transition hover:ring-1 hover:ring-neutral-400"
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

type Props = {
  daysByDate: Map<string, CalendarDay>
  journalByDate?: Map<string, DailyJournal>
  targetsByDate?: Map<string, DailyTargetResult>
  plannedDates?: Set<string>
  onSaveNote?: (date: string, fields: { notes?: string; mood_rating?: number | null }) => void
}

export function PnlCalendarHeatmap({ daysByDate, journalByDate, targetsByDate, plannedDates, onSaveNote }: Props) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'month' | 'year'>('month')
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() } // month: 0-11
  })
  const [noteDate, setNoteDate] = useState<string | null>(null)

  const journalMap = journalByDate ?? new Map<string, DailyJournal>()
  const targetsMap = targetsByDate ?? new Map<string, DailyTargetResult>()
  const plannedSet = plannedDates ?? new Set<string>()

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-md border border-neutral-700 p-0.5 text-xs">
          <button
            onClick={() => setMode('month')}
            className={`rounded px-2.5 py-1 transition ${mode === 'month' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            Month
          </button>
          <button
            onClick={() => setMode('year')}
            className={`rounded px-2.5 py-1 transition ${mode === 'year' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            Year
          </button>
        </div>
      </div>

      {mode === 'month' ? (
        <MonthView
          cursor={cursor}
          setCursor={setCursor}
          daysByDate={daysByDate}
          journalByDate={journalMap}
          targetsByDate={targetsMap}
          plannedDates={plannedSet}
          onOpenNote={setNoteDate}
        />
      ) : (
        <YearView
          year={cursor.year}
          setYear={(update) => setCursor((c) => ({ ...c, year: typeof update === 'function' ? update(c.year) : update }))}
          daysByDate={daysByDate}
        />
      )}

      {noteDate && onSaveNote && (
        <DayNoteModal
          date={noteDate}
          journal={journalMap.get(noteDate) ?? null}
          onSave={onSaveNote}
          onClose={() => setNoteDate(null)}
          onOpenFullDay={() => navigate(`/journal?date=${noteDate}`)}
        />
      )}
    </div>
  )
}
