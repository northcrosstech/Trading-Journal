import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  fetchTradeWithDetails,
  fetchPlaybooks,
  fetchPlaybookWithRules,
  setTradePlaybook,
  removeTradePlaybook,
  setTradeRuleCheckStatus,
  updateTradeNotes,
  uploadTradeScreenshot,
  updateTradeScreenshot,
  getTradeScreenshotUrl,
  deleteTradeScreenshot,
} from '../lib/queries'
import type { TradeWithDetails, Playbook, PlaybookWithRules } from '../lib/database.types'
import { fetchCandles, type CandleInterval, type CandleResult } from '../lib/candles'
import { CandlestickChart, type ChartMarker } from '../components/CandlestickChart'
import { PlaybookPicker } from '../components/PlaybookPicker'
import { PlaybookRuleChecklist } from '../components/PlaybookRuleChecklist'
import { currency, holdTimeFmt, optionLabel, dateTimeFmt, timeOnlyFmt, priceFmt, percentFmt } from '../lib/format'
import { returnOnCapitalPct, entrySizeUsd, exitSizeUsd } from '../lib/metrics'

const ACTION_LABEL: Record<string, string> = { entry: 'Open', add: 'Add', trim: 'Trim', exit: 'Close' }

export function TradeDetailPage() {
  const { tradeId } = useParams<{ tradeId: string }>()
  const { user } = useAuth()

  const [trade, setTrade] = useState<TradeWithDetails | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(true)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trade Log
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-100">
            {trade.symbol} {optionLabel(trade.options_detail?.strike, trade.options_detail?.option_type)}
          </h1>
          <span className="text-sm text-neutral-500">exp {trade.options_detail?.expiration}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              trade.status === 'OPEN' ? 'bg-blue-950 text-blue-300' : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {trade.status}
          </span>
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
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Side</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {sortedExecutions.map((e) => (
                  <tr key={e.id} className="border-b border-neutral-800/60 last:border-0">
                    <td className="px-4 py-2 text-neutral-400" title={dateTimeFmt(e.filled_at)}>
                      {timeOnlyFmt(e.filled_at)}
                    </td>
                    <td className="px-4 py-2 text-neutral-200">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-4 py-2 capitalize text-neutral-400">{e.side}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{e.quantity}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{priceFmt(e.price)}</td>
                  </tr>
                ))}
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
