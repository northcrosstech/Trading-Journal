import { Fragment, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { Landmark, Plus, Settings2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { NetworthAccount, NetworthBalance, NetworthCategory } from '../lib/database.types'
import { saveMonthBalances } from '../lib/wealthQueries'
import { categoryLabel, categoryOrder, isDebt, isOpenIn, monthLabel } from '../lib/networth'
import { errorMessage, fmtBalance, parseBalance } from '../lib/balanceInput'
import { currency } from '../lib/format'
import { INPUT_SM } from '../lib/ui'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { EmptyState } from './ui/EmptyState'

export type BalancesTableHandle = {
  /** Scrolls to and focuses the first of these accounts' balance fields, in table order. */
  focusFirst: (accountIds: string[]) => void
  /** How many rows hold typed or ticked changes that haven't been saved. */
  unsavedCount: () => number
  /** Saves them. False when it didn't go through (the table shows why). */
  save: () => Promise<boolean>
  /** Throws them away, including the copy kept for coming back to the page. */
  discard: () => void
}

/** Typed and ticked rows that haven't been saved, as kept in sessionStorage. */
type Draft = { edits: [string, string][]; confirmed: string[] }
const NO_DRAFT: Draft = { edits: [], confirmed: [] }

function readDraft(key: string | null): Draft {
  if (!key) return NO_DRAFT
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return NO_DRAFT
    const { edits, confirmed } = raw as { edits?: unknown; confirmed?: unknown }
    return {
      edits: Array.isArray(edits) ? edits.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') : [],
      confirmed: Array.isArray(confirmed) ? confirmed.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch {
    return NO_DRAFT
  }
}

/** A draft cut down to what can still be saved: nothing in a closed month, and only the
 * accounts open in it. */
function savableDraft(d: Draft, open: NetworthAccount[], locked: boolean): Draft {
  if (locked) return NO_DRAFT
  const ids = new Set(open.map((a) => a.id))
  return { edits: d.edits.filter(([id]) => ids.has(id)), confirmed: d.confirmed.filter((id) => ids.has(id)) }
}

/** An empty draft removes the entry. */
function writeDraft(key: string | null, draft: Draft) {
  if (!key) return
  try {
    if (draft.edits.length === 0 && draft.confirmed.length === 0) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(draft))
  } catch {
    /* private mode or full storage -- the typing just isn't kept across pages */
  }
}

/** The month's balances as a table: open accounts only, pre-filled with this month's entry
 * or the most recent earlier one ("carried"), grouped into Assets and Debts with subtotals.
 * Portfolio-fed lines are read-only. Saving writes only what you changed or confirmed, so a
 * carried balance stays carried until you've looked at it. A closed month is read-only.
 *
 * What you've typed belongs to one month: the page gives the table a new `key` per month, so
 * it starts clean there, and a data reload for any other reason leaves typed rows alone.
 * Unsaved rows are also kept in sessionStorage per user and month, so leaving the page and
 * coming back in the same tab brings them back as unsaved typing. */
export function BalancesTable({
  month,
  accounts,
  balances,
  portfolioLines,
  onSaved,
  onManage,
  locked,
  ref,
}: {
  month: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  portfolioLines: { key: string; name: string; category: NetworthCategory; amount: number }[]
  /** Reloads the page's data; the saved rows are released once it settles. */
  onSaved: () => void | Promise<void>
  onManage: () => void
  locked: boolean
  ref?: Ref<BalancesTableHandle>
}) {
  const { user } = useAuth()
  const toast = useToast()
  const open = useMemo(() => accounts.filter((a) => isOpenIn(a, month)), [accounts, month])
  const prefill = useMemo(() => {
    const out = new Map<string, { value: string; from: string | null }>()
    for (const a of open) {
      let best: NetworthBalance | null = null
      for (const b of balances) if (b.account_id === a.id && b.month <= month && (!best || b.month > best.month)) best = b
      out.set(a.id, { value: best ? fmtBalance(Number(best.balance)) : '', from: best && best.month !== month ? best.month : null })
    }
    return out
  }, [open, balances, month])

  const draftKey = user ? `tj.balancesDraft.${user.id}.${month}` : null
  // What was left unsaved the last time this month was on screen, read once.
  const [restored] = useState(() => savableDraft(readDraft(draftKey), open, locked))

  // Only the rows you've typed in. Every other row shows the saved (or carried) number, so it
  // follows a reload while typed rows keep what you typed.
  const [edits, setEdits] = useState<Map<string, string>>(() => new Map(restored.edits))
  // Carried rows you've confirmed for this month: typed in, Enter pressed, or "unchanged" ticked.
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(restored.confirmed))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  // Keeps the stored copy in step with what's typed; it empties once everything is saved or discarded.
  useEffect(() => {
    writeDraft(draftKey, savableDraft({ edits: [...edits], confirmed: [...confirmed] }, open, locked))
  }, [draftKey, edits, confirmed, open, locked])

  const valueOf = (id: string) => edits.get(id) ?? prefill.get(id)?.value ?? ''
  const isCarried = (id: string) => Boolean(prefill.get(id)?.from)
  const changed = (id: string) => parseBalance(valueOf(id)) !== parseBalance(prefill.get(id)?.value ?? '')
  // Saved when you changed it, or confirmed a carried balance for this month.
  const toSave = (a: NetworthAccount, conf: Set<string> = confirmed) => (conf.has(a.id) && isCarried(a.id)) || changed(a.id)
  const dirty = open.some((a) => toSave(a))

  const confirm = (id: string) => setConfirmed((c) => (c.has(id) ? c : new Set(c).add(id)))
  const unconfirm = (id: string) =>
    setConfirmed((c) => {
      const n = new Set(c)
      n.delete(id)
      return n
    })

  function focusInput(id: string, scroll = false) {
    const el = inputs.current.get(id)
    if (!el) return
    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: scroll })
    el.select()
  }

  async function save(conf: Set<string> = confirmed): Promise<boolean> {
    if (!user || saving) return false
    const entries: { accountId: string; balance: number | null }[] = []
    for (const a of open.filter((x) => toSave(x, conf))) {
      const parsed = parseBalance(valueOf(a.id))
      if (parsed === undefined) {
        setError(`“${valueOf(a.id)}” isn’t a valid amount for ${a.name}. Enter a positive number — debts are subtracted for you.`)
        focusInput(a.id)
        return false
      }
      entries.push({ accountId: a.id, balance: parsed })
    }
    if (entries.length === 0) return true
    setSaving(true)
    setError(null)
    try {
      await saveMonthBalances(user.id, month, entries)
      toast(`Saved ${monthLabel(month)} balances`)
      await onSaved()
      // The reload now shows what was saved, so those rows go back to following the data.
      // A row typed in again while the save was running keeps its new number.
      const sent = new Map(entries.map((e) => [e.accountId, e.balance]))
      setEdits((d) => {
        const n = new Map(d)
        for (const [id, balance] of sent) if (n.has(id) && parseBalance(n.get(id)!) === balance) n.delete(id)
        return n
      })
      setConfirmed((c) => new Set([...c].filter((id) => !sent.has(id))))
      // The stored copy too, right away: when the page moves to another month straight after
      // the save, this table is gone before it can catch up.
      const stored = readDraft(draftKey)
      writeDraft(draftKey, {
        edits: stored.edits.filter(([id, typed]) => !(sent.has(id) && parseBalance(typed) === sent.get(id))),
        confirmed: stored.confirmed.filter((id) => !sent.has(id)),
      })
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setEdits(new Map())
    setConfirmed(new Set())
    setError(null)
    // Straight away rather than on the next render: the page may be leaving this month.
    writeDraft(draftKey, NO_DRAFT)
  }

  const amountOf = (a: NetworthAccount) => parseBalance(valueOf(a.id)) ?? 0
  type Item =
    | { kind: 'account'; key: string; category: NetworthCategory; name: string; account: NetworthAccount; amount: number }
    | { kind: 'portfolio'; key: string; category: NetworthCategory; name: string; amount: number }
  // Accounts and portfolio lines together, sorted by category, so each category's lines sit
  // side by side and can carry a subtotal.
  const groups = ([false, true] as const).map((debt) => {
    const items: Item[] = [
      ...open
        .filter((a) => isDebt(a.category) === debt)
        .map((a): Item => ({ kind: 'account', key: a.id, category: a.category, name: a.name, account: a, amount: amountOf(a) })),
      ...portfolioLines
        .filter((l) => isDebt(l.category) === debt)
        .map((l): Item => ({ kind: 'portfolio', key: l.key, category: l.category, name: l.name, amount: Math.abs(l.amount) })),
    ].sort((x, y) => categoryOrder(x.category) - categoryOrder(y.category) || x.name.localeCompare(y.name))
    const counts = new Map<NetworthCategory, number>()
    for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1)
    const subtotal = items.reduce((s, it) => s + it.amount, 0)
    return { debt, items, counts, subtotal }
  })
  const assets = groups[0].subtotal
  const debts = groups[1].subtotal
  // The balance fields from top to bottom, for Enter and for jumping to a missing one.
  const order = groups.flatMap((g) => g.items.filter((it) => it.kind === 'account').map((it) => it.key))
  // Carried balances you haven't changed or confirmed yet.
  const unconfirmed = open.filter((a) => isCarried(a.id) && !toSave(a))
  const carriedCount = unconfirmed.length

  useImperativeHandle(ref, () => ({
    focusFirst(accountIds) {
      const id = order.find((x) => accountIds.includes(x))
      if (id) focusInput(id, true)
    },
    unsavedCount: () => open.filter((a) => toSave(a)).length,
    save: () => save(),
    discard,
  }))

  /** Enter moves down the column; on the last field it saves. In a carried row it also
   * confirms the number, the same as ticking "unchanged". */
  function onEnter(e: KeyboardEvent<HTMLInputElement>, id: string) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    let conf = confirmed
    if (isCarried(id) && !confirmed.has(id)) {
      conf = new Set(confirmed).add(id)
      setConfirmed(conf)
    }
    const next = order[order.indexOf(id) + 1]
    if (next) focusInput(next)
    else if (open.some((a) => toSave(a, conf))) void save(conf)
  }

  if (open.length === 0 && portfolioLines.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Landmark size={22} />}
          title={`No accounts open in ${monthLabel(month)}`}
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={onManage}>
              Add an account
            </Button>
          }
        >
          Add what you own (home, cash, 401k…) and what you owe (mortgage, cards, loans). Portfolios fill their lines automatically.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card
      title={`Balances · ${monthLabel(month)}`}
      subtitle={
        locked
          ? `${monthLabel(month)} is closed. Reopen it to change these.`
          : 'Enter each balance as a positive number — debts are subtracted for you. Enter moves to the next one. Blank = no balance this month.'
      }
      flush
      actions={
        <Button size="sm" icon={<Settings2 size={14} />} onClick={onManage}>
          Manage accounts
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {groups.map((g) =>
              g.items.length === 0 ? null : (
                <GroupRows key={String(g.debt)} title={g.debt ? 'Debts' : 'Assets'} debt={g.debt} subtotal={g.subtotal}>
                  {g.items.map((it, i) => {
                    const lastOfCategory = g.items[i + 1]?.category !== it.category
                    const catCount = g.counts.get(it.category) ?? 0
                    const catTotal = g.items.filter((x) => x.category === it.category).reduce((s2, x) => s2 + x.amount, 0)
                    const p = it.kind === 'account' ? prefill.get(it.account.id) : undefined
                    return (
                      <Fragment key={it.key}>
                        <tr className="border-b border-(--border) hover:bg-white/2">
                          <td className="px-5 py-2.5">
                            <div className="font-medium text-neutral-100">{it.name}</div>
                            {it.kind === 'portfolio' ? (
                              <div className="text-xs text-neutral-500">
                                {it.key.startsWith('margin:') ? 'margin used · from Portfolios' : 'from Portfolios · last close'}
                              </div>
                            ) : (
                              p?.from &&
                              !locked &&
                              (changed(it.account.id) ? (
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  was ${p.value} in {monthLabel(p.from)}
                                </div>
                              ) : (
                                <label className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-400/90">
                                  carried from {monthLabel(p.from)} ·
                                  {/* Out of the Tab order, so Tab goes from one balance to the next. */}
                                  <input
                                    type="checkbox"
                                    tabIndex={-1}
                                    checked={confirmed.has(it.account.id)}
                                    onChange={(e) => (e.target.checked ? confirm(it.account.id) : unconfirm(it.account.id))}
                                  />
                                  unchanged
                                </label>
                              ))
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <Pill tone={g.debt ? 'red' : 'teal'}>{categoryLabel(it.category)}</Pill>
                          </td>
                          {it.kind === 'account' ? (
                            <td className="w-48 px-5 py-2">
                              <span className="relative block">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
                                <input
                                  ref={(el) => {
                                    if (el) inputs.current.set(it.account.id, el)
                                    else inputs.current.delete(it.account.id)
                                  }}
                                  inputMode="decimal"
                                  enterKeyHint="next"
                                  aria-label={`${it.name} balance`}
                                  value={valueOf(it.account.id)}
                                  disabled={locked}
                                  onChange={(e) => {
                                    setEdits((d) => new Map(d).set(it.account.id, e.target.value))
                                    // Typing in a carried row means you've looked at it.
                                    if (p?.from) confirm(it.account.id)
                                  }}
                                  onKeyDown={(e) => onEnter(e, it.account.id)}
                                  onBlur={(e) => {
                                    // A row that was only visited stays untouched.
                                    if (!edits.has(it.account.id)) return
                                    const n = parseBalance(e.target.value)
                                    setEdits((d) => {
                                      const next = new Map(d)
                                      // Back at the saved number: the row follows the data again. Otherwise tidy what was typed.
                                      if (n === parseBalance(p?.value ?? '')) next.delete(it.account.id)
                                      else if (n !== null && n !== undefined) next.set(it.account.id, fmtBalance(n))
                                      return next
                                    })
                                  }}
                                  className={`${INPUT_SM} pl-6 text-right tabular-nums disabled:opacity-70 ${p?.from && !confirmed.has(it.account.id) ? 'border-amber-500/40' : ''}`}
                                />
                              </span>
                            </td>
                          ) : (
                            <td className="w-48 px-5 py-2.5 text-right tabular-nums text-neutral-300">{currency(it.amount)}</td>
                          )}
                        </tr>
                        {lastOfCategory && catCount >= 2 && (
                          <tr className="border-b border-(--border) bg-white/2">
                            <td colSpan={2} className="px-5 py-2 text-xs text-neutral-400">
                              {categoryLabel(it.category)} · {catCount} accounts
                            </td>
                            <td className={`px-5 py-2 text-right text-sm font-semibold tabular-nums ${g.debt ? 'text-red-300' : 'text-neutral-100'}`}>
                              {g.debt ? '−' : ''}
                              {currency(catTotal)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </GroupRows>
              ),
            )}
            <tr className="bg-white/3">
              <td className="px-5 py-3 text-sm font-semibold text-white" colSpan={2}>
                Net worth
              </td>
              <td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-white">{currency(assets - debts)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {!locked && (dirty || error || carriedCount > 0) && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-(--border) bg-(--card-raised)/95 px-5 py-3 backdrop-blur">
          <span className="text-xs text-neutral-400">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : carriedCount > 0 ? (
              `${carriedCount} balance${carriedCount === 1 ? ' is' : 's are'} carried from an earlier month. In each, type the new number or press Enter to keep it for ${monthLabel(month)}.`
            ) : (
              'You have unsaved changes.'
            )}
          </span>
          <span className="flex flex-wrap gap-2">
            {dirty && (
              <Button size="sm" variant="ghost" onClick={discard}>
                Discard
              </Button>
            )}
            {carriedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmed((c) => new Set([...c, ...unconfirmed.map((a) => a.id)]))}>
                Mark all unchanged
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : `Save ${monthLabel(month, 'short')}`}
            </Button>
          </span>
        </div>
      )}
    </Card>
  )
}

function GroupRows({ title, debt, subtotal, children }: { title: string; debt: boolean; subtotal: number; children: ReactNode }) {
  return (
    <>
      <tr className="border-y border-(--border) bg-white/2">
        <td colSpan={2} className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${debt ? 'bg-red-400' : 'bg-teal-400'}`} />
          {title}
        </td>
        <td className={`px-5 py-2 text-right text-sm font-semibold tabular-nums ${debt ? 'text-red-300' : 'text-teal-300'}`}>
          {debt ? '−' : ''}
          {currency(subtotal)}
        </td>
      </tr>
      {children}
    </>
  )
}
