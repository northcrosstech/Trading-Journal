import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import {
  fetchTradesWithDetails,
  fetchPlaybooks,
  fetchDailyPlan,
  fetchDailyJournal,
  upsertDailyJournal,
  upsertDailyPlan,
  updateTradeJournal,
} from '../lib/queries'
import type { DailyPlanWithPlaybooks, Playbook, TradeWithDetails } from '../lib/database.types'
import { useTradeJournal } from '../lib/useTradeJournal'
import { strengthsOf } from '../lib/strengths'
import { reviewMissing, shortcutTags } from '../lib/reviewChecks'
import { useReviewChecklist } from '../lib/reviewChecklistContext'
import { tradeOutcome } from '../lib/whatIf'
import { MOODS } from '../lib/moods'
import { toDateStr } from '../lib/dateRange'
import { tradeDay, longDayLabel, nextTradingDay, watchlistSymbols } from '../lib/tradingDay'
import { currency, priceFmt, holdTimeFmt, optionLabel, dteLabel, timeOnlyFmt } from '../lib/format'
import { TradeChart } from '../components/TradeChart'
import { TradeJournalPanel } from '../components/TradeJournalPanel'

/** How many trades carry each tag, most common first -- whatever labels were used,
 * so tags since removed from the checklist still count. */
function tagCounts(tagLists: string[][]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const tags of tagLists) for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
}

function pnlClass(v: number) {
  return v > 0 ? 'text-(--status-good)' : v < 0 ? 'text-(--status-critical)' : 'text-neutral-300'
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

/** End of the queue: a short day summary, one daily note + mood, and tomorrow's focus
 * (written straight into the next trading day's plan, so the review feeds the plan). */
function WrapUp({ date, trades, userId }: { date: string; trades: TradeWithDetails[]; userId: string }) {
  const navigate = useNavigate()
  const tomorrow = nextTradingDay(date)
  const [note, setNote] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [focus, setFocus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchDailyJournal(date).then((j) => {
      setNote(j?.notes ?? '')
      setMood(j?.mood_rating ?? null)
    })
    fetchDailyPlan(tomorrow).then((p) => setFocus(p?.focus ?? ''))
  }, [date, tomorrow])

  const net = trades.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0)
  const planned = trades.filter((t) => t.trade_origin === 'planned').length
  const unplanned = trades.filter((t) => t.trade_origin === 'unplanned').length
  const followed = trades.filter((t) => t.trade_origin === 'followed').length
  const strengthCounts = tagCounts(trades.map(strengthsOf))
  const leftOnTable = trades.reduce((sum, t) => {
    const o = tradeOutcome(t)
    return o.kind === 'left_on_table' || o.kind === 'cost_of_ignoring_stop' ? sum + (o.delta ?? 0) : sum
  }, 0)
  const mistakeCounts = tagCounts(trades.map((t) => t.mistakes))

  async function handleFinish() {
    setSaving(true)
    try {
      await upsertDailyJournal(userId, date, { notes: note.trim() || null, mood_rating: mood })
      if (focus.trim()) await upsertDailyPlan(userId, tomorrow, { focus: focus.trim() })
      navigate(`/journal?date=${date}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="text-xs uppercase tracking-wide text-neutral-500">{longDayLabel(date)} — reviewed</div>
        <div className={`mt-1 text-3xl font-semibold tabular-nums ${pnlClass(net)}`}>{currency(net)}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-400">
          <span>{trades.length} trades</span>
          <span className="text-emerald-400">{planned} planned</span>
          <span className="text-amber-400">{unplanned} unplanned</span>
          {followed > 0 && <span className="text-sky-400">{followed} followed</span>}
        </div>
        {strengthCounts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {strengthCounts.map((m) => (
              <span key={m.tag} className="rounded-full bg-emerald-950/70 px-2 py-0.5 text-xs text-emerald-300">
                {m.tag} ×{m.count}
              </span>
            ))}
          </div>
        )}
        {leftOnTable > 0 && (
          <p className="mt-3 text-sm text-red-400">Execution leaks today: {currency(leftOnTable)} vs your planned exits.</p>
        )}
        {mistakeCounts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {mistakeCounts.map((m) => (
              <span key={m.tag} className="rounded-full bg-red-950/70 px-2 py-0.5 text-xs text-red-300">
                {m.tag} ×{m.count}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-emerald-500">No mistakes tagged today.</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-300">How did today go?</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="What did you do well? What pattern do you want to stop?"
            className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </label>
        <div className="flex gap-1.5">
          {MOODS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMood(mood === m.value ? null : m.value)}
              title={m.label}
              className={`flex-1 rounded-lg border py-1.5 text-lg transition ${
                mood === m.value ? 'border-blue-500 bg-blue-950/40' : 'border-neutral-700 opacity-60 hover:opacity-100'
              }`}
            >
              {m.emoji}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-300">Tomorrow's one focus</span>
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. No trades outside my watchlist"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
          <span className="text-xs text-neutral-600">Shows on {longDayLabel(tomorrow)}'s plan.</span>
        </label>
        <button
          onClick={handleFinish}
          disabled={saving}
          className="mt-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Finish review'}
        </button>
      </div>
    </div>
  )
}

/** The review queue: one closed trade at a time for a day -- chart on the left,
 * whose idea? / mistakes / setup / note / screenshot on the right, then the next trade.
 * Keyboard: P / U / F planned / unplanned / followed, Shift+1-6 done right, 1-7 mistakes, N or → next, ← back,
 * Ctrl+Enter next from the note box. */
export function ReviewPage() {
  const { user } = useAuth()
  const { selectedAccountId } = useAccountFilter()
  const [searchParams] = useSearchParams()
  const date = searchParams.get('date') ?? toDateStr(new Date())

  const [dayTrades, setDayTrades] = useState<TradeWithDetails[] | null>(null)
  const [setups, setSetups] = useState<Playbook[]>([])
  const [plan, setPlan] = useState<DailyPlanWithPlaybooks | null>(null)
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [queueIds, setQueueIds] = useState<string[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setDayTrades(null) // so the queue below rebuilds from the fresh load
    fetchTradesWithDetails(selectedAccountId).then((all) => {
      if (cancelled) return
      setDayTrades(
        all
          .filter((t) => t.status === 'CLOSED' && tradeDay(t) === date)
          .sort((a, b) => (a.first_in_at ?? '').localeCompare(b.first_in_at ?? '')),
      )
    })
    fetchPlaybooks().then((p) => !cancelled && setSetups(p ?? []))
    fetchDailyPlan(date).then((p) => !cancelled && setPlan(p))
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, date])

  // The queue is fixed when it's built, so marking a trade reviewed doesn't shift the
  // remaining trades out from under the current index.
  const loaded = dayTrades !== null
  useEffect(() => {
    if (!dayTrades) return
    setQueueIds(dayTrades.filter((t) => includeReviewed || !t.reviewed_at).map((t) => t.id))
    setIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only on load / toggle, not on every edit
  }, [loaded, includeReviewed])

  const updateTrade = useCallback((id: string, update: (t: TradeWithDetails) => TradeWithDetails) => {
    setDayTrades((prev) => (prev ? prev.map((t) => (t.id === id ? update(t) : t)) : prev))
  }, [])

  const current = useMemo(() => dayTrades?.find((t) => t.id === queueIds[index]) ?? null, [dayTrades, queueIds, index])
  const journal = useTradeJournal(current, user?.id, updateTrade)

  // A trade on a watchlist ticker starts out marked Planned -- one less tap; easy to flip.
  const watchlist = useMemo(() => watchlistSymbols(plan?.plan_notes), [plan])
  const currentId = current?.id
  const suggestPlanned = !!current && current.trade_origin === null && !current.reviewed_at && watchlist.has(current.symbol)
  useEffect(() => {
    if (suggestPlanned) journal.setOrigin('planned')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per trade shown
  }, [currentId, suggestPlanned])

  // Next with unanswered required sections warns once (highlighting them); pressing
  // Next again on the same trade moves on anyway, but the trade is only marked
  // reviewed once it's complete -- a skipped one stays "to review".
  const [warnedId, setWarnedId] = useState<string | null>(null)
  const { checklist } = useReviewChecklist()
  const keys = useMemo(() => shortcutTags(checklist), [checklist])
  const missing = current ? reviewMissing(current, setups, checklist) : []
  const warned = !!current && warnedId === current.id && missing.length > 0

  const next = useCallback(() => {
    if (!current) return
    if (missing.length > 0 && warnedId !== current.id) {
      setWarnedId(current.id)
      return
    }
    setWarnedId(null)
    if (!current.reviewed_at && missing.length === 0) {
      const reviewedAt = new Date().toISOString()
      updateTrade(current.id, (t) => ({ ...t, reviewed_at: reviewedAt }))
      updateTradeJournal(current.id, { reviewed_at: reviewedAt })
    }
    setIndex((i) => i + 1)
  }, [current, updateTrade, missing.length, warnedId])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        next()
        return
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      // Shift+digit gives '!' etc. in e.key, so match the physical key instead.
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1]
      if (e.shiftKey && digit && Number(digit) <= keys.good.length) {
        journal.toggleStrength(keys.good[Number(digit) - 1])
        e.preventDefault()
        return
      }
      const key = e.key.toLowerCase()
      const origin = ({ p: 'planned', u: 'unplanned', f: 'followed' } as const)[key as 'p' | 'u' | 'f']
      if (origin) journal.setOrigin(current.trade_origin === origin ? null : origin)
      else if (key === 'n' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= keys.bad.length) journal.toggleMistake(keys.bad[Number(e.key) - 1])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, journal, next, back, keys])

  if (dayTrades === null || !user) return <div className="text-neutral-500">Loading review…</div>

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link to={`/journal?date=${date}`} className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Journal
        </Link>
        <h1 className="text-lg font-semibold text-neutral-100">Review · {longDayLabel(date)}</h1>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-neutral-500">
        <input type="checkbox" checked={includeReviewed} onChange={(e) => setIncludeReviewed(e.target.checked)} />
        Include already-reviewed trades
      </label>
    </div>
  )

  if (dayTrades.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {header}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">
          No closed trades on this day.
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {header}
        <WrapUp date={date} trades={dayTrades} userId={user.id} />
      </div>
    )
  }

  const net = current.realized_pnl_net ?? 0
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {header}

      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1">
          {queueIds.map((id, i) => (
            <button
              key={id}
              onClick={() => setIndex(i)}
              className={`h-1.5 flex-1 rounded-full transition ${i === index ? 'bg-blue-500' : i < index ? 'bg-neutral-500' : 'bg-neutral-800'}`}
              aria-label={`Trade ${i + 1}`}
            />
          ))}
        </div>
        <span className="text-xs tabular-nums text-neutral-500">
          {index + 1} / {queueIds.length}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div>
              <Link to={`/trades/${current.id}`} className="text-lg font-semibold text-neutral-100 hover:underline">
                {current.symbol}{' '}
                {current.options_detail && (
                  <span className="text-base font-normal text-neutral-400">
                    {optionLabel(current.options_detail.strike, current.options_detail.option_type)}{' '}
                    {dteLabel(current.first_in_at, current.options_detail.expiration)}
                  </span>
                )}
              </Link>
              <div className="mt-1 text-xs text-neutral-500">
                {timeOnlyFmt(current.first_in_at)} · {current.side} {current.total_contracts ?? '—'} · in {priceFmt(current.avg_entry)} → out{' '}
                {priceFmt(current.avg_exit)} · held {holdTimeFmt(current.hold_seconds)}
              </div>
            </div>
            <div className={`text-2xl font-semibold tabular-nums ${pnlClass(net)}`}>{currency(net)}</div>
          </div>
          <TradeChart trade={current} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <TradeJournalPanel trade={current} journal={journal} setups={setups} shortcuts highlightMissing={warned} />
          </div>
          {warned && (
            <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              Still to answer: {missing.join(', ')}. Press Next again to skip — it stays “to review”.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={back}
              disabled={index === 0}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-30"
            >
              ←
            </button>
            <button
              onClick={next}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              {index + 1 === queueIds.length ? 'Done — wrap up the day' : 'Next trade'}
              <kbd className="ml-2 rounded border border-blue-400/50 px-1 text-[10px] text-blue-100">N</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
