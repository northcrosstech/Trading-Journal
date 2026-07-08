import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchTargetSettings, upsertTargetSettings } from '../lib/queries'

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
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 py-2 pl-6 pr-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
      />
    </div>
  )
}

function TargetSettingsCard() {
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
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="text-sm text-neutral-500">Loading…</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-1 text-sm font-medium text-neutral-300">Daily Targets</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Dollar amounts only for now. Used to mark hit/gave-it-back/breach days on the calendar and show today's live
        benchmark on the dashboard.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Profit Target</label>
          <DollarInput value={profitTarget} onChange={setProfitTarget} placeholder="e.g. 300" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Max Loss Limit</label>
          <DollarInput value={lossLimit} onChange={setLossLimit} placeholder="e.g. 200" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="text-xs text-neutral-600">{saved ? '' : 'Saving…'}</span>
        <button
          onClick={handleSave}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
        >
          Save
        </button>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { user, signOut } = useAuth()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-100">Settings</h1>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-neutral-300">Account</h2>
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-400">{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
          >
            Sign out
          </button>
        </div>
      </div>

      <TargetSettingsCard />
    </div>
  )
}
