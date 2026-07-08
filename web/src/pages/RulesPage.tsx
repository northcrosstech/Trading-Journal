import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchRules, createRule, renameRule, setRuleArchived, fetchTradesWithDetails } from '../lib/queries'
import type { Rule, TradeWithDetails } from '../lib/database.types'
import { computeRuleStats } from '../lib/metrics'
import { currency } from '../lib/format'
import { MagnitudeBar } from '../components/MagnitudeBar'

function pf(v: number | null): string {
  return v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

/** Per-rule Follow Rate / Net P&L / Profit Factor / Win Rate, split into a followed
 * vs. broken comparison -- the discipline-to-outcome link is the point, so a single
 * blended number per rule would hide it. */
function RuleAnalytics({ trades, rules }: { trades: TradeWithDetails[]; rules: Rule[] }) {
  const activeRules = useMemo(() => rules.filter((r) => !r.archived), [rules])
  const stats = useMemo(() => computeRuleStats(trades, activeRules), [trades, activeRules])
  const maxAbs = Math.max(1, ...stats.flatMap((s) => [Math.abs(s.pnlFollowed), Math.abs(s.pnlBroken)]))

  if (stats.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-neutral-300">Rules Analytics</h2>
      {stats.map((s) => (
        <div key={s.rule.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-neutral-200">{s.rule.name}</span>
              <span className="ml-2 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                {s.rule.type}
              </span>
            </div>
            <span className="text-xs text-neutral-500">
              {s.followRate === null ? '—' : `Followed ${Math.round(s.followRate * 100)}% of applicable trades`}
              {s.naCount > 0 && ` · ${s.naCount} n/a`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-(--status-good)">Followed ({s.followedCount})</span>
                <span className="tabular-nums text-neutral-400">
                  {currency(s.pnlFollowed)} · PF {pf(s.profitFactorFollowed)} ·{' '}
                  {s.winRateFollowed === null ? '—' : `${(s.winRateFollowed * 100).toFixed(0)}% win`}
                </span>
              </div>
              <MagnitudeBar value={s.pnlFollowed} maxAbs={maxAbs} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-(--status-critical)">Broken ({s.brokenCount})</span>
                <span className="tabular-nums text-neutral-400">
                  {currency(s.pnlBroken)} · PF {pf(s.profitFactorBroken)} ·{' '}
                  {s.winRateBroken === null ? '—' : `${(s.winRateBroken * 100).toFixed(0)}% win`}
                </span>
              </div>
              <MagnitudeBar value={s.pnlBroken} maxAbs={maxAbs} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RuleList({
  title,
  rules,
  showArchived,
  onRename,
  onToggleArchived,
}: {
  title: string
  rules: Rule[]
  showArchived: boolean
  onRename: (id: string, name: string) => void
  onToggleArchived: (rule: Rule) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const visible = rules.filter((r) => showArchived || !r.archived)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-4 py-2.5">
        <span className="text-xs uppercase tracking-wide text-neutral-500">
          {title} · {visible.length}
        </span>
      </div>
      <div className="flex flex-col divide-y divide-neutral-800/60">
        {visible.length === 0 && <div className="px-4 py-6 text-center text-sm text-neutral-500">No rules yet.</div>}
        {visible.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
            {editingId === r.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => {
                  if (editingName.trim()) onRename(r.id, editingName.trim())
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (editingName.trim()) onRename(r.id, editingName.trim())
                    setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
                className="rounded-md border border-blue-500 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setEditingId(r.id)
                  setEditingName(r.name)
                }}
                className={`text-sm hover:text-neutral-100 ${r.archived ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}
              >
                {r.name}
              </button>
            )}
            <button onClick={() => onToggleArchived(r)} className="text-xs text-neutral-500 hover:text-neutral-300">
              {r.archived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RulesPage() {
  const { user } = useAuth()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [trades, setTrades] = useState<TradeWithDetails[]>([])
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'entry' | 'exit'>('entry')
  const [showArchived, setShowArchived] = useState(false)

  function reload() {
    fetchRules().then(setRules)
  }

  useEffect(() => {
    reload()
    fetchTradesWithDetails().then(setTrades)
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!user || !newName.trim()) return
    await createRule(user.id, newName.trim(), newType)
    setNewName('')
    reload()
  }

  if (rules === null) {
    return <div className="text-neutral-500">Loading rules…</div>
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Rules</h1>
        <p className="mt-1 text-sm text-neutral-500">
          A global entry/exit rule library. Mark which rules you followed on each trade, then check the Stats page
          to see how your P&L differs when you follow them vs. break them.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New rule…"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <div className="flex overflow-hidden rounded-md border border-neutral-700 text-sm">
          {(['entry', 'exit'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setNewType(t)}
              className={`px-3 py-2 capitalize transition ${
                newType === t ? 'bg-neutral-700 text-neutral-50' : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!newName.trim()}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      <label className="flex items-center gap-1.5 self-end text-xs text-neutral-500">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>

      <RuleList
        title="Entry Rules"
        rules={rules.filter((r) => r.type === 'entry')}
        showArchived={showArchived}
        onRename={(id, name) => renameRule(id, name).then(reload)}
        onToggleArchived={(r) => setRuleArchived(r.id, !r.archived).then(reload)}
      />
      <RuleList
        title="Exit Rules"
        rules={rules.filter((r) => r.type === 'exit')}
        showArchived={showArchived}
        onRename={(id, name) => renameRule(id, name).then(reload)}
        onToggleArchived={(r) => setRuleArchived(r.id, !r.archived).then(reload)}
      />

      <RuleAnalytics trades={trades} rules={rules} />
    </div>
  )
}
