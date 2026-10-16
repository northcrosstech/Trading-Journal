import { Link } from 'react-router-dom'
import type { Trade, TradeWithDetails } from '../lib/database.types'
import { computeCostBasisAnalysis, returnOnCapitalPct, OVERSIZE_RATIO } from '../lib/metrics'
import { currency, holdTimeFmt, optionLabel, dteLabel, timeOnlyFmt, percentFmt } from '../lib/format'
import { ReviewChecks } from './ReviewChecks'
import { ORIGIN_LABEL, ORIGIN_TEXT } from '../lib/origin'

function pnlClass(v: number) {
  return v > 0 ? 'text-(--status-good)' : v < 0 ? 'text-(--status-critical)' : 'text-neutral-300'
}

/** One trade in a day list (Today, Journal): time, contract (ticker tinted by
 * planned / unplanned / followed), hold, review checks,
 * position size, net P&L and return %. `usualSize` is the trader's typical position
 * size per asset type as of that day (see typicalPositionSize) -- positions at
 * OVERSIZE_RATIO or more of it get flagged. */
export function TradeRow({
  trade: t,
  usualSize,
}: {
  trade: TradeWithDetails
  usualSize: Map<Trade['asset_type'], number>
}) {
  const pos = computeCostBasisAnalysis(t).peakExposureUsd
  const returnPct = t.status === 'CLOSED' ? returnOnCapitalPct(t) : null
  const usual = usualSize.get(t.asset_type) ?? null
  const sizeRatio = pos !== null && usual ? pos / usual : null
  const oversized = sizeRatio !== null && sizeRatio >= OVERSIZE_RATIO
  const origin = t.trade_origin

  return (
    <Link to={`/trades/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-neutral-800/40">
      <span className="w-20 shrink-0 text-xs tabular-nums text-neutral-500">{timeOnlyFmt(t.first_in_at)}</span>
      <span className="w-40 shrink-0 truncate font-medium">
        <span className={origin ? ORIGIN_TEXT[origin] : 'text-neutral-100'} title={origin ? ORIGIN_LABEL[origin] : 'Not reviewed yet'}>
          {t.symbol}
        </span>
        {t.options_detail && (
          <span className="ml-1.5 text-xs font-normal text-neutral-500">
            {optionLabel(t.options_detail.strike, t.options_detail.option_type)} {dteLabel(t.first_in_at, t.options_detail.expiration)}
          </span>
        )}
      </span>
      <span className="w-16 shrink-0 text-xs text-neutral-500">{holdTimeFmt(t.hold_seconds)}</span>
      <span className="min-w-0 flex-1">
        <ReviewChecks trade={t} />
      </span>
      <span
        className={`w-24 shrink-0 text-right text-xs tabular-nums ${oversized ? 'font-medium text-amber-400' : 'text-neutral-400'}`}
        title={
          oversized
            ? `${sizeRatio!.toFixed(1)}× your usual size (median ${currency(usual)} over your recent ${t.asset_type} trades)`
            : 'Position size: peak dollar capital committed at any single moment'
        }
      >
        {oversized && '⚠ '}
        {pos !== null ? currency(pos) : '—'}
      </span>
      <span className={`w-24 shrink-0 text-right font-medium tabular-nums ${t.status === 'OPEN' ? 'text-neutral-500' : pnlClass(t.realized_pnl_net ?? 0)}`}>
        {t.status === 'OPEN' ? 'OPEN' : currency(t.realized_pnl_net)}
      </span>
      <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${returnPct === null ? 'text-neutral-500' : pnlClass(returnPct)}`}>
        {returnPct === null ? '—' : percentFmt(returnPct)}
      </span>
    </Link>
  )
}
