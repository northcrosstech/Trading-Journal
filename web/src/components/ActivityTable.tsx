import type { PortfolioActivity } from '../lib/database.types'
import { deleteActivityEntry, editActivityEntry } from '../lib/wealthQueries'
import { signedCurrency as signed } from '../lib/portfolio'
import { currency, dateFmt, priceFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { parseAmount, useDialog, validators, type DialogField } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Menu, type MenuItem } from './ui/Menu'
import { EmptyState } from './ui/EmptyState'

type Kind = PortfolioActivity['kind']

const ACTIVITY_LABEL: Record<Kind, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  dividend: 'Dividend',
  cash_adjust: 'Cash balance set',
  buy: 'Buy',
  sell: 'Sell',
  transfer_in: 'Added / moved in',
  transfer_out: 'Moved out',
  split: 'Split',
  csp_open: 'Sold put',
  csp_close: 'Bought back put',
  csp_expire: 'Put expired',
  csp_assign: 'Put assigned',
  option_buy: 'Bought option',
  option_sell: 'Sold option',
  option_write: 'Sold covered call',
  option_buyback: 'Bought back call',
  option_expire: 'Option expired',
  option_exercise: 'Exercised call',
  option_assign: 'Call assigned',
}

const SHARE_KINDS: Kind[] = ['buy', 'sell', 'transfer_in']
const CASH_KINDS: Kind[] = ['deposit', 'withdrawal', 'dividend']
const OPEN_KINDS: Kind[] = ['csp_open', 'option_buy', 'option_write']
/** Entries that only moved cash -- undone by reversing the cash change. */
const CASH_ONLY: Kind[] = [...CASH_KINDS, 'cash_adjust']
/** Undone with a plain Delete (not a reopen), but not editable. */
const PLAIN_UNDO: Kind[] = [...CASH_ONLY, 'split']

const qtyOf = (a: PortfolioActivity) => Number(Number(a.quantity ?? 0).toFixed(6))

/** What undoing an entry will do, in plain words, for the confirm dialog. */
function undoMessage(a: PortfolioActivity): string {
  const cash = Math.abs(Number(a.cash_change))
  switch (a.kind) {
    case 'buy':
      return `Takes back the ${qtyOf(a)} ${a.symbol} shares and returns ${currency(cash)} to cash. The average cost goes back to what it was.`
    case 'sell':
      return `Puts the ${qtyOf(a)} ${a.symbol} shares back at their original cost and takes the ${currency(cash)} out of cash. The realized gain is removed.`
    case 'transfer_in':
      return `Removes the ${qtyOf(a)} ${a.symbol} shares this added. Cash isn’t touched.`
    case 'deposit':
    case 'withdrawal':
    case 'dividend':
      return `Reverses the ${currency(cash)} ${a.kind}.`
    case 'split':
      return `Reverses the ${a.symbol} split: shares and average cost go back to what they were.`
    case 'cash_adjust':
      return `Puts cash back to what it was before, reversing the ${currency(cash)} change.`
    case 'csp_open':
    case 'option_buy':
    case 'option_write':
      return 'Deletes the position and reverses its premium.'
    default:
      return 'Reopens the position and reverses everything this did (cash, shares, gain).'
  }
}

/** Every trade, cash move and option event in a portfolio, newest first. Each entry can be
 * undone; stock and cash entries can also be edited. Both reverse the original exactly. */
export function ActivityTable({ activity, onChanged }: { activity: PortfolioActivity[]; onChanged: () => void }) {
  const dialog = useDialog()
  const toast = useToast()

  async function run(p: Promise<unknown>, message: string) {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function edit(a: PortfolioActivity) {
    const shares = SHARE_KINDS.includes(a.kind)
    const fields: DialogField[] = [{ name: 'on', label: 'Date', type: 'date', defaultValue: a.occurred_on }]
    if (shares) {
      fields.push(
        { name: 'symbol', label: 'Ticker', defaultValue: a.symbol ?? '', validate: validators.required },
        { name: 'quantity', label: 'Shares', type: 'number', defaultValue: String(qtyOf(a)), validate: validators.positive },
        {
          name: 'price',
          label: a.kind === 'transfer_in' ? 'Cost per share' : 'Price per share',
          type: 'number',
          prefix: '$',
          defaultValue: a.price !== null ? String(Number(a.price)) : '',
          validate: (s) => validators.required(s) ?? validators.nonNegative(s),
        },
      )
    } else {
      fields.push({ name: 'amount', label: 'Amount', type: 'number', prefix: '$', defaultValue: String(Math.abs(Number(a.cash_change))), validate: validators.positive })
      if (a.kind === 'dividend') fields.push({ name: 'symbol', label: 'Ticker', defaultValue: a.symbol ?? '', optional: true, hint: 'Which holding paid it (optional).' })
    }
    const v = await dialog.form({
      title: `Edit ${ACTIVITY_LABEL[a.kind].toLowerCase()}`,
      description: 'The original is reversed and this is saved in its place — cash, shares and average cost update to match.',
      submitLabel: 'Save changes',
      fields,
    })
    if (!v) return
    run(
      editActivityEntry({
        activityId: a.id,
        symbol: v.symbol ? v.symbol.toUpperCase() : null,
        quantity: shares ? parseAmount(v.quantity) : null,
        price: shares ? parseAmount(v.price) : null,
        amount: shares ? null : parseAmount(v.amount),
        on: v.on,
      }),
      `${ACTIVITY_LABEL[a.kind]} updated`,
    )
  }

  async function undo(a: PortfolioActivity) {
    const opening = OPEN_KINDS.includes(a.kind)
    const closing = !opening && !SHARE_KINDS.includes(a.kind) && !PLAIN_UNDO.includes(a.kind)
    const ok = await dialog.confirm({
      title: opening ? 'Delete this position?' : closing ? 'Undo and reopen the position?' : `Delete this ${ACTIVITY_LABEL[a.kind].toLowerCase()}?`,
      message: undoMessage(a),
      confirmLabel: opening ? 'Delete position' : closing ? 'Undo' : 'Delete entry',
      tone: 'danger',
    })
    if (ok) run(deleteActivityEntry(a.id), closing ? 'Position reopened' : 'Entry deleted')
  }

  const menuFor = (a: PortfolioActivity): MenuItem[] => {
    if (a.kind === 'transfer_out') return [] // reversed by transferring back / Add existing
    const items: MenuItem[] = []
    if (SHARE_KINDS.includes(a.kind) || CASH_KINDS.includes(a.kind)) items.push({ label: 'Edit…', onClick: () => edit(a) })
    const opening = OPEN_KINDS.includes(a.kind)
    const closing = !opening && !SHARE_KINDS.includes(a.kind) && !PLAIN_UNDO.includes(a.kind)
    items.push({ label: opening ? 'Delete position' : closing ? 'Undo (reopen)' : 'Delete', tone: 'danger', onClick: () => undo(a) })
    return items
  }

  if (activity.length === 0) return <EmptyState title="Nothing yet">Trades and cash moves you record show up here.</EmptyState>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <th className="px-5 py-2.5">Date</th>
            <th className="px-3 py-2.5">Event</th>
            <th className="px-3 py-2.5">Details</th>
            <th className="px-3 py-2.5 text-right">Cash</th>
            <th className="px-3 py-2.5 text-right">Realized</th>
            <th className="w-12 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {activity.map((a) => {
            const items = menuFor(a)
            return (
              <tr key={a.id} className="border-b border-(--border) last:border-0 hover:bg-white/2">
                <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-neutral-400">{dateFmt(a.occurred_on)}</td>
                <td className="px-3 py-2.5 text-neutral-200">{ACTIVITY_LABEL[a.kind]}</td>
                <td className="px-3 py-2.5 text-neutral-400">
                  {a.kind === 'split' && a.price !== null ? (
                    <>
                      {a.symbol} {Number(a.price) >= 1 ? `${Number(Number(a.price).toFixed(4))}-for-1` : `1-for-${Number((1 / Number(a.price)).toFixed(4))}`}
                      {a.quantity !== null && <span className="text-neutral-500"> · now {qtyOf(a)}</span>}
                    </>
                  ) : a.kind === 'cash_adjust' && a.price !== null ? (
                    <>
                      to {Number(a.price) < 0 ? `${currency(-Number(a.price))} margin used` : currency(Number(a.price))}
                      {Number(a.external_flow) === 0 && <span className="text-neutral-500"> · interest/fees</span>}
                    </>
                  ) : (
                    <>
                      {a.symbol}
                      {a.quantity !== null && ` × ${qtyOf(a)}`}
                      {a.price !== null && ` @ ${priceFmt(Number(a.price))}`}
                    </>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${Number(a.cash_change) === 0 ? 'text-neutral-600' : toneClass(Number(a.cash_change))}`}>
                  {Number(a.cash_change) === 0 ? '—' : signed(Number(a.cash_change))}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${a.realized_gain === null ? 'text-neutral-600' : toneClass(Number(a.realized_gain))}`}>
                  {a.realized_gain === null ? '—' : signed(Number(a.realized_gain))}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {items.length > 0 ? (
                    <Menu items={items} label={`Actions for ${ACTIVITY_LABEL[a.kind]} ${a.symbol ?? ''}`} />
                  ) : (
                    <span className="text-xs text-neutral-600" title="Transfer the shares back, or use Add existing">
                      —
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
