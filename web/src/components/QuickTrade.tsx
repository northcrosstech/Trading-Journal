import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { HoldingView } from '../lib/portfolio'
import { signedCurrency as signed } from '../lib/portfolio'
import { portfolioTrades, type TradeLine } from '../lib/wealthQueries'
import { centralDateStr, currency } from '../lib/format'
import { INPUT_SM, toneClass } from '../lib/ui'
import { Button } from './ui/Button'

type Side = 'buy' | 'sell'
/** autoPrice: the price was filled in for you, so it follows the ticker until you type one. */
type Line = { key: number; symbol: string; side: Side; qty: string; price: string; fee: string; autoPrice: boolean }

const num = (s: string) => {
  const t = s.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const fmtQty = (n: number) => String(Number(n.toFixed(6)))
/** The small input style at a fixed width (the shared one fills its container). */
const BOX = INPUT_SM.replace('w-full ', '')
const priceText = (p: number | null) => (p === null ? '' : String(Number(p.toFixed(4))))

/** Log buys and sells right from the holdings list: opens under the position you clicked,
 * already filled in, and "+ Add another" adds more lines. Log saves every line together --
 * or none, with the failing line marked. */
export function QuickTrade({
  portfolioId,
  views,
  priceOf,
  cash,
  symbol,
  onDone,
  onCancel,
}: {
  portfolioId: string
  views: HoldingView[]
  /** Latest known price for a ticker (to fill in the price), null if none. */
  priceOf: (symbol: string) => number | null
  cash: number
  /** The position clicked; '' = a new ticker. */
  symbol: string
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [nextKey, setNextKey] = useState(1)
  const [lines, setLines] = useState<Line[]>([{ key: 0, symbol, side: 'buy', qty: '', price: priceText(symbol ? priceOf(symbol) : null), fee: '', autoPrice: true }])
  const [on, setOn] = useState(centralDateStr(new Date()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ line: number | null; message: string } | null>(null)

  const held = (s: string) => views.find((v) => v.holding.symbol === s.trim().toUpperCase())?.holding
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function addLine() {
    setLines((ls) => [...ls, { key: nextKey, symbol: '', side: 'buy', qty: '', price: '', fee: '', autoPrice: true }])
    setNextKey((k) => k + 1)
  }

  /** Cash effect and, for a sale, the gain -- both after the fee. */
  function result(l: Line): { cash: number; gain: number | null } | null {
    const q = num(l.qty)
    const p = num(l.price)
    if (q === null || p === null || q <= 0) return null
    const fee = num(l.fee) ?? 0
    if (l.side === 'buy') return { cash: -(q * p + fee), gain: null }
    const h = held(l.symbol)
    const proceeds = q * p - fee
    return { cash: proceeds, gain: h ? proceeds - q * Number(h.avg_cost) : null }
  }
  const cashAfter = cash + lines.reduce((s, l) => s + (result(l)?.cash ?? 0), 0)

  async function log() {
    setError(null)
    const trades: TradeLine[] = []
    for (const [i, l] of lines.entries()) {
      const fail = (message: string) => setError({ line: i, message })
      const sym = l.symbol.trim().toUpperCase()
      const q = num(l.qty)
      const p = num(l.price)
      const fee = num(l.fee) ?? 0
      if (!sym) return fail('Enter a ticker.')
      if (q === null || q <= 0) return fail('Enter the number of shares.')
      if (p === null || p < 0) return fail('Enter the price per share.')
      if (fee < 0) return fail('The fee can’t be negative.')
      trades.push({ symbol: sym, side: l.side, quantity: q, price: p, fee, on })
    }
    setBusy(true)
    try {
      await portfolioTrades(portfolioId, trades)
      onDone(
        trades.length === 1
          ? `${trades[0].side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(trades[0].quantity)} ${trades[0].symbol}`
          : `Logged ${trades.length} trades`,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const m = /^Line (\d+) \([^)]*\): (.*)$/s.exec(message)
      setError(m ? { line: Number(m[1]) - 1, message: m[2] } : { line: null, message })
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !busy) log()
    else if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const h = held(l.symbol)
          const r = result(l)
          const bad = error?.line === i
          return (
            <div key={l.key} className={`flex flex-wrap items-center gap-2 rounded-lg p-1 ${bad ? 'bg-red-500/10 ring-1 ring-red-500/40' : ''}`}>
              <input
                value={l.symbol}
                onChange={(e) => {
                  const s = e.target.value.toUpperCase()
                  update(l.key, { symbol: s, ...(l.autoPrice || l.price === '' ? { price: priceText(priceOf(s.trim())), autoPrice: true } : {}) })
                }}
                autoFocus={i > 0 || symbol === ''}
                placeholder="Ticker"
                aria-label="Ticker"
                className={`${BOX} w-24 font-semibold uppercase`}
              />
              <span className="inline-flex rounded-lg bg-(--card-raised) p-0.5 text-xs">
                {(['buy', 'sell'] as Side[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => update(l.key, { side: s })}
                    className={`rounded-md px-2.5 py-1 font-medium transition ${l.side === s ? (s === 'buy' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200') : 'text-neutral-400 hover:text-white'}`}
                  >
                    {s === 'buy' ? 'Bought' : 'Sold'}
                  </button>
                ))}
              </span>
              <span className="flex items-center gap-1">
                <input
                  value={l.qty}
                  onChange={(e) => update(l.key, { qty: e.target.value })}
                  autoFocus={i === 0 && symbol !== ''}
                  inputMode="decimal"
                  placeholder="Shares"
                  aria-label="Shares"
                  className={`${BOX} w-24 text-right tabular-nums`}
                />
                {l.side === 'sell' && h && (
                  <button type="button" onClick={() => update(l.key, { qty: fmtQty(Number(h.quantity)) })} className="rounded-md px-1.5 py-1 text-xs text-(--accent-text) hover:bg-(--card-raised)" title={`Sell all ${fmtQty(Number(h.quantity))}`}>
                    All
                  </button>
                )}
              </span>
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                @
                <input value={l.price} onChange={(e) => update(l.key, { price: e.target.value, autoPrice: false })} inputMode="decimal" placeholder="Price" aria-label="Price per share" className={`${BOX} w-24 text-right tabular-nums`} />
              </label>
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                fee
                <input value={l.fee} onChange={(e) => update(l.key, { fee: e.target.value })} inputMode="decimal" placeholder="0" aria-label="Fee" className={`${BOX} w-16 text-right tabular-nums`} />
              </label>
              <span className="min-w-28 text-xs tabular-nums">
                {r && (r.gain !== null ? <span className={toneClass(r.gain)}>{r.gain >= 0 ? 'gain' : 'loss'} {signed(r.gain)}</span> : <span className="text-neutral-400">cash {signed(r.cash)}</span>)}
              </span>
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded-md p-1 text-neutral-500 hover:bg-(--card-raised) hover:text-white" title="Remove this line">
                  <X size={14} />
                </button>
              )}
              {bad && <span className="basis-full px-1 text-xs text-red-300">{error.message}</span>}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border) pt-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addLine}>
            Add another
          </Button>
          <label className="flex items-center gap-1.5">
            Date
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={`${BOX} w-auto`} />
          </label>
          <span className="tabular-nums">
            Cash {currency(cash)} → <span className={cashAfter < 0 ? 'text-amber-300' : 'text-neutral-200'}>{currency(cashAfter)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error && error.line === null && <span className="text-xs text-red-300">{error.message}</span>}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={log} disabled={busy}>
            {busy ? 'Saving…' : lines.length > 1 ? `Log ${lines.length} trades` : 'Log'}
          </Button>
        </div>
      </div>
    </div>
  )
}
