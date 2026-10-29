import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, NotebookPen, Plus, Settings2, X } from 'lucide-react'
import type { Portfolio, TickerThesisRow } from '../lib/database.types'
import { savePositionPlan, updatePortfolio } from '../lib/wealthQueries'
import { comparePlan, suggestBuys, type PlanRow, type PlanTarget } from '../lib/positionPlan'
import { centralDateStr, currency } from '../lib/format'
import { INPUT, INPUT_SM } from '../lib/ui'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { Drawer } from './ui/Drawer'

const shares = (amount: number, price: number | null) => (price && price > 0 ? ` (${Number((amount / price).toFixed(amount / price >= 10 ? 1 : 2))} sh)` : '')
const pct = (n: number) => `${Number(n.toFixed(1))}%`

/** Is a thesis due for review (its review date is today or past)? */
export const reviewDue = (t: TickerThesisRow | undefined) => !!t?.review_on && t.review_on <= centralDateStr(new Date())

/** A portfolio's position plan: each ticker's target against what it is now, what to buy or
 * trim to get back on plan, and "Add money" (buys only) for putting cash to work. */
export function PositionPlanCard({
  portfolio,
  holdings,
  longOptions,
  cash,
  spendable,
  plan,
  tolerance,
  theses,
  onOpenTicker,
  onSaved,
}: {
  portfolio: Portfolio
  holdings: { symbol: string; value: number; price: number | null }[]
  longOptions: number
  cash: number
  /** Cash not set aside for puts. */
  spendable: number
  plan: PlanTarget[]
  tolerance: number
  theses: Map<string, TickerThesisRow>
  onOpenTicker: (symbol: string) => void
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [money, setMoney] = useState('')
  const cmp = useMemo(() => comparePlan(holdings, longOptions, cash, plan, tolerance), [holdings, longOptions, cash, plan, tolerance])
  const amount = Number(money.replace(/[$,\s]/g, ''))
  const suggestion = useMemo(() => suggestBuys(cmp.rows, cmp.base, cash, amount, spendable), [cmp, cash, amount, spendable])
  const hasPlan = plan.length > 0

  return (
    <Card
      title="Position plan"
      flush={hasPlan}
      subtitle={
        !hasPlan ? (
          'Set a target % for each ticker to see what to buy or trim.'
        ) : cmp.off === 0 ? (
          <span className="text-emerald-300">
            On plan (±{tolerance}%){cmp.unplanned > 0 && <span className="text-neutral-500"> · {cmp.unplanned} not in your plan</span>}
          </span>
        ) : (
          <span className="text-amber-300">
            {cmp.off} off plan (±{tolerance}%){cmp.unplanned > 0 && <span className="text-neutral-500"> · {cmp.unplanned} not in your plan</span>}
          </span>
        )
      }
      actions={
        <Button size="sm" icon={<Settings2 size={14} />} onClick={() => setEditing(true)}>
          {hasPlan ? 'Edit plan' : 'Set plan'}
        </Button>
      }
    >
      {hasPlan ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-(--border) text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">Ticker</th>
                  <th className="px-3 py-2.5 text-right font-medium">Target</th>
                  <th className="px-3 py-2.5 text-right font-medium">Now</th>
                  <th className="w-40 px-3 py-2.5 font-medium" />
                  <th className="px-3 py-2.5 text-right font-medium">Drift</th>
                  <th className="px-5 py-2.5 font-medium">To get back on plan</th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <PlanLine key={r.key} r={r} thesis={theses.get(r.symbol)} onOpen={r.kind === 'ticker' ? () => onOpenTicker(r.symbol) : undefined} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-(--border) px-5 py-4">
            <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
              Add money
              <span className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">$</span>
                <input value={money} onChange={(e) => setMoney(e.target.value)} inputMode="decimal" placeholder="0" className={`${INPUT_SM.replace('w-full ', '')} w-28 pl-5 text-right tabular-nums`} />
              </span>
              {spendable > 0 && (
                <button type="button" onClick={() => setMoney(String(Number(spendable.toFixed(2))))} className="rounded-md px-1.5 py-1 text-xs text-(--accent-text) hover:bg-(--card-raised)">
                  Use my cash ({currency(spendable)})
                </button>
              )}
              <span className="text-xs text-neutral-500">Buys only, nothing sold. Comes out of cash first; more than that counts as new money.</span>
            </label>
            {amount > 0 && (
              <p className="text-sm text-neutral-300">
                {suggestion.buys.length === 0 && suggestion.keepCash === 0 ? (
                  <span className="text-neutral-500">Nothing to buy.</span>
                ) : (
                  <>
                    {suggestion.buys.map((b, i) => (
                      <span key={b.symbol}>
                        {i > 0 && <span className="text-neutral-600"> · </span>}
                        <span className="font-semibold text-white">{b.symbol}</span> <span className="tabular-nums text-emerald-300">{currency(b.amount)}</span>
                        <span className="text-xs text-neutral-500">{shares(b.amount, b.price)}</span>
                      </span>
                    ))}
                    {suggestion.keepCash >= 0.005 && <span className="text-neutral-400"> · keep {currency(suggestion.keepCash)} as cash</span>}
                  </>
                )}
              </p>
            )}
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-(--border) px-4 py-4 text-left text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">
          <ClipboardList size={18} className="shrink-0" />
          <span>
            Set a target % for each ticker (e.g. VOO 40%). Whatever doesn't add up to 100% stays as cash.
          </span>
        </button>
      )}

      <PlanEditor open={editing} onClose={() => setEditing(false)} portfolio={portfolio} plan={plan} held={holdings.map((h) => h.symbol)} onSaved={onSaved} />
    </Card>
  )
}

function PlanLine({ r, thesis, onOpen }: { r: PlanRow; thesis: TickerThesisRow | undefined; onOpen?: () => void }) {
  const amber = r.status === 'over' || r.status === 'under' || r.status === 'missing'
  const fill = r.status === 'on' ? 'bg-emerald-400' : amber ? 'bg-amber-400' : 'bg-neutral-500'
  return (
    <tr className="border-b border-(--border) last:border-0">
      <td className="px-5 py-2.5">
        <span className="flex items-center gap-1.5">
          {onOpen ? (
            <button type="button" onClick={onOpen} className="font-semibold text-white hover:text-(--accent-text)" title={`Open ${r.symbol}: research and your thesis`}>
              {r.symbol}
            </button>
          ) : (
            <span className={r.kind === 'cash' ? 'text-neutral-300' : 'text-neutral-400'}>{r.symbol}</span>
          )}
          {thesis?.thesis && <NotebookPen size={12} className="text-neutral-500" aria-label="Has a thesis" />}
          {reviewDue(thesis) && (
            <Pill tone="amber" title={`Review date ${thesis?.review_on}`}>
              review
            </Pill>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">{r.target === null ? '—' : pct(r.target)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-100">{pct(r.pct)}</td>
      <td className="px-3 py-2.5">
        <span className="relative block h-2 w-full rounded-full bg-neutral-800">
          <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.min(r.pct, 100)}%` }} />
          {r.target !== null && <span className="absolute -top-1 h-4 w-0.5 rounded bg-white/80" style={{ left: `calc(${Math.min(r.target, 100)}% - 1px)` }} title={`Target ${pct(r.target)}`} />}
        </span>
      </td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${amber ? 'text-amber-300' : 'text-neutral-500'}`}>{r.target === null ? '' : `${r.diff >= 0 ? '+' : '−'}${pct(Math.abs(r.diff))}`}</td>
      <td className="px-5 py-2.5 text-xs">
        {r.status === 'unplanned' ? (
          <span className="text-neutral-500">not in your plan · {currency(r.value)}</span>
        ) : r.status === 'on' ? (
          <span className="text-emerald-300">on plan</span>
        ) : r.status === 'missing' ? (
          <span className="text-amber-300">not owned yet · buy {currency(r.move)}</span>
        ) : r.kind === 'cash' ? (
          <span className="text-amber-300">{r.move > 0 ? `keep ${currency(r.move)} more cash` : `${currency(-r.move)} more cash than planned`}</span>
        ) : r.move > 0 ? (
          <span className="text-amber-300">
            buy {currency(r.move)}
            <span className="text-neutral-500">{shares(r.move, r.price)}</span>
          </span>
        ) : (
          <span className="text-amber-300">
            trim {currency(-r.move)}
            <span className="text-neutral-500">{shares(-r.move, r.price)}</span>
          </span>
        )}
      </td>
    </tr>
  )
}

type EditRow = { key: number; symbol: string; pct: string }
const TICKER = /^[A-Z0-9.-]{1,12}$/

/** The plan as rows: a ticker and its % each, "+ Add ticker" for more. Whatever the rows leave
 * of 100% is the cash target. */
function PlanEditor({ open, onClose, portfolio, plan, held, onSaved }: { open: boolean; onClose: () => void; portfolio: Portfolio; plan: PlanTarget[]; held: string[]; onSaved: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<EditRow[]>([])
  const [nextKey, setNextKey] = useState(0)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    const start = plan.length > 0 ? plan.map((t, i) => ({ key: i, symbol: t.symbol, pct: String(t.pct) })) : [{ key: 0, symbol: '', pct: '' }]
    setRows(start)
    setNextKey(start.length)
  }, [open, plan])

  const update = (key: number, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  function addRow() {
    setRows((rs) => [...rs, { key: nextKey, symbol: '', pct: '' }])
    setNextKey((k) => k + 1)
  }

  // A row with neither box filled is ignored; a half-filled row is a problem to fix.
  const filled = rows.filter((r) => r.symbol.trim() !== '' || r.pct.trim() !== '')
  const count = new Map<string, number>()
  for (const r of filled) count.set(r.symbol.trim(), (count.get(r.symbol.trim()) ?? 0) + 1)
  const problem = (r: EditRow): string | null => {
    if (r.symbol.trim() === '' && r.pct.trim() === '') return null
    if (!TICKER.test(r.symbol.trim())) return 'Enter a ticker'
    const n = Number(r.pct)
    if (r.pct.trim() === '' || !(n > 0)) return 'Enter a %'
    if ((count.get(r.symbol.trim()) ?? 0) > 1) return 'Listed twice'
    return null
  }
  const total = filled.reduce((s, r) => s + (Number(r.pct) || 0), 0)
  const over = total > 100.0001
  const valid = filled.every((r) => problem(r) === null) && !over

  async function save(targets: PlanTarget[]) {
    setSaving(true)
    try {
      await savePositionPlan(portfolio.id, targets)
      toast(targets.length === 0 ? 'Plan cleared' : 'Plan saved')
      onSaved()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={`${portfolio.name} · position plan`} subtitle="A ticker and its % on each line. What's left of 100% stays as cash.">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const p = problem(r)
            return (
              <div key={r.key}>
                <div className="flex items-center gap-2">
                  <input
                    value={r.symbol}
                    onChange={(e) => update(r.key, { symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, '') })}
                    autoFocus={i === rows.length - 1 && r.symbol === ''}
                    placeholder="Ticker"
                    aria-label="Ticker"
                    className={`${INPUT_SM} flex-1 font-semibold uppercase ${p && p !== 'Enter a %' ? 'ring-1 ring-red-500/60' : ''}`}
                  />
                  <span className="relative w-24 shrink-0">
                    <input
                      value={r.pct}
                      onChange={(e) => update(r.key, { pct: e.target.value.replace(/[^0-9.]/g, '') })}
                      onKeyDown={(e) => e.key === 'Enter' && addRow()}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Target %"
                      className={`${INPUT_SM} pr-6 text-right tabular-nums ${p === 'Enter a %' ? 'ring-1 ring-red-500/60' : ''}`}
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">%</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: nextKey, symbol: '', pct: '' }]))}
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-(--card-raised) hover:text-white"
                    title="Remove"
                    aria-label={`Remove ${r.symbol || 'row'}`}
                  >
                    <X size={14} />
                  </button>
                </div>
                {p ? (
                  <p className="mt-0.5 px-1 text-xs text-red-300">{p}</p>
                ) : (
                  r.symbol && TICKER.test(r.symbol) && !held.includes(r.symbol) && <p className="mt-0.5 px-1 text-xs text-neutral-500">not owned yet</p>
                )}
              </div>
            )
          })}
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addRow} className="self-start">
            Add ticker
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-(--card-raised) px-3 py-2.5 tabular-nums">
          <span className="text-neutral-300">Cash (what's left)</span>
          <span className={over ? 'text-red-300' : 'text-neutral-100'}>{over ? `${pct(total - 100)} over 100%` : pct(100 - total)}</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => save([])} disabled={saving || plan.length === 0}>
            Clear plan
          </Button>
          <Button variant="primary" onClick={() => save(filled.map((r) => ({ symbol: r.symbol.trim(), pct: Number(r.pct) })))} disabled={!valid || saving || filled.length === 0}>
            {saving ? 'Saving…' : 'Save plan'}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}

/** The portfolio's plan notes: its rules and reasons, saved as you type (after a pause) and
 * when you leave the box. */
export function PlanNotesCard({ portfolio, onSaved }: { portfolio: Portfolio; onSaved: () => void }) {
  const toast = useToast()
  const [text, setText] = useState(portfolio.notes ?? '')
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const saved = useRef(portfolio.notes ?? '')
  const timer = useRef<number | undefined>(undefined)

  async function save(value: string) {
    window.clearTimeout(timer.current)
    if (value === saved.current) return setState('saved')
    setState('saving')
    try {
      await updatePortfolio(portfolio.id, { notes: value.trim() === '' ? null : value })
      saved.current = value
      setState('saved')
      onSaved()
    } catch (e) {
      setState('dirty')
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <Card
      title="Plan notes"
      subtitle="Your rules for this account, written while calm — read them before you trade."
      actions={<span className="text-xs text-neutral-500">{state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Not saved yet' : text ? 'Saved' : ''}</span>}
    >
      <textarea
        value={text}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          setState('dirty')
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => save(v), 1200)
        }}
        onBlur={() => save(text)}
        rows={5}
        placeholder={'e.g. Long-term growth. No options in this account.\nRebalance every January, or when anything is 5% off.\nAdd AMZN on dips below fair value.'}
        className={INPUT}
      />
    </Card>
  )
}
