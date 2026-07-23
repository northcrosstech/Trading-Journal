import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  fetchTradesWithDetails,
  fetchEmotions,
  ensureDefaultEmotions,
  createEmotion,
  setTradeEmotion,
  removeTradeEmotion,
  updateTradeThesisNote,
  updateTradeReflectionNote,
} from '../lib/queries'
import type { TradeWithDetails, Emotion } from '../lib/database.types'
import { toDateStr } from '../lib/dateRange'
import { centralDateStr, optionLabel, currency } from '../lib/format'
import { PsychologyChips } from '../components/PsychologyChips'

/** The same day-bucketing rule used everywhere else (calendar, journal): closed
 * trades count under their close date, open trades under their entry date. */
function bucketDate(t: Pick<TradeWithDetails, 'status' | 'first_in_at' | 'last_out_at'>): string | null {
  const iso = t.status === 'CLOSED' ? t.last_out_at : t.first_in_at
  return iso ? centralDateStr(new Date(iso)) : null
}

/** Rapid-fire tagging: cycles through one day's untagged trades (zero trade_emotions
 * rows) one at a time, so a whole day's psychology can be logged in the time it'd
 * take to open each trade individually. Same PsychologyChips component as the trade
 * detail page and manual entry -- persists immediately per trade, no batch save. */
export function PsychPassPage() {
  const { user } = useAuth()
  const [date, setDate] = useState(() => toDateStr(new Date()))
  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [allEmotions, setAllEmotions] = useState<Emotion[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    fetchTradesWithDetails().then(setTrades)
  }, [])

  useEffect(() => {
    if (!user) return
    ensureDefaultEmotions(user.id)
      .then(() => fetchEmotions())
      .then(setAllEmotions)
  }, [user])

  const untagged = useMemo(() => {
    if (!trades) return []
    return trades.filter((t) => bucketDate(t) === date && t.trade_emotions.length === 0)
  }, [trades, date])

  useEffect(() => setIndex(0), [date])

  const current = untagged[index] ?? null

  function reloadCurrent(tradeId: string, patch: Partial<TradeWithDetails>) {
    setTrades((prev) => (prev ? prev.map((t) => (t.id === tradeId ? { ...t, ...patch } : t)) : prev))
  }

  async function handleToggle(emotion: Emotion, on: boolean) {
    if (!current) return
    if (on) {
      await setTradeEmotion(current.id, emotion.id, emotion.phase)
      const next = current.trade_emotions.filter((te) => te.emotion_id !== emotion.id)
      next.push({ emotion_id: emotion.id, phase: emotion.phase, emotions: emotion })
      reloadCurrent(current.id, { trade_emotions: next })
    } else {
      await removeTradeEmotion(current.id, emotion.id)
      reloadCurrent(current.id, { trade_emotions: current.trade_emotions.filter((te) => te.emotion_id !== emotion.id) })
    }
  }

  async function handleAddEmotion(phase: Emotion['phase'], name: string) {
    if (!user) return
    const nextOrder = allEmotions.length > 0 ? Math.max(...allEmotions.map((e) => e.sort_order)) + 1 : 0
    const emotion = await createEmotion(user.id, phase, name, nextOrder)
    setAllEmotions((prev) => [...prev, emotion])
    handleToggle(emotion, true)
  }

  function handleThesisNoteChange(text: string) {
    if (current) reloadCurrent(current.id, { thesis_note: text })
  }
  function handleReflectionNoteChange(text: string) {
    if (current) reloadCurrent(current.id, { reflection_note: text })
  }
  function handleThesisNoteBlur() {
    if (current) updateTradeThesisNote(current.id, current.thesis_note ?? '')
  }
  function handleReflectionNoteBlur() {
    if (current) updateTradeReflectionNote(current.id, current.reflection_note ?? '')
  }

  if (trades === null) {
    return <div className="text-neutral-500">Loading…</div>
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trade Log
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-100">Quick Psych Pass</h1>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {current ? (
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-neutral-100">
                {current.symbol}
                {current.options_detail && (
                  <span className="ml-1.5 text-xs font-normal text-neutral-500">
                    {optionLabel(current.options_detail.strike, current.options_detail.option_type)}
                  </span>
                )}
              </div>
              <div className={`text-xs tabular-nums ${(current.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
                {current.status === 'OPEN' ? 'Open' : currency(current.realized_pnl_net)}
              </div>
            </div>
            <span className="text-xs text-neutral-500">
              {index + 1} of {untagged.length}
            </span>
          </div>

          {/* Thesis/reflection notes here save on blur (not debounced-as-you-type) --
              keeps rapid-fire tagging simple: type, tab/click away, move on. */}
          <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && (handleThesisNoteBlur(), handleReflectionNoteBlur())}>
            <PsychologyChips
              emotions={allEmotions}
              selected={current.trade_emotions.map((te) => ({ emotion_id: te.emotion_id, phase: te.phase }))}
              thesisNote={current.thesis_note ?? ''}
              reflectionNote={current.reflection_note ?? ''}
              onToggle={handleToggle}
              onThesisNoteChange={handleThesisNoteChange}
              onReflectionNoteChange={handleReflectionNoteChange}
              onAddEmotion={handleAddEmotion}
            />
          </div>

          <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              ← Previous
            </button>
            <Link to={`/trades/${current.id}`} className="text-xs text-neutral-500 hover:text-neutral-300">
              Open full trade →
            </Link>
            <button
              onClick={() => setIndex((i) => Math.min(untagged.length - 1, i + 1))}
              disabled={index >= untagged.length - 1}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
          {trades.some((t) => bucketDate(t) === date)
            ? 'All trades for this day are already tagged. Nice.'
            : 'No trades on this day.'}
        </div>
      )}
    </div>
  )
}
