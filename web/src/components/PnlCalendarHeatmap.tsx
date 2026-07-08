import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarDay } from '../lib/metrics'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const currency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** Day cells: status-hue diverging FILL (background wash), scaled by magnitude --
 * this is the "day" visual language. */
function dayCellStyle(netPnl: number, maxAbs: number): { background: string; color: string } {
  if (netPnl === 0 || maxAbs === 0) {
    return { background: 'var(--gridline)', color: 'var(--text-muted)' }
  }
  const intensity = Math.min(1, Math.abs(netPnl) / maxAbs)
  const alpha = 0.18 + intensity * 0.72 // floor so small amounts are still visible
  const hue = netPnl > 0 ? '12, 163, 12' : '208, 59, 59' // status-good / status-critical as rgb
  return {
    background: `rgba(${hue}, ${alpha})`,
    color: alpha > 0.5 ? '#ffffff' : 'var(--text-primary)',
  }
}

/** Week chip: deliberately a different visual language from day cells -- neutral
 * panel background with a colored TEXT value and left accent bar, rather than a
 * colored fill, so a week total never reads as "just another day" at a glance. */
function weekTextColor(netPnl: number): string {
  if (netPnl === 0) return 'var(--text-muted)'
  return netPnl > 0 ? 'var(--status-good)' : 'var(--status-critical)'
}

export function PnlCalendarHeatmap({ daysByDate }: { daysByDate: Map<string, CalendarDay> }) {
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() } // month: 0-11
  })

  const { weeks, monthTotal, maxAbs } = useMemo(() => {
    const firstOfMonth = new Date(cursor.year, cursor.month, 1)
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
    const startWeekday = firstOfMonth.getDay()

    const cells: (CalendarDay | null)[] = Array(startWeekday).fill(null)
    let total = 0
    let max = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${cursor.year}-${pad(cursor.month + 1)}-${pad(d)}`
      const day = daysByDate.get(dateStr) ?? { date: dateStr, netPnl: 0, tradeCount: 0, anyEstimated: false }
      cells.push(day)
      total += day.netPnl
      max = Math.max(max, Math.abs(day.netPnl))
    }
    while (cells.length % 7 !== 0) cells.push(null)

    const weekRows: (CalendarDay | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weekRows.push(cells.slice(i, i + 7))

    return { weeks: weekRows, monthTotal: total, maxAbs: max }
  }, [cursor, daysByDate])

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))}
          className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="text-sm font-medium text-neutral-200">
          {MONTH_LABELS[cursor.month]} {cursor.year}{' '}
          <span className={`ml-2 tabular-nums ${monthTotal >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
            {currency(monthTotal)}
          </span>
        </div>
        <button
          onClick={() => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))}
          className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="flex items-stretch gap-3">
        <div className="grid flex-1 grid-cols-7 gap-1 text-center text-[11px] text-neutral-500">
          {DAY_LABELS.map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>
        <div className="w-24 shrink-0 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
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
                  if (!day) return <div key={`${wi}-${di}`} />
                  const dayNum = Number(day.date.slice(-2))
                  const style = dayCellStyle(day.netPnl, maxAbs)
                  const hasTrades = day.tradeCount > 0
                  return (
                    <button
                      key={day.date}
                      onClick={() => navigate(`/journal?date=${day.date}`)}
                      title={
                        hasTrades
                          ? `${day.date}: ${currency(day.netPnl)} across ${day.tradeCount} trade${day.tradeCount > 1 ? 's' : ''}${day.anyEstimated ? ' (some fees estimated)' : ''} — click to journal`
                          : `${day.date} — click to journal`
                      }
                      style={{ background: style.background, color: style.color }}
                      className="flex aspect-square flex-col items-center justify-center rounded-md text-xs transition hover:ring-2 hover:ring-neutral-500"
                    >
                      <span className="opacity-70">{dayNum}</span>
                      {hasTrades && (
                        <span className="text-[9px] font-medium tabular-nums leading-tight">
                          {currency(day.netPnl).replace('$', '')}
                          {day.anyEstimated && <span title="includes estimated fees">*</span>}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Week chip: neutral panel + left accent bar + colored text, deliberately
                  unlike the day tiles' colored-fill language. */}
              <div
                title={weekHasTrades ? `Week total: ${currency(weekTotal)}` : 'No trades this week'}
                className="flex w-24 shrink-0 flex-col items-center justify-center rounded-md border-l-4 bg-neutral-800/70 px-1 text-center"
                style={{ borderLeftColor: weekHasTrades ? weekTextColor(weekTotal) : 'var(--baseline)' }}
              >
                {weekHasTrades ? (
                  <span
                    className="text-[11px] font-semibold tabular-nums leading-tight"
                    style={{ color: weekTextColor(weekTotal) }}
                  >
                    {currency(weekTotal)}
                    {weekAnyEstimated && <span title="includes estimated fees">*</span>}
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-600">—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
