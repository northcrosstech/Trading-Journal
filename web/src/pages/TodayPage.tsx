import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchTradesWithDetails, fetchDailyPlan, fetchTargetSettings } from '../lib/queries'
import type { DailyPlanWithPlaybooks, TargetSettings, TradeWithDetails } from '../lib/database.types'
import { computeCalendarDays } from '../lib/metrics'
import { currency, holdTimeFmt, optionLabel, dteLabel, timeOnlyFmt } from '../lib/format'
import { toDateStr } from '../lib/dateRange'
import { tradeDay, longDayLabel } from '../lib/tradingDay'
import { PlanCard } from '../components/PlanCard'
import { TradeTags } from '../components/TradeTags'

function pnlClass(v: number) {
  return v > 0 ? 'text-(--status-good)' : v < 0 ? 'text-(--status-critical)' : 'text-neutral-300'
}

function RiskCard({
  closed,
  openCount,
  maxLoss,
  maxTrades,
}: {
  closed: TradeWithDetails[]
  openCount: number
  maxLoss: number | null
  maxTrades: number | null
}) {
  let net = 0
  let worst = 0
  for (const t of [...closed].sort((a, b) => (a.last_out_at ?? '').localeCompare(b.last_out_at ?? ''))) {
    net += t.realized_pnl_net ?? 0
    worst = Math.min(worst, net)
  }
  const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0).length
  const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0).length
  const tradeCount = closed.length + openCount
  const lossUsed = maxLoss ? Math.min(1, Math.max(0, -net) / maxLoss) : 0
  const maxLossHit = maxLoss !== null && net <= -maxLoss
  const overTrades = maxTrades !== null && tradeCount > maxTrades

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">Net P&L today</div>
        <div className={`mt-1 text-3xl font-semibold tabular-nums ${pnlClass(net)}`}>{currency(net)}</div>
        <div className="mt-1 text-xs text-neutral-500">
          {wins}W · {losses}L{openCount > 0 && ` · ${openCount} open`}
          {worst < 0 && <> · worst point <span className="text-neutral-300">{currency(worst)}</span></>}
        </div>
      </div>

      {maxLoss !== null && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-neutral-500">
            <span>Loss limit used</span>
            <span className="tabular-nums">
              {currency(Math.max(0, -net))} / {currency(maxLoss)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className={`h-full rounded-full ${lossUsed >= 1 ? 'bg-(--status-critical)' : lossUsed >= 0.6 ? 'bg-amber-500' : 'bg-neutral-500'}`}
              style={{ width: `${lossUsed * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex justify-between text-xs text-neutral-500">
        <span>Trades</span>
        <span className={`tabular-nums ${overTrades ? 'text-amber-400' : 'text-neutral-300'}`}>
          {tradeCount}
          {maxTrades !== null && ` / ${maxTrades}`}
        </span>
      </div>

      {maxLossHit && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm font-medium text-red-300">
          Max loss hit — you're done for today.
        </div>
      )}
      {!maxLossHit && overTrades && (
        <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Over your max trades. Only A+ setups from here.
        </div>
      )}
    </div>
  )
}

export function TodayPage() {
  const { user } = useAuth()
  const { selectedAccountId } = useAccountFilter()
  const today = toDateStr(new Date())
  const [trades, setTrades] = useState<TradeWithDetails[] | null>(null)
  const [plan, setPlan] = useState<DailyPlanWithPlaybooks | null>(null)
  const [settings, setSettings] = useState<TargetSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchTradesWithDetails(selectedAccountId)
      .then((t) => !cancelled && setTrades(t))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  useEffect(() => {
    fetchDailyPlan(today).then(setPlan)
    fetchTargetSettings().then(setSettings)
  }, [today])

  const todays = useMemo(
    () =>
      (trades ?? [])
        .filter((t) => tradeDay(t) === today)
        .sort((a, b) => (a.first_in_at ?? '').localeCompare(b.first_in_at ?? '')),
    [trades, today],
  )
  const closed = todays.filter((t) => t.status === 'CLOSED')
  const toReview = closed.filter((t) => !t.reviewed_at).length

  const recentDays = useMemo(() => {
    if (!trades) return []
    return Array.from(computeCalendarDays(trades).values())
      .filter((d) => d.date < today)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5)
      .reverse()
  }, [trades, today])

  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load trades: {error}</div>
  }
  if (trades === null || !user) {
    return <div className="text-neutral-500">Loading…</div>
  }

  const maxLoss = plan?.planned_max_loss ?? settings?.loss_limit_value ?? null

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">{longDayLabel(today)}</h1>
          <p className="text-sm text-neutral-500">Plan → trade → review.</p>
        </div>
        {toReview > 0 && (
          <Link
            to={`/review?date=${today}`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Review {toReview} trade{toReview === 1 ? '' : 's'} →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PlanCard date={today} userId={user.id} plan={plan} defaultMaxLoss={settings?.loss_limit_value ?? null} onSaved={setPlan} />
        </div>
        <RiskCard
          closed={closed}
          openCount={todays.length - closed.length}
          maxLoss={maxLoss}
          maxTrades={plan?.planned_max_trades ?? null}
        />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
          <h2 className="text-sm font-medium text-neutral-300">Today's trades</h2>
          {closed.length > 0 && toReview === 0 && <span className="text-xs text-emerald-500">All reviewed ✓</span>}
        </div>
        {todays.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">No trades yet today.</div>
        ) : (
          <div className="divide-y divide-neutral-800/60">
            {todays.map((t) => (
              <Link
                key={t.id}
                to={`/trades/${t.id}`}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-neutral-800/40"
              >
                <span className="w-20 shrink-0 text-xs tabular-nums text-neutral-500">{timeOnlyFmt(t.first_in_at)}</span>
                <span className="w-40 shrink-0 truncate font-medium text-neutral-100">
                  {t.symbol}
                  {t.options_detail && (
                    <span className="ml-1.5 text-xs font-normal text-neutral-500">
                      {optionLabel(t.options_detail.strike, t.options_detail.option_type)} {dteLabel(t.first_in_at, t.options_detail.expiration)}
                    </span>
                  )}
                </span>
                <span className="w-16 shrink-0 text-xs text-neutral-500">{holdTimeFmt(t.hold_seconds)}</span>
                <span className="min-w-0 flex-1">
                  <TradeTags trade={t} />
                </span>
                <span className={`w-24 shrink-0 text-right font-medium tabular-nums ${t.status === 'OPEN' ? 'text-neutral-500' : pnlClass(t.realized_pnl_net ?? 0)}`}>
                  {t.status === 'OPEN' ? 'OPEN' : currency(t.realized_pnl_net)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {recentDays.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-neutral-400">Recent days</h2>
          <div className="grid grid-cols-5 gap-2">
            {recentDays.map((d) => (
              <Link
                key={d.date}
                to={`/journal?date=${d.date}`}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 transition hover:border-neutral-700"
              >
                <div className="text-[11px] text-neutral-500">{longDayLabel(d.date)}</div>
                <div className={`text-sm font-semibold tabular-nums ${pnlClass(d.netPnl)}`}>{currency(d.netPnl)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
