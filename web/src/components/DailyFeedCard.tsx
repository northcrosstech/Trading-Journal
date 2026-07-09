import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DailyFeedEntry, PlanVsActual } from '../lib/metrics'
import type { DailyJournal } from '../lib/database.types'
import { currency, optionLabel, timeOnlyFmt } from '../lib/format'
import { MiniSparkline } from './MiniSparkline'

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
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type Props = {
  entry: DailyFeedEntry
  journal: DailyJournal | null
  expanded: boolean
  onToggle: () => void
  onSave: (date: string, fields: { notes?: string; mood_rating?: number | null }) => void
  planComparison?: PlanVsActual // only passed when a pre-market plan exists for this day
}

export const DailyFeedCard = forwardRef<HTMLDivElement, Props>(function DailyFeedCard(
  { entry, journal, expanded, onToggle, onSave, planComparison },
  ref,
) {
  const [notes, setNotes] = useState(journal?.notes ?? '')
  const [mood, setMood] = useState<number | null>(journal?.mood_rating ?? null)
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setNotes(journal?.notes ?? '')
    setMood(journal?.mood_rating ?? null)
    setSaved(true)
  }, [journal])

  const save = useCallback(
    (fields: { notes?: string; mood_rating?: number | null }) => {
      setSaved(false)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onSave(entry.date, fields)
        setSaved(true)
      }, 600)
    },
    [entry.date, onSave],
  )

  const hasNote = !!journal?.notes?.trim()
  const netTone = entry.netPnl >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'

  return (
    <div ref={ref} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 scroll-mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-medium text-neutral-200">{dateHeading(entry.date)}</div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {entry.closedTrades.length} trade{entry.closedTrades.length === 1 ? '' : 's'} · {entry.wins}W {entry.losses}L
              {entry.winRate !== null && ` · ${(entry.winRate * 100).toFixed(0)}% win`}
              {hasNote && <span className="ml-1.5 text-neutral-600">· noted</span>}
            </div>
          </div>
          {entry.equityPoints.length > 1 && (
            <MiniSparkline points={entry.equityPoints.map((p) => p.cumulative)} />
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={`text-lg font-semibold tabular-nums ${netTone}`}>
              {currency(entry.netPnl)}
              {entry.anyEstimated && <span title="includes estimated fees">*</span>}
            </div>
            <div className="text-[11px] text-neutral-500">
              PF {entry.profitFactor === null ? '—' : entry.profitFactor === Infinity ? '∞' : entry.profitFactor.toFixed(2)}
              {' · '}fees {currency(entry.fees)}
            </div>
          </div>
          <button
            onClick={onToggle}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
          >
            {expanded ? 'Close' : hasNote ? 'View Note' : 'Add Note'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 flex flex-col gap-4 border-t border-neutral-800 pt-4">
          {planComparison && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
              <div className="mb-1.5 text-xs font-medium text-neutral-400">Plan vs Reality</div>
              <div className="flex flex-col gap-1 text-sm text-neutral-300">
                {planComparison.plannedMaxTrades !== null && (
                  <div>
                    Planned {planComparison.plannedMaxTrades} trade{planComparison.plannedMaxTrades === 1 ? '' : 's'}, took{' '}
                    <span className={planComparison.followedTradeLimit === false ? 'font-medium text-(--status-critical)' : ''}>
                      {planComparison.actualTradeCount}
                    </span>
                  </div>
                )}
                {planComparison.plannedMaxLoss !== null && (
                  <div>
                    Planned {currency(-planComparison.plannedMaxLoss)} max, hit{' '}
                    <span className={planComparison.followedLossLimit === false ? 'font-medium text-(--status-critical)' : ''}>
                      {currency(planComparison.actualWorstPoint)}
                    </span>
                  </div>
                )}
              </div>
              {(planComparison.offPlanSetupIds.length > 0 || planComparison.untradedSetupIds.length > 0) && (
                <div className="mt-1.5 text-xs text-neutral-500">
                  {planComparison.untradedSetupIds.length > 0 &&
                    `${planComparison.untradedSetupIds.length} planned setup${planComparison.untradedSetupIds.length === 1 ? '' : 's'} not traded`}
                  {planComparison.untradedSetupIds.length > 0 && planComparison.offPlanSetupIds.length > 0 && ' · '}
                  {planComparison.offPlanSetupIds.length > 0 &&
                    `${planComparison.offPlanSetupIds.length} off-plan setup${planComparison.offPlanSetupIds.length === 1 ? '' : 's'} traded`}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-400">Mood</span>
              <span className="text-[11px] text-neutral-600">{saved ? 'Saved' : 'Saving…'}</span>
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
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition ${
                    mood === m.value ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'bg-neutral-800 hover:bg-neutral-700'
                  }`}
                >
                  {m.emoji}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              save({ notes: e.target.value })
            }}
            placeholder="How did today go? What did you notice about your process?"
            rows={4}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />

          {entry.trades.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-neutral-400">Trades this day</div>
              <div className="flex flex-col divide-y divide-neutral-800/60">
                {entry.trades.map((t) => (
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
      )}
    </div>
  )
})
