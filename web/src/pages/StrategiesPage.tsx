import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchStrategies, createStrategy, renameStrategy, setStrategyArchived } from '../lib/queries'
import type { Strategy } from '../lib/database.types'

export function StrategiesPage() {
  const { user } = useAuth()
  const [strategies, setStrategies] = useState<Strategy[] | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  function reload() {
    fetchStrategies().then(setStrategies)
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!user || !newName.trim()) return
    await createStrategy(user.id, newName.trim())
    setNewName('')
    reload()
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) {
      setEditingId(null)
      return
    }
    await renameStrategy(id, editingName.trim())
    setEditingId(null)
    reload()
  }

  async function toggleArchived(s: Strategy) {
    await setStrategyArchived(s.id, !s.archived)
    reload()
  }

  if (strategies === null) {
    return <div className="text-neutral-500">Loading strategies…</div>
  }

  const visible = strategies.filter((s) => showArchived || !s.archived)

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Strategies</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage the tags you assign to trades. Archived strategies stay on past trades but drop out of the tag
          picker for new ones.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New strategy name…"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
          <span className="text-xs uppercase tracking-wide text-neutral-500">
            {visible.length} strateg{visible.length === 1 ? 'y' : 'ies'}
          </span>
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        <div className="flex flex-col divide-y divide-neutral-800/60">
          {visible.length === 0 && <div className="px-4 py-6 text-center text-sm text-neutral-500">No strategies yet.</div>}
          {visible.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => handleRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(s.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="rounded-md border border-blue-500 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingId(s.id)
                    setEditingName(s.name)
                  }}
                  className={`text-sm hover:text-neutral-100 ${s.archived ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}
                >
                  {s.name}
                </button>
              )}
              <button
                onClick={() => toggleArchived(s)}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                {s.archived ? 'Unarchive' : 'Archive'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
