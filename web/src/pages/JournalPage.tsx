import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchTradesWithDetails, fetchAllDailyJournal, upsertDailyJournal, fetchAllDailyPlans, fetchTargetSettings } from '../lib/queries'
import type { DailyJournal, DailyPlanWithPlaybooks, TargetSettings, TradeWithDetails } from '../lib/database.types'
import { computeCalendarDays, computeDailyTargetStats } from '../lib/metrics'
import { MOODS } from '../lib/moods'
import { tradeDay, longDayLabel } from '../lib/tradingDay'
import { currency, holdTimeFmt, optionLabel, dteLabel, timeOnlyFmt } from '../lib/format'
import { PnlCalendarHeatmap } from '../components/PnlCalendarHeatmap'
import { TradeTags } from '../components/TradeTags'

const PAGE_SIZE = 15

function pnlClass(v: number) {
  return v > 0 ? 'text-(--status-good)' : v < 0 ? 'text-(--status-critical)' : 'text-neutral-300'
}

type Day = { date: string; trades: TradeWithDetails[] }

const DayCard = forwardRef<
  HTMLDivElement,
  {
    day: Day
    journal: DailyJournal | null
    plan: DailyPlanWithPlaybooks | null
    highlighted: boolean
    onSaveNote: (date: string, fields: { notes?: string | null; mood_rating?: number | null }) => void
  }
>(function DayCard({ day, journal, plan, highlighted, onSaveNote }, ref) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const closed = day.trades.filter((t) => t.status === 'CLOSED')
  const net = closed.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
  const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0).length
  const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0).length
  const toReview = closed.filter((t) => !t.reviewed_at).length
  const planned = closed.filter((t) => t.planned === true).length
  const unplanned = closed.filter((t) => t.planned === false).length
  const mistakes = closed.reduce((n, t) => n + t.mistakes.length, 0)
  const mood = MOODS.find((m) => m.value === journal?.mood_rating)

  return (
    <div
      ref={ref}
      className={`scroll-mt-6 rounded-xl border bg-neutral-900 ${highlighted ? 'border-blue-700' : 'border-neutral-800'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-neutral-100">
            {longDayLabel(day.date)} {mood && <span title={mood.label}>{mood.emoji}</span>}
          </div>
          <div className="text-xs text-neutral-500">
            {wins}W · {losses}L
            {(planned > 0 || unplanned > 0) && (
              <>
                {' '}· <span className="text-emerald-400">{planned} planned</span> · <span className="text-amber-400">{unplanned} unplanned</span>
              </>
            )}
            {mistakes > 0 && <span className="text-red-400"> · {mistakes} mistake{mistakes === 1 ? '' : 's'}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {toReview > 0 ? (
            <Link
              to={`/review?date=${day.date}`}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              Review {toReview} →
            </Link>
          ) : (
            closed.length > 0 && (
              <Link to={`/review?date=${day.date}`} className="text-xs text-neutral-500 hover:text-neutral-300">
                Reviewed ✓
              </Link>
            )
          )}
          <span className={`text-lg font-semibold tabular-nums ${pnlClass(net)}`}>{currency(net)}</span>
        </div>
      </div>

      {(plan?.focus || plan?.plan_notes) && (
        <div className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
          {plan.focus && (
            <span>
              <span className="font-medium text-violet-400">Focus:</span> {plan.focus}
            </span>
          )}
          {plan.plan_notes && <div className="mt-0.5 whitespace-pre-wrap text-neutral-500">{plan.plan_notes}</div>}
        </div>
      )}

      <div className="border-b border-neutral-800 px-4 py-2.5">
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-neutral-500 hover:text-neutral-300">
                Cancel
              </button>
              <button
                onClick={() => {
                  onSaveNote(day.date, { notes: draft.trim() || null })
                  setEditing(false)
                }}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500"
              >
                Save
              </button>
            </div>
          </div>
        ) : journal?.notes ? (
          <button
            onClick={() => {
              setDraft(journal.notes ?? '')
              setEditing(true)
            }}
            className="w-full whitespace-pre-wrap text-left text-sm text-neutral-300 hover:text-neutral-100"
          >
            {journal.notes}
          </button>
        ) : (
          <button
            onClick={() => {
              setDraft('')
              setEditing(true)
            }}
            className="text-xs text-neutral-600 hover:text-neutral-300"
          >
            + Add a note for the day
          </button>
        )}
      </div>

      <div className="divide-y divide-neutral-800/60">
        {day.trades.map((t) => (
          <Link key={t.id} to={`/trades/${t.id}`} className="flex items-center gap-3 px-4 py-2 text-sm transition hover:bg-neutral-800/40">
            <span className="w-20 shrink-0 text-xs tabular-nums text-neutral-500">{timeOnlyFmt(t.first_in_at)}</span>
            <span className="w-40 shrink-0 truncate font-medium text-neutral-200">
              {t.symbol}
              {t.options_detail && (
                <span className="ml-1.5 text-xs font-normal text-neutral-500">
                  {optionLabel(t.options_detail.strike, t.options_detail.option_type)} {dteLabel(t.first_in_at, t.options_detail.expiration)}
                </span>
              )}
            </span>
            <span className="w-14 shrink-0 text-xs text-neutral-500">{holdTimeFmt(t.hold_seconds)}</span>
            <span className="min-w-0 flex-1">
              <TradeTags trade={t} />
            </span>
            <span className={`w-24 shrink-0 text-right tabular-nums ${t.status === 'OPEN' ? 'text-neutral-500' : pnlClass(t.realized_pnl_net ?? 0)}`}>
              {t.status === 'OPEN' ? 'OPEN' : currency(t.realized_pnl_net)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
})

/** Calendar for the big picture, then one card per trading day: P&L, plan focus,
 * the day's note, every trade with its review tags, and a link into the review queue
 * when anything is still unreviewed. */
export function JournalPage() {
  const { user } = useAuth()
  const { selectedAccountId } = useAccountFilter()
  const [searchParams] = useSearchParams()
  const focusDate = searchParams.get('date')

  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [journalByDate, setJournalByDate] = useState<Map<string, DailyJournal>>(new Map())
  const [planByDate, setPlanByDate] = useState<Map<string, DailyPlanWithPlaybooks>>(new Map())
  const [settings, setSettings] = useState<TargetSettings | null>(null)
  const [shown, setShown] = useState(PAGE_SIZE)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    let cancelled = false
    fetchTradesWithDetails(selectedAccountId).then((t) => !cancelled && setTrades(t))
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  useEffect(() => {
    fetchAllDailyJournal().then((entries) => setJournalByDate(new Map(entries.map((e) => [e.entry_date, e]))))
    fetchAllDailyPlans().then((plans) => setPlanByDate(new Map(plans.map((p) => [p.plan_date, p]))))
    fetchTargetSettings().then(setSettings)
  }, [])

  const days = useMemo<Day[]>(() => {
    const byDate = new Map<string, TradeWithDetails[]>()
    for (const t of trades ?? []) {
      const d = tradeDay(t)
      if (!d) continue
      const list = byDate.get(d)
      if (list) list.push(t)
      else byDate.set(d, [t])
    }
    if (focusDate && !byDate.has(focusDate)) byDate.set(focusDate, []) // clicking an empty calendar day still lets you journal it
    return Array.from(byDate, ([date, list]) => ({
      date,
      trades: list.sort((a, b) => (a.first_in_at ?? '').localeCompare(b.first_in_at ?? '')),
    })).sort((a, b) => b.date.localeCompare(a.date))
  }, [trades, focusDate])

  // Make sure a deep-linked day is within the rendered page, then scroll to it.
  useEffect(() => {
    if (!focusDate) return
    const idx = days.findIndex((d) => d.date === focusDate)
    if (idx >= 0) setShown((n) => Math.max(n, idx + 1))
    requestAnimationFrame(() => cardRefs.current.get(focusDate)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [focusDate, days])

  const handleSaveNote = useCallback(
    (date: string, fields: { notes?: string | null; mood_rating?: number | null }) => {
      if (!user) return
      upsertDailyJournal(user.id, date, fields).then(() =>
        setJournalByDate((prev) => {
          const next = new Map(prev)
          const existing = next.get(date)
          next.set(date, {
            id: existing?.id ?? '',
            user_id: user.id,
            entry_date: date,
            notes: fields.notes !== undefined ? fields.notes : (existing?.notes ?? null),
            mood_rating: fields.mood_rating !== undefined ? fields.mood_rating : (existing?.mood_rating ?? null),
            created_at: existing?.created_at ?? new Date().toISOString(),
          })
          return next
        }),
      )
    },
    [user],
  )

  if (trades === null) return <div className="text-neutral-500">Loading journal…</div>

  const calendarDays = computeCalendarDays(trades)
  const targetsByDate = computeDailyTargetStats(trades, settings)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="text-lg font-semibold text-neutral-100">Journal</h1>

      <PnlCalendarHeatmap
        daysByDate={calendarDays}
        journalByDate={journalByDate}
        targetsByDate={targetsByDate}
        plannedDates={new Set(planByDate.keys())}
        onSaveNote={handleSaveNote}
      />

      {days.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-400">
          No trading days yet. Once trades sync in, each day shows up here.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {days.slice(0, shown).map((day) => (
            <DayCard
              key={day.date}
              ref={(el) => {
                if (el) cardRefs.current.set(day.date, el)
                else cardRefs.current.delete(day.date)
              }}
              day={day}
              journal={journalByDate.get(day.date) ?? null}
              plan={planByDate.get(day.date) ?? null}
              highlighted={day.date === focusDate}
              onSaveNote={handleSaveNote}
            />
          ))}
          {shown < days.length && (
            <button
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="rounded-lg border border-neutral-800 py-2 text-sm text-neutral-400 transition hover:bg-neutral-900"
            >
              Show older days
            </button>
          )}
        </div>
      )}
    </div>
  )
}
