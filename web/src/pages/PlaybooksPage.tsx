import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchPlaybooks, createPlaybook, setPlaybookArchived, fetchTradesWithDetails, fetchMissedTrades } from '../lib/queries'
import type { Playbook, TradeWithDetails, MissedTrade } from '../lib/database.types'
import { computePlaybookStats } from '../lib/metrics'
import { TAG_COLORS } from '../lib/tagColors'
import { ColorPicker } from '../components/ColorPicker'
import { currency, percentFmt } from '../lib/format'

function pf(v: number | null): string {
  return v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

export function PlaybooksPage() {
  const { user } = useAuth()
  const { selectedAccountId } = useAccountFilter()
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null)
  const [trades, setTrades] = useState<TradeWithDetails[]>([])
  const [missedTrades, setMissedTrades] = useState<MissedTrade[]>([])
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const [newColor, setNewColor] = useState<string>(TAG_COLORS[8])
  const [showArchived, setShowArchived] = useState(false)

  function reload() {
    fetchPlaybooks().then(setPlaybooks)
  }

  useEffect(() => {
    let cancelled = false
    reload()
    fetchTradesWithDetails(selectedAccountId).then((t) => {
      if (!cancelled) setTrades(t)
    })
    fetchMissedTrades().then((m) => {
      if (!cancelled) setMissedTrades(m)
    })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!user || !newName.trim()) return
    await createPlaybook(user.id, { name: newName.trim(), color: newColor, icon: newIcon.trim() || null })
    setNewName('')
    setNewIcon('')
    reload()
  }

  const missedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of missedTrades) counts.set(m.playbook_id, (counts.get(m.playbook_id) ?? 0) + 1)
    return counts
  }, [missedTrades])

  const stats = useMemo(() => (playbooks ? computePlaybookStats(trades, playbooks, missedCounts) : []), [trades, playbooks, missedCounts])
  const statsById = useMemo(() => new Map(stats.map((s) => [s.playbook.id, s])), [stats])

  if (playbooks === null) {
    return <div className="text-neutral-500">Loading playbooks…</div>
  }

  const visible = playbooks.filter((p) => showArchived || !p.archived)
  // Ranked by expectancy where known (traded playbooks), untraded ones after, alphabetical within each group.
  const ranked = [...visible].sort((a, b) => {
    const sa = statsById.get(a.id)
    const sb = statsById.get(b.id)
    if (sa && sb) return (sb.expectancy ?? -Infinity) - (sa.expectancy ?? -Infinity)
    if (sa) return -1
    if (sb) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Playbooks</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Documented setups -- description, market conditions, and grouped rules. Ranked by expectancy once you've
          traded them, so it's plain which ones to trade more of and which to cut.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex gap-2">
          <input
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            placeholder="📈"
            maxLength={4}
            className="w-14 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-center text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New playbook name…"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <ColorPicker value={newColor} onChange={setNewColor} />
      </form>

      <label className="flex items-center gap-1.5 self-end text-xs text-neutral-500">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>

      <div className="flex flex-col gap-2">
        {ranked.length === 0 && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">
            No playbooks yet -- add your first setup above.
          </div>
        )}
        {ranked.map((p) => {
          const s = statsById.get(p.id)
          return (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-700 hover:bg-neutral-800/60 ${p.archived ? 'opacity-50' : ''}`}
            >
              <Link to={`/playbooks/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                  style={{ backgroundColor: `${p.color}26` }}
                >
                  {p.icon || '📘'}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-100">{p.name}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {s && s.tradeCount > 0
                      ? `${s.tradeCount} trade${s.tradeCount === 1 ? '' : 's'} · ${s.winRate === null ? '—' : `${(s.winRate * 100).toFixed(0)}% win`} · PF ${pf(s.profitFactor)}`
                      : 'Not traded yet'}
                    {s && s.missedCount > 0 && ` · ${s.missedCount} missed`}
                  </div>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-4">
                <Link to={`/playbooks/${p.id}`} className="text-right">
                  {s && s.tradeCount > 0 ? (
                    <>
                      <div className={`text-sm font-semibold tabular-nums ${s.netPnl >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}`}>
                        {currency(s.netPnl)}
                      </div>
                      <div className="text-[11px] text-neutral-500">expectancy {currency(s.expectancy)} · {percentFmt(s.pnlPct)}</div>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-600">—</span>
                  )}
                </Link>
                <button
                  onClick={() => setPlaybookArchived(p.id, !p.archived).then(reload)}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  {p.archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {!showArchived && playbooks.some((p) => p.archived) && (
        <div className="text-center text-xs text-neutral-600">Archived playbooks hidden -- check "Show archived" above.</div>
      )}
    </div>
  )
}
