import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fetchTradesWithDetails, fetchAllDailyJournal, upsertDailyJournal, fetchAllDailyPlans } from '../lib/queries'
import type { TradeWithDetails, DailyJournal, DailyPlanWithStrategies } from '../lib/database.types'
import { computeDailyFeed, computePlanVsActual } from '../lib/metrics'
import { DailyFeedCard } from '../components/DailyFeedCard'

export function JournalPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusDate = searchParams.get('date')

  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [journalByDate, setJournalByDate] = useState<Map<string, DailyJournal>>(new Map())
  const [planByDate, setPlanByDate] = useState<Map<string, DailyPlanWithStrategies>>(new Map())
  const [expandedDate, setExpandedDate] = useState<string | null>(focusDate)

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    fetchTradesWithDetails().then(setTrades)
    fetchAllDailyJournal().then((entries) => {
      setJournalByDate(new Map(entries.map((e) => [e.entry_date, e])))
    })
    fetchAllDailyPlans().then((plans) => {
      setPlanByDate(new Map(plans.map((p) => [p.plan_date, p])))
    })
  }, [])

  const feed = useMemo(() => (trades ? computeDailyFeed(trades) : []), [trades])

  // If the calendar linked to a date that has no trades yet, still show it as an
  // ad-hoc journal-only entry so "click a day to journal" always works.
  const feedWithFocus = useMemo(() => {
    if (!focusDate || feed.some((e) => e.date === focusDate)) return feed
    const empty = {
      date: focusDate,
      trades: [],
      closedTrades: [],
      netPnl: 0,
      grossPnl: 0,
      fees: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      profitFactor: null,
      anyEstimated: false,
      equityPoints: [],
    }
    return [empty, ...feed].sort((a, b) => b.date.localeCompare(a.date))
  }, [feed, focusDate])

  useEffect(() => {
    if (!focusDate) return
    setExpandedDate(focusDate)
    const el = cardRefs.current.get(focusDate)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusDate, feedWithFocus.length])

  const handleSave = useCallback(
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
    return <div className="text-neutral-500">Loading journal…</div>
  }

  if (feedWithFocus.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-400">
        No trading days yet. Once trades sync in, each day shows up here as a journal entry.
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <h1 className="text-lg font-semibold text-neutral-100">Journal</h1>
      {feedWithFocus.map((entry) => (
        <DailyFeedCard
          key={entry.date}
          ref={(el) => {
            if (el) cardRefs.current.set(entry.date, el)
            else cardRefs.current.delete(entry.date)
          }}
          entry={entry}
          journal={journalByDate.get(entry.date) ?? null}
          planComparison={
            planByDate.has(entry.date) && trades
              ? computePlanVsActual(entry.date, trades, planByDate.get(entry.date)!)
              : undefined
          }
          expanded={expandedDate === entry.date}
          onToggle={() => {
            const next = expandedDate === entry.date ? null : entry.date
            setExpandedDate(next)
            setSearchParams(next ? { date: next } : {}, { replace: true })
          }}
          onSave={handleSave}
        />
      ))}
    </div>
  )
}
