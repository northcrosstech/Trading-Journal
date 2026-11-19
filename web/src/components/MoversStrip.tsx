import { useMemo, useState } from 'react'
import { dayChangeLabel, signedCurrency, type HoldingView } from '../lib/portfolio'
import { hasDayMoves, movers, pricedCount, type Mover, type MoverMode } from '../lib/movers'
import { percentFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { Segmented } from './ui/Tabs'

const CHIP_TONE = {
  up: 'border-(--status-good)/30 bg-(--status-good)/10',
  down: 'border-(--status-critical)/30 bg-(--status-critical)/10',
}

/** One holding: ticker, then dollars over percent, as the Gain column stacks them. The third
 * chip of a side only shows where the strip is wide enough to stay on one row. */
function Chip({ m, third, onShow }: { m: Mover; third: boolean; onShow?: (id: string) => void }) {
  const tone = toneClass(m.dollars)
  const cls = `${third ? 'hidden @min-[70rem]:inline-flex' : 'inline-flex'} shrink-0 items-center gap-2 rounded-md border px-1.5 py-0.5 text-xs ${CHIP_TONE[m.dollars > 0 ? 'up' : 'down']}`
  const body = (
    <>
      <span className="font-semibold text-white">{m.symbol}</span>
      <span className={`flex flex-col items-end leading-tight tabular-nums ${tone}`}>
        <span className="font-medium">{signedCurrency(m.dollars)}</span>
        {m.pct !== null && <span className="text-[11px]">{percentFmt(m.pct)}</span>}
      </span>
    </>
  )
  if (!onShow) return <span className={cls}>{body}</span>
  return (
    <button type="button" onClick={() => onShow(m.id)} title={`Show ${m.symbol} in the table`} className={`${cls} text-left transition hover:brightness-125`}>
      {body}
    </button>
  )
}

/** The holdings that have made and lost the most, in one row above the holdings table: gain
 * against cost, or the latest day's change. Renders nothing with fewer than three priced
 * holdings. `onShow` (optional) takes a holding id to scroll the table to. */
export function MoversStrip({ views, asOf, onShow }: { views: HoldingView[]; asOf: string | null; onShow?: (id: string) => void }) {
  const [picked, setPicked] = useState<MoverMode>('total')
  const dayOk = useMemo(() => hasDayMoves(views, asOf), [views, asOf])
  const mode: MoverMode = dayOk ? picked : 'total'
  const { up, down } = useMemo(() => movers(views, mode, asOf), [views, mode, asOf])
  if (pricedCount(views) < 3) return null

  const quiet = 'text-xs text-neutral-500'
  return (
    <div className="@container">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-5 pb-3">
        <span className="mr-1 text-[11px] text-neutral-500">Biggest gains and losses</span>
        {up.length === 0 && down.length === 0 ? (
          <span className={quiet}>Nothing is up or down</span>
        ) : (
          <>
            {up.length === 0 ? <span className={quiet}>Nothing is up</span> : up.map((m, i) => <Chip key={m.id} m={m} third={i === 2} onShow={onShow} />)}
            <span className="mx-1 h-4 w-px bg-(--border-strong)" aria-hidden />
            {down.length === 0 ? <span className={quiet}>Nothing is down</span> : down.map((m, i) => <Chip key={m.id} m={m} third={i === 2} onShow={onShow} />)}
          </>
        )}
        {dayOk && (
          <span className="ml-auto">
            <Segmented<MoverMode>
              size="sm"
              options={[
                { value: 'total', label: 'Total' },
                { value: 'day', label: dayChangeLabel(asOf) },
              ]}
              value={mode}
              onChange={setPicked}
            />
          </span>
        )}
      </div>
    </div>
  )
}
