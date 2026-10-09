import { useEffect, useMemo, useState } from 'react'
import type { TradeWithDetails } from '../lib/database.types'
import { fetchCandles, type CandleInterval, type CandleResult } from '../lib/candles'
import { priceFmt } from '../lib/format'
import { CandlestickChart, type ChartMarker } from './CandlestickChart'

const ACTION_LABEL: Record<string, string> = { entry: 'Open', add: 'Add', trim: 'Trim', exit: 'Close' }

/** Underlying-price candles around a trade with its fills marked -- shared by the
 * trade page and the review queue. */
export function TradeChart({ trade }: { trade: TradeWithDetails }) {
  const [interval, setCandleInterval] = useState<CandleInterval>('1min')
  const [result, setResult] = useState<CandleResult | null>(null)

  const executions = useMemo(
    () => [...trade.executions].sort((a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime()),
    [trade.executions],
  )

  useEffect(() => {
    if (executions.length === 0) return
    const first = executions[0]
    const last = executions[executions.length - 1]
    const from = new Date(new Date(first.filled_at).getTime() - 30 * 60_000)
    const to = new Date(new Date(trade.status === 'CLOSED' ? last.filled_at : Date.now()).getTime() + 30 * 60_000)
    // Stub fallback only: anchor near the underlying's likely price via the strike --
    // the option premium is on a totally different scale.
    const anchor = trade.options_detail?.strike ?? first.price

    let cancelled = false
    setResult(null)
    fetchCandles({ symbol: trade.symbol, from, to, interval, anchorLow: anchor, anchorHigh: anchor }).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [executions, trade.symbol, trade.status, trade.options_detail?.strike, interval])

  const markers: ChartMarker[] = useMemo(
    () =>
      executions.map((e) => ({
        time: Math.floor(new Date(e.filled_at).getTime() / 1000),
        position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: e.side === 'buy' ? '#3987e5' : '#eda100',
        shape: e.side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${ACTION_LABEL[e.action] ?? e.action} ${e.quantity}@${priceFmt(e.price)}`,
      })),
    [executions],
  )

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-300">
          {trade.symbol} <span className="font-normal text-neutral-500">underlying</span>
        </h2>
        <div className="flex items-center gap-3">
          {result?.source === 'stub' && (
            <span className="text-xs text-amber-400/80" title={result.error}>
              stub data — live feed unavailable
            </span>
          )}
          <div className="flex overflow-hidden rounded-md border border-neutral-700 text-xs">
            {(['1min', '5min'] as const).map((iv) => (
              <button
                key={iv}
                onClick={() => setCandleInterval(iv)}
                className={`px-2.5 py-1 transition ${
                  interval === iv ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                {iv === '1min' ? '1m' : '5m'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {result ? (
        <CandlestickChart candles={result.candles} markers={markers} />
      ) : (
        <div className="flex h-80 items-center justify-center text-sm text-neutral-500">Loading chart…</div>
      )}
    </div>
  )
}
