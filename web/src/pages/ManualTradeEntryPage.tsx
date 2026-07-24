import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import {
  createManualTrade,
  fetchEmotions,
  ensureDefaultEmotions,
  createEmotion,
  setTradeEmotion,
  setTradePlaybook,
  fetchPlaybooks,
} from '../lib/queries'
import type { Emotion, Playbook } from '../lib/database.types'
import { summarizeFills, type FillAction, type FillInput } from '../lib/manualTrade'
import { PsychologyChips } from '../components/PsychologyChips'
import { PlaybookChip } from '../components/PlaybookChip'
import { priceFmt } from '../lib/format'

/** yyyy-mm-ddThh:mm, the format <input type="datetime-local"> both wants and gives back. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ACTION_LABEL: Record<FillAction, string> = { open: 'Open', add: 'Add', trim: 'Trim', close: 'Close' }

type FillFormRow = { key: string; action: FillAction; time: string; price: string; quantity: string }

let fillKeySeq = 0
function newFillKey() {
  fillKeySeq += 1
  return `fill-${fillKeySeq}`
}

function FillRow({
  row,
  onChange,
  onRemove,
  removable,
}: {
  row: FillFormRow
  onChange: (patch: Partial<FillFormRow>) => void
  onRemove: () => void
  removable: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={row.action}
        onChange={(e) => onChange({ action: e.target.value as FillAction })}
        className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500"
      >
        {(Object.keys(ACTION_LABEL) as FillAction[]).map((a) => (
          <option key={a} value={a}>
            {ACTION_LABEL[a]}
          </option>
        ))}
      </select>
      <input
        type="datetime-local"
        value={row.time}
        onChange={(e) => onChange({ time: e.target.value })}
        className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500"
      />
      <input
        type="number"
        step="0.01"
        placeholder="Price"
        value={row.price}
        onChange={(e) => onChange({ price: e.target.value })}
        className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500"
      />
      <input
        type="number"
        step="1"
        min="1"
        placeholder="Qty"
        value={row.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
        className="w-16 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        className="w-5 shrink-0 text-neutral-600 hover:text-red-400 disabled:opacity-20"
        title="Remove fill"
      >
        ✕
      </button>
    </div>
  )
}

export function ManualTradeEntryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { accounts, selectedAccountId } = useAccountFilter()
  // Memoized so it's referentially stable across renders (only changes when
  // `accounts` itself does) -- lets the default-asset-type effect below depend on it
  // directly without re-firing on every render.
  const manualAccounts = useMemo(() => accounts.filter((a) => a.sync_mode === 'manual'), [accounts])

  const [accountId, setAccountId] = useState('')
  // Defaults the account to whatever's currently selected in the sidebar switcher
  // (if it accepts manual entry), falling back to the first manual account -- runs
  // once, the first time manualAccounts has something to choose from, and never
  // overrides a choice the user's already made.
  const defaultedAccountRef = useRef(false)
  useEffect(() => {
    if (defaultedAccountRef.current || manualAccounts.length === 0) return
    defaultedAccountRef.current = true
    const preferred = manualAccounts.find((a) => a.id === selectedAccountId)
    setAccountId((preferred ?? manualAccounts[0]).id)
  }, [manualAccounts, selectedAccountId])

  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [isOption, setIsOption] = useState(false)
  const [optionType, setOptionType] = useState<'call' | 'put'>('call')
  const [strike, setStrike] = useState('')
  const [expiration, setExpiration] = useState('')
  const [fees, setFees] = useState('0')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fills, setFills] = useState<FillFormRow[]>(() => {
    const now = toDatetimeLocal(new Date())
    return [
      { key: newFillKey(), action: 'open', time: now, price: '', quantity: '1' },
      { key: newFillKey(), action: 'close', time: now, price: '', quantity: '1' },
    ]
  })

  function updateFill(key: string, patch: Partial<FillFormRow>) {
    setFills((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }

  function addFill() {
    setFills((prev) => {
      const row = { key: newFillKey(), action: 'trim' as FillAction, time: toDatetimeLocal(new Date()), price: '', quantity: '1' }
      // Insert before the last row (typically "Close") so Close stays the final fill
      // by default -- matches "I want to trim before I close."
      if (prev.length === 0) return [row]
      return [...prev.slice(0, -1), row, prev[prev.length - 1]]
    })
  }

  function removeFill(key: string) {
    setFills((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.key !== key)))
  }

  // Live preview math -- shares the exact same summarizeFills logic createManualTrade
  // uses, so what you see here can never disagree with what gets saved. Rows with
  // incomplete price/quantity are simply excluded from the running total rather than
  // blocking the preview.
  const fillSummary = useMemo(() => {
    const parsed: FillInput[] = fills
      .filter((f) => f.price !== '' && f.quantity !== '' && f.time)
      .map((f) => ({ action: f.action, time: new Date(f.time).toISOString(), price: Number(f.price), quantity: Number(f.quantity) }))
    return summarizeFills(parsed)
  }, [fills])

  // Defaults the options checkbox from the selected account's preference (set on the
  // Accounts page) -- re-applies whenever the account selection changes, so switching
  // accounts mid-form updates the default rather than sticking with the first one.
  useEffect(() => {
    const account = manualAccounts.find((a) => a.id === accountId)
    if (account) setIsOption(account.default_asset_type === 'option')
  }, [accountId, manualAccounts])

  // Step 2: optional context, collapsed by default so logging a trade never feels
  // heavier than "the numbers."
  const [showMore, setShowMore] = useState(false)
  const [allPlaybooks, setAllPlaybooks] = useState<Playbook[]>([])
  const [playbookId, setPlaybookId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [allEmotions, setAllEmotions] = useState<Emotion[]>([])
  const [selectedEmotions, setSelectedEmotions] = useState<{ emotion_id: string; phase: Emotion['phase'] }[]>([])
  const [thesisNote, setThesisNote] = useState('')
  const [reflectionNote, setReflectionNote] = useState('')

  useEffect(() => {
    fetchPlaybooks().then((p) => setAllPlaybooks((p ?? []).filter((pb) => !pb.archived)))
  }, [])

  useEffect(() => {
    if (!user) return
    ensureDefaultEmotions(user.id)
      .then(() => fetchEmotions())
      .then(setAllEmotions)
  }, [user])

  function handleToggleEmotion(emotion: Emotion, on: boolean) {
    setSelectedEmotions((prev) =>
      on
        ? [...prev.filter((e) => e.emotion_id !== emotion.id), { emotion_id: emotion.id, phase: emotion.phase }]
        : prev.filter((e) => e.emotion_id !== emotion.id),
    )
  }

  async function handleAddEmotion(phase: Emotion['phase'], name: string) {
    if (!user) return
    const nextOrder = allEmotions.length > 0 ? Math.max(...allEmotions.map((e) => e.sort_order)) + 1 : 0
    const emotion = await createEmotion(user.id, phase, name, nextOrder)
    setAllEmotions((prev) => [...prev, emotion])
    handleToggleEmotion(emotion, true)
  }

  const fillsValid = fills.every((f) => f.price !== '' && Number(f.price) > 0 && f.quantity !== '' && Number(f.quantity) > 0)
  const canSubmit = !!accountId && !!symbol.trim() && fillsValid && fillSummary.entryQty > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const parsedFills: FillInput[] = fills.map((f) => ({
        action: f.action,
        time: new Date(f.time).toISOString(),
        price: Number(f.price),
        quantity: Number(f.quantity),
      }))
      const trade = await createManualTrade(user.id, {
        accountId,
        symbol: symbol.trim().toUpperCase(),
        side,
        fills: parsedFills,
        fees: Number(fees) || 0,
        optionType: isOption ? optionType : undefined,
        strike: isOption && strike ? Number(strike) : undefined,
        expiration: isOption && expiration ? expiration : undefined,
        notes,
        thesisNote,
        reflectionNote,
      })
      if (playbookId) {
        await setTradePlaybook(trade.id, playbookId)
      }
      await Promise.all(selectedEmotions.map((em) => setTradeEmotion(trade.id, em.emotion_id, em.phase)))
      navigate(`/trades/${trade.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  if (manualAccounts.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Add Manual Trade</h1>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-400">
          No manual-entry accounts yet.{' '}
          <Link to="/accounts" className="text-blue-400 hover:underline">
            Create one on the Accounts page
          </Link>{' '}
          first (broker "Manual", or any account with sync mode "Manual entry").
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trade Log
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-neutral-100">Add Manual Trade</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Account</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            >
              {manualAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Symbol</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="SPY"
              autoFocus
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-neutral-700">
            {(['long', 'short'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`px-4 py-1.5 text-sm capitalize transition ${
                  side === s ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={isOption} onChange={(e) => setIsOption(e.target.checked)} />
            Options trade
          </label>
        </div>

        {isOption && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Type</label>
              <select
                value={optionType}
                onChange={(e) => setOptionType(e.target.value as 'call' | 'put')}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              >
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Strike</label>
              <input
                type="number"
                step="0.5"
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Expiration</label>
              <input
                type="date"
                value={expiration}
                onChange={(e) => setExpiration(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs text-neutral-500">Fills</label>
            <button type="button" onClick={addFill} className="text-xs text-blue-400 hover:underline">
              + Add fill
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {fills.map((f) => (
              <FillRow
                key={f.key}
                row={f}
                removable={fills.length > 1}
                onChange={(patch) => updateFill(f.key, patch)}
                onRemove={() => removeFill(f.key)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-400">
          <span>
            Avg Entry <span className="font-medium text-neutral-200">{priceFmt(fillSummary.avgEntry)}</span>
          </span>
          <span>
            Avg Exit <span className="font-medium text-neutral-200">{fillSummary.avgExit !== null ? priceFmt(fillSummary.avgExit) : '—'}</span>
          </span>
          <span>
            Net Qty{' '}
            <span className="font-medium text-neutral-200">
              {fillSummary.netQty} {fillSummary.entryQty > 0 && (fillSummary.closed ? '(Closed)' : '(Open)')}
            </span>
          </span>
        </div>

        <div>
          <label className="mb-1 block text-xs text-neutral-500">Fees (total)</label>
          <input
            type="number"
            step="0.01"
            value={fees}
            onChange={(e) => setFees(e.target.value)}
            className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1 self-start text-xs text-neutral-500 hover:text-neutral-300"
        >
          <span className={`inline-block transition-transform ${showMore ? 'rotate-90' : ''}`}>▸</span>
          More details (optional) -- playbook, psychology, notes
        </button>

        {showMore && (
          <div className="flex flex-col gap-4 border-t border-neutral-800 pt-3">
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500">Playbook</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {playbookId && allPlaybooks.find((p) => p.id === playbookId) && (
                  <PlaybookChip playbook={allPlaybooks.find((p) => p.id === playbookId)!} onRemove={() => setPlaybookId(null)} />
                )}
                {!playbookId &&
                  allPlaybooks
                    .filter((p) => !p.archived)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlaybookId(p.id)}
                        className="rounded-full border border-dashed border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                      >
                        {p.icon && <span className="mr-1">{p.icon}</span>}
                        {p.name}
                      </button>
                    ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-neutral-500">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything else worth remembering about this trade…"
                rows={2}
                className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <h2 className="mb-2 text-xs text-neutral-500">Psychology</h2>
              <PsychologyChips
                emotions={allEmotions}
                selected={selectedEmotions}
                thesisNote={thesisNote}
                reflectionNote={reflectionNote}
                onToggle={handleToggleEmotion}
                onThesisNoteChange={setThesisNote}
                onReflectionNoteChange={setReflectionNote}
                onAddEmotion={handleAddEmotion}
              />
            </div>
          </div>
        )}

        {error && <div className="rounded-md border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Save Trade'}
        </button>
      </form>
    </div>
  )
}
