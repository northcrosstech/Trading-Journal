import { useState } from 'react'
import type { Holding, Portfolio } from '../lib/database.types'
import { portfolioBuy, portfolioCash, portfolioSell, portfolioTransfer, type SymbolPrice } from '../lib/wealthQueries'
import { centralDateStr, currency } from '../lib/format'

const INPUT =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'

type Tab = 'buy' | 'sell' | 'existing' | 'transfer' | 'cash'
const TABS: { value: Tab; label: string; hint: string }[] = [
  { value: 'buy', label: 'Buy', hint: 'Paid from this portfolio’s cash. The average cost updates for you.' },
  { value: 'sell', label: 'Sell', hint: 'Proceeds go to this portfolio’s cash; the gain or loss is recorded.' },
  { value: 'existing', label: 'Add existing', hint: 'Shares you already own (or moved in). Counts as money added, not a purchase.' },
  { value: 'transfer', label: 'Transfer', hint: 'Move shares to another portfolio, or out of the app. Average cost carries over — not a sale.' },
  { value: 'cash', label: 'Cash', hint: 'Deposits and withdrawals are money in/out. Dividends are earnings.' },
]

const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

/** Buy / sell / add existing shares / cash moves for one portfolio. Each action is one
 * database call that updates the holding, the cash and the activity log together. */
export function PortfolioActions({
  portfolioId,
  otherPortfolios,
  holdings,
  prices,
  cashAvailable,
  onDone,
}: {
  portfolioId: string
  otherPortfolios: Pick<Portfolio, 'id' | 'name'>[]
  holdings: Holding[]
  prices: Map<string, SymbolPrice>
  cashAvailable: number
  onDone: () => void
}) {
  const [tab, setTab] = useState<Tab>('buy')
  const [symbol, setSymbol] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [cashKind, setCashKind] = useState<'deposit' | 'withdrawal' | 'dividend'>('deposit')
  const [amount, setAmount] = useState('')
  const [on, setOn] = useState(centralDateStr(new Date()))
  const [destination, setDestination] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sym = symbol.trim().toUpperCase()
  const held = holdings.find((h) => h.symbol === sym)
  const lastClose = prices.get(sym)?.close

  function reset() {
    setSymbol('')
    setQty('')
    setPrice('')
    setAmount('')
  }

  async function submit() {
    setError(null)
    try {
      setBusy(true)
      if (tab === 'transfer') {
        const q = num(qty)
        if (!sym) throw new Error('Choose a ticker.')
        if (q === null || q <= 0) throw new Error('Enter a quantity above zero.')
        if (!destination) throw new Error('Choose where the shares are going.')
        await portfolioTransfer({ fromPortfolioId: portfolioId, symbol: sym, quantity: q, toPortfolioId: destination === 'out' ? null : destination, on })
      } else if (tab === 'cash') {
        const a = num(amount)
        if (a === null || a <= 0) throw new Error('Enter an amount above zero.')
        await portfolioCash({ portfolioId, kind: cashKind, amount: a, symbol: cashKind === 'dividend' ? sym || null : null, on })
      } else {
        const q = num(qty)
        const p = num(price)
        if (!sym) throw new Error('Enter a ticker.')
        if (q === null || q <= 0) throw new Error('Enter a quantity above zero.')
        if (p === null || p < 0) throw new Error(tab === 'existing' ? 'Enter your average cost per share.' : 'Enter the price per share.')
        if (tab === 'sell') await portfolioSell({ portfolioId, symbol: sym, quantity: q, price: p, toCash: true, on })
        else await portfolioBuy({ portfolioId, symbol: sym, quantity: q, price: p, fromCash: tab === 'buy', on })
      }
      reset()
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const q = num(qty)
  const p = num(price)
  const total = q !== null && p !== null ? q * p : null

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex overflow-hidden rounded-md border border-neutral-700">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setTab(t.value)
              setError(null)
            }}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition ${
              tab === t.value ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-[11px] text-neutral-500">{TABS.find((t) => t.value === tab)!.hint}</p>

      {tab === 'cash' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type">
            <select value={cashKind} onChange={(e) => setCashKind(e.target.value as typeof cashKind)} className={INPUT}>
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="dividend">Dividend</option>
            </select>
          </Field>
          <Field label="Amount ($)">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} />
          </Field>
          {cashKind === 'dividend' && (
            <Field label="From ticker (optional)">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${INPUT} uppercase`} />
            </Field>
          )}
          <Field label="Date">
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={INPUT} />
          </Field>
        </div>
      ) : tab === 'transfer' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ticker">
            <select value={sym} onChange={(e) => setSymbol(e.target.value)} className={INPUT}>
              <option value="">Choose…</option>
              {holdings.map((h) => (
                <option key={h.id} value={h.symbol}>
                  {h.symbol}
                </option>
              ))}
            </select>
          </Field>
          <Field label={held ? `Quantity (you hold ${Number(held.quantity)})` : 'Quantity'}>
            <span className="flex gap-1">
              <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={INPUT} />
              {held && (
                <button onClick={() => setQty(String(Number(held.quantity)))} className="shrink-0 rounded-md border border-neutral-700 px-2 text-[11px] text-neutral-400 hover:bg-neutral-800">
                  All
                </button>
              )}
            </span>
          </Field>
          <Field label="To">
            <select value={destination} onChange={(e) => setDestination(e.target.value)} className={INPUT}>
              <option value="">Choose…</option>
              {otherPortfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="out">Leaves the app (another broker)</option>
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={INPUT} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ticker">
            {tab === 'sell' ? (
              <select value={sym} onChange={(e) => setSymbol(e.target.value)} className={INPUT}>
                <option value="">Choose…</option>
                {holdings.map((h) => (
                  <option key={h.id} value={h.symbol}>
                    {h.symbol}
                  </option>
                ))}
              </select>
            ) : (
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. VOO" className={`${INPUT} uppercase`} />
            )}
          </Field>
          <Field label={tab === 'sell' && held ? `Quantity (you hold ${Number(held.quantity)})` : 'Quantity'}>
            <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={INPUT} />
          </Field>
          <Field label={tab === 'existing' ? 'Average cost / share' : 'Price / share'}>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={lastClose !== undefined && tab !== 'existing' ? `last close ${lastClose}` : undefined}
              className={INPUT}
            />
          </Field>
          <Field label="Date">
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={INPUT} />
          </Field>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-neutral-500">
          {(tab === 'buy' || tab === 'sell' || tab === 'existing') && total !== null && <>Total {currency(total)}</>}
          {tab === 'transfer' && held && <>Average cost {currency(Number(held.avg_cost))}/share carries over</>}
          {tab === 'buy' && total !== null && total > cashAvailable && (
            <span className="text-amber-400"> · more than the {currency(cashAvailable)} cash available</span>
          )}
        </span>
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          {busy ? 'Saving…' : TABS.find((t) => t.value === tab)!.label}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-(--status-critical)">{error}</p>}
    </div>
  )
}
