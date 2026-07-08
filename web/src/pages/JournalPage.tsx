import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fetchDailyJournal, upsertDailyJournal, fetchTradesWithDetails } from '../lib/queries'
import type { TradeWithDetails } from '../lib/database.types'
import { currency, optionLabel, timeOnlyFmt } from '../lib/format'

const MOODS = [
  { value: 1, emoji: '😖', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Off' },
  { value: 3, emoji: '😐', label: 'Neutral' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function JournalPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('date') ?? todayStr()

  const [notes, setNotes] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [dayTrades, setDayTrades] = useState<TradeWithDetails[] | null>(null)
  const [allTrades, setAllTrades] = useState<TradeWithDetails[] | null>(null)

  useEffect(() => {
    fetchTradesWithDetails().then(setAllTrades)
  }, [])

  useEffect(() => {
    if (!allTrades) return
    setDayTrades(
      allTrades.filter((t) => (t.status === 'CLOSED' ? t.last_out_at?.slice(0, 10) === date : t.first_in_at?.slice(0, 10) === date)),
    )
  }, [allTrades, date])

  useEffect(() => {
    fetchDailyJournal(date).then((entry) => {
      setNotes(entry?.notes ?? '')
      setMood(entry?.mood_rating ?? null)
      setSaved(true)
    })
  }, [date])

  const save = useCallback(
    (fields: { notes?: string; mood_rating?: number | null }) => {
      if (!user) return
      setSaved(false)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        await upsertDailyJournal(user.id, date, fields)
        setSaved(true)
      }, 600)
    },
    [user, date],
  )

  const dayNet = (dayTrades ?? []).reduce((sum, t) => sum + (t.status === 'CLOSED' ? t.realized_pnl_net ?? 0 : 0), 0)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setSearchParams({ date: shiftDate(date, -1) })}
          className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          ‹ Prev
        </button>
        <div className="text-center">
          <div className="text-lg font-semibold text-neutral-100">
            {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          {dayTrades && dayTrades.length > 0 && (
            <div className={`text-sm tabular-nums ${dayNet >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
              {currency(dayNet)} · {dayTrades.length} trade{dayTrades.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
        <button
          onClick={() => setSearchParams({ date: shiftDate(date, 1) })}
          className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          Next ›
        </button>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Mood</h2>
          <span className="text-xs text-neutral-600">{saved ? 'Saved' : 'Saving…'}</span>
        </div>
        <div className="flex gap-2">
          {MOODS.map((m) => (
            <button
              key={m.value}
              onClick={() => {
                const next = mood === m.value ? null : m.value
                setMood(next)
                save({ mood_rating: next })
              }}
              title={m.label}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition ${
                mood === m.value ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'bg-neutral-800 hover:bg-neutral-700'
              }`}
            >
              {m.emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">Journal</h2>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            save({ notes: e.target.value })
          }}
          placeholder="How did today go? What did you notice about your process?"
          rows={8}
          className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
      </div>

      {dayTrades && dayTrades.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">Trades this day</h2>
          <div className="flex flex-col divide-y divide-neutral-800/60">
            {dayTrades.map((t) => (
              <Link
                key={t.id}
                to={`/trades/${t.id}`}
                className="flex items-center justify-between py-2 text-sm hover:text-neutral-100"
              >
                <span className="text-neutral-300">
                  {t.symbol} {optionLabel(t.options_detail?.strike, t.options_detail?.option_type)}
                  <span className="ml-2 text-xs text-neutral-500">{timeOnlyFmt(t.first_in_at)}</span>
                </span>
                {t.status === 'CLOSED' ? (
                  <span className={(t.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                    {currency(t.realized_pnl_net)}
                  </span>
                ) : (
                  <span className="text-neutral-500">OPEN</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
