import { useState } from 'react'
import type { Holding, OptionPosition } from '../lib/database.types'
import { cspOpen, optionOpen } from '../lib/wealthQueries'
import { OPTION_MULTIPLIER } from '../lib/portfolio'
import { centralDateStr, currency } from '../lib/format'
import { INPUT, LABEL } from '../lib/ui'
import { Button } from './ui/Button'
import { Segmented } from './ui/Tabs'

type Kind = 'buy_call' | 'buy_put' | 'covered_call' | 'csp'
const KINDS: { value: Kind; label: string; hint: string; action: string }[] = [
  { value: 'buy_call', label: 'Buy call', hint: 'LEAPS or any long call — the premium is paid from cash.', action: 'Buy call' },
  { value: 'buy_put', label: 'Buy put', hint: 'Hedges and long puts — the premium is paid from cash.', action: 'Buy put' },
  { value: 'covered_call', label: 'Covered call', hint: 'Sell a call against shares you hold. Premium goes to cash; needs 100 uncovered shares per contract.', action: 'Sell covered call' },
  { value: 'csp', label: 'Cash-secured put', hint: 'Sell a put. Premium goes to cash; strike × 100 per contract is set aside.', action: 'Sell put' },
]

const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  )
}

/** Opens any option position: long call/put, covered call, or cash-secured put. */
export function OptionTradeForm({
  portfolioId,
  holdings,
  options,
  cashAvailable,
  onDone,
}: {
  portfolioId: string
  holdings: Holding[]
  options: OptionPosition[]
  cashAvailable: number
  onDone: (message: string) => void
}) {
  const [kind, setKind] = useState<Kind>('buy_call')
  const [symbol, setSymbol] = useState('')
  const [strike, setStrike] = useState('')
  const [expiration, setExpiration] = useState('')
  const [contracts, setContracts] = useState('1')
  const [price, setPrice] = useState('')
  const [hedge, setHedge] = useState(false)
  const [on, setOn] = useState(centralDateStr(new Date()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = KINDS.find((k) => k.value === kind)!
  const sym = symbol.trim().toUpperCase()
  const covered = (s: string) =>
    options.filter((o) => o.status === 'open' && o.side === 'short' && o.symbol === s).reduce((n, o) => n + o.contracts * OPTION_MULTIPLIER, 0)
  const uncovered = (s: string) => Number(holdings.find((h) => h.symbol === s)?.quantity ?? 0) - covered(s)

  async function submit() {
    setError(null)
    const k = num(strike)
    const c = num(contracts)
    const p = num(price)
    if (!sym) return setError('Enter a ticker.')
    if (k === null || k <= 0) return setError('Enter the strike price.')
    if (!expiration) return setError('Pick the expiration date.')
    if (c === null || c <= 0 || !Number.isInteger(c)) return setError('Contracts must be a whole number above zero.')
    if (p === null || p < 0) return setError('Enter the option price per share, e.g. 4.20.')
    setBusy(true)
    try {
      if (kind === 'csp') {
        await cspOpen({ portfolioId, symbol: sym, strike: k, expiration, contracts: c, premium: p, on })
      } else {
        await optionOpen({
          portfolioId,
          symbol: sym,
          optionType: kind === 'buy_put' ? 'put' : 'call',
          side: kind === 'covered_call' ? 'short' : 'long',
          strike: k,
          expiration,
          contracts: c,
          price: p,
          isHedge: (kind === 'buy_call' || kind === 'buy_put') && hedge,
          on,
        })
      }
      onDone(`${meta.action}: ${sym} ${k}${kind === 'buy_put' || kind === 'csp' ? 'P' : 'C'} ×${c}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const k = num(strike)
  const c = num(contracts)
  const p = num(price)
  const total = p !== null && c !== null ? p * OPTION_MULTIPLIER * c : null
  const long = kind === 'buy_call' || kind === 'buy_put'
  const collateral = kind === 'csp' && k !== null && c !== null ? k * OPTION_MULTIPLIER * c : null

  return (
    <div className="flex flex-col gap-4">
      <Segmented options={KINDS.map((x) => ({ value: x.value, label: x.label }))} value={kind} onChange={(v) => {
          setKind(v)
          setError(null)
        }} size="sm" />
      <p className="text-xs text-neutral-500">{meta.hint}</p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ticker">
          {kind === 'covered_call' ? (
            <select value={sym} onChange={(e) => setSymbol(e.target.value)} className={INPUT}>
              <option value="">Choose…</option>
              {holdings.map((h) => (
                <option key={h.id} value={h.symbol}>
                  {h.symbol} ({Math.max(0, uncovered(h.symbol))} free)
                </option>
              ))}
            </select>
          ) : (
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. SPY" className={`${INPUT} uppercase`} />
          )}
        </Field>
        <Field label="Strike">
          <input inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="e.g. 600" className={INPUT} />
        </Field>
        <Field label="Expiration">
          <input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} className={INPUT} />
        </Field>
        <Field label="Contracts">
          <input inputMode="numeric" value={contracts} onChange={(e) => setContracts(e.target.value)} className={INPUT} />
        </Field>
        <Field label={long ? 'Price paid / share' : 'Premium received / share'}>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 4.20" className={INPUT} />
        </Field>
        <Field label="Date">
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={INPUT} />
        </Field>
      </div>

      {long && (
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={hedge} onChange={(e) => setHedge(e.target.checked)} className="h-4 w-4 accent-(--accent)" />
          This is a hedge
        </label>
      )}

      <div className="rounded-xl bg-(--card-raised) px-4 py-3 text-sm">
        {total === null ? (
          <span className="text-neutral-500">Enter the price and contracts to see the total.</span>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-neutral-400">{long ? 'Cost' : 'Premium to cash'}</span>
              <span className="font-semibold tabular-nums text-white">{currency(total)}</span>
            </div>
            {collateral !== null && (
              <div className="flex justify-between">
                <span className="text-neutral-400">Set aside</span>
                <span className="tabular-nums text-neutral-200">{currency(collateral)}</span>
              </div>
            )}
            {((long && total > cashAvailable) || (collateral !== null && collateral > cashAvailable)) && (
              <div className="text-xs text-amber-400">More than the {currency(cashAvailable)} cash available.</div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button variant="primary" onClick={submit} disabled={busy} className="w-full">
        {busy ? 'Saving…' : meta.action}
      </Button>
    </div>
  )
}
