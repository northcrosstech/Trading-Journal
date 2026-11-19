import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fetchTargetSettings, upsertTargetSettings, fetchPlaybooks, createPlaybook, updatePlaybook, setPlaybookArchived } from '../lib/queries'
import {
  fetchAllocationTolerance,
  fetchResearchSettings,
  setAllocationTolerance,
  setResearchSettings,
} from '../lib/wealthQueries'
import type { Playbook } from '../lib/database.types'
import { TAG_COLORS, tagChipStyle } from '../lib/tagColors'
import { INPUT_SM } from '../lib/ui'
import { useToast } from '../lib/toastContext'
import { useUrlState } from '../lib/useUrlState'
import { useWorkspace, type Workspace } from '../lib/workspace'
import { ColorPicker } from '../components/ColorPicker'
import { ReviewChecklistCard } from '../components/ReviewChecklistCard'
import { ChevronRight, Database, FileUp, Landmark, Link2, ListChecks, LogOut, PenLine, ShieldAlert, Signpost, SlidersHorizontal, Tags, Target, UserRound } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'

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

/** A link out of Settings that is easy to spot: what it is, and one line on what's there. */
function LinkTile({ to, icon: Icon, title, text }: { to: string; icon: typeof Database; title: string; text: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-(--border-strong) bg-(--card-raised) px-3.5 py-3 transition hover:border-(--accent)">
      <span className="shrink-0 rounded-lg bg-(--accent-soft) p-2 text-(--accent-text)">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-neutral-100">{title}</span>
        <span className="block text-xs text-neutral-500">{text}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-neutral-600 transition group-hover:text-neutral-300" />
    </Link>
  )
}

function DataCard() {
  return (
    <Card title="Accounts & import" subtitle="Your broker accounts, and the ways to bring trades in.">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <LinkTile to="/accounts" icon={Link2} title="Broker accounts" text="The accounts your trades belong to." />
        <LinkTile to="/trades/import" icon={FileUp} title="Import CSV" text="Bring in trades from a CSV file." />
        <LinkTile to="/trades/import/robinhood" icon={FileUp} title="Import Robinhood CSV" text="Bring in a Robinhood export." />
        <LinkTile to="/trades/new" icon={PenLine} title="Add a trade manually" text="Enter one trade by hand." />
      </div>
    </Card>
  )
}

// --- Wealth ------------------------------------------------------------------------------------

/** The Wealth settings as typed: two percentages. */
type WealthValues = { tolerance: string; growthCap: string }

const DEFAULT_GROWTH_CAP = 30

function SettingRow({ id, label, effect, error, children }: { id: string; label: string; effect: string; error: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3.5 first:pt-0">
      <div className="min-w-0 max-w-md flex-1 basis-64">
        <label htmlFor={id} className="text-sm text-neutral-200">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-neutral-500">{effect}</p>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      {children}
    </div>
  )
}

function PercentInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <span className="relative w-24 shrink-0">
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder}
        className={`${INPUT_SM} pr-6 text-right tabular-nums`}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">%</span>
    </span>
  )
}

/** The Wealth numbers that are otherwise set from drawers around the app (the targets
 * editor, a stock's research panel), in one place with one Save.
 * Same saved values and the same limits as those places, which keep working. */
function WealthSettingsCard() {
  const { user } = useAuth()
  const toast = useToast()
  const [saved, setSaved] = useState<WealthValues | null>(null)
  const [draft, setDraft] = useState<WealthValues>({ tolerance: '', growthCap: '' })
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    Promise.all([fetchAllocationTolerance(), fetchResearchSettings()])
      .then(([tolerance, research]) => {
        const values = { tolerance: String(tolerance), growthCap: String(research.growthCap) }
        setSaved(values)
        setDraft(values)
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  if (failed) {
    return (
      <Card title="Wealth settings">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-400">
          Couldn’t load these settings.
          <Button size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      </Card>
    )
  }
  if (saved === null) {
    return (
      <Card title="Wealth settings">
        <div className="text-sm text-neutral-500">Loading…</div>
      </Card>
    )
  }

  const tolerance = Number(draft.tolerance)
  // A blank growth cap goes back to the usual 30%, as it does in a stock's research panel.
  const growthCap = draft.growthCap.trim() === '' ? DEFAULT_GROWTH_CAP : Number(draft.growthCap)

  const changed = {
    tolerance: tolerance !== Number(saved.tolerance),
    growthCap: growthCap !== Number(saved.growthCap),
  }
  // Only what you changed is checked (and saved), so an untouched value never blocks Save.
  const errors = {
    tolerance: !changed.tolerance || (tolerance > 0 && tolerance <= 50) ? null : 'Enter a number above 0, up to 50.',
    growthCap: !changed.growthCap || (growthCap >= 1 && growthCap <= 100) ? null : 'Enter a number from 1 to 100.',
  }
  const valid = !errors.tolerance && !errors.growthCap
  const dirty = changed.tolerance || changed.growthCap

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!user || !valid || !dirty || saving) return
    setSaving(true)
    try {
      // Only what changed is written, each with the same call its own screen uses.
      if (changed.tolerance) await setAllocationTolerance(user.id, tolerance)
      if (changed.growthCap) await setResearchSettings(user.id, { growth_cap: growthCap })
      const values = { tolerance: String(tolerance), growthCap: String(growthCap) }
      setSaved(values)
      setDraft(values)
      toast('Wealth settings saved')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(/wealth_settings|allocation_tolerance|growth_cap/.test(msg) ? "This isn't set up yet." : msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof WealthValues) => (v: string) => setDraft((d) => ({ ...d, [key]: v }))

  return (
    <Card title="Wealth settings" subtitle="These apply to every portfolio and stock. Nothing changes until you save.">
      <form onSubmit={save} className="flex flex-col">
        <div className="divide-y divide-(--border)">
          <SettingRow
            id="wealth-tolerance"
            label="On-target tolerance"
            effect="How far a holding or mix can be from its target before it shows as off target."
            error={errors.tolerance}
          >
            <PercentInput id="wealth-tolerance" value={draft.tolerance} onChange={set('tolerance')} />
          </SettingRow>
          <SettingRow
            id="wealth-growth-cap"
            label="Growth cap for fair value"
            effect="The highest yearly growth Research uses when it works out a stock’s fair value. Blank = 30%."
            error={errors.growthCap}
          >
            <PercentInput id="wealth-growth-cap" value={draft.growthCap} onChange={set('growthCap')} placeholder={String(DEFAULT_GROWTH_CAP)} />
          </SettingRow>
        </div>
        <div className="mt-2 flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-neutral-500">Not saved yet</span>}
          <Button type="submit" variant="primary" disabled={!valid || !dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function WealthLinksCard() {
  return (
    <Card title="Set on their own pages" subtitle="These have more to them, so they stay where they are used.">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <LinkTile to="/wealth?details=freedom" icon={Target} title="Financial freedom assumptions" text="Your inputs for the gauge on Overview." />
        <LinkTile to="/networth" icon={Landmark} title="Balances and payment details" text="Accounts, balances and payments on Net worth." />
      </div>
    </Card>
  )
}

// --- Page --------------------------------------------------------------------------------------

const GROUPS: readonly Workspace[] = ['trading', 'wealth']

const SECTIONS: Record<Workspace, { id: string; label: string; icon: typeof Database }[]> = {
  trading: [
    { id: 'data', label: 'Accounts & import', icon: Database },
    { id: 'risk', label: 'Risk limits', icon: ShieldAlert },
    { id: 'setups', label: 'Setups', icon: Tags },
    { id: 'checklist', label: 'Review checklist', icon: ListChecks },
    { id: 'profile', label: 'Profile', icon: UserRound },
  ],
  wealth: [
    { id: 'wealth', label: 'Wealth settings', icon: SlidersHorizontal },
    { id: 'elsewhere', label: 'On their own pages', icon: Signpost },
    { id: 'profile', label: 'Profile', icon: UserRound },
  ],
}

const SUBTITLE: Record<Workspace, string> = {
  trading: 'Accounts and import, risk limits, setups and your review checklist.',
  wealth: 'Allocation tolerance, the growth cap for fair value, and month-end close.',
}

/** Settings, in two groups: Trading and Wealth. It opens on the group for the area you came
 * from. Each group has a section menu on the left (jumps to the section) and every section's
 * card on the right, so everything stays one scroll away. */
export function SettingsPage() {
  const { user, signOut } = useAuth()
  const workspace = useWorkspace()
  const [group, setGroup] = useUrlState<Workspace>('group', workspace, GROUPS)
  const jump = (id: string) => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Settings" subtitle={SUBTITLE[group]} />
      <Tabs
        tabs={[
          { value: 'trading', label: 'Trading' },
          { value: 'wealth', label: 'Wealth' },
        ]}
        value={group}
        onChange={setGroup}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-8 lg:flex-col lg:self-start">
          {SECTIONS[group].map(({ id, label, icon: Icon }) => (
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
          {group === 'trading' ? (
            <>
              <div id="settings-data" className="scroll-mt-8">
                <DataCard />
              </div>
              <div id="settings-risk" className="scroll-mt-8">
                <RiskCard />
              </div>
              <div id="settings-setups" className="scroll-mt-8">
                <SetupsCard />
              </div>
              <div id="settings-checklist" className="scroll-mt-8">
                <ReviewChecklistCard />
              </div>
            </>
          ) : (
            <>
              <div id="settings-wealth" className="scroll-mt-8">
                <WealthSettingsCard />
              </div>
              <div id="settings-elsewhere" className="scroll-mt-8">
                <WealthLinksCard />
              </div>
            </>
          )}
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
