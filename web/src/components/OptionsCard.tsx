import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Plus, X } from 'lucide-react'
import type { CspPosition, Holding, OptionPosition } from '../lib/database.types'
import { cspEdit, cspResolve, optionClose, optionEdit, setCspMark, setOptionMark, undoPositionLast, type SymbolPrice } from '../lib/wealthQueries'
import { OPTION_MULTIPLIER, cspAnnualizedYield, cspCollateral, cspLiability, cspStats, optionGain, optionValue } from '../lib/portfolio'
import { centralDateStr, currency, dateFmt, percentFmt, priceFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { parseAmount, useDialog, validators, type DialogField, type FormOptions } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { contractLabel, daysTo, openContractLines, type ContractLine, type OptionLot } from '../lib/optionLines'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill, type PillTone } from './ui/Pill'
import { Menu, type MenuItem } from './ui/Menu'
import { EmptyState } from './ui/EmptyState'
import { SortTh } from './SortTh'
import { sortRows, useSort } from '../lib/useSort'
import type { OptionFormInitial, OptionKind } from './OptionTradeForm'

const pct = (n: number | null) => (n === null ? '—' : percentFmt(n).replace('+', ''))
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const shareCount = (n: number) => Number(n.toFixed(6))

type Tag = { label: string; tone: PillTone }
type Outcome = 'closed' | 'expired' | 'assigned' | 'exercised'

/** One purchase or sale of a contract (a row of option_positions or csp_positions), with
 * the calls that act on it. */
type Lot = {
  id: string
  /** "Jan 5, 2026 ×2": how a lot is named when a contract has several. */
  name: string
  openedOn: string
  contracts: number
  openPrice: number // per share
  mark: number | null
  premium: number // $ paid (long) or received (short)
  value: number // $ value (long) or $ to buy back (short)
  valueWord: string
  gain: number
  /** Cash set aside for a sold put. */
  collateral: number
  tags: Tag[]
  extra?: string
  setMark: (mark: number | null) => Promise<unknown>
  /** `contracts` closes only that many of this lot; left out, the whole lot. */
  resolve: (outcome: Outcome, on: string, price?: number, contracts?: number) => Promise<unknown>
  edit: () => void
  remove: () => void
}

/** One contract in the table: every open lot of it added up. Long calls/puts and covered
 * calls come from option_positions, cash-secured puts from csp_positions. */
type Row = {
  key: string
  symbol: string
  /** "AAPL 150C" */
  name: string
  /** With the contract count, as shown and sorted: "AAPL 150C ×3". */
  label: string
  strike: number
  contracts: number
  long: boolean
  isCsp: boolean
  canExercise: boolean
  canAssign: boolean
  type: Tag
  tags: Tag[]
  expiration: string
  premium: number
  premiumWord: 'paid' | 'received'
  value: number
  valueWord: string
  marked: boolean
  gain: number
  extra?: string
  lots: Lot[]
  /** What "+ Add" fills the option form with. */
  initial: OptionFormInitial
}

/** A contract line, or one lot of it, that an action applies to. */
type Target = Pick<Row, 'symbol' | 'name' | 'strike' | 'long' | 'isCsp' | 'canExercise' | 'canAssign' | 'expiration'> & { lots: Lot[] }

/** One lot an action runs on, and how many of its contracts (left out: all of them). */
type Step = { lot: Lot; take?: number }

/** What was saved when an action ran over several lots and one of them failed. */
type Batch = { done: Lot[]; failed: { lot: Lot; message: string } | null; rest: Lot[] }

const STATUS_LABEL: Record<string, string> = { closed: 'Closed', expired: 'Expired', exercised: 'Exercised', assigned: 'Assigned' }
const FORM_KIND: Partial<Record<ContractLine['kind'], OptionKind>> = { long_call: 'buy_call', long_put: 'buy_put', short_call: 'covered_call', csp: 'csp' }

const OPTION_SORT_KEYS = ['label', 'expires', 'premium', 'value', 'gain'] as const
const OPTION_ASC_FIRST = ['label', 'expires'] as const

/** All open option positions in one table, grouped by stock and then by contract: several
 * purchases of the same contract show as one line (open it to see each lot). Actions
 * (update price, close, expire, exercise/assign) are in each line's menu and apply to every
 * lot of the line; each lot keeps its own menu too. There's no free option price feed: a
 * long option counts at what was paid until you enter today's price; short ones at their
 * in-the-money amount. */
export function OptionsCard({
  options,
  csps,
  prices,
  holdings = [],
  onChanged,
  onAdd,
  focus,
}: {
  options: OptionPosition[]
  csps: CspPosition[]
  prices: Map<string, SymbolPrice>
  /** For the shares line under each stock: held, covered by sold calls, free. */
  holdings?: Holding[]
  onChanged: () => void
  /** Opens the option form, filled in with a contract when adding to an open line. */
  onAdd: (initial?: OptionFormInitial) => void
  /** Scrolls to a contract line (by its key) and highlights it. Pass a new object each time. */
  focus?: { key: string } | null
}) {
  const dialog = useDialog()
  const toast = useToast()
  const [showHistory, setShowHistory] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ title: string; lines: string[] } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const { state: sort, toggle: onSort } = useSort('options', OPTION_SORT_KEYS, OPTION_ASC_FIRST)
  const today = centralDateStr(new Date())
  const resolveDate = (expiration: string) => (expiration < today ? expiration : today)

  useEffect(() => {
    if (!focus) return
    const el = document.getElementById(`option-line-${focus.key}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(focus.key)
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [focus])

  async function run(p: Promise<unknown>, message: string) {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const priceField = (current: number | null, allowBlank: boolean): DialogField => ({
    name: 'price',
    label: 'Price per share',
    type: 'number',
    prefix: '$',
    defaultValue: current !== null ? String(current) : '',
    placeholder: 'e.g. 4.20',
    optional: allowBlank,
    validate: allowBlank ? validators.nonNegative : (s) => validators.nonNegative(s) ?? (s.trim() === '' ? 'Required' : null),
    hint: allowBlank ? 'From your broker. Leave blank to go back to the estimate.' : 'As quoted by your broker (per share, not per contract).',
  })
  const dateField = (defaultValue: string): DialogField => ({ name: 'on', label: 'Date', type: 'date', defaultValue, validate: validators.required })

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
    // Saved from inside the dialog, so a refused edit keeps what was typed.
    const v = await dialog.form({
      title: `Edit ${contractLabel(o.symbol, o.strike, o.option_type)}`,
      description: EDIT_NOTE,
      submitLabel: 'Save changes',
      fields,
      onSubmit: (v) =>
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
    })
    if (!v) return
    toast('Option updated')
    onChanged()
  }

  async function editCsp(c: CspPosition) {
    const fields = contractFields(
      { symbol: c.symbol, strike: c.strike, expiration: c.expiration, contracts: c.contracts, price: c.premium, openedOn: c.opened_on },
      'Premium received',
    )
    const v = await dialog.form({
      title: `Edit ${contractLabel(c.symbol, c.strike, 'put')}`,
      description: EDIT_NOTE,
      submitLabel: 'Save changes',
      fields,
      onSubmit: (v) =>
        cspEdit({
          cspId: c.id,
          symbol: v.symbol.toUpperCase(),
          strike: parseAmount(v.strike)!,
          expiration: v.expiration,
          contracts: Number(v.contracts),
          premium: parseAmount(v.price)!,
          on: v.on,
        }),
    })
    if (!v) return
    toast('Put updated')
    onChanged()
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

  /** Asks once, then runs `each` on every lot in order (oldest first), stopping at the first
   * that fails. `plan` narrows that to some lots, or part of one, from what was typed. If
   * nothing was saved the dialog stays open with the reason and what was typed; if some
   * lots were saved, it closes and the card says which were and which weren't. */
  async function act(
    t: Target,
    what: string,
    form: Omit<FormOptions, 'onSubmit'>,
    each: (lot: Lot, values: Record<string, string>, take?: number) => Promise<unknown>,
    doneMessage: string,
    plan: (values: Record<string, string>) => Step[] = () => t.lots.map((lot) => ({ lot })),
  ) {
    const out: { batch: Batch | null } = { batch: null }
    const v = await dialog.form({
      ...form,
      onSubmit: async (values) => {
        const steps = plan(values)
        const done: Lot[] = []
        for (const [i, step] of steps.entries()) {
          try {
            await each(step.lot, values, step.take)
            done.push(step.lot)
          } catch (e) {
            out.batch = { done, failed: { lot: step.lot, message: errorText(e) }, rest: steps.slice(i + 1).map((x) => x.lot) }
            if (done.length === 0) throw e
            return
          }
        }
        out.batch = { done, failed: null, rest: [] }
      },
    })
    const batch = out.batch
    if (!v || !batch) return
    if (batch.failed) {
      const names = (lots: Lot[]) => lots.map((l) => l.name).join(', ')
      setNotice({
        title: `${what} ${t.name}: only some lots were recorded`,
        lines: [
          `Recorded: ${names(batch.done)}.`,
          `Not recorded: ${batch.failed.lot.name} (${batch.failed.message})${batch.rest.length > 0 ? `, and so ${names(batch.rest)} ${batch.rest.length === 1 ? 'was' : 'were'} not tried` : ''}.`,
          'Fix the cause, then use the menu of each lot that is left.',
        ],
      })
      toast(`${what} ${t.name} stopped part-way. See the note on the Options card.`, 'error')
    } else toast(doneMessage)
    onChanged()
  }

  const contractsOf = (t: Target) => t.lots.reduce((s, l) => s + l.contracts, 0)
  /** The price every lot was last updated to, when they agree. */
  const sharedMark = (t: Target) => (t.lots.every((l) => l.mark === t.lots[0].mark) ? t.lots[0].mark : null)
  const allLots = (t: Target, sentence: string) => (t.lots.length > 1 ? sentence : undefined)

  /** "Contracts" on the closing dialogs, filled in with all of them. Not shown for a single
   * contract, where there is nothing to choose. */
  const countField = (t: Target): DialogField[] => {
    const total = contractsOf(t)
    if (total <= 1) return []
    return [
      {
        name: 'contracts',
        label: 'Contracts',
        type: 'number',
        defaultValue: String(total),
        hint: t.lots.length > 1 ? `You have ${total}. For fewer, the oldest purchases go first.` : `You have ${total}.`,
        validate: (s) => (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= total ? null : `Enter a whole number from 1 to ${total}`),
      },
    ]
  }

  /** The lots a closing action touches for the count typed, oldest first: whole lots until
   * the count runs out, then part of the next one. */
  const oldestFirst =
    (t: Target) =>
    (values: Record<string, string>): Step[] => {
      let left = values.contracts ? Number(values.contracts) : contractsOf(t)
      const steps: Step[] = []
      for (const lot of t.lots) {
        if (left <= 0) break
        const take = Math.min(left, lot.contracts)
        steps.push(take === lot.contracts ? { lot } : { lot, take })
        left -= take
      }
      return steps
    }

  /** Shares and dollars for every contract of the target, plus the per-contract figures
   * when the count can be lowered. */
  const sharesAtStrike = (t: Target) => {
    const total = contractsOf(t)
    return {
      n: total * OPTION_MULTIPLIER,
      each: total > 1 ? ` (${OPTION_MULTIPLIER} shares and ${currency(t.strike * OPTION_MULTIPLIER)} per contract)` : '',
    }
  }

  const updatePrice = (t: Target) =>
    act(
      t,
      'Update price of',
      {
        title: `Update ${t.name} price`,
        description: allLots(t, `Sets the price on all ${t.lots.length} lots of this contract.`),
        submitLabel: 'Save',
        fields: [priceField(sharedMark(t), true)],
      },
      (lot, v) => lot.setMark(v.price === '' ? null : parseAmount(v.price)),
      `${t.name} price updated`,
    )

  const closeAtPrice = (t: Target) =>
    act(
      t,
      t.long ? 'Sell to close' : 'Buy back',
      {
        title: `${t.long ? 'Sell' : 'Buy back'} ${t.name} ×${contractsOf(t)}`,
        description: allLots(t, `All ${t.lots.length} lots are ${t.long ? 'sold' : 'bought back'} at this price unless you lower the count.`),
        submitLabel: 'Save',
        fields: [priceField(sharedMark(t), false), ...countField(t), dateField(today)],
      },
      (lot, v, take) => lot.resolve('closed', v.on, parseAmount(v.price)!, take),
      `${t.name} ${t.long ? 'sold' : 'bought back'}`,
      oldestFirst(t),
    )

  const expire = (t: Target) =>
    act(
      t,
      'Expired worthless',
      {
        title: `${t.name} expired worthless?`,
        description: `${t.long ? 'Records the premium paid as a loss.' : 'You keep the full premium.'}${t.lots.length > 1 ? ` Applies to all ${t.lots.length} lots unless you lower the count.` : ''}`,
        submitLabel: 'Mark expired',
        fields: [...countField(t), dateField(resolveDate(t.expiration))],
      },
      (lot, v, take) => lot.resolve('expired', v.on, undefined, take),
      `${t.name} marked expired`,
      oldestFirst(t),
    )

  const exercise = (t: Target) => {
    const { n, each } = sharesAtStrike(t)
    return act(
      t,
      'Exercise',
      {
        title: `Exercise ${t.name}?`,
        description: `Buys ${n} ${t.symbol} at ${t.strike} — ${currency(t.strike * n)} from cash${each}. Their cost basis includes the premium you paid.`,
        submitLabel: 'Exercise',
        tone: 'warning',
        fields: [...countField(t), dateField(resolveDate(t.expiration))],
      },
      (lot, v, take) => lot.resolve('exercised', v.on, undefined, take),
      `${t.name} exercised`,
      oldestFirst(t),
    )
  }

  const assign = (t: Target) => {
    const { n, each } = sharesAtStrike(t)
    const what = t.isCsp
      ? `Buys ${n} ${t.symbol} at ${t.strike} — ${currency(t.lots.reduce((s, l) => s + l.collateral, 0))} from cash${each}. Cost basis is strike minus the premium.`
      : `Sells ${n} ${t.symbol} at ${t.strike} — ${currency(t.strike * n)} to cash${each}.`
    return act(
      t,
      'Assigned',
      {
        title: `${t.name} assigned?`,
        description: what,
        submitLabel: 'Mark assigned',
        tone: 'warning',
        fields: [...countField(t), dateField(resolveDate(t.expiration))],
      },
      (lot, v, take) => lot.resolve('assigned', v.on, undefined, take),
      `${t.name} assigned`,
      oldestFirst(t),
    )
  }

  /** The menu for a whole contract line, or for one lot of it. Edit and Delete act on a
   * single lot, so a line made of several shows them on each lot instead. */
  const menuFor = (t: Target): MenuItem[] => {
    const menu: MenuItem[] = [
      { label: 'Update price', onClick: () => updatePrice(t) },
      { label: t.long ? 'Sell to close' : 'Buy back', onClick: () => closeAtPrice(t) },
      { label: 'Expired worthless', onClick: () => expire(t) },
    ]
    if (t.canExercise) menu.push({ label: 'Exercise', tone: 'warning', onClick: () => exercise(t) })
    if (t.canAssign) menu.push({ label: 'Assigned', tone: 'warning', onClick: () => assign(t) })
    if (t.lots.length === 1) menu.push({ label: 'Edit…', onClick: t.lots[0].edit }, { label: 'Delete', tone: 'danger', onClick: t.lots[0].remove })
    return menu
  }

  const lotOf = (l: OptionLot, name: string): Lot => {
    if (l.source === 'option') {
      const o = l.o
      const n = o.contracts * OPTION_MULTIPLIER
      const long = o.side === 'long'
      const tags: Tag[] = []
      if (long && daysTo(o.expiration, o.opened_on) > 365) tags.push({ label: 'LEAPS', tone: 'violet' })
      if (o.is_hedge) tags.push({ label: 'Hedge', tone: 'sky' })
      return {
        id: o.id,
        name: `${dateFmt(o.opened_on)} ×${o.contracts}`,
        openedOn: o.opened_on,
        contracts: o.contracts,
        openPrice: Number(o.open_price),
        mark: o.mark !== null ? Number(o.mark) : null,
        premium: Number(o.open_price) * n,
        value: Math.abs(optionValue(o, prices)),
        valueWord: o.mark !== null ? `@ ${Number(o.mark)}` : long ? 'not updated' : 'est. to buy back',
        gain: optionGain(o, prices),
        collateral: 0,
        tags,
        setMark: (mark) => setOptionMark(o.id, mark),
        resolve: (outcome, on, price, contracts) =>
          optionClose(outcome === 'closed' ? { optionId: o.id, outcome, price, on, contracts } : { optionId: o.id, outcome, on, contracts }),
        edit: () => editOption(o),
        remove: () => deletePosition(name, { optionId: o.id }),
      }
    }
    const c = l.c
    const premium = Number(c.premium) * OPTION_MULTIPLIER * c.contracts
    const liability = cspLiability(c, prices)
    return {
      id: c.id,
      name: `${dateFmt(c.opened_on)} ×${c.contracts}`,
      openedOn: c.opened_on,
      contracts: c.contracts,
      openPrice: Number(c.premium),
      mark: c.mark !== null ? Number(c.mark) : null,
      premium,
      value: liability,
      valueWord: c.mark !== null ? `@ ${Number(c.mark)}` : 'est. to buy back',
      gain: premium - liability,
      collateral: cspCollateral(c),
      tags: [],
      extra: `${currency(cspCollateral(c))} set aside · ${pct(cspAnnualizedYield(c))}/yr`,
      setMark: (mark) => setCspMark(c.id, mark),
      resolve: (outcome, on, price, contracts) => {
        if (outcome === 'exercised') return Promise.reject(new Error('A sold put can’t be exercised.'))
        return cspResolve(outcome === 'closed' ? { cspId: c.id, outcome, price, on, contracts } : { cspId: c.id, outcome, on, contracts })
      },
      edit: () => editCsp(c),
      remove: () => deletePosition(name, { cspId: c.id }),
    }
  }

  const rowOf = (line: ContractLine): Row => {
    const name = contractLabel(line.symbol, line.strike, line.optionType)
    const lots = line.lots.map((l) => lotOf(l, name))
    const isCsp = line.kind === 'csp'
    const long = line.kind === 'long_call' || line.kind === 'long_put'
    const marked = lots.every((l) => l.mark !== null)
    const sameMark = lots.every((l) => l.mark === lots[0].mark)
    const tags: Tag[] = []
    for (const t of lots.flatMap((l) => l.tags)) if (!tags.some((x) => x.label === t.label)) tags.push(t)
    const collateral = lots.reduce((s, l) => s + l.collateral, 0)
    return {
      key: line.key,
      symbol: line.symbol,
      name,
      label: `${name} ×${line.contracts}`,
      strike: line.strike,
      contracts: line.contracts,
      long,
      isCsp,
      canExercise: line.kind === 'long_call',
      canAssign: !long,
      type: isCsp
        ? { label: 'Cash-secured put', tone: 'teal' }
        : long
          ? { label: line.optionType === 'call' ? 'Long call' : 'Long put', tone: line.optionType === 'call' ? 'green' : 'red' }
          : { label: 'Covered call', tone: 'amber' },
      tags,
      expiration: line.expiration,
      premium: lots.reduce((s, l) => s + l.premium, 0),
      premiumWord: long ? 'paid' : 'received',
      value: lots.reduce((s, l) => s + l.value, 0),
      // Several lots: say so when their prices were not all updated, or not to the same price.
      valueWord: sameMark ? lots[0].valueWord : marked ? 'lots at different prices' : 'partly updated',
      marked,
      gain: lots.reduce((s, l) => s + l.gain, 0),
      extra: !isCsp ? undefined : lots.length === 1 ? lots[0].extra : `${currency(collateral)} set aside`,
      lots,
      initial: { kind: FORM_KIND[line.kind], symbol: line.symbol, strike: line.strike, expiration: line.expiration },
    }
  }

  const rows = sortRows(openContractLines(options, csps).map(rowOf), sort, {
    label: (r) => r.label,
    expires: (r) => r.expiration,
    premium: (r) => r.premium,
    value: (r) => r.value,
    gain: (r) => r.gain,
  })
  // Lines stay in sorted order; each stock sits where its first line falls.
  const groups: { symbol: string; rows: Row[] }[] = []
  for (const r of rows) {
    const g = groups.find((x) => x.symbol === r.symbol)
    if (g) g.rows.push(r)
    else groups.push({ symbol: r.symbol, rows: [r] })
  }
  const stats = cspStats(csps)
  const unrealized = rows.reduce((s, r) => s + r.gain, 0)

  /** Shares behind a stock's options: held, covered by open sold calls, and free. */
  const sharesLine = (symbol: string) => {
    const h = holdings.find((x) => x.symbol === symbol)
    if (!h) return null
    const qty = Number(h.quantity)
    const covered = options.filter((o) => o.status === 'open' && o.side === 'short' && o.symbol === symbol).reduce((n, o) => n + o.contracts * OPTION_MULTIPLIER, 0)
    return covered > 0
      ? `${shareCount(qty)} shares · ${shareCount(covered)} covered by sold calls · ${shareCount(Math.max(0, qty - covered))} free`
      : `${shareCount(qty)} shares · none covered by sold calls`
  }

  const toggleLots = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const history = [
    ...options
      .filter((o) => o.status !== 'open')
      .map((o) => {
        const n = o.contracts * OPTION_MULTIPLIER
        const premium = Number(o.open_price) * n
        const exit = o.close_price !== null ? Number(o.close_price) * n : 0
        const result = o.status === 'exercised' || o.status === 'assigned' ? null : o.side === 'long' ? exit - premium : premium - exit
        return { key: o.id, label: `${contractLabel(o.symbol, o.strike, o.option_type)} ×${o.contracts}`, kind: o.side === 'long' ? `Long ${o.option_type}` : 'Covered call', status: STATUS_LABEL[o.status], date: o.closed_on, result, target: { optionId: o.id } }
      }),
    ...csps
      .filter((c) => c.status !== 'open')
      .map((c) => {
        const credit = Number(c.premium) * OPTION_MULTIPLIER * c.contracts
        const kept = c.status === 'closed' && c.close_price !== null ? credit - Number(c.close_price) * OPTION_MULTIPLIER * c.contracts : credit
        return { key: c.id, label: `${contractLabel(c.symbol, c.strike, 'put')} ×${c.contracts}`, kind: 'Cash-secured put', status: c.status === 'closed' ? 'Bought back' : STATUS_LABEL[c.status], date: c.closed_on, result: kept, target: { cspId: c.id } }
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
        <Button size="sm" icon={<Plus size={14} />} onClick={() => onAdd()}>
          Add option
        </Button>
      }
    >
      {notice && (
        <div role="alert" className="mx-5 mb-3 flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <div className="min-w-0">
            <div className="font-medium">{notice.title}</div>
            {notice.lines.map((l) => (
              <div key={l} className="text-red-200/80">
                {l}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-red-200/70 transition hover:bg-red-500/15 hover:text-red-100">
            <X size={14} />
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<Layers size={20} />} title="No open options">
          Long calls and puts (LEAPS, hedges), covered calls and cash-secured puts show up here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                <SortTh k="label" sort={sort} onSort={onSort} className="px-5 py-2.5">Position</SortTh>
                <SortTh k="expires" sort={sort} onSort={onSort} className="px-3 py-2.5">Expires</SortTh>
                <SortTh k="premium" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Premium</SortTh>
                <SortTh k="value" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Value</SortTh>
                <SortTh k="gain" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Gain</SortTh>
                <th className="w-28 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const shares = sharesLine(g.symbol)
                const stock = prices.get(g.symbol)?.close
                return (
                  <Fragment key={g.symbol}>
                    <tr className="border-b border-(--border) bg-white/2">
                      <td colSpan={6} className="px-5 py-1.5 text-xs text-neutral-500">
                        <span className="font-semibold text-neutral-200">{g.symbol}</span>
                        {shares && ` · ${shares}`}
                        {stock !== undefined && ` · stock ${stock.toFixed(2)}`}
                      </td>
                    </tr>
                    {g.rows.map((r) => {
                      const dte = daysTo(r.expiration, today)
                      const several = r.lots.length > 1
                      const open = several && expanded.has(r.key)
                      return (
                        <Fragment key={r.key}>
                          <tr
                            id={`option-line-${r.key}`}
                            className={`border-b border-(--border) transition last:border-0 hover:bg-white/2 ${flash === r.key ? 'bg-amber-500/10' : ''}`}
                          >
                            <td className="px-5 py-3">
                              <div className="font-semibold text-white">{r.label}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Pill tone={r.type.tone}>{r.type.label}</Pill>
                                {r.tags.map((t) => (
                                  <Pill key={t.label} tone={t.tone}>
                                    {t.label}
                                  </Pill>
                                ))}
                                {several && (
                                  <button
                                    type="button"
                                    onClick={() => toggleLots(r.key)}
                                    aria-expanded={open}
                                    title={open ? 'Hide the lots' : 'Show each purchase with its own date, price and menu'}
                                    className="inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs font-medium text-(--accent-text) transition hover:bg-(--card-raised)"
                                  >
                                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                    {r.lots.length} lots
                                  </button>
                                )}
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
                              <span className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => onAdd(r.initial)}
                                  title={`Add more ${r.name}: only contracts and price to type`}
                                  className="whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-(--accent-text) transition hover:bg-(--card-raised)"
                                >
                                  + Add
                                </button>
                                <Menu items={menuFor(r)} label={`Actions for ${r.label}`} />
                              </span>
                            </td>
                          </tr>
                          {open &&
                            r.lots.map((lot) => (
                              <tr key={lot.id} className="border-b border-(--border) bg-white/2 text-xs last:border-0">
                                <td className="py-2 pl-9 pr-3 text-neutral-400">
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    Opened {dateFmt(lot.openedOn)} · ×{lot.contracts} @ {priceFmt(lot.openPrice)}
                                    {lot.tags.map((t) => (
                                      <Pill key={t.label} tone={t.tone}>
                                        {t.label}
                                      </Pill>
                                    ))}
                                  </span>
                                  {lot.extra && <div className="mt-0.5 text-neutral-500">{lot.extra}</div>}
                                </td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{currency(lot.premium)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                                  {currency(lot.value)}
                                  <div className={lot.mark !== null ? 'text-neutral-500' : 'text-amber-500/80'}>{lot.valueWord}</div>
                                </td>
                                <td className={`px-3 py-2 text-right tabular-nums ${toneClass(lot.gain)}`}>{currency(lot.gain)}</td>
                                <td className="px-3 py-2 text-right">
                                  <Menu items={menuFor({ ...r, lots: [lot] })} label={`Actions for the ${lot.name} lot of ${r.name}`} />
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      )
                    })}
                  </Fragment>
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
