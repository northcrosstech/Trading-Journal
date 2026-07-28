import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import {
  fetchTradeWithDetails,
  fetchTrades,
  fetchPlaybooks,
  fetchPlaybookWithRules,
  setTradePlaybook,
  removeTradePlaybook,
  setTradeRuleCheckStatus,
  updateTradeNotes,
  updateTradeThesisNote,
  updateTradeReflectionNote,
  uploadTradeScreenshot,
  updateTradeScreenshot,
  getTradeScreenshotUrl,
  deleteTradeScreenshot,
  fetchEmotions,
  ensureDefaultEmotions,
  createEmotion,
  setTradeEmotion,
  removeTradeEmotion,
  deleteManualTrade,
} from '../lib/queries'
import type { Trade, TradeWithDetails, Playbook, PlaybookWithRules, Emotion } from '../lib/database.types'
import { fetchCandles, type CandleInterval, type CandleResult } from '../lib/candles'
import { CandlestickChart, type ChartMarker } from '../components/CandlestickChart'
import { PlaybookPicker } from '../components/PlaybookPicker'
import { PlaybookRuleChecklist } from '../components/PlaybookRuleChecklist'
import { PsychologyChips } from '../components/PsychologyChips'
import { currency, holdTimeFmt, optionLabel, dateFmt, dateTimeFmt, timeOnlyFmt, priceFmt, percentFmt, dteLabel } from '../lib/format'
import { returnOnCapitalPct, entrySizeUsd, exitSizeUsd, computeCostBasisAnalysis } from '../lib/metrics'

const ACTION_LABEL: Record<string, string> = { entry: 'Open', add: 'Add', trim: 'Trim', exit: 'Close' }

/** Same bucketing rule used everywhere else: closed trades sort by when the P&L
 * became real, open trades by when the position was entered. */
function navSortDate(t: Trade): string | null {
  return t.status === 'CLOSED' ? t.last_out_at : t.first_in_at
}

/** Persistent trade list so you can click straight through a review session instead
 * of going back to the Trade Log between every trade. Scoped to the current account
 * filter, newest first -- a lighter fetchTrades (no execution/playbook joins) since
 * this only ever renders a summary line per row. */
function TradeNavPanel({ currentTradeId }: { currentTradeId: string }) {
  const { selectedAccountId } = useAccountFilter()
  const [navTrades, setNavTrades] = useState<Trade[] | null>(null)
  const [filter, setFilter] = useState('')
  const currentRowRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchTrades(selectedAccountId).then((t) => {
      if (!cancelled) setNavTrades(t)
    })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const sorted = useMemo(() => {
    if (!navTrades) return []
    return [...navTrades].sort((a, b) => new Date(navSortDate(b) ?? 0).getTime() - new Date(navSortDate(a) ?? 0).getTime())
  }, [navTrades])

  const visible = filter.trim() ? sorted.filter((t) => t.symbol.toLowerCase().includes(filter.trim().toLowerCase())) : sorted

  // Keeps the current trade in view when navigating via the panel itself, without
  // fighting the page's own scroll position on first load.
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentTradeId])

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 lg:flex">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by symbol…"
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500"
      />
      <div className="sticky top-6 flex max-h-[calc(100vh-8rem)] flex-col gap-0.5 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-1.5">
        {navTrades === null && <div className="p-3 text-xs text-neutral-500">Loading…</div>}
        {navTrades !== null && visible.length === 0 && <div className="p-3 text-xs text-neutral-500">No trades match.</div>}
        {visible.map((t) => {
          const isCurrent = t.id === currentTradeId
          const date = navSortDate(t)
          return (
            <Link
              key={t.id}
              ref={isCurrent ? currentRowRef : undefined}
              to={`/trades/${t.id}`}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                isCurrent ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
              }`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{t.symbol}</span>
                <span className="text-[11px] text-neutral-500">{date ? dateFmt(date) : '—'}</span>
              </span>
              {t.status === 'CLOSED' ? (
                <span className={`shrink-0 tabular-nums ${(t.realized_pnl_net ?? 0) >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
                  {currency(t.realized_pnl_net)}
                </span>
              ) : (
                <span className="shrink-0 text-neutral-600">OPEN</span>
              )}
            </Link>
          )
        })}
      </div>
    </aside>
  )
}

export function TradeDetailPage() {
  const { tradeId } = useParams<{ tradeId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [trade, setTrade] = useState<TradeWithDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(true)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [thesisNote, setThesisNote] = useState('')
  const [reflectionNote, setReflectionNote] = useState('')
  const [psychSaved, setPsychSaved] = useState(true)
  const psychTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [allEmotions, setAllEmotions] = useState<Emotion[]>([])

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [candleInterval, setCandleInterval] = useState<CandleInterval>('1min')
  const [candleResult, setCandleResult] = useState<CandleResult | null>(null)

  const [allPlaybooks, setAllPlaybooks] = useState<Playbook[]>([])
  const [linkedPlaybook, setLinkedPlaybook] = useState<PlaybookWithRules | null>(null)

  const load = useCallback(async () => {
    if (!tradeId) return
    const t = await fetchTradeWithDetails(tradeId)
    setTrade(t)
    setNotes(t?.notes ?? '')
    setThesisNote(t?.thesis_note ?? '')
    setReflectionNote(t?.reflection_note ?? '')
    if (t?.screenshot_url) {
      getTradeScreenshotUrl(t.screenshot_url).then(setScreenshotUrl).catch(() => setScreenshotUrl(null))
    } else {
      setScreenshotUrl(null)
    }
    if (t?.trade_playbooks) {
      fetchPlaybookWithRules(t.trade_playbooks.playbook_id).then(setLinkedPlaybook)
    } else {
      setLinkedPlaybook(null)
    }
  }, [tradeId])

  useEffect(() => {
    load().catch((e) => setError(e.message))
    fetchPlaybooks().then((p) => setAllPlaybooks(p ?? []))
  }, [load])

  useEffect(() => {
    if (!user) return
    ensureDefaultEmotions(user.id)
      .then(() => fetchEmotions())
      .then(setAllEmotions)
  }, [user])

  async function handleSelectPlaybook(playbookId: string) {
    if (!tradeId) return
    await setTradePlaybook(tradeId, playbookId)
    load()
  }

  async function handleClearPlaybook() {
    if (!tradeId) return
    await removeTradePlaybook(tradeId)
    load()
  }

  async function handleDelete() {
    if (!tradeId) return
    setDeleting(true)
    try {
      await deleteManualTrade(tradeId)
      navigate('/trades')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  async function handleSetRuleStatus(ruleId: string, status: 'followed' | 'broken' | 'na') {
    if (!trade) return
    await setTradeRuleCheckStatus(trade.id, ruleId, status)
    setTrade((t) => {
      if (!t) return t
      const next = t.trade_rule_checks.filter((tr) => tr.rule_id !== ruleId)
      const rule = linkedPlaybook?.playbook_rule_groups.flatMap((g) => g.playbook_rules).find((r) => r.id === ruleId) ?? null
      next.push({ rule_id: ruleId, status, playbook_rules: rule })
      return { ...t, trade_rule_checks: next }
    })
  }

  useEffect(() => {
    if (!trade) return
    const executions = [...trade.executions].sort(
      (a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime(),
    )
    if (executions.length === 0) return

    const first = executions[0]
    const last = executions[executions.length - 1]
    const from = new Date(new Date(first.filled_at).getTime() - 30 * 60_000)
    const to = new Date(new Date(trade.status === 'CLOSED' ? last.filled_at : Date.now()).getTime() + 30 * 60_000)

    // Stub fallback only: anchor near the underlying's likely spot price using the
    // option's strike (a reasonable approximation for a typically-near-the-money
    // short-dated retail option trade) -- the option premium itself is on a totally
    // different scale from the underlying's price.
    const strikeAnchor = trade.options_detail?.strike ?? first.price

    setCandleResult(null)
    fetchCandles({
      symbol: trade.symbol,
      from,
      to,
      interval: candleInterval,
      anchorLow: strikeAnchor,
      anchorHigh: strikeAnchor,
    }).then(setCandleResult)
  }, [trade, candleInterval])

  const markers: ChartMarker[] = useMemo(() => {
    if (!trade) return []
    return [...trade.executions]
      .sort((a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime())
      .map((e) => ({
        time: Math.floor(new Date(e.filled_at).getTime() / 1000),
        position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: e.side === 'buy' ? '#3987e5' : '#eda100',
        shape: e.side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${ACTION_LABEL[e.action] ?? e.action} ${e.quantity}@${priceFmt(e.price)}`,
      }))
  }, [trade])

  function scheduleNotesSave(value: string) {
    setNotes(value)
    setNotesSaved(false)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      if (!tradeId) return
      await updateTradeNotes(tradeId, value)
      setNotesSaved(true)
    }, 700)
  }

  function scheduleThesisNoteSave(value: string) {
    setThesisNote(value)
    setPsychSaved(false)
    if (psychTimer.current) clearTimeout(psychTimer.current)
    psychTimer.current = setTimeout(async () => {
      if (!tradeId) return
      await updateTradeThesisNote(tradeId, value)
      setPsychSaved(true)
    }, 700)
  }

  function scheduleReflectionNoteSave(value: string) {
    setReflectionNote(value)
    setPsychSaved(false)
    if (psychTimer.current) clearTimeout(psychTimer.current)
    psychTimer.current = setTimeout(async () => {
      if (!tradeId) return
      await updateTradeReflectionNote(tradeId, value)
      setPsychSaved(true)
    }, 700)
  }

  async function handleToggleEmotion(emotion: Emotion, on: boolean) {
    if (!tradeId) return
    if (on) {
      await setTradeEmotion(tradeId, emotion.id, emotion.phase)
      setTrade((t) => {
        if (!t) return t
        const next = t.trade_emotions.filter((te) => te.emotion_id !== emotion.id)
        next.push({ emotion_id: emotion.id, phase: emotion.phase, emotions: emotion })
        return { ...t, trade_emotions: next }
      })
    } else {
      await removeTradeEmotion(tradeId, emotion.id)
      setTrade((t) => (t ? { ...t, trade_emotions: t.trade_emotions.filter((te) => te.emotion_id !== emotion.id) } : t))
    }
  }

  async function handleAddEmotion(phase: Emotion['phase'], name: string) {
    if (!user || !tradeId) return
    const nextOrder = allEmotions.length > 0 ? Math.max(...allEmotions.map((e) => e.sort_order)) + 1 : 0
    const emotion = await createEmotion(user.id, phase, name, nextOrder)
    setAllEmotions((prev) => [...prev, emotion])
    await handleToggleEmotion(emotion, true)
  }

  async function handleScreenshotChange(file: File | null) {
    if (!file || !tradeId || !user) return
    setUploading(true)
    try {
      const path = await uploadTradeScreenshot(user.id, tradeId, file)
      await updateTradeScreenshot(tradeId, path)
      const url = await getTradeScreenshotUrl(path)
      setScreenshotUrl(url)
      setTrade((t) => (t ? { ...t, screenshot_url: path } : t))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveScreenshot() {
    if (!trade?.screenshot_url || !tradeId) return
    await deleteTradeScreenshot(trade.screenshot_url)
    await updateTradeScreenshot(tradeId, null)
    setScreenshotUrl(null)
    setTrade((t) => (t ? { ...t, screenshot_url: null } : t))
  }

  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>
  }
  if (!trade) {
    return <div className="text-neutral-500">Loading trade…</div>
  }

  const feeUsed = trade.fee_source === 'actual' ? trade.actual_fee : trade.estimated_fee
  const returnPct = returnOnCapitalPct(trade)
  const entrySize = entrySizeUsd(trade)
  const exitSize = exitSizeUsd(trade)
  const sortedExecutions = [...trade.executions].sort(
    (a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime(),
  )
  const costBasis = computeCostBasisAnalysis(trade)

  return (
    <div className="flex gap-5">
      <TradeNavPanel currentTradeId={trade.id} />
      <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trade Log
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-100">
            {trade.symbol} {optionLabel(trade.options_detail?.strike, trade.options_detail?.option_type)}
          </h1>
          {trade.options_detail && (
            <span className="text-sm text-neutral-500">{dteLabel(trade.first_in_at, trade.options_detail.expiration)}</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              trade.status === 'OPEN' ? 'bg-blue-950 text-blue-300' : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {trade.status}
          </span>
          {trade.trade_key === null && !confirmingDelete && (
            <>
              <Link to={`/trades/${trade.id}/edit`} className="text-xs text-blue-400 hover:underline">
                Edit
              </Link>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs text-neutral-500 hover:text-red-400 hover:underline"
              >
                Delete
              </button>
            </>
          )}
          {trade.trade_key === null && confirmingDelete && (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-red-300">Delete this trade permanently?</span>
              <button type="button" onClick={handleDelete} disabled={deleting} className="text-red-400 hover:underline disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-neutral-500 hover:underline">
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>

      {/* stats row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Avg Entry"
          value={priceFmt(trade.avg_entry)}
          sub={<SizeSub contracts={trade.total_contracts} price={trade.avg_entry} size={entrySize} />}
        />
        <Stat
          label="Avg Exit"
          value={priceFmt(trade.avg_exit)}
          sub={<SizeSub contracts={trade.total_contracts} price={trade.avg_exit} size={exitSize} />}
        />
        <Stat
          label="Net P&L"
          value={currency(trade.realized_pnl_net)}
          tone={pnlTone(trade.realized_pnl_net)}
          sub={
            <>
              {returnPct !== null && (
                <>
                  <PctSpan value={returnPct} /> return ·{' '}
                </>
              )}
              fee {currency(feeUsed)}{' '}
              <span className={trade.fee_source === 'estimated' ? 'text-amber-400/80' : ''}>
                ({trade.fee_source === 'estimated' ? 'estimated' : 'confirmed'})
              </span>
            </>
          }
        />
        <Stat label="Hold Time" value={holdTimeFmt(trade.hold_seconds)} />
      </div>

      {/* chart */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">
            {trade.symbol} <span className="font-normal text-neutral-500">underlying price</span>
          </h2>
          <div className="flex items-center gap-3">
            {candleResult?.source === 'stub' && (
              <span className="text-xs text-amber-400/80" title={candleResult.error}>
                stub data — live feed unavailable
              </span>
            )}
            <div className="flex overflow-hidden rounded-md border border-neutral-700 text-xs">
              {(['1min', '5min'] as const).map((iv) => (
                <button
                  key={iv}
                  onClick={() => setCandleInterval(iv)}
                  className={`px-2.5 py-1 transition ${
                    candleInterval === iv ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  {iv === '1min' ? '1m' : '5m'}
                </button>
              ))}
            </div>
          </div>
        </div>
        {candleResult ? (
          <CandlestickChart candles={candleResult.candles} markers={markers} />
        ) : (
          <div className="flex h-80 items-center justify-center text-sm text-neutral-500">Loading chart…</div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* executions */}
        <div className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">Executions</h2>
          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2">Time (CT)</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Side</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right" title="Priced against the running average cost of the position at that moment; gross, before fees">
                    Realized
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedExecutions.map((e) => {
                  const trim = costBasis.trimResults.get(e.id)
                  return (
                    <tr key={e.id} className="border-b border-neutral-800/60 last:border-0">
                      <td className="px-4 py-2 text-neutral-400" title={dateTimeFmt(e.filled_at)}>
                        {timeOnlyFmt(e.filled_at)}
                      </td>
                      <td className="px-4 py-2 text-neutral-200">{ACTION_LABEL[e.action] ?? e.action}</td>
                      <td className="px-4 py-2 capitalize text-neutral-400">{e.side}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{e.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{priceFmt(e.price)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {trim ? (
                          <span className={trim.realizedDollarGross >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
                            {currency(trim.realizedDollarGross)}
                            {trim.realizedPct !== null && <span className="ml-1 text-neutral-500">({percentFmt(trim.realizedPct)})</span>}
                          </span>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* sidebar: playbook, rules, notes, screenshot */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-300">Playbook</h2>
            <PlaybookPicker
              assigned={trade.trade_playbooks}
              allPlaybooks={allPlaybooks}
              onSelect={handleSelectPlaybook}
              onClear={handleClearPlaybook}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-300">Rules</h2>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <PlaybookRuleChecklist playbook={linkedPlaybook} tradeRuleChecks={trade.trade_rule_checks} onSetStatus={handleSetRuleStatus} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-300">Psychology</h2>
              <span className="text-xs text-neutral-600">{psychSaved ? 'Saved' : 'Saving…'}</span>
            </div>
            <PsychologyChips
              emotions={allEmotions}
              selected={trade.trade_emotions.map((te) => ({ emotion_id: te.emotion_id, phase: te.phase }))}
              thesisNote={thesisNote}
              reflectionNote={reflectionNote}
              onToggle={handleToggleEmotion}
              onThesisNoteChange={scheduleThesisNoteSave}
              onReflectionNoteChange={scheduleReflectionNoteSave}
              onAddEmotion={handleAddEmotion}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-300">Notes</h2>
              <span className="text-xs text-neutral-600">{notesSaved ? 'Saved' : 'Saving…'}</span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => scheduleNotesSave(e.target.value)}
              placeholder="What was your thesis? What would you do differently?"
              rows={5}
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-300">Screenshot</h2>
            {screenshotUrl ? (
              <div className="relative">
                <img src={screenshotUrl} alt="Trade screenshot" className="w-full rounded-lg border border-neutral-800" />
                <button
                  onClick={handleRemoveScreenshot}
                  className="absolute right-2 top-2 rounded-md bg-neutral-950/80 px-2 py-1 text-xs text-neutral-300 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
                {uploading ? 'Uploading…' : '+ Add screenshot'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleScreenshotChange(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

function pnlTone(v: number | null): 'good' | 'critical' | 'neutral' {
  if (v === null) return 'neutral'
  return v >= 0 ? 'good' : 'critical'
}

function PctSpan({ value }: { value: number }) {
  return <span className={value >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>{percentFmt(value)}</span>
}

/** "3 × $5.81 = $1,743.00" -- the position-size total is the point, so it's the only
 * part that's brightened/bolded; the contracts × price factors stay muted context. */
function SizeSub({ contracts, price, size }: { contracts: number | null; price: number | null; size: number | null }) {
  if (contracts === null || price === null || size === null) return null
  return (
    <>
      {contracts} × {priceFmt(price)} = <span className="font-semibold text-neutral-300">{currency(size)}</span>
    </>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
  sub,
}: {
  label: string
  value: string
  tone?: 'good' | 'critical' | 'neutral'
  sub?: ReactNode
}) {
  const toneClass = tone === 'good' ? 'text-(--status-good)' : tone === 'critical' ? 'text-(--status-critical)' : 'text-neutral-100'
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-600">{sub}</div>}
    </div>
  )
}
