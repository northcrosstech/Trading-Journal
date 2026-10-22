import { useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import type { CspPosition, OptionPosition } from '../lib/database.types'
import { cspEdit, cspResolve, optionClose, optionEdit, setCspMark, setOptionMark, undoPositionLast, type SymbolPrice } from '../lib/wealthQueries'
import { OPTION_MULTIPLIER, cspAnnualizedYield, cspCollateral, cspLiability, cspStats, optionGain, optionValue } from '../lib/portfolio'
import { centralDateStr, currency, dateFmt, percentFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { parseAmount, useDialog, validators, type DialogField } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill, type PillTone } from './ui/Pill'
import { Menu, type MenuItem } from './ui/Menu'
import { EmptyState } from './ui/EmptyState'

const daysTo = (iso: string, from: string) => Math.round((Date.parse(iso) - Date.parse(from)) / 86_400_000)
const pct = (n: number | null) => (n === null ? '—' : percentFmt(n).replace('+', ''))

/** One row in the unified options table -- long calls/puts and covered calls come from
 * option_positions, cash-secured puts from csp_positions. */
type Row = {
  key: string
  label: string
  type: { label: string; tone: PillTone }
  tags: { label: string; tone: PillTone }[]
  expiration: string
  stock: number | undefined
  premium: number // $ paid (long) or received (short)
  premiumWord: 'paid' | 'received'
  value: number // $ value (long) or $ to buy back (short)
  valueWord: string
  marked: boolean
  gain: number
  extra?: string
  menu: MenuItem[]
}

const STATUS_LABEL: Record<string, string> = { closed: 'Closed', expired: 'Expired', exercised: 'Exercised', assigned: 'Assigned' }

/** All open option positions in one table, with row actions (update price, close, expire,
 * exercise/assign) in a menu. There's no free option price feed: a long option counts at
 * what was paid until you enter today's price; short ones at their in-the-money amount. */
export function OptionsCard({
  options,
  csps,
  prices,
  onChanged,
  onAdd,
}: {
  options: OptionPosition[]
  csps: CspPosition[]
  prices: Map<string, SymbolPrice>
  onChanged: () => void
  onAdd: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const [showHistory, setShowHistory] = useState(false)
  const today = centralDateStr(new Date())
  const resolveDate = (expiration: string) => (expiration < today ? expiration : today)

  async function run(p: Promise<unknown>, message: string) {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function askPrice(title: string, current: number | null, description?: string, allowBlank = false) {
    const v = await dialog.form({
      title,
      description,
      submitLabel: 'Save',
      fields: [
        {
          name: 'price',
          label: 'Price per share',
          type: 'number',
          prefix: '$',
          defaultValue: current !== null ? String(current) : '',
          placeholder: 'e.g. 4.20',
          optional: allowBlank,
          validate: allowBlank ? validators.nonNegative : (s) => validators.nonNegative(s) ?? (s.trim() === '' ? 'Required' : null),
          hint: allowBlank ? 'From your broker. Leave blank to go back to the estimate.' : 'As quoted by your broker (per share, not per contract).',
        },
      ],
    })
    if (!v) return undefined
    return v.price === '' ? null : parseAmount(v.price)
  }

  const labelOf = (symbol: string, strike: number, type: 'call' | 'put') => `${symbol} ${Number(strike)}${type === 'call' ? 'C' : 'P'}`

  /** The fields shared by editing an option and a put: the contract and what was paid/received. */
  const contractFields = (
    p: { symbol: string; strike: number; expiration: string; contracts: number; price: number; openedOn: string },
    priceLabel: string,
  ): DialogField[] => [
    { name: 'symbol', label: 'Ticker', defaultValue: p.symbol, validate: validators.required },
    { name: 'strike', label: 'Strike', type: 'number', prefix: '$', defaultValue: String(Number(p.strike)), validate: validators.positive },
    { name: 'expiration', label: 'Expiration', type: 'date', defaultValue: p.expiration, validate: validators.required },
    {
      name: 'contracts',
      label: 'Contracts',
      type: 'number',
      defaultValue: String(p.contracts),
      validate: (s) => (Number.isInteger(Number(s)) && Number(s) > 0 ? null : 'Enter a whole number above 0'),
    },
    {
      name: 'price',
      label: priceLabel,
      type: 'number',
      prefix: '$',
      defaultValue: String(Number(p.price)),
      hint: 'Per share, as quoted.',
      validate: (s) => validators.required(s) ?? validators.nonNegative(s),
    },
    { name: 'on', label: 'Opened on', type: 'date', defaultValue: p.openedOn, validate: validators.required },
  ]
  const EDIT_NOTE = 'The original is reversed and this is saved in its place — the premium in cash updates to match.'

  async function editOption(o: OptionPosition) {
    const long = o.side === 'long'
    const fields = contractFields(
      { symbol: o.symbol, strike: o.strike, expiration: o.expiration, contracts: o.contracts, price: o.open_price, openedOn: o.opened_on },
      long ? 'Price paid' : 'Premium received',
    )
    if (long)
      fields.push({
        name: 'hedge',
        label: 'Hedge',
        type: 'select',
        defaultValue: o.is_hedge ? 'yes' : 'no',
        options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes — protects other positions' },
        ],
      })
    const v = await dialog.form({ title: `Edit ${labelOf(o.symbol, o.strike, o.option_type)}`, description: EDIT_NOTE, submitLabel: 'Save changes', fields })
    if (!v) return
    run(
      optionEdit({
        optionId: o.id,
        symbol: v.symbol.toUpperCase(),
        strike: parseAmount(v.strike)!,
        expiration: v.expiration,
        contracts: Number(v.contracts),
        price: parseAmount(v.price)!,
        isHedge: long ? v.hedge === 'yes' : false,
        on: v.on,
      }),
      'Option updated',
    )
  }

  async function editCsp(c: CspPosition) {
    const fields = contractFields(
      { symbol: c.symbol, strike: c.strike, expiration: c.expiration, contracts: c.contracts, price: c.premium, openedOn: c.opened_on },
      'Premium received',
    )
    const v = await dialog.form({ title: `Edit ${labelOf(c.symbol, c.strike, 'put')}`, description: EDIT_NOTE, submitLabel: 'Save changes', fields })
    if (!v) return
    run(
      cspEdit({
        cspId: c.id,
        symbol: v.symbol.toUpperCase(),
        strike: parseAmount(v.strike)!,
        expiration: v.expiration,
        contracts: Number(v.contracts),
        premium: parseAmount(v.price)!,
        on: v.on,
      }),
      'Put updated',
    )
  }

  async function deletePosition(label: string, target: { optionId?: string; cspId?: string }) {
    if (
      await dialog.confirm({
        title: `Delete ${label}?`,
        message: 'For a position entered by mistake: it’s removed and its premium reversed in cash. To record a real close, use Sell / Buy back / Expired instead.',
        confirmLabel: 'Delete position',
        tone: 'danger',
      })
    )
      run(undoPositionLast(target), `${label} deleted`)
  }

  async function reopen(label: string, status: string, target: { optionId?: string; cspId?: string }) {
    if (
      await dialog.confirm({
        title: `Reopen ${label}?`,
        message: `Undoes “${status}” — cash, shares and the realized gain go back to how they were before it.`,
        confirmLabel: 'Reopen',
        tone: 'warning',
      })
    )
      run(undoPositionLast(target), `${label} reopened`)
  }

  const optionRows: Row[] = options
    .filter((o) => o.status === 'open')
    .map((o) => {
      const label = labelOf(o.symbol, o.strike, o.option_type)
      const n = o.contracts * OPTION_MULTIPLIER
      const long = o.side === 'long'
      const tags: Row['tags'] = []
      if (long && daysTo(o.expiration, o.opened_on) > 365) tags.push({ label: 'LEAPS', tone: 'violet' })
      if (o.is_hedge) tags.push({ label: 'Hedge', tone: 'sky' })
      const menu: MenuItem[] = [
        {
          label: 'Update price',
          onClick: async () => {
            const v = await askPrice(`Update ${label} price`, o.mark !== null ? Number(o.mark) : null, undefined, true)
            if (v !== undefined) run(setOptionMark(o.id, v), `${label} price updated`)
          },
        },
        {
          label: long ? 'Sell to close' : 'Buy back',
          onClick: async () => {
            const v = await askPrice(`${long ? 'Sell' : 'Buy back'} ${label} ×${o.contracts}`, o.mark !== null ? Number(o.mark) : null)
            if (v !== undefined && v !== null)
              run(optionClose({ optionId: o.id, outcome: 'closed', price: v, on: today }), `${label} ${long ? 'sold' : 'bought back'}`)
          },
        },
        {
          label: 'Expired worthless',
          onClick: async () => {
            if (await dialog.confirm({ title: `${label} expired worthless?`, message: long ? 'Records the premium paid as a loss.' : 'You keep the full premium.', confirmLabel: 'Mark expired' }))
              run(optionClose({ optionId: o.id, outcome: 'expired', on: resolveDate(o.expiration) }), `${label} marked expired`)
          },
        },
      ]
      if (long && o.option_type === 'call')
        menu.push({
          label: 'Exercise',
          tone: 'warning',
          onClick: async () => {
            if (
              await dialog.confirm({
                title: `Exercise ${label}?`,
                message: `Buys ${n} ${o.symbol} at ${Number(o.strike)} — ${currency(Number(o.strike) * n)} from cash. Their cost basis includes the premium you paid.`,
                confirmLabel: 'Exercise',
                tone: 'warning',
              })
            )
              run(optionClose({ optionId: o.id, outcome: 'exercised', on: resolveDate(o.expiration) }), `${label} exercised`)
          },
        })
      if (!long)
        menu.push({
          label: 'Assigned',
          tone: 'warning',
          onClick: async () => {
            if (
              await dialog.confirm({
                title: `${label} assigned?`,
                message: `Sells ${n} ${o.symbol} at ${Number(o.strike)} — ${currency(Number(o.strike) * n)} to cash.`,
                confirmLabel: 'Mark assigned',
                tone: 'warning',
              })
            )
              run(optionClose({ optionId: o.id, outcome: 'assigned', on: resolveDate(o.expiration) }), `${label} assigned`)
          },
        })
      menu.push({ label: 'Edit…', onClick: () => editOption(o) }, { label: 'Delete', tone: 'danger', onClick: () => deletePosition(label, { optionId: o.id }) })
      return {
        key: o.id,
        label: `${label} ×${o.contracts}`,
        type: long ? { label: o.option_type === 'call' ? 'Long call' : 'Long put', tone: o.option_type === 'call' ? 'green' : 'red' } : { label: 'Covered call', tone: 'amber' },
        tags,
        expiration: o.expiration,
        stock: prices.get(o.symbol)?.close,
        premium: Number(o.open_price) * n,
        premiumWord: long ? 'paid' : 'received',
        value: Math.abs(optionValue(o, prices)),
        valueWord: o.mark !== null ? `@ ${Number(o.mark)}` : long ? 'not updated' : 'est. to buy back',
        marked: o.mark !== null,
        gain: optionGain(o, prices),
        menu,
      }
    })

  const cspRows: Row[] = csps
    .filter((c) => c.status === 'open')
    .map((c) => {
      const label = labelOf(c.symbol, c.strike, 'put')
      const premium = Number(c.premium) * OPTION_MULTIPLIER * c.contracts
      const liability = cspLiability(c, prices)
      const menu: MenuItem[] = [
        {
          label: 'Update price',
          onClick: async () => {
            const v = await askPrice(`Update ${label} price`, c.mark !== null ? Number(c.mark) : null, undefined, true)
            if (v !== undefined) run(setCspMark(c.id, v), `${label} price updated`)
          },
        },
        {
          label: 'Buy back',
          onClick: async () => {
            const v = await askPrice(`Buy back ${label} ×${c.contracts}`, c.mark !== null ? Number(c.mark) : null)
            if (v !== undefined && v !== null) run(cspResolve({ cspId: c.id, outcome: 'closed', price: v, on: today }), `${label} bought back`)
          },
        },
        {
          label: 'Expired worthless',
          onClick: async () => {
            if (await dialog.confirm({ title: `${label} expired worthless?`, message: 'You keep the full premium.', confirmLabel: 'Mark expired' }))
              run(cspResolve({ cspId: c.id, outcome: 'expired', on: resolveDate(c.expiration) }), `${label} marked expired`)
          },
        },
        {
          label: 'Assigned',
          tone: 'warning',
          onClick: async () => {
            if (
              await dialog.confirm({
                title: `${label} assigned?`,
                message: `Buys ${c.contracts * OPTION_MULTIPLIER} ${c.symbol} at ${Number(c.strike)} — ${currency(cspCollateral(c))} from cash. Cost basis is strike minus the premium.`,
                confirmLabel: 'Mark assigned',
                tone: 'warning',
              })
            )
              run(cspResolve({ cspId: c.id, outcome: 'assigned', on: resolveDate(c.expiration) }), `${label} assigned`)
          },
        },
        { label: 'Edit…', onClick: () => editCsp(c) },
        { label: 'Delete', tone: 'danger', onClick: () => deletePosition(label, { cspId: c.id }) },
      ]
      return {
        key: c.id,
        label: `${label} ×${c.contracts}`,
        type: { label: 'Cash-secured put', tone: 'teal' },
        tags: [],
        expiration: c.expiration,
        stock: prices.get(c.symbol)?.close,
        premium,
        premiumWord: 'received',
        value: liability,
        valueWord: c.mark !== null ? `@ ${Number(c.mark)}` : 'est. to buy back',
        marked: c.mark !== null,
        gain: premium - liability,
        extra: `${currency(cspCollateral(c))} set aside · ${pct(cspAnnualizedYield(c))}/yr`,
        menu,
      }
    })

  const rows = [...optionRows, ...cspRows].sort((a, b) => a.expiration.localeCompare(b.expiration))
  const stats = cspStats(csps)
  const unrealized = rows.reduce((s, r) => s + r.gain, 0)

  const history = [
    ...options
      .filter((o) => o.status !== 'open')
      .map((o) => {
        const n = o.contracts * OPTION_MULTIPLIER
        const premium = Number(o.open_price) * n
        const exit = o.close_price !== null ? Number(o.close_price) * n : 0
        const result = o.status === 'exercised' || o.status === 'assigned' ? null : o.side === 'long' ? exit - premium : premium - exit
        return { key: o.id, label: `${labelOf(o.symbol, o.strike, o.option_type)} ×${o.contracts}`, kind: o.side === 'long' ? `Long ${o.option_type}` : 'Covered call', status: STATUS_LABEL[o.status], date: o.closed_on, result, target: { optionId: o.id } }
      }),
    ...csps
      .filter((c) => c.status !== 'open')
      .map((c) => {
        const credit = Number(c.premium) * OPTION_MULTIPLIER * c.contracts
        const kept = c.status === 'closed' && c.close_price !== null ? credit - Number(c.close_price) * OPTION_MULTIPLIER * c.contracts : credit
        return { key: c.id, label: `${labelOf(c.symbol, c.strike, 'put')} ×${c.contracts}`, kind: 'Cash-secured put', status: c.status === 'closed' ? 'Bought back' : STATUS_LABEL[c.status], date: c.closed_on, result: kept, target: { cspId: c.id } }
      }),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return (
    <Card
      title="Options"
      subtitle={
        rows.length > 0 ? (
          <>
            {rows.length} open · unrealized <span className={toneClass(unrealized)}>{currency(unrealized)}</span>
            {stats.premiumCollected !== 0 && <> · puts premium kept {currency(stats.premiumCollected)}</>}
          </>
        ) : undefined
      }
      flush
      actions={
        <Button size="sm" icon={<Plus size={14} />} onClick={onAdd}>
          Add option
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={<Layers size={20} />} title="No open options">
          Long calls and puts (LEAPS, hedges), covered calls and cash-secured puts show up here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                <th className="px-5 py-2.5">Position</th>
                <th className="px-3 py-2.5">Expires</th>
                <th className="px-3 py-2.5 text-right">Premium</th>
                <th className="px-3 py-2.5 text-right">Value</th>
                <th className="px-3 py-2.5 text-right">Gain</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dte = daysTo(r.expiration, today)
                return (
                  <tr key={r.key} className="border-b border-(--border) transition last:border-0 hover:bg-white/2">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-white">{r.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Pill tone={r.type.tone}>{r.type.label}</Pill>
                        {r.tags.map((t) => (
                          <Pill key={t.label} tone={t.tone}>
                            {t.label}
                          </Pill>
                        ))}
                        {r.stock !== undefined && <span className="text-xs text-neutral-500">stock {r.stock.toFixed(2)}</span>}
                      </div>
                      {r.extra && <div className="mt-1 text-xs text-neutral-500">{r.extra}</div>}
                    </td>
                    <td className="px-3 py-3 text-neutral-300">
                      {dateFmt(r.expiration)}
                      <div className={`text-xs ${dte <= 7 ? 'text-amber-400' : 'text-neutral-500'}`}>{dte >= 0 ? `${dte}d left` : 'expired'}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-300">
                      {currency(r.premium)}
                      <div className="text-xs text-neutral-500">{r.premiumWord}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-100">
                      {currency(r.value)}
                      <div className={`text-xs ${r.marked ? 'text-neutral-500' : 'text-amber-500/80'}`}>{r.valueWord}</div>
                    </td>
                    <td className={`px-3 py-3 text-right font-medium tabular-nums ${toneClass(r.gain)}`}>
                      {currency(r.gain)}
                      {r.premium > 0 && <div className="text-xs font-normal">{percentFmt(r.gain / r.premium)}</div>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Menu items={r.menu} label={`Actions for ${r.label}`} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <div className="border-t border-(--border) px-5 py-3 text-sm">
          <button onClick={() => setShowHistory((v) => !v)} className="text-xs font-medium text-neutral-500 transition hover:text-neutral-200">
            {showHistory ? 'Hide' : 'Show'} {history.length} closed option{history.length === 1 ? '' : 's'}
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col divide-y divide-(--border)">
              {history.map((h) => (
                <div key={h.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-neutral-300">
                    {h.label} <span className="text-neutral-500">· {h.kind}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className="text-neutral-500">
                      {h.status}
                      {h.date && ` ${dateFmt(h.date)}`}
                    </span>
                    {h.result !== null && <span className={`font-medium tabular-nums ${toneClass(h.result)}`}>{currency(h.result)}</span>}
                    <button
                      onClick={() => reopen(h.label, h.status, h.target)}
                      title="Undo this close if it was a mistake"
                      className="rounded-md px-1.5 py-0.5 text-neutral-500 transition hover:bg-(--card-raised) hover:text-white"
                    >
                      Reopen
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
