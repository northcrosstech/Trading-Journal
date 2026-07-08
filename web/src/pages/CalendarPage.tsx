import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fetchAllDailyJournal, upsertDailyJournal, fetchTargetSettings } from '../lib/queries'
import type { Trade, DailyJournal, TargetSettings } from '../lib/database.types'
import { computeCalendarDays, computeDailyTargetStats } from '../lib/metrics'
import { PnlCalendarHeatmap } from '../components/PnlCalendarHeatmap'

export function CalendarPage() {
  const { user } = useAuth()
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [journalByDate, setJournalByDate] = useState<Map<string, DailyJournal>>(new Map())
  const [targetSettings, setTargetSettings] = useState<TargetSettings | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('trades')
      .select('*')
      .order('first_in_at', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setTrades(data ?? [])
      })

    fetchAllDailyJournal().then((entries) => {
      if (cancelled) return
      setJournalByDate(new Map(entries.map((e) => [e.entry_date, e])))
    })

    fetchTargetSettings().then((s) => {
      if (!cancelled) setTargetSettings(s)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveNote = useCallback(
    (date: string, fields: { notes?: string; mood_rating?: number | null }) => {
      if (!user) return
      upsertDailyJournal(user.id, date, fields).then(() => {
        setJournalByDate((prev) => {
          const next = new Map(prev)
          const existing = next.get(date)
          next.set(date, {
            id: existing?.id ?? '',
            user_id: user.id,
            entry_date: date,
            notes: fields.notes ?? existing?.notes ?? null,
            mood_rating: fields.mood_rating !== undefined ? fields.mood_rating : (existing?.mood_rating ?? null),
            created_at: existing?.created_at ?? new Date().toISOString(),
          })
          return next
        })
      })
    },
    [user],
  )

  if (trades === null) {
    return <div className="text-neutral-500">Loading calendar…</div>
  }

  const calendarData = computeCalendarDays(trades)
  const targetsByDate = computeDailyTargetStats(trades, targetSettings)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-100">Calendar</h1>
      <PnlCalendarHeatmap
        daysByDate={calendarData}
        journalByDate={journalByDate}
        targetsByDate={targetsByDate}
        onSaveNote={handleSaveNote}
      />
    </div>
  )
}
