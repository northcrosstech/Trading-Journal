import { useState } from 'react'
import type { CspPosition } from '../lib/database.types'
import { cspOpen, cspResolve, setCspMark, type SymbolPrice } from '../lib/wealthQueries'
import { cspAnnualizedYield, cspCollateral, cspLiability, cspStats, OPTION_MULTIPLIER } from '../lib/portfolio'
import { centralDateStr, currency, dateFmt, percentFmt } from '../lib/format'

const INPUT =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'
const pct = (n: number | null) => (n === null ? '—' : percentFmt(n).replace('+', ''))

const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}

const STATUS_LABEL: Record<CspPosition['status'], string> = { open: 'Open', expired: 'Expired', assigned: 'Assigned', closed: 'Bought back' }

/** Cash-secured puts, entered by hand: sell one (premium goes to cash), then resolve it
 * as expired, bought back, or assigned (shares added at strike minus premium). */
export function CspSection({
  portfolioId,
  csps,
  prices,
  cashAvailable,
  onDone,
}: {
  portfolioId: string
  csps: CspPosition[]
  prices: Map<string, SymbolPrice>
  cashAvailable: number
  onDone: () => void
}) {
  const [symbol, setSymbol] = useState('')
  const [strike, setStrike] = useState('')
  const [expiration, setExpiration] = useState('')
  const [contracts, setContracts] = useState('1')
  const [premium, setPremium] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const open = csps.filter((c) => c.status === 'open')
  const history = csps.filter((c) => c.status !== 'open').sort((a, b) => (b.closed_on ?? '').localeCompare(a.closed_on ?? ''))
  const stats = cspStats(csps)
  const today = centralDateStr(new Date())

  const run = async (p: Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await p
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function sell() {
    const k = num(strike)
    const c = num(contracts)
    const pr = num(premium)
    if (!symbol.trim()) return setError('Enter a ticker.')
    if (k === null || k <= 0) return setError('Enter the strike price.')
    if (!expiration) return setError('Pick the expiration date.')
    if (c === null || c <= 0 || !Number.isInteger(c)) return setError('Contracts must be a whole number above zero.')
    if (pr === null || pr < 0) return setError('Enter the premium per share (e.g. 1.25).')
    await run(
      cspOpen({ portfolioId, symbol: symbol.trim().toUpperCase(), strike: k, expiration, contracts: c, premium: pr, on: today }).then(() => {
        setSymbol('')
        setStrike('')
        setExpiration('')
        setContracts('1')
        setPremium('')
      }),
    )
  }

  const k = num(strike)
  const c = num(contracts)
  const newCollateral = k !== null && c !== null ? k * OPTION_MULTIPLIER * c : null

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-200">Cash-secured puts</h2>
        <span className="text-xs text-neutral-500">
          Premium kept <span className="tabular-nums text-neutral-300">{currency(stats.premiumCollected)}</span>
          {stats.avgAnnualizedYield !== null && (
            <>
              {' '}· avg yield <span className="tabular-nums text-neutral-300">{pct(stats.avgAnnualizedYield)}</span>/yr
            </>
          )}
          {stats.assignmentRate !== null && (
            <>
              {' '}· assigned <span className="tabular-nums text-neutral-300">{pct(stats.assignmentRate)}</span> of {stats.resolved}
            </>
          )}
        </span>
      </div>

      {open.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="py-1.5 pr-2">Put</th>
                <th className="py-1.5 pr-2 text-right">Premium</th>
                <th className="py-1.5 pr-2 text-right" title="Cash set aside: strike × 100 × contracts">Collateral</th>
                <th className="py-1.5 pr-2 text-right" title="Cost to buy back now: your entered price, else its value from the stock's last close">Buy-back</th>
                <th className="py-1.5 pr-2 text-right" title="Premium ÷ collateral, scaled to a year">Yield/yr</th>
                <th className="py-1.5 text-right">Resolve</th>
              </tr>
            </thead>
            <tbody>
              {open.map((p) => {
                const close = prices.get(p.symbol)?.close
                const itm = close !== undefined && close < Number(p.strike)
                return (
                  <tr key={p.id} className="border-b border-neutral-800/60 last:border-0">
                    <td className="py-2 pr-2">
                      <div className="font-medium text-neutral-100">
                        {p.symbol} {Number(p.strike)}P ×{p.contracts}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        exp {dateFmt(p.expiration)}
                        {close !== undefined && (
                          <span className={itm ? 'text-amber-400' : ''}>
                            {' '}· stock {close.toFixed(2)}
                            {itm && ' (in the money)'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">{currency(Number(p.premium) * OPTION_MULTIPLIER * p.contracts)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{currency(cspCollateral(p))}</td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        onClick={() => {
                          const raw = window.prompt('Current option price per share (blank to use the estimate)', p.mark !== null ? String(p.mark) : '')
                          if (raw === null) return
                          const v = num(raw)
                          run(setCspMark(p.id, raw.trim() === '' ? null : v))
                        }}
                        className="tabular-nums text-neutral-300 underline decoration-neutral-700 decoration-dotted underline-offset-2 hover:text-neutral-100"
                        title={p.mark !== null ? 'Your entered price — click to change' : 'Estimated — click to enter the real price'}
                      >
                        {currency(cspLiability(p, prices))}
                        {p.mark === null && <span className="text-neutral-600"> est</span>}
                      </button>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-neutral-300">{pct(cspAnnualizedYield(p))}</td>
                    <td className="py-2 text-right">
                      <span className="flex justify-end gap-2 text-xs">
                        <button disabled={busy} onClick={() => run(cspResolve({ cspId: p.id, outcome: 'expired', on: p.expiration < today ? p.expiration : today }))} className="text-neutral-400 hover:text-neutral-100">
                          Expired
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const raw = window.prompt('Bought back at what price per share?')
                            if (raw === null) return
                            const v = num(raw)
                            if (v === null || v < 0) return setError('Enter the buy-back price per share.')
                            run(cspResolve({ cspId: p.id, outcome: 'closed', price: v, on: today }))
                          }}
                          className="text-neutral-400 hover:text-neutral-100"
                        >
                          Bought back
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Assigned: buy ${p.contracts * OPTION_MULTIPLIER} ${p.symbol} at ${Number(p.strike)} (${currency(cspCollateral(p))} from cash)?`))
                              run(cspResolve({ cspId: p.id, outcome: 'assigned', on: p.expiration < today ? p.expiration : today }))
                          }}
                          className="text-amber-400/90 hover:text-amber-300"
                        >
                          Assigned
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Ticker" className={`${INPUT} uppercase`} />
        <input inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="Strike" className={INPUT} />
        <input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} title="Expiration" className={INPUT} />
        <input inputMode="numeric" value={contracts} onChange={(e) => setContracts(e.target.value)} placeholder="Contracts" className={INPUT} />
        <input inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} placeholder="Premium / share" className={INPUT} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-neutral-500">
          {newCollateral !== null && (
            <>
              Sets aside {currency(newCollateral)}
              {newCollateral > cashAvailable && <span className="text-amber-400"> · more than the {currency(cashAvailable)} cash available</span>}
            </>
          )}
        </span>
        <button onClick={sell} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
          Sell put
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-(--status-critical)">{error}</p>}

      {history.length > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-2 text-xs">
          <button onClick={() => setShowHistory((v) => !v)} className="text-neutral-500 hover:text-neutral-300">
            {showHistory ? 'Hide' : 'Show'} {history.length} past put{history.length === 1 ? '' : 's'}
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col divide-y divide-neutral-800/60">
              {history.map((p) => {
                const credit = Number(p.premium) * OPTION_MULTIPLIER * p.contracts
                const kept = p.status === 'closed' && p.close_price !== null ? credit - Number(p.close_price) * OPTION_MULTIPLIER * p.contracts : credit
                return (
                  <div key={p.id} className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">
                      {p.symbol} {Number(p.strike)}P ×{p.contracts} <span className="text-neutral-500">· exp {dateFmt(p.expiration)}</span>
                    </span>
                    <span className="flex gap-3">
                      <span className={p.status === 'assigned' ? 'text-amber-400' : 'text-neutral-500'}>{STATUS_LABEL[p.status]}</span>
                      <span className={`tabular-nums ${kept >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>{currency(kept)}</span>
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
