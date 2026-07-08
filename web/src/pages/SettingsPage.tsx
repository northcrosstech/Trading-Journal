import { useAuth } from '../auth/AuthContext'

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
    </div>
  )
}
