import { useState } from 'react'
import type { Holding, OptionPosition } from '../lib/database.types'
import { optionClose, optionOpen, setOptionMark, type SymbolPrice } from '../lib/wealthQueries'
import { OPTION_MULTIPLIER, optionGain, optionValue } from '../lib/portfolio'
import { centralDateStr, currency, dateFmt, percentFmt } from '../lib/format'

const INPUT =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'

const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}
const tone = (n: number) => (n > 0 ? 'text-(--status-good)' : n < 0 ? 'text-(--status-critical)' : 'text-neutral-300')

type Kind = 'buy_call' | 'buy_put' | 'covered_call'
const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'buy_call', label: 'Buy call', hint: 'LEAPS or any long call — premium paid from cash.' },
  { value: 'buy_put', label: 'Buy put', hint: 'Hedges and long puts — premium paid from cash.' },
  { value: 'covered_call', label: 'Sell covered call', hint: 'Premium goes to cash. Needs 100 uncovered shares per contract.' },
]

const STATUS_LABEL: Record<OptionPosition['status'], string> = {
  open: 'Open',
  closed: 'Closed',
  expired: 'Expired',
  exercised: 'Exercised',
  assigned: 'Assigned',
}

const label = (o: OptionPosition) => `${o.symbol} ${Number(o.strike)}${o.option_type === 'call' ? 'C' : 'P'}`
const daysTo = (iso: string, from: string) => Math.round((Date.parse(iso) - Date.parse(from)) / 86_400_000)

/** Long calls and puts (LEAPS, hedges) and covered calls, entered by hand. There's no
 * free option price feed, so each position's current price is tapped in when you check
 * your broker; until then a long option counts at what you paid ("not updated") and a
 * covered call at its in-the-money amount. */
export function OptionsSection({
  portfolioId,
  options,
  holdings,
  prices,
  cashAvailable,
  onDone,
}: {
  portfolioId: string
  options: OptionPosition[]
  holdings: Holding[]
  prices: Map<string, SymbolPrice>
  cashAvailable: number
  onDone: () => void
}) {
  const [kind, setKind] = useState<Kind>('buy_call')
  const [symbol, setSymbol] = useState('')
  const [strike, setStrike] = useState('')
  const [expiration, setExpiration] = useState('')
  const [contracts, setContracts] = useState('1')
  const [price, setPrice] = useState('')
  const [hedge, setHedge] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const today = centralDateStr(new Date())
  const open = options.filter((o) => o.status === 'open')
  const history = options.filter((o) => o.status !== 'open').sort((a, b) => (b.closed_on ?? '').localeCompare(a.closed_on ?? ''))
  const sym = symbol.trim().toUpperCase()
  const coveredNow = (s: string) => open.filter((o) => o.side === 'short' && o.symbol === s).reduce((n, o) => n + o.contracts * OPTION_MULTIPLIER, 0)
  const uncovered = (s: string) => Number(holdings.find((h) => h.symbol === s)?.quantity ?? 0) - coveredNow(s)

  const run = async (p: Promise<unknown>, after?: () => void) => {
    setError(null)
    setBusy(true)
    try {
      await p
      after?.()
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    const k = num(strike)
    const c = num(contracts)
    const p = num(price)
    if (!sym) return setError('Enter a ticker.')
    if (k === null || k <= 0) return setError('Enter the strike price.')
    if (!expiration) return setError('Pick the expiration date.')
    if (c === null || c <= 0 || !Number.isInteger(c)) return setError('Contracts must be a whole number above zero.')
    if (p === null || p < 0) return setError('Enter the option price per share (e.g. 4.20).')
    run(
      optionOpen({
        portfolioId,
        symbol: sym,
        optionType: kind === 'buy_put' ? 'put' : 'call',
        side: kind === 'covered_call' ? 'short' : 'long',
        strike: k,
        expiration,
        contracts: c,
        price: p,
        isHedge: kind !== 'covered_call' && hedge,
        on: today,
      }),
      () => {
        setSymbol('')
        setStrike('')
        setExpiration('')
        setContracts('1')
        setPrice('')
        setHedge(false)
      },
    )
  }

  function updateMark(o: OptionPosition) {
    const raw = window.prompt(`${label(o)} — current option price per share (blank to clear)`, o.mark !== null ? String(o.mark) : '')
    if (raw === null) return
    const v = num(raw)
    if (raw.trim() !== '' && (v === null || v < 0)) return setError('Enter a price per share, e.g. 4.20')
    run(setOptionMark(o.id, raw.trim() === '' ? null : v))
  }

  function closeAt(o: OptionPosition) {
    const raw = window.prompt(`${label(o)} — ${o.side === 'long' ? 'sold' : 'bought back'} at what price per share?`, o.mark !== null ? String(o.mark) : '')
    if (raw === null) return
    const v = num(raw)
    if (v === null || v < 0) return setError('Enter the price per share.')
    run(optionClose({ optionId: o.id, outcome: 'closed', price: v, on: today }))
  }

  const resolveDate = (o: OptionPosition) => (o.expiration < today ? o.expiration : today)
  const p = num(price)
  const c = num(contracts)
  const total = p !== null && c !== null ? p * OPTION_MULTIPLIER * c : null

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-200">Options</h2>
        {open.length > 0 && (
          <span className="text-xs text-neutral-500">
            Open value <span className="tabular-nums text-neutral-300">{currency(open.reduce((s, o) => s + optionValue(o, prices), 0))}</span> · unrealized{' '}
            <span className={`tabular-nums ${tone(open.reduce((s, o) => s + optionGain(o, prices), 0))}`}>
              {currency(open.reduce((s, o) => s + optionGain(o, prices), 0))}
            </span>
          </span>
        )}
      </div>

      {open.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="py-1.5 pr-2">Position</th>
                <th className="py-1.5 pr-2 text-right">Premium</th>
                <th className="py-1.5 pr-2 text-right" title="Click to enter today's option price from your broker">Value</th>
                <th className="py-1.5 pr-2 text-right">Gain</th>
                <th className="py-1.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {open.map((o) => {
                const premium = Number(o.open_price) * OPTION_MULTIPLIER * o.contracts
                const value = optionValue(o, prices)
                const gain = optionGain(o, prices)
                const close = prices.get(o.symbol)?.close
                const dte = daysTo(o.expiration, today)
                const leaps = o.side === 'long' && daysTo(o.expiration, o.opened_on) > 365
                return (
                  <tr key={o.id} className="border-b border-neutral-800/60 last:border-0">
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-neutral-100">
                        {label(o)} ×{o.contracts}
                        {o.side === 'short' && <span className="rounded bg-neutral-800 px-1.5 text-[10px] font-normal text-neutral-300">Covered call</span>}
                        {leaps && <span className="rounded bg-neutral-800 px-1.5 text-[10px] font-normal text-neutral-300">LEAPS</span>}
                        {o.is_hedge && <span className="rounded bg-neutral-800 px-1.5 text-[10px] font-normal text-neutral-300">Hedge</span>}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        exp {dateFmt(o.expiration)} · {dte >= 0 ? `${dte}d left` : 'expired'}
                        {close !== undefined && ` · stock ${close.toFixed(2)}`}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">
                      {o.side === 'long' ? '' : '+'}
                      {currency(premium)}
                      <div className="text-[11px] text-neutral-600">{o.side === 'long' ? 'paid' : 'received'}</div>
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        onClick={() => updateMark(o)}
                        className="tabular-nums text-neutral-200 underline decoration-neutral-700 decoration-dotted underline-offset-2 hover:text-white"
                        title={o.mark !== null ? `Your price: ${o.mark}/share — click to update` : 'Click to enter today’s price from your broker'}
                      >
                        {currency(Math.abs(value))}
                      </button>
                      <div className="text-[11px] text-neutral-600">
                        {o.mark !== null ? `@ ${Number(o.mark)}` : o.side === 'long' ? 'not updated' : 'est'}
                        {o.side === 'short' && ' to buy back'}
                      </div>
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${tone(gain)}`}>
                      {currency(gain)}
                      {premium > 0 && <div className="text-[11px]">{percentFmt(gain / premium)}</div>}
                    </td>
                    <td className="py-2 text-right">
                      <span className="flex justify-end gap-2 text-xs">
                        <button disabled={busy} onClick={() => closeAt(o)} className="text-neutral-400 hover:text-neutral-100">
                          {o.side === 'long' ? 'Sell' : 'Buy back'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`${label(o)} expired worthless?`)) run(optionClose({ optionId: o.id, outcome: 'expired', on: resolveDate(o) }))
                          }}
                          className="text-neutral-400 hover:text-neutral-100"
                        >
                          Expired
                        </button>
                        {o.side === 'long' && o.option_type === 'call' && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Exercise: buy ${o.contracts * OPTION_MULTIPLIER} ${o.symbol} at ${Number(o.strike)} (${currency(Number(o.strike) * OPTION_MULTIPLIER * o.contracts)} from cash)?`))
                                run(optionClose({ optionId: o.id, outcome: 'exercised', on: resolveDate(o) }))
                            }}
                            className="text-amber-400/90 hover:text-amber-300"
                          >
                            Exercise
                          </button>
                        )}
                        {o.side === 'short' && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Assigned: sell ${o.contracts * OPTION_MULTIPLIER} ${o.symbol} at ${Number(o.strike)}?`))
                                run(optionClose({ optionId: o.id, outcome: 'assigned', on: resolveDate(o) }))
                            }}
                            className="text-amber-400/90 hover:text-amber-300"
                          >
                            Assigned
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-2 flex overflow-hidden rounded-md border border-neutral-700">
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => {
              setKind(k.value)
              setError(null)
            }}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition ${
              kind === k.value ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-neutral-500">{KINDS.find((k) => k.value === kind)!.hint}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {kind === 'covered_call' ? (
          <select value={sym} onChange={(e) => setSymbol(e.target.value)} className={INPUT}>
            <option value="">Ticker…</option>
            {holdings.map((h) => (
              <option key={h.id} value={h.symbol}>
                {h.symbol} ({Math.max(0, uncovered(h.symbol))} free)
              </option>
            ))}
          </select>
        ) : (
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Ticker" className={`${INPUT} uppercase`} />
        )}
        <input inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="Strike" className={INPUT} />
        <input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} title="Expiration" className={INPUT} />
        <input inputMode="numeric" value={contracts} onChange={(e) => setContracts(e.target.value)} placeholder="Contracts" className={INPUT} />
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price / share" className={INPUT} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3 text-xs text-neutral-500">
          {kind !== 'covered_call' && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={hedge} onChange={(e) => setHedge(e.target.checked)} /> Hedge
            </label>
          )}
          {total !== null && (
            <span>
              {kind === 'covered_call' ? 'Receive' : 'Costs'} {currency(total)}
              {kind !== 'covered_call' && total > cashAvailable && <span className="text-amber-400"> · more than the {currency(cashAvailable)} cash available</span>}
            </span>
          )}
        </span>
        <button onClick={submit} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
          {KINDS.find((k) => k.value === kind)!.label}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-(--status-critical)">{error}</p>}

      {history.length > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-2 text-xs">
          <button onClick={() => setShowHistory((v) => !v)} className="text-neutral-500 hover:text-neutral-300">
            {showHistory ? 'Hide' : 'Show'} {history.length} closed option{history.length === 1 ? '' : 's'}
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col divide-y divide-neutral-800/60">
              {history.map((o) => {
                const premium = Number(o.open_price) * OPTION_MULTIPLIER * o.contracts
                const exit = o.close_price !== null ? Number(o.close_price) * OPTION_MULTIPLIER * o.contracts : 0
                const result =
                  o.status === 'exercised' || o.status === 'assigned' ? null : o.side === 'long' ? exit - premium : premium - exit
                return (
                  <div key={o.id} className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">
                      {label(o)} ×{o.contracts} {o.side === 'short' && <span className="text-neutral-500">covered call</span>}{' '}
                      <span className="text-neutral-500">· exp {dateFmt(o.expiration)}</span>
                    </span>
                    <span className="flex gap-3">
                      <span className="text-neutral-500">{STATUS_LABEL[o.status]}</span>
                      {result !== null && <span className={`tabular-nums ${tone(result)}`}>{currency(result)}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
