import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fetchTargetSettings, upsertTargetSettings, fetchPlaybooks, createPlaybook, updatePlaybook, setPlaybookArchived } from '../lib/queries'
import type { Playbook } from '../lib/database.types'
import { TAG_COLORS, tagChipStyle } from '../lib/tagColors'
import { ColorPicker } from '../components/ColorPicker'
import { ReviewChecklistCard } from '../components/ReviewChecklistCard'
import { Database, ListChecks, LogOut, ShieldAlert, Tags, UserRound } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'

function DollarInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-(--border-strong) bg-(--card-raised) py-2 pl-6 pr-3 text-sm text-neutral-100 outline-none focus:border-(--accent)"
      />
    </div>
  )
}

function RiskCard() {
  const { user } = useAuth()
  const [profitTarget, setProfitTarget] = useState('')
  const [lossLimit, setLossLimit] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    fetchTargetSettings().then((s) => {
      setProfitTarget(s?.profit_target_value !== null && s?.profit_target_value !== undefined ? String(s.profit_target_value) : '')
      setLossLimit(s?.loss_limit_value !== null && s?.loss_limit_value !== undefined ? String(s.loss_limit_value) : '')
      setLoaded(true)
    })
  }, [])

  async function handleSave() {
    if (!user) return
    setSaved(false)
    await upsertTargetSettings(user.id, {
      profit_target_value: profitTarget.trim() === '' ? null : Number(profitTarget),
      loss_limit_value: lossLimit.trim() === '' ? null : Number(lossLimit),
    })
    setSaved(true)
  }

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-(--border) bg-(--card) p-5">
        <div className="text-sm text-neutral-500">Loading…</div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-(--border) bg-(--card) p-5">
      <h2 className="mb-1 text-sm font-semibold text-white">Daily risk</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Your default max daily loss — pre-filled into each day's plan and tracked live on Today. The profit target marks
        green days on the calendar.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Max daily loss</label>
          <DollarInput value={lossLimit} onChange={setLossLimit} placeholder="e.g. 200" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Daily profit target</label>
          <DollarInput value={profitTarget} onChange={setProfitTarget} placeholder="e.g. 300" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="text-xs text-neutral-600">{saved ? '' : 'Saving…'}</span>
        <button
          onClick={handleSave}
          className="rounded-md bg-(--accent) px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function SetupRow({ setup, onChanged }: { setup: Playbook; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(setup.name)

  function commit() {
    setEditing(false)
    if (name.trim() && name.trim() !== setup.name) updatePlaybook(setup.id, { name: name.trim() }).then(onChanged)
    else setName(setup.name)
  }

  return (
    <div className={`flex items-center gap-2 py-1.5 ${setup.archived ? 'opacity-50' : ''}`}>
      <span style={tagChipStyle(setup.color)} className="h-3 w-3 shrink-0 rounded-full border" />
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setName(setup.name)
              setEditing(false)
            }
          }}
          className="flex-1 rounded-md border border-(--accent) bg-(--card-raised) px-2 py-1 text-sm text-neutral-100 outline-none"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm text-neutral-200 hover:text-neutral-50">
          {setup.icon && <span className="mr-1">{setup.icon}</span>}
          {setup.name}
        </button>
      )}
      <button
        onClick={() => setPlaybookArchived(setup.id, !setup.archived).then(onChanged)}
        className="shrink-0 text-xs text-neutral-600 hover:text-neutral-300"
      >
        {setup.archived ? 'Unarchive' : 'Archive'}
      </button>
    </div>
  )
}

/** Setups are the named patterns you trade (ORB, VWAP reclaim, ...) -- one tap per
 * trade in review, and the "By setup" table on Insights shows which ones pay. */
function SetupsCard() {
  const { user } = useAuth()
  const [setups, setSetups] = useState<Playbook[] | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[8])
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(() => {
    fetchPlaybooks().then((p) => setSetups(p ?? []))
  }, [])

  useEffect(load, [load])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user || !name.trim()) return
    await createPlaybook(user.id, { name: name.trim(), color })
    setName('')
    load()
  }

  const visible = (setups ?? []).filter((s) => showArchived || !s.archived)

  return (
    <div className="rounded-2xl border border-(--border) bg-(--card) p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Setups</h2>
        {(setups ?? []).some((s) => s.archived) && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-500">The patterns you trade. Tag each trade with one during review. Click a name to rename.</p>
      <div className="flex flex-col divide-y divide-(--border)">
        {setups === null && <div className="py-2 text-xs text-neutral-600">Loading…</div>}
        {setups !== null && visible.length === 0 && <div className="py-2 text-xs text-neutral-600">No setups yet.</div>}
        {visible.map((s) => (
          <SetupRow key={s.id} setup={s} onChanged={load} />
        ))}
      </div>
      <form onSubmit={handleAdd} className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New setup, e.g. Opening range breakout"
            className="flex-1 rounded-lg border border-(--border-strong) bg-(--card-raised) px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-(--accent)"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </div>
  )
}

const linkClass =
  'flex items-center justify-between rounded-lg px-3 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100'

function DataCard() {
  return (
    <div className="rounded-2xl border border-(--border) bg-(--card) p-2">
      <h2 className="px-3 pb-1 pt-2 text-sm font-semibold text-white">Accounts & data</h2>
      <Link to="/accounts" className={linkClass}>
        Broker accounts <span className="text-neutral-600">→</span>
      </Link>
      <Link to="/trades/new" className={linkClass}>
        Add a trade manually <span className="text-neutral-600">→</span>
      </Link>
      <Link to="/trades/import" className={linkClass}>
        Import CSV <span className="text-neutral-600">→</span>
      </Link>
      <Link to="/trades/import/robinhood" className={linkClass}>
        Import Robinhood CSV <span className="text-neutral-600">→</span>
      </Link>
    </div>
  )
}

const SECTIONS = [
  { id: 'risk', label: 'Risk limits', icon: ShieldAlert },
  { id: 'setups', label: 'Setups', icon: Tags },
  { id: 'checklist', label: 'Review checklist', icon: ListChecks },
  { id: 'data', label: 'Accounts & data', icon: Database },
  { id: 'profile', label: 'Profile', icon: UserRound },
] as const

/** Settings: a section menu on the left (jumps to the section) and every section's card on
 * the right, so everything stays one scroll away. */
export function SettingsPage() {
  const { user, signOut } = useAuth()
  const jump = (id: string) => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Settings" subtitle="Risk limits, setups, your review checklist, accounts and data." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-8 lg:flex-col lg:self-start">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => jump(id)}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-400 transition hover:bg-(--card) hover:text-white"
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-6">
          <div id="settings-risk" className="scroll-mt-8">
            <RiskCard />
          </div>
          <div id="settings-setups" className="scroll-mt-8">
            <SetupsCard />
          </div>
          <div id="settings-checklist" className="scroll-mt-8">
            <ReviewChecklistCard />
          </div>
          <div id="settings-data" className="scroll-mt-8">
            <DataCard />
          </div>
          <div id="settings-profile" className="scroll-mt-8 rounded-2xl border border-(--border) bg-(--card) p-5">
            <h2 className="text-sm font-semibold text-white">Profile</h2>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-neutral-300">{user?.email}</span>
              <Button icon={<LogOut size={15} />} onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
