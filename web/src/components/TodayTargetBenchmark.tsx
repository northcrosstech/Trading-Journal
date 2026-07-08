import { Link } from 'react-router-dom'
import type { DailyTargetResult, TargetSettingsInput } from '../lib/metrics'
import { currency, percentFmt } from '../lib/format'

function resolveRange(target: number | null, lossLimit: number | null): [number, number] {
  if (target !== null && lossLimit !== null) return [-lossLimit, target]
  if (target !== null) return [-target, target]
  if (lossLimit !== null) return [-lossLimit, lossLimit]
  return [-1, 1] // unreachable given the caller's guard, kept only so the type is total
}

function clampPct(value: number, min: number, max: number): number {
  if (max === min) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

type Props = {
  settings: TargetSettingsInput
  today: DailyTargetResult | undefined
}

/** Today's live profit-target / loss-limit benchmark -- a horizontal bar from the
 * loss limit to the profit target with today's realized net P&L marked, plus a
 * fainter marker at today's intraday realized peak (see computeDailyTargetStats for
 * why that peak is realized-only, not mark-to-market). */
export function TodayTargetBenchmark({ settings, today }: Props) {
  const target = settings.profit_target_value
  const lossLimit = settings.loss_limit_value

  if (target === null && lossLimit === null) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-500">
        Set a daily profit target or loss limit in{' '}
        <Link to="/settings" className="text-blue-400 hover:underline">
          Settings
        </Link>{' '}
        to see today's live benchmark.
      </div>
    )
  }

  const todayPnl = today?.netPnlClose ?? 0
  const todayPeak = today?.intradayPeakRealized ?? 0
  const [min, max] = resolveRange(target, lossLimit)

  const zeroPct = clampPct(0, min, max)
  const pnlPct = clampPct(todayPnl, min, max)
  const peakPct = clampPct(todayPeak, min, max)
  const showPeakMarker = Math.abs(todayPeak - todayPnl) > 0.01

  const fillFrom = Math.min(zeroPct, pnlPct)
  const fillWidth = Math.abs(pnlPct - zeroPct)
  const fillColor = todayPnl >= 0 ? 'var(--status-good)' : 'var(--status-critical)'

  const targetPct = target !== null ? todayPnl / target : null
  const toGo = target !== null ? target - todayPnl : null
  const lossDistance = lossLimit !== null ? todayPnl + lossLimit : null // distance above the floor; negative = breached

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-sm font-medium text-neutral-300">Today's Benchmark</h2>

      <div className="relative mb-2 h-2.5 rounded-full bg-neutral-800">
        <div
          className="absolute top-0 h-full rounded-full"
          style={{ left: `${fillFrom}%`, width: `${fillWidth}%`, backgroundColor: fillColor }}
        />
        <div className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-neutral-600" style={{ left: `${zeroPct}%` }} />
        {showPeakMarker && (
          <div
            title={`Intraday peak: ${currency(todayPeak)}`}
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-neutral-400 opacity-60"
            style={{ left: `${peakPct}%` }}
          />
        )}
        <div
          title={`Today: ${currency(todayPnl)}`}
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950"
          style={{ left: `${pnlPct}%`, backgroundColor: fillColor }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-neutral-600">
        <span>{lossLimit !== null ? currency(-lossLimit) : ''}</span>
        <span>$0</span>
        <span>{target !== null ? currency(target) : ''}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        <span className="font-semibold tabular-nums" style={{ color: fillColor }}>
          Today {todayPnl >= 0 ? '+' : ''}
          {currency(todayPnl)}
        </span>
        {target !== null && (
          <>
            <span className="text-neutral-500">
              / {currency(target)} target ({percentFmt(targetPct)})
            </span>
            <span className="text-neutral-500">
              · {toGo !== null && toGo <= 0 ? 'target hit!' : `${currency(toGo)} to go`}
            </span>
          </>
        )}
        {lossLimit !== null && (
          <span className={lossDistance !== null && lossDistance <= 0 ? 'text-(--status-critical)' : 'text-neutral-500'}>
            · {lossDistance !== null && lossDistance <= 0
              ? `loss limit breached by ${currency(Math.abs(lossDistance))}`
              : `${currency(lossDistance)} above loss limit`}
          </span>
        )}
      </div>
    </div>
  )
}
