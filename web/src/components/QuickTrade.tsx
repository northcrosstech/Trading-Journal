import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { HoldingView } from '../lib/portfolio'
import { signedCurrency as signed } from '../lib/portfolio'
import { portfolioTrades, type TradeLine } from '../lib/wealthQueries'
import { centralDateStr, currency } from '../lib/format'
import { INPUT_SM, toneClass } from '../lib/ui'
import { parsePastedTrades } from '../lib/pasteTrades'
import { Button } from './ui/Button'

type Side = 'buy' | 'sell'
/** A line to start the form with: the row clicked, a plan suggestion, or several of them. */
export type QuickLine = { symbol: string; side?: Side; qty?: number }
/** autoPrice: the price was filled in for you, so it follows the ticker until you type one.
 * focus: the field that takes the cursor when the line appears. */
type Line = { key: number; symbol: string; side: Side; qty: string; price: string; fee: string; autoPrice: boolean; focus: 'symbol' | 'qty' | 'price' | null }

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
 * already filled in, and "+ Add another" adds more lines. Rows copied from a broker or a
 * spreadsheet can be pasted in, one line each. Log saves every line together -- or none,
 * with the failing line marked. */
export function QuickTrade({
  portfolioId,
  views,
  priceOf,
  cash,
  setAside = 0,
  symbol,
  preset,
  onDone,
  onCancel,
  onEscape,
  onDirtyChange,
}: {
  portfolioId: string
  views: HoldingView[]
  /** Latest known price for a ticker (to fill in the price), null if none. */
  priceOf: (symbol: string) => number | null
  cash: number
  /** Cash held back for open puts: buying into it is flagged, not blocked. */
  setAside?: number
  /** The position clicked; '' = a new ticker. */
  symbol: string
  /** Lines filled in for you (the plan's suggested trades). Without it: one line for `symbol`. */
  preset?: QuickLine[] | null
  onDone: (message: string) => void
  onCancel: () => void
  /** Esc was pressed. Defaults to onCancel; the page uses it to ask before dropping typed lines. */
  onEscape?: () => void
  /** Told true once something has been typed or pasted, false when the form goes away. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [lines, setLines] = useState<Line[]>(() => {
    const start: QuickLine[] = preset && preset.length > 0 ? preset : [{ symbol }]
    return start.map((p, i) => ({
      key: i,
      symbol: p.symbol,
      side: p.side ?? 'buy',
      qty: p.qty ? String(p.qty) : '',
      price: priceText(p.symbol ? priceOf(p.symbol) : null),
      fee: '',
      autoPrice: true,
      // Several suggested lines: the prices are what needs checking. One line: the first blank.
      focus: i > 0 ? null : start.length > 1 ? 'price' : p.symbol === '' ? 'symbol' : 'qty',
    }))
  })
  const nextKey = useRef(lines.length)
  const [on, setOn] = useState(centralDateStr(new Date()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ line: number | null; message: string } | null>(null)
  const [pasteNote, setPasteNote] = useState<string | null>(null)

  const touched = useRef(false)
  const dirtyChange = useRef(onDirtyChange)
  useEffect(() => {
    dirtyChange.current = onDirtyChange
  })
  useEffect(() => () => dirtyChange.current?.(false), [])
  const touch = () => {
    if (touched.current) return
    touched.current = true
    onDirtyChange?.(true)
  }

  const held = (s: string) => views.find((v) => v.holding.symbol === s.trim().toUpperCase())?.holding
  const update = (key: number, patch: Partial<Line>) => {
    touch()
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    const key = nextKey.current++
    setLines((ls) => [...ls, { key, symbol: '', side: 'buy', qty: '', price: '', fee: '', autoPrice: true, focus: 'symbol' }])
  }

  /** Rows pasted from a broker or spreadsheet become one line each. A single value (a
   * ticker, a price) is not a row, so it pastes into the field as usual. */
  function onPaste(e: React.ClipboardEvent) {
    const t = e.target
    if (!(t instanceof HTMLInputElement) || t.type === 'date') return
    const parsed = parsePastedTrades(e.clipboardData.getData('text'))
    if (!parsed) return
    e.preventDefault()
    const typedBefore = touched.current
    touch()
    const added: Line[] = parsed.trades.map((p, i) => ({
      key: nextKey.current++,
      symbol: p.symbol,
      side: p.side,
      qty: fmtQty(p.qty),
      price: priceText(p.price),
      fee: '',
      autoPrice: false,
      focus: i === 0 ? 'qty' : null,
    }))
    // Lines still waiting for a share count give way to the pasted rows: the blank ones
    // always, the starting line too if nothing had been typed yet.
    setLines((ls) => [...ls.filter((l) => l.qty.trim() !== '' || (typedBefore && l.symbol.trim() !== '')), ...added])
    setError(null)
    const n = parsed.trades.length
    setPasteNote(
      `Pasted ${n} ${n === 1 ? 'row' : 'rows'}: check ${n === 1 ? 'it' : 'them'} before you log.` +
        (parsed.skipped > 0 ? ` ${parsed.skipped} ${parsed.skipped === 1 ? 'row' : 'rows'} couldn’t be read and ${parsed.skipped === 1 ? 'was' : 'were'} left out.` : ''),
    )
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
  // Display only: what spending past the free cash means. Nothing is blocked.
  const cashNote = cashAfter >= cash ? null : cashAfter < 0 ? 'the rest shows as margin' : cashAfter < setAside ? `uses cash set aside for puts (${currency(setAside)})` : null

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
    if (e.key === 'Escape') return (onEscape ?? onCancel)()
    // Enter saves only from a field you type in: on a button it presses that button, and on
    // the date field it belongs to the date picker.
    const t = e.target
    if (e.key === 'Enter' && !busy && t instanceof HTMLInputElement && t.type !== 'date') log()
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex flex-col gap-2" onPaste={onPaste}>
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
                autoFocus={l.focus === 'symbol'}
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
                    aria-pressed={l.side === s}
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
                  autoFocus={l.focus === 'qty'}
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
                <input
                  value={l.price}
                  onChange={(e) => update(l.key, { price: e.target.value, autoPrice: false })}
                  autoFocus={l.focus === 'price'}
                  inputMode="decimal"
                  placeholder="Price"
                  aria-label="Price per share"
                  className={`${BOX} w-24 text-right tabular-nums`}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                fee
                <input value={l.fee} onChange={(e) => update(l.key, { fee: e.target.value })} inputMode="decimal" placeholder="0" aria-label="Fee" className={`${BOX} w-16 text-right tabular-nums`} />
              </label>
              <span className="min-w-28 text-xs tabular-nums">
                {r && (r.gain !== null ? <span className={toneClass(r.gain)}>{r.gain >= 0 ? 'gain' : 'loss'} {signed(r.gain)}</span> : <span className="text-neutral-400">cash {signed(r.cash)}</span>)}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    touch()
                    setLines((ls) => ls.filter((x) => x.key !== l.key))
                    // The failing line's number no longer points at the same line.
                    setError(null)
                  }}
                  className="rounded-md p-1 text-neutral-500 hover:bg-(--card-raised) hover:text-white"
                  title="Remove this line"
                  aria-label={`Remove ${l.symbol || 'this'} line`}
                >
                  <X size={14} />
                </button>
              )}
              {bad && <span className="basis-full px-1 text-xs text-red-300">{error.message}</span>}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border) pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-400">
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addLine}>
            Add another
          </Button>
          <span className="text-neutral-500" title="One trade per line: ticker, shares, price. A word like “sold”, or a negative share count, marks a sale.">
            {pasteNote ?? 'or paste rows from your broker: ticker, shares, price'}
          </span>
          <label className="flex items-center gap-1.5">
            Date
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={`${BOX} w-auto`} />
          </label>
          <span className="tabular-nums">
            Cash {currency(cash)} → <span className={cashAfter < 0 || cashNote ? 'text-amber-300' : 'text-neutral-200'}>{currency(cashAfter)}</span>
            {cashNote && <span className="text-amber-300/80"> · {cashNote}</span>}
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
