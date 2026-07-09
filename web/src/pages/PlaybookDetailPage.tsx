import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  fetchPlaybookWithRules,
  updatePlaybook,
  setPlaybookArchived,
  uploadPlaybookChart,
  getPlaybookAssetUrl,
  deletePlaybookAsset,
  createRuleGroup,
  renameRuleGroup,
  reorderRuleGroup,
  deleteRuleGroup,
  createPlaybookRule,
  updatePlaybookRuleText,
  reorderPlaybookRule,
  deletePlaybookRule,
  fetchTradesWithDetails,
  fetchMissedTrades,
  createMissedTrade,
  deleteMissedTrade,
  uploadMissedTradeScreenshot,
  updateMissedTradeScreenshot,
} from '../lib/queries'
import type { PlaybookWithRules, PlaybookRuleGroup, PlaybookRule, TradeWithDetails, MissedTrade } from '../lib/database.types'
import { computePlaybookStats, computePlaybookRuleStats } from '../lib/metrics'
import { filterTradesByDateRange, presetRange, type DateRangePreset } from '../lib/dateRange'
import { ColorPicker } from '../components/ColorPicker'
import { DateRangePresetBar } from '../components/DateRangePresetBar'
import { StatTile } from '../components/StatStripBar'
import { MagnitudeBar } from '../components/MagnitudeBar'
import { currency, dateFmt } from '../lib/format'

function pf(v: number | null): string {
  return v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

function RuleRow({
  rule,
  isFirst,
  isLast,
  onEdit,
  onMove,
  onDelete,
}: {
  rule: PlaybookRule
  isFirst: boolean
  isLast: boolean
  onEdit: (text: string) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(rule.text)

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex shrink-0 flex-col">
        <button onClick={() => onMove(-1)} disabled={isFirst} className="text-neutral-600 hover:text-neutral-300 disabled:opacity-20">
          ▲
        </button>
        <button onClick={() => onMove(1)} disabled={isLast} className="text-neutral-600 hover:text-neutral-300 disabled:opacity-20">
          ▼
        </button>
      </div>
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim()) onEdit(text.trim())
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (text.trim()) onEdit(text.trim())
              setEditing(false)
            }
            if (e.key === 'Escape') setEditing(false)
          }}
          className="flex-1 rounded-md border border-blue-500 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm text-neutral-200 hover:text-neutral-100">
          {rule.text}
        </button>
      )}
      <button onClick={onDelete} className="shrink-0 text-xs text-neutral-600 hover:text-red-400">
        Remove
      </button>
    </div>
  )
}

function RuleStatRow({ stat }: { stat: ReturnType<typeof computePlaybookRuleStats>[number] }) {
  const maxAbs = Math.max(1, Math.abs(stat.pnlFollowed), Math.abs(stat.pnlBroken))
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-300">{stat.rule.text}</span>
        <span className="shrink-0 text-xs text-neutral-500">
          {stat.followRate === null ? '—' : `${(stat.followRate * 100).toFixed(0)}% followed`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 shrink-0 text-(--status-good)">Followed</span>
        <MagnitudeBar value={stat.pnlFollowed} maxAbs={maxAbs} />
        <span className="w-20 shrink-0 text-right tabular-nums text-neutral-400">
          {currency(stat.pnlFollowed)} ({stat.followedCount})
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 shrink-0 text-(--status-critical)">Broken</span>
        <MagnitudeBar value={stat.pnlBroken} maxAbs={maxAbs} />
        <span className="w-20 shrink-0 text-right tabular-nums text-neutral-400">
          {currency(stat.pnlBroken)} ({stat.brokenCount})
        </span>
      </div>
    </div>
  )
}

function MissedTradeRow({ missed, onDelete }: { missed: MissedTrade; onDelete: () => void }) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)

  useEffect(() => {
    if (missed.screenshot_url) {
      getPlaybookAssetUrl(missed.screenshot_url).then(setScreenshotUrl).catch(() => setScreenshotUrl(null))
    }
  }, [missed.screenshot_url])

  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-neutral-200">{missed.symbol}</span>
          <span className="text-xs text-neutral-500">{dateFmt(missed.missed_date)}</span>
          {missed.est_pnl_missed !== null && (
            <span className="text-xs text-(--status-critical)">missed {currency(missed.est_pnl_missed)}</span>
          )}
        </div>
        {missed.notes && <p className="mt-0.5 text-xs text-neutral-500">{missed.notes}</p>}
        {screenshotUrl && (
          <img src={screenshotUrl} alt="" className="mt-2 max-h-40 rounded-lg border border-neutral-800" />
        )}
      </div>
      <button onClick={onDelete} className="shrink-0 text-xs text-neutral-600 hover:text-red-400">
        Remove
      </button>
    </div>
  )
}

function MissedTradeForm({ onSubmit }: { onSubmit: (fields: { date: string; symbol: string; notes: string; estPnl: string; file: File | null }) => Promise<void> }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [symbol, setSymbol] = useState('')
  const [notes, setNotes] = useState('')
  const [estPnl, setEstPnl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!symbol.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ date, symbol: symbol.trim().toUpperCase(), notes: notes.trim(), estPnl, file })
      setSymbol('')
      setNotes('')
      setEstPnl('')
      setFile(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-xl border border-dashed border-neutral-700 p-3">
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Symbol"
          className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <input
          type="number"
          step="0.01"
          value={estPnl}
          onChange={(e) => setEstPnl(e.target.value)}
          placeholder="Est. P&L missed"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What happened…"
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
      />
      <div className="flex items-center justify-between gap-2">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="flex-1 text-xs text-neutral-500 file:mr-2 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-950 file:px-2 file:py-1 file:text-xs file:text-neutral-300"
        />
        <button
          type="submit"
          disabled={!symbol.trim() || submitting}
          className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Adding…' : 'Add Missed Trade'}
        </button>
      </div>
    </form>
  )
}

function RuleGroupCard({ group, onReload }: { group: PlaybookRuleGroup & { playbook_rules: PlaybookRule[] }; onReload: () => void }) {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(group.name)
  const [newRuleText, setNewRuleText] = useState('')

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault()
    if (!newRuleText.trim()) return
    const nextOrder = group.playbook_rules.length > 0 ? Math.max(...group.playbook_rules.map((r) => r.sort_order)) + 1 : 0
    await createPlaybookRule(group.id, newRuleText.trim(), nextOrder)
    setNewRuleText('')
    onReload()
  }

  async function handleMoveRule(rule: PlaybookRule, direction: -1 | 1) {
    const idx = group.playbook_rules.findIndex((r) => r.id === rule.id)
    const swapWith = group.playbook_rules[idx + direction]
    if (!swapWith) return
    await Promise.all([reorderPlaybookRule(rule.id, swapWith.sort_order), reorderPlaybookRule(swapWith.id, rule.sort_order)])
    onReload()
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) renameRuleGroup(group.id, name.trim()).then(onReload)
              setEditingName(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (name.trim()) renameRuleGroup(group.id, name.trim()).then(onReload)
                setEditingName(false)
              }
            }}
            className="rounded-md border border-blue-500 bg-neutral-950 px-2 py-1 text-sm font-medium text-neutral-100 outline-none"
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="text-sm font-medium text-neutral-200 hover:text-neutral-100">
            {group.name}
          </button>
        )}
        <button
          onClick={() => deleteRuleGroup(group.id).then(onReload)}
          className="text-xs text-neutral-600 hover:text-red-400"
        >
          Delete group
        </button>
      </div>

      <div className="flex flex-col divide-y divide-neutral-800/60">
        {group.playbook_rules.length === 0 && <div className="py-2 text-xs text-neutral-600">No rules in this group yet.</div>}
        {group.playbook_rules.map((rule, i) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            isFirst={i === 0}
            isLast={i === group.playbook_rules.length - 1}
            onEdit={(text) => updatePlaybookRuleText(rule.id, text).then(onReload)}
            onMove={(direction) => handleMoveRule(rule, direction)}
            onDelete={() => deletePlaybookRule(rule.id).then(onReload)}
          />
        ))}
      </div>

      <form onSubmit={handleAddRule} className="mt-2 flex gap-2">
        <input
          value={newRuleText}
          onChange={(e) => setNewRuleText(e.target.value)}
          placeholder="Add a rule…"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={!newRuleText.trim()}
          className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </div>
  )
}

export function PlaybookDetailPage() {
  const { playbookId } = useParams<{ playbookId: string }>()
  const { user } = useAuth()

  const [playbook, setPlaybook] = useState<PlaybookWithRules | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chartUrl, setChartUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  const [trades, setTrades] = useState<TradeWithDetails[]>([])
  const [missedTrades, setMissedTrades] = useState<MissedTrade[]>([])
  const [preset, setPreset] = useState<DateRangePreset | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [marketConditions, setMarketConditions] = useState('')
  const [icon, setIcon] = useState('')
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!playbookId) return
    const p = await fetchPlaybookWithRules(playbookId)
    setPlaybook(p)
    if (p) {
      setName(p.name)
      setDescription(p.description ?? '')
      setMarketConditions(p.market_conditions ?? '')
      setIcon(p.icon ?? '')
      if (p.example_chart_url) {
        getPlaybookAssetUrl(p.example_chart_url).then(setChartUrl).catch(() => setChartUrl(null))
      } else {
        setChartUrl(null)
      }
    }
  }, [playbookId])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  const loadStatsData = useCallback(async () => {
    if (!playbookId) return
    const [t, m] = await Promise.all([fetchTradesWithDetails(), fetchMissedTrades(playbookId)])
    setTrades(t)
    setMissedTrades(m)
  }, [playbookId])

  useEffect(() => {
    loadStatsData().catch((e) => setError(e.message))
  }, [loadStatsData])

  const range = useMemo(() => presetRange(preset), [preset])

  const filteredTrades = useMemo(() => {
    if (!playbookId) return []
    const assigned = trades.filter((t) => t.trade_playbooks?.playbook_id === playbookId)
    return filterTradesByDateRange(assigned, range)
  }, [trades, playbookId, range])

  const filteredMissedTrades = useMemo(() => {
    if (!range) return missedTrades
    return missedTrades.filter((m) => m.missed_date >= range.from && m.missed_date <= range.to)
  }, [missedTrades, range])

  const stat = useMemo(() => {
    if (!playbook) return null
    const missedCounts = new Map([[playbook.id, filteredMissedTrades.length]])
    const [s] = computePlaybookStats(filteredTrades, [playbook], missedCounts)
    return (
      s ?? {
        playbook,
        tradeCount: 0,
        winRate: null,
        netPnl: 0,
        expectancy: null,
        pnlPct: null,
        pnlContributionPct: null,
        profitFactor: null,
        avgWin: null,
        avgLoss: null,
        missedCount: filteredMissedTrades.length,
      }
    )
  }, [playbook, filteredTrades, filteredMissedTrades])

  const ruleStats = useMemo(() => {
    if (!playbook) return []
    const rules = playbook.playbook_rule_groups.flatMap((g) => g.playbook_rules)
    return computePlaybookRuleStats(filteredTrades, rules).filter((r) => r.followedCount + r.brokenCount > 0)
  }, [playbook, filteredTrades])

  async function handleAddMissedTrade(fields: { date: string; symbol: string; notes: string; estPnl: string; file: File | null }) {
    if (!playbookId || !user) return
    const created = await createMissedTrade(user.id, {
      playbook_id: playbookId,
      missed_date: fields.date,
      symbol: fields.symbol,
      notes: fields.notes || null,
      est_pnl_missed: fields.estPnl.trim() === '' ? null : Number(fields.estPnl),
    })
    if (fields.file) {
      const path = await uploadMissedTradeScreenshot(user.id, created.id, fields.file)
      await updateMissedTradeScreenshot(created.id, path)
    }
    loadStatsData()
  }

  async function handleDeleteMissedTrade(missed: MissedTrade) {
    if (missed.screenshot_url) await deletePlaybookAsset(missed.screenshot_url)
    await deleteMissedTrade(missed.id)
    loadStatsData()
  }

  function scheduleFieldSave(fields: Parameters<typeof updatePlaybook>[1]) {
    if (!playbookId) return
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await updatePlaybook(playbookId, fields)
      setSaved(true)
    }, 600)
  }

  async function handleChartChange(file: File | null) {
    if (!file || !playbookId || !user) return
    setUploading(true)
    try {
      if (playbook?.example_chart_url) await deletePlaybookAsset(playbook.example_chart_url)
      const path = await uploadPlaybookChart(user.id, playbookId, file)
      await updatePlaybook(playbookId, { example_chart_url: path })
      const url = await getPlaybookAssetUrl(path)
      setChartUrl(url)
      setPlaybook((p) => (p ? { ...p, example_chart_url: path } : p))
    } finally {
      setUploading(false)
    }
  }

  async function handleAddGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!playbookId || !newGroupName.trim()) return
    const nextOrder = playbook && playbook.playbook_rule_groups.length > 0 ? Math.max(...playbook.playbook_rule_groups.map((g) => g.sort_order)) + 1 : 0
    await createRuleGroup(playbookId, newGroupName.trim(), nextOrder)
    setNewGroupName('')
    load()
  }

  async function handleMoveGroup(group: PlaybookRuleGroup, direction: -1 | 1) {
    if (!playbook) return
    const idx = playbook.playbook_rule_groups.findIndex((g) => g.id === group.id)
    const swapWith = playbook.playbook_rule_groups[idx + direction]
    if (!swapWith) return
    await Promise.all([reorderRuleGroup(group.id, swapWith.sort_order), reorderRuleGroup(swapWith.id, group.sort_order)])
    load()
  }

  if (error) {
    return <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>
  }
  if (!playbook) {
    return <div className="text-neutral-500">Loading playbook…</div>
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <Link to="/playbooks" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Playbooks
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-neutral-100">{playbook.name}</h1>
          <button
            onClick={() => setPlaybookArchived(playbook.id, !playbook.archived).then(load)}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
          >
            {playbook.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-300">Performance</h2>
        <DateRangePresetBar value={preset} onChange={setPreset} />
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:grid-cols-4">
        <StatTile
          label="Expectancy"
          value={stat && stat.expectancy !== null ? currency(stat.expectancy) : '—'}
          tone={stat && stat.expectancy !== null ? (stat.expectancy >= 0 ? 'good' : 'critical') : 'neutral'}
        />
        <StatTile label="Win Rate" value={stat && stat.winRate !== null ? `${(stat.winRate * 100).toFixed(0)}%` : '—'} />
        <StatTile label="Profit Factor" value={pf(stat?.profitFactor ?? null)} />
        <StatTile label="Net P&L" value={currency(stat?.netPnl ?? 0)} tone={(stat?.netPnl ?? 0) >= 0 ? 'good' : 'critical'} />
        <StatTile label="Avg Win" value={stat && stat.avgWin !== null ? currency(stat.avgWin) : '—'} tone="good" />
        <StatTile label="Avg Loss" value={stat && stat.avgLoss !== null ? currency(stat.avgLoss) : '—'} tone="critical" />
        <StatTile label="Trades" value={String(stat?.tradeCount ?? 0)} />
        <StatTile label="Missed" value={String(stat?.missedCount ?? 0)} tone={stat && stat.missedCount > 0 ? 'critical' : 'neutral'} />
      </div>

      {ruleStats.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-1 text-sm font-medium text-neutral-300">Rule Follow-Rate</h2>
          <div className="flex flex-col divide-y divide-neutral-800/60">
            {ruleStats.map((s) => (
              <RuleStatRow key={s.rule.id} stat={s} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Details</h2>
          <span className="text-[11px] text-neutral-600">{saved ? 'Saved' : 'Saving…'}</span>
        </div>

        <div className="mb-3 grid grid-cols-[4rem_1fr] gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Icon</label>
            <input
              value={icon}
              onChange={(e) => {
                setIcon(e.target.value)
                scheduleFieldSave({ icon: e.target.value.trim() || null })
              }}
              placeholder="📈"
              maxLength={4}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-center text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                scheduleFieldSave({ name: e.target.value })
              }}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs text-neutral-500">Color</label>
          <ColorPicker
            value={playbook.color}
            onChange={(color) => {
              updatePlaybook(playbook.id, { color }).then(load)
            }}
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs text-neutral-500">Description</label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              scheduleFieldSave({ description: e.target.value.trim() || null })
            }}
            placeholder="What is this setup? What's the thesis?"
            rows={3}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs text-neutral-500">Market Conditions</label>
          <textarea
            value={marketConditions}
            onChange={(e) => {
              setMarketConditions(e.target.value)
              scheduleFieldSave({ market_conditions: e.target.value.trim() || null })
            }}
            placeholder="Trending, high volume, near key level…"
            rows={2}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-neutral-500">Example Chart</label>
          {chartUrl ? (
            <div className="relative">
              <img src={chartUrl} alt="Example chart" className="w-full rounded-lg border border-neutral-800" />
              <button
                onClick={async () => {
                  if (!playbook.example_chart_url) return
                  await deletePlaybookAsset(playbook.example_chart_url)
                  await updatePlaybook(playbook.id, { example_chart_url: null })
                  setChartUrl(null)
                  setPlaybook((p) => (p ? { ...p, example_chart_url: null } : p))
                }}
                className="absolute right-2 top-2 rounded-md bg-neutral-950/80 px-2 py-1 text-xs text-neutral-300 hover:text-red-400"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
              {uploading ? 'Uploading…' : '+ Add example chart'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => handleChartChange(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-300">Rules</h2>
        <div className="flex flex-col gap-3">
          {playbook.playbook_rule_groups.map((group, i) => (
            <div key={group.id} className="flex items-start gap-2">
              <div className="mt-4 flex shrink-0 flex-col">
                <button
                  onClick={() => handleMoveGroup(group, -1)}
                  disabled={i === 0}
                  className="text-neutral-600 hover:text-neutral-300 disabled:opacity-20"
                >
                  ▲
                </button>
                <button
                  onClick={() => handleMoveGroup(group, 1)}
                  disabled={i === playbook.playbook_rule_groups.length - 1}
                  className="text-neutral-600 hover:text-neutral-300 disabled:opacity-20"
                >
                  ▼
                </button>
              </div>
              <div className="flex-1">
                <RuleGroupCard group={group} onReload={load} />
              </div>
            </div>
          ))}

          <form onSubmit={handleAddGroup} className="flex gap-2 rounded-xl border border-dashed border-neutral-700 p-3">
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="New rule group, e.g. Entry Criteria…"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={!newGroupName.trim()}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              Add Group
            </button>
          </form>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-300">Missed Trades</h2>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            {missedTrades.length === 0 ? (
              <div className="py-2 text-center text-sm text-neutral-500">No missed trades logged for this playbook yet.</div>
            ) : (
              <div className="flex flex-col divide-y divide-neutral-800/60">
                {missedTrades.map((m) => (
                  <MissedTradeRow key={m.id} missed={m} onDelete={() => handleDeleteMissedTrade(m)} />
                ))}
              </div>
            )}
          </div>
          <MissedTradeForm onSubmit={handleAddMissedTrade} />
        </div>
      </div>
    </div>
  )
}
