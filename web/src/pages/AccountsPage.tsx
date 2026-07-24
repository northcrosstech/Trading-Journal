import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { fetchAccounts, createAccount, updateAccount, setAccountEnabled, setAccountArchived } from '../lib/queries'
import type { Account } from '../lib/database.types'

const BROKER_LABEL: Record<Account['broker'], string> = { webull: 'Webull', schwab: 'Schwab', manual: 'Manual' }

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        tone === 'good' ? 'bg-(--status-good)/15 text-(--status-good)' : 'bg-neutral-800 text-neutral-400'
      }`}
    >
      {children}
    </span>
  )
}

function EditAccountForm({ account, onSave, onCancel }: { account: Account; onSave: (fields: Partial<Account>) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(account.label)
  const [accountType, setAccountType] = useState<Account['account_type']>(account.account_type)
  const [syncMode, setSyncMode] = useState<Account['sync_mode']>(account.sync_mode)
  const [defaultAssetType, setDefaultAssetType] = useState<Account['default_asset_type']>(account.default_asset_type)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    onSave({
      label: label.trim(),
      account_type: accountType,
      sync_mode: account.broker === 'manual' ? 'manual' : syncMode,
      default_asset_type: defaultAssetType,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="w-40 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
      />
      <select
        value={accountType}
        onChange={(e) => setAccountType(e.target.value as Account['account_type'])}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
      >
        <option value="live">Live</option>
        <option value="paper">Paper</option>
      </select>
      <select
        value={account.broker === 'manual' ? 'manual' : syncMode}
        onChange={(e) => setSyncMode(e.target.value as Account['sync_mode'])}
        disabled={account.broker === 'manual'}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500 disabled:opacity-40"
      >
        <option value="auto">Auto-sync</option>
        <option value="manual">Manual entry</option>
      </select>
      <select
        value={defaultAssetType}
        onChange={(e) => setDefaultAssetType(e.target.value as Account['default_asset_type'])}
        title="Default asset type for new manual trades on this account"
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
      >
        <option value="stock">Default: Stock</option>
        <option value="option">Default: Option</option>
      </select>
      <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500">
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-neutral-500 hover:text-neutral-300">
        Cancel
      </button>
    </form>
  )
}

export function AccountsPage() {
  const { user } = useAuth()
  // This page needs the FULL list (including archived, for "Show archived"), so it
  // keeps its own fetch rather than reading the switcher context's (non-archived-only)
  // list directly -- but every mutation here also refreshes the shared context so the
  // sidebar switcher doesn't go stale (it used to only refresh once on initial mount).
  const { reloadAccounts: reloadSwitcherAccounts } = useAccountFilter()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [broker, setBroker] = useState<Account['broker']>('manual')
  const [label, setLabel] = useState('')
  const [accountType, setAccountType] = useState<Account['account_type']>('live')
  const [syncMode, setSyncMode] = useState<Account['sync_mode']>('manual')
  const [defaultAssetType, setDefaultAssetType] = useState<Account['default_asset_type']>('stock')

  const reload = useCallback(() => {
    fetchAccounts().then(setAccounts)
    reloadSwitcherAccounts()
  }, [reloadSwitcherAccounts])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!user || !label.trim()) return
    await createAccount(user.id, {
      broker,
      label: label.trim(),
      account_type: accountType,
      sync_mode: broker === 'manual' ? 'manual' : syncMode,
      default_asset_type: defaultAssetType,
    })
    setLabel('')
    reload()
  }

  if (accounts === null) {
    return <div className="text-neutral-500">Loading accounts…</div>
  }

  const visible = accounts.filter((a) => showArchived || !a.archived)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Accounts</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every broker/paper account your trades can be attributed to. The account switcher (next up) will let you
          filter every view by one of these, or see them combined.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={broker}
            onChange={(e) => setBroker(e.target.value as Account['broker'])}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          >
            <option value="manual">Manual</option>
            <option value="webull">Webull</option>
            <option value="schwab">Schwab</option>
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. ThinkorSwim Paper"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as Account['account_type'])}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          >
            <option value="live">Live</option>
            <option value="paper">Paper</option>
          </select>
          <select
            value={broker === 'manual' ? 'manual' : syncMode}
            onChange={(e) => setSyncMode(e.target.value as Account['sync_mode'])}
            disabled={broker === 'manual'}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500 disabled:opacity-40"
          >
            <option value="auto">Auto-sync</option>
            <option value="manual">Manual entry</option>
          </select>
          <select
            value={defaultAssetType}
            onChange={(e) => setDefaultAssetType(e.target.value as Account['default_asset_type'])}
            title="Default asset type for new manual trades on this account"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
          >
            <option value="stock">Default: Stock</option>
            <option value="option">Default: Option</option>
          </select>
          <button
            type="submit"
            disabled={!label.trim()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {broker !== 'manual' && (
          <p className="text-xs text-amber-400/80">
            {BROKER_LABEL[broker]} credentials connected in a later step -- this creates a placeholder account with no
            live sync yet.
          </p>
        )}
      </form>

      <label className="flex items-center gap-1.5 self-end text-xs text-neutral-500">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">
            No accounts yet -- add one above.
          </div>
        )}
        {visible.map((a) => (
          <div key={a.id} className={`rounded-xl border border-neutral-800 bg-neutral-900 p-4 ${a.archived ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-100">{a.label}</span>
                  <Badge>{BROKER_LABEL[a.broker]}</Badge>
                  <Badge tone={a.account_type === 'live' ? 'good' : 'neutral'}>{a.account_type === 'live' ? 'Live' : 'Paper'}</Badge>
                  <Badge>{a.sync_mode === 'auto' ? 'Auto-sync' : 'Manual entry'}</Badge>
                  <Badge>Default: {a.default_asset_type === 'option' ? 'Option' : 'Stock'}</Badge>
                  {!a.enabled && <Badge>Disabled</Badge>}
                </div>
                {a.broker !== 'manual' && !a.credential_ref && (
                  <p className="mt-1 text-xs text-neutral-600">Credentials connected in a later step -- placeholder only.</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={(e) => setAccountEnabled(a.id, e.target.checked).then(reload)}
                  />
                  Enabled
                </label>
                <button
                  onClick={() => setEditingId(editingId === a.id ? null : a.id)}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  {editingId === a.id ? 'Close' : 'Edit'}
                </button>
                <button
                  onClick={() => setAccountArchived(a.id, !a.archived).then(reload)}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  {a.archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            </div>
            {editingId === a.id && (
              <EditAccountForm
                account={a}
                onCancel={() => setEditingId(null)}
                onSave={(fields) => updateAccount(a.id, fields).then(() => { setEditingId(null); reload() })}
              />
            )}
          </div>
        ))}
      </div>

      {!showArchived && accounts.some((a) => a.archived) && (
        <div className="text-center text-xs text-neutral-600">Archived accounts hidden -- check "Show archived" above.</div>
      )}
    </div>
  )
}
