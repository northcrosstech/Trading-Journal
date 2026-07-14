import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { currency } from '../lib/format'
import { SyncStatus } from './SyncStatus'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/trades', label: 'Trade Log' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/stats', label: 'Stats' },
  { to: '/playbooks', label: 'Playbooks' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const { user, signOut } = useAuth()
  const [balance, setBalance] = useState<number | null>(null)

  // All-time cumulative net P&L, unaffected by any page's date-range filter -- a
  // synthetic estimate (no real starting capital or cash deposits/withdrawals are
  // tracked), so it's explicitly labeled "Est." rather than presented as real cash.
  useEffect(() => {
    supabase
      .from('trades')
      .select('status, realized_pnl_net')
      .eq('status', 'CLOSED')
      .then(({ data }) => {
        if (!data) return
        setBalance(data.reduce((sum, t) => sum + (t.realized_pnl_net ?? 0), 0))
      })
  }, [])

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
        <div className="px-4 py-4">
          <span className="text-sm font-semibold tracking-tight text-neutral-100">Trading Journal</span>
        </div>

        <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-neutral-300">Webull Individual</div>
            <div className="truncate text-[11px] tabular-nums text-neutral-500">
              {balance === null ? '—' : `Est. ${currency(balance)}`}
            </div>
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
