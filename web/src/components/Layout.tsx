import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { SyncStatus } from './SyncStatus'

// The daily loop, in order: plan + trade (Today) -> review (Journal) -> learn (Insights).
const navItems = [
  { to: '/', label: 'Today', end: true },
  { to: '/journal', label: 'Journal' },
  { to: '/trades', label: 'Trades' },
  { to: '/insights', label: 'Insights' },
  { to: '/portfolios', label: 'Portfolios' },
  { to: '/networth', label: 'Net worth' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const { user, signOut } = useAuth()
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountFilter()
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
        <div className="px-4 py-4">
          <span className="text-sm font-semibold tracking-tight text-neutral-100">Trading Journal</span>
        </div>

        <div className="mx-2 mb-2 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selectedAccount === null || selectedAccount.enabled ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
            <select
              value={selectedAccountId ?? 'all'}
              onChange={(e) => setSelectedAccountId(e.target.value === 'all' ? null : e.target.value)}
              className="w-full truncate bg-neutral-900 text-xs font-medium text-neutral-300 outline-none"
            >
              <option value="all" className="bg-neutral-900 text-neutral-100">
                All Accounts
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-neutral-900 text-neutral-100">
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SyncStatus />

        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-neutral-800 text-neutral-50'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-3">
          <span className="truncate text-xs text-neutral-500">{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
