import { useCallback, useEffect, useRef, useState } from 'react'
import type { DailyJournal } from '../lib/database.types'

const MOODS = [
  { value: 1, emoji: '😖', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Off' },
  { value: 3, emoji: '😐', label: 'Neutral' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
]

function dateHeading(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

type Props = {
  date: string
  journal: DailyJournal | null
  onSave: (date: string, fields: { notes?: string; mood_rating?: number | null }) => void
  onClose: () => void
  onOpenFullDay: () => void
}

/** Quick view/edit for a single day's note, launched from the note icon on a
 * calendar cell -- lets you check or jot a note without leaving the calendar.
 * "Open full day" hands off to the journal feed for the trade list + mood in context. */
export function DayNoteModal({ date, journal, onSave, onClose, onOpenFullDay }: Props) {
  const [notes, setNotes] = useState(journal?.notes ?? '')
  const [mood, setMood] = useState<number | null>(journal?.mood_rating ?? null)
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = useCallback(
    (fields: { notes?: string; mood_rating?: number | null }) => {
      setSaved(false)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onSave(date, fields)
        setSaved(true)
      }, 500)
    },
    [date, onSave],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-neutral-200">{dateHeading(date)}</div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <div className="flex gap-1.5">
            {MOODS.map((m) => (
              <button
                key={m.value}
                onClick={() => {
                  const next = mood === m.value ? null : m.value
                  setMood(next)
                  save({ mood_rating: next })
                }}
                title={m.label}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-base transition ${
                  mood === m.value ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'bg-neutral-800 hover:bg-neutral-700'
                }`}
              >
                {m.emoji}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-neutral-600">{saved ? 'Saved' : 'Saving…'}</span>
        </div>

        <textarea
          ref={textareaRef}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            save({ notes: e.target.value })
          }}
          placeholder="How did today go? What did you notice about your process?"
          rows={6}
          className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />

        <div className="mt-3 flex justify-end">
          <button
            onClick={onOpenFullDay}
            className="text-xs text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
          >
            Open full day in Journal →
          </button>
        </div>
      </div>
    </div>
  )
}
