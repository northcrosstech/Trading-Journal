import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchTradesWithDetails, fetchDailyPlan, fetchTargetSettings } from '../lib/queries'
import type { DailyPlanWithPlaybooks, TargetSettings, TradeWithDetails } from '../lib/database.types'
import { computeCalendarDays, entrySizeUsd, typicalPositionSize } from '../lib/metrics'
import { currency, percentFmt } from '../lib/format'
import { toDateStr } from '../lib/dateRange'
import { tradeDay, longDayLabel } from '../lib/tradingDay'
import { PlanCard } from '../components/PlanCard'
import { TradeRow } from '../components/TradeRow'
import { ORIGINS, ORIGIN_TEXT } from '../lib/origin'
import { CalendarDays, CheckCircle2, ClipboardCheck, Plus } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { ButtonLink } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { EmptyState } from '../components/ui/EmptyState'

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
  // Same denominator as each row's % (entry size), so this is the capital-weighted
  // average of the per-trade returns -- not a % of account balance, which isn't tracked.
  let deployed = 0
  let deployedNet = 0
  for (const t of closed) {
    const size = entrySizeUsd(t)
    if (!size || t.realized_pnl_net === null) continue
    deployed += size
    deployedNet += t.realized_pnl_net
  }
  const returnOnDeployed = deployed > 0 ? deployedNet / deployed : null
  const wins = closed.filter((t) => (t.realized_pnl_net ?? 0) > 0).length
  const losses = closed.filter((t) => (t.realized_pnl_net ?? 0) < 0).length
  const tradeCount = closed.length + openCount
  const lossUsed = maxLoss ? Math.min(1, Math.max(0, -net) / maxLoss) : 0
  const maxLossHit = maxLoss !== null && net <= -maxLoss
  const overTrades = maxTrades !== null && tradeCount > maxTrades

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-(--border) bg-(--card) p-5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${net > 0 ? 'bg-(--status-good)' : net < 0 ? 'bg-(--status-critical)' : 'bg-(--accent)'}`} />
      <div>
        <div className="text-xs font-medium text-neutral-400">Net P&L today</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`text-4xl font-semibold tracking-tight tabular-nums ${pnlClass(net)}`}>{currency(net)}</span>
          {returnOnDeployed !== null && (
            <span
              className={`text-sm font-medium tabular-nums ${pnlClass(returnOnDeployed)}`}
              title={`Return on ${currency(deployed)} of capital deployed across today's closed trades`}
            >
              {percentFmt(returnOnDeployed)}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <Pill tone="green">{wins}W</Pill>
          <Pill tone="red">{losses}L</Pill>
          {openCount > 0 && <Pill tone="blue">{openCount} open</Pill>}
          {worst < 0 && (
            <span className="ml-1">
              worst point <span className="text-neutral-300">{currency(worst)}</span>
            </span>
          )}
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

      <div className="flex justify-between border-t border-(--border) pt-3 text-xs text-neutral-500">
        <span>Trades today</span>
        <span className={`tabular-nums ${overTrades ? 'text-amber-400' : 'text-neutral-300'}`}>
          {tradeCount}
          {maxTrades !== null && ` / ${maxTrades}`}
        </span>
      </div>

      {maxLossHit && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300">
          Max loss hit — you're done for today.
        </div>
      )}
      {!maxLossHit && overTrades && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
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
  const usualSize = useMemo(() => typicalPositionSize(trades ?? [], today), [trades, today])
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
    return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load trades: {error}</div>
  }
  if (trades === null || !user) {
    return <div className="text-neutral-500">Loading…</div>
  }

  const maxLoss = plan?.planned_max_loss ?? settings?.loss_limit_value ?? null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={longDayLabel(today)}
        subtitle="Plan → trade → review."
        actions={
          <>
            <ButtonLink to="/trades/new" icon={<Plus size={16} />}>
              Add trade
            </ButtonLink>
            {toReview > 0 ? (
              <ButtonLink to={`/review?date=${today}`} variant="primary" icon={<ClipboardCheck size={16} />}>
                Review {toReview} trade{toReview === 1 ? '' : 's'}
              </ButtonLink>
            ) : (
              closed.length > 0 && (
                <Pill tone="green">
                  <CheckCircle2 size={12} /> All reviewed
                </Pill>
              )
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RiskCard
          closed={closed}
          openCount={todays.length - closed.length}
          maxLoss={maxLoss}
          maxTrades={plan?.planned_max_trades ?? null}
        />
        <div className="lg:col-span-2">
          <PlanCard date={today} userId={user.id} plan={plan} defaultMaxLoss={settings?.loss_limit_value ?? null} onSaved={setPlan} />
        </div>
      </div>

      <Card
        title="Today’s trades"
        subtitle={
          <span className="flex flex-wrap gap-3">
            {ORIGINS.map((o) => (
              <span key={o.value} className={ORIGIN_TEXT[o.value]}>
                ● {o.label}
              </span>
            ))}
          </span>
        }
        flush
      >
        {todays.length === 0 ? (
          <EmptyState icon={<CalendarDays size={20} />} title="No trades yet today">
            Trades sync from Webull every 15 minutes during market hours — or add one by hand.
          </EmptyState>
        ) : (
          <div className="divide-y divide-(--border) border-t border-(--border)">
            {todays.map((t) => (
              <TradeRow key={t.id} trade={t} usualSize={usualSize} />
            ))}
          </div>
        )}
      </Card>

      {recentDays.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">Recent days</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {recentDays.map((d) => (
              <Link
                key={d.date}
                to={`/journal?date=${d.date}`}
                className={`rounded-2xl border px-4 py-3 transition hover:-translate-y-0.5 ${
                  d.netPnl > 0
                    ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40'
                    : d.netPnl < 0
                      ? 'border-red-500/20 bg-red-500/5 hover:border-red-500/40'
                      : 'border-(--border) bg-(--card) hover:border-(--border-strong)'
                }`}
              >
                <div className="text-xs text-neutral-400">{longDayLabel(d.date)}</div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${pnlClass(d.netPnl)}`}>{currency(d.netPnl)}</div>
                <div className="text-xs text-neutral-500">
                  {d.tradeCount} trade{d.tradeCount === 1 ? '' : 's'}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
