import { useState, type ReactNode } from 'react'
import type { Holding, OptionPosition, Portfolio } from '../lib/database.types'
import { portfolioBuy, portfolioCash, portfolioSetCash, portfolioSplit, portfolioTransfer } from '../lib/wealthQueries'
import { centralDateStr, currency } from '../lib/format'
import { INPUT, LABEL } from '../lib/ui'
import { LOG_HINT, type LogAction } from '../lib/logActions'
import { Button } from './ui/Button'
import { Segmented } from './ui/Tabs'
import { OptionTradeForm, type OptionFormInitial } from './OptionTradeForm'

const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}
const fmtQty = (n: number) => String(Number(n.toFixed(6)))

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </label>
  )
}

/** One form from the Log menu, in the drawer: a cash move, shares already owned, a transfer,
 * a stock split, or opening an option. (Buying and selling shares is the quick form on the
 * Positions tab.) Each is one database call that updates the holding, the cash and the
 * activity log together. `onDone` gets a short summary for a notification. */
export function PortfolioActions({
  portfolioId,
  otherPortfolios,
  holdings,
  options,
  cashAvailable,
  cash,
  action,
  onAction,
  optionInitial,
  onDone,
}: {
  portfolioId: string
  otherPortfolios: Pick<Portfolio, 'id' | 'name'>[]
  holdings: Holding[]
  options: OptionPosition[]
  cashAvailable: number
  /** Current cash; negative = margin used. */
  cash: number
  /** The form to show. */
  action: LogAction
  /** Switches between Deposit and Withdraw without losing the amount typed. */
  onAction?: (action: LogAction) => void
  /** Contract to fill the option form with. */
  optionInitial?: OptionFormInitial
  onDone: (message: string) => void
}) {
  const [symbol, setSymbol] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [balanceReason, setBalanceReason] = useState<'correction' | 'interest'>('correction')
  const [amount, setAmount] = useState('')
  const [on, setOn] = useState(centralDateStr(new Date()))
  const [destination, setDestination] = useState<string>('')
  const [splitNew, setSplitNew] = useState('2')
  const [splitOld, setSplitOld] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sym = symbol.trim().toUpperCase()
  const held = holdings.find((h) => h.symbol === sym)

  async function submit() {
    setError(null)
    try {
      setBusy(true)
      let message: string
      if (action === 'split') {
        const n = num(splitNew)
        const o = num(splitOld)
        if (!sym) throw new Error('Choose a ticker.')
        if (n === null || o === null || n <= 0 || o <= 0 || n === o) throw new Error('Enter the split, e.g. 2 for 1 (or 1 for 10 for a reverse split).')
        await portfolioSplit({ portfolioId, symbol: sym, ratio: n / o, on })
        message = `${sym} split ${fmtQty(n)}-for-${fmtQty(o)}`
      } else if (action === 'transfer') {
        const q = num(qty)
        if (!sym) throw new Error('Choose a ticker.')
        if (q === null || q <= 0) throw new Error('Enter a quantity above zero.')
        if (!destination) throw new Error('Choose where the shares are going.')
        await portfolioTransfer({ fromPortfolioId: portfolioId, symbol: sym, quantity: q, toPortfolioId: destination === 'out' ? null : destination, on })
        const to = destination === 'out' ? 'out of the app' : `to ${otherPortfolios.find((p) => p.id === destination)?.name ?? 'portfolio'}`
        message = `Moved ${fmtQty(q)} ${sym} ${to}`
      } else if (action === 'balance') {
        const b = num(amount.replace(/^\((.*)\)$/, '-$1'))
        if (b === null) throw new Error('Enter the cash balance your broker shows (negative for margin used).')
        await portfolioSetCash({ portfolioId, balance: b, countsInReturn: balanceReason === 'interest', on })
        message = b < 0 ? `Margin used set to ${currency(-b)}` : `Cash set to ${currency(b)}`
      } else if (action === 'deposit' || action === 'withdrawal' || action === 'dividend') {
        const a = num(amount)
        if (a === null || a <= 0) throw new Error('Enter an amount above zero.')
        await portfolioCash({ portfolioId, kind: action, amount: a, symbol: action === 'dividend' ? sym || null : null, on })
        message = `${action === 'deposit' ? 'Deposited' : action === 'withdrawal' ? 'Withdrew' : 'Recorded dividend of'} ${currency(a)}`
      } else {
        // Shares I already own: added at their average cost, with no cash spent.
        const q = num(qty)
        const p = num(price)
        if (!sym) throw new Error('Enter a ticker.')
        if (q === null || q <= 0) throw new Error('Enter a quantity above zero.')
        if (p === null || p < 0) throw new Error('Enter your average cost per share.')
        await portfolioBuy({ portfolioId, symbol: sym, quantity: q, price: p, fromCash: false, on, fee: 0 })
        message = `Added ${fmtQty(q)} ${sym}`
      }
      setSymbol('')
      setQty('')
      setPrice('')
      setAmount('')
      onDone(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (action === 'option')
    return <OptionTradeForm portfolioId={portfolioId} holdings={holdings} options={options} cashAvailable={cashAvailable} initial={optionInitial} onDone={onDone} />

  const q = num(qty)
  const p = num(price)
  const total = q !== null && p !== null ? q * p : null
  const tickerSelect = (
    <select autoFocus value={sym} onChange={(e) => setSymbol(e.target.value)} className={INPUT}>
      <option value="">Choose…</option>
      {holdings.map((h) => (
        <option key={h.id} value={h.symbol}>
          {h.symbol} ({fmtQty(Number(h.quantity))})
        </option>
      ))}
    </select>
  )
  const dateField = (
    <Field label="Date">
      <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={INPUT} />
    </Field>
  )
  // Enter saves from a field you type in (not from the date picker, a list or a button).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target
    if (e.key === 'Enter' && !busy && t instanceof HTMLInputElement && t.type !== 'date') submit()
  }

  return (
    <div className="flex flex-col gap-5" onKeyDown={onKeyDown}>
      <p className="-mt-1 text-xs text-neutral-500">{LOG_HINT[action]}</p>

      {action === 'deposit' || action === 'withdrawal' || action === 'dividend' || action === 'balance' ? (
        <div className="flex flex-col gap-4">
          {(action === 'deposit' || action === 'withdrawal') && onAction && (
            <Segmented
              options={[
                { value: 'deposit', label: 'Deposit' },
                { value: 'withdrawal', label: 'Withdraw' },
              ]}
              value={action}
              onChange={(v) => {
                setError(null)
                onAction(v)
              }}
              size="sm"
            />
          )}
          {action === 'balance' ? (
            <BalanceFields cash={cash} amount={amount} setAmount={setAmount} reason={balanceReason} setReason={setBalanceReason} />
          ) : (
            <Field label="Amount">
              <span className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
                <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${INPUT} pl-7`} />
              </span>
            </Field>
          )}
          {action === 'dividend' && (
            <Field label="From ticker (optional)">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${INPUT} uppercase`} />
            </Field>
          )}
          {dateField}
        </div>
      ) : action === 'split' ? (
        <div className="flex flex-col gap-4">
          <Field label="Ticker">{tickerSelect}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="New shares">
              <input inputMode="decimal" value={splitNew} onChange={(e) => setSplitNew(e.target.value)} className={INPUT} />
            </Field>
            <Field label="For every old share(s)">
              <input inputMode="decimal" value={splitOld} onChange={(e) => setSplitOld(e.target.value)} className={INPUT} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-neutral-500">2 for 1 doubles your shares. A 1-for-10 reverse split is 1 new for every 10 old.</p>
          {dateField}
        </div>
      ) : action === 'transfer' ? (
        <div className="flex flex-col gap-4">
          <Field label="Ticker">{tickerSelect}</Field>
          <Field label="Quantity" hint={held ? `You hold ${fmtQty(Number(held.quantity))}` : undefined}>
            <span className="flex gap-2">
              <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={INPUT} />
              {held && (
                <Button size="md" onClick={() => setQty(fmtQty(Number(held.quantity)))}>
                  All
                </Button>
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
          {dateField}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Ticker">
            <input autoFocus value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. VOO" className={`${INPUT} uppercase`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Average cost per share">
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={INPUT} />
            </Field>
          </div>
          {dateField}
        </div>
      )}

      <div className="rounded-xl bg-(--card-raised) px-4 py-3 text-sm">
        {action === 'existing' && total !== null ? (
          <div className="flex justify-between">
            <span className="text-neutral-400">Total</span>
            <span className="font-semibold tabular-nums text-white">{currency(total)}</span>
          </div>
        ) : action === 'split' && held && num(splitNew) && num(splitOld) && num(splitNew) !== num(splitOld) ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-neutral-400">Shares</span>
              <span className="tabular-nums text-white">
                {fmtQty(Number(held.quantity))} → {fmtQty((Number(held.quantity) * num(splitNew)!) / num(splitOld)!)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Average cost</span>
              <span className="tabular-nums text-white">
                {currency(Number(held.avg_cost))} → {currency((Number(held.avg_cost) * num(splitOld)!) / num(splitNew)!)}
              </span>
            </div>
          </div>
        ) : action === 'transfer' && held ? (
          <span className="text-neutral-400">Average cost {currency(Number(held.avg_cost))}/share carries over.</span>
        ) : (
          <span className="text-neutral-500">Cash available {currency(cashAvailable)}</span>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button variant="primary" onClick={submit} disabled={busy} className="w-full">
        {busy
          ? 'Saving…'
          : action === 'existing'
            ? 'Add shares I already own'
            : action === 'split'
              ? 'Record split'
              : action === 'transfer'
                ? 'Transfer'
                : action === 'balance'
                  ? 'Match broker balance'
                  : `Record ${action}`}
      </Button>
    </div>
  )
}

/** "Match broker balance": type what the broker shows (negative = margin used) and why it
 * differs, with the current balance and the change it makes. */
function BalanceFields({
  cash,
  amount,
  setAmount,
  reason,
  setReason,
}: {
  cash: number
  amount: string
  setAmount: (v: string) => void
  reason: 'correction' | 'interest'
  setReason: (v: 'correction' | 'interest') => void
}) {
  const target = num(amount)
  const delta = target === null ? null : target - cash
  const show = (n: number) => (n < 0 ? `${currency(-n)} margin used` : currency(n))
  return (
    <>
      <Field
        label="Cash balance at your broker"
        hint={
          <>
            Now {show(cash)}. Enter a negative number for margin used, e.g. <span className="tabular-nums text-neutral-300">-33,481.61</span>.
            {delta !== null && delta !== 0 && (
              <span className={`mt-0.5 block ${delta < 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                Changes cash by {delta > 0 ? '+' : '−'}
                {currency(Math.abs(delta))} → {show(target!)}
              </span>
            )}
          </>
        }
      >
        <span className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-33,481.61" className={`${INPUT} pl-7`} />
        </span>
      </Field>
      <Field
        label="Why is it different?"
        hint={
          reason === 'correction'
            ? 'Setup or correction, e.g. shares added with “Shares I already own” that were bought on margin. Treated as money in/out, so it isn’t a gain or loss.'
            : 'Margin interest or fees: a real cost, so it lowers your return.'
        }
      >
        <Segmented
          options={[
            { value: 'correction', label: 'Setup / correction' },
            { value: 'interest', label: 'Interest or fees' },
          ]}
          value={reason}
          onChange={setReason}
          size="sm"
        />
      </Field>
    </>
  )
}
