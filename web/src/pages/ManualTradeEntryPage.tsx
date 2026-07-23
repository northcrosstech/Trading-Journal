import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { createManualTrade, fetchEmotions, ensureDefaultEmotions, createEmotion, setTradeEmotion } from '../lib/queries'
import type { Emotion } from '../lib/database.types'
import { PsychologyChips } from '../components/PsychologyChips'

/** yyyy-mm-ddThh:mm, the format <input type="datetime-local"> both wants and gives back. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ManualTradeEntryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { accounts } = useAccountFilter()
  const manualAccounts = accounts.filter((a) => a.sync_mode === 'manual')

  const [accountId, setAccountId] = useState(manualAccounts[0]?.id ?? '')
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [isOption, setIsOption] = useState(false)
  const [optionType, setOptionType] = useState<'call' | 'put'>('call')
  const [strike, setStrike] = useState('')
  const [expiration, setExpiration] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [entryPrice, setEntryPrice] = useState('')
  const [entryTime, setEntryTime] = useState(() => toDatetimeLocal(new Date()))
  const [closed, setClosed] = useState(true)
  const [exitPrice, setExitPrice] = useState('')
  const [exitTime, setExitTime] = useState(() => toDatetimeLocal(new Date()))
  const [fees, setFees] = useState('0')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [allEmotions, setAllEmotions] = useState<Emotion[]>([])
  const [selectedEmotions, setSelectedEmotions] = useState<{ emotion_id: string; phase: Emotion['phase'] }[]>([])
  const [thesisNote, setThesisNote] = useState('')
  const [reflectionNote, setReflectionNote] = useState('')

  useEffect(() => {
    if (!user) return
    ensureDefaultEmotions(user.id)
      .then(() => fetchEmotions())
      .then(setAllEmotions)
  }, [user])

  function handleToggleEmotion(emotion: Emotion, on: boolean) {
    setSelectedEmotions((prev) =>
      on ? [...prev.filter((e) => e.emotion_id !== emotion.id), { emotion_id: emotion.id, phase: emotion.phase }] : prev.filter((e) => e.emotion_id !== emotion.id),
    )
  }

  async function handleAddEmotion(phase: Emotion['phase'], name: string) {
    if (!user) return
    const nextOrder = allEmotions.length > 0 ? Math.max(...allEmotions.map((e) => e.sort_order)) + 1 : 0
    const emotion = await createEmotion(user.id, phase, name, nextOrder)
    setAllEmotions((prev) => [...prev, emotion])
    handleToggleEmotion(emotion, true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !accountId || !symbol.trim() || !entryPrice || !quantity) return
    setSubmitting(true)
    setError(null)
    try {
      const trade = await createManualTrade(user.id, {
        accountId,
        symbol: symbol.trim().toUpperCase(),
        side,
        quantity: Number(quantity),
        entryPrice: Number(entryPrice),
        entryTime: new Date(entryTime).toISOString(),
        exitPrice: closed && exitPrice ? Number(exitPrice) : null,
        exitTime: closed && exitTime ? new Date(exitTime).toISOString() : null,
        fees: Number(fees) || 0,
        optionType: isOption ? optionType : undefined,
        strike: isOption && strike ? Number(strike) : undefined,
        expiration: isOption && expiration ? expiration : undefined,
        thesisNote,
        reflectionNote,
      })
      await Promise.all(selectedEmotions.map((e) => setTradeEmotion(trade.id, e.emotion_id, e.phase)))
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
        <p className="mt-1 text-sm text-neutral-500">
          One entry fill and one exit fill -- writes real executions rows, so this trade works everywhere a synced
          one does (dashboard, stats, playbooks, calendar, journal).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Symbol</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="SPY"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Side</label>
            <div className="flex overflow-hidden rounded-md border border-neutral-700">
              {(['long', 'short'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={`flex-1 py-2 text-sm capitalize transition ${
                    side === s ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={isOption} onChange={(e) => setIsOption(e.target.checked)} />
          This is an options trade
        </label>

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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Quantity</label>
            <input
              type="number"
              step="1"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Fees (total)</label>
            <input
              type="number"
              step="0.01"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Entry Price</label>
            <input
              type="number"
              step="0.01"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Entry Time</label>
            <input
              type="datetime-local"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          Trade is closed (has an exit fill)
        </label>

        {closed && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Exit Price</label>
              <input
                type="number"
                step="0.01"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Exit Time</label>
              <input
                type="datetime-local"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}

        <div className="border-t border-neutral-800 pt-3">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">Psychology (optional)</h2>
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

        {error && <div className="rounded-md border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !symbol.trim() || !entryPrice || !quantity}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Save Trade'}
        </button>
      </form>
    </div>
  )
}
