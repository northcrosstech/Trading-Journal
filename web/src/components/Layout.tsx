import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  LogOut,
  Menu,
  PieChart,
  Settings,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { useAccountFilter } from '../accounts/AccountContext'
import { SyncStatus } from './SyncStatus'

type Workspace = 'trading' | 'wealth'

// Trading: the daily loop, in order -- plan + trade (Today) -> review -> learn (Insights).
const NAV: Record<Workspace, { to: string; label: string; icon: typeof BookOpen; end?: boolean }[]> = {
  trading: [
    { to: '/', label: 'Today', icon: CalendarCheck, end: true },
    { to: '/journal', label: 'Journal', icon: BookOpen },
    { to: '/review', label: 'Review', icon: ClipboardCheck },
    { to: '/trades', label: 'Trades', icon: ListOrdered },
    { to: '/insights', label: 'Insights', icon: BarChart3 },
  ],
  wealth: [
    { to: '/wealth', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/portfolios', label: 'Portfolios', icon: PieChart },
    { to: '/networth', label: 'Net worth', icon: Landmark },
    { to: '/cashflow', label: 'Cash flow', icon: ArrowLeftRight },
  ],
}
const HOME: Record<Workspace, string> = { trading: '/', wealth: '/wealth' }
const WEALTH_PREFIXES = ['/wealth', '/portfolios', '/networth', '/cashflow']
const SHARED_PREFIXES = ['/settings', '/accounts']
const STORAGE_KEY = 'tj.workspace'

function readStoredWorkspace(): Workspace {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'wealth' ? 'wealth' : 'trading'
  } catch {
    return 'trading'
  }
}

/** Which area a path belongs to; shared pages (Settings) keep whichever area you came from. */
function workspaceFor(path: string, fallback: Workspace): Workspace {
  if (WEALTH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return 'wealth'
  if (SHARED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback
  return 'trading'
}

function AccountSwitcher() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountFilter()
  const selected = accounts.find((a) => a.id === selectedAccountId) ?? null
  return (
    <label className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-2.5 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${selected === null || selected.enabled ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
      <select
        value={selectedAccountId ?? 'all'}
        onChange={(e) => setSelectedAccountId(e.target.value === 'all' ? null : e.target.value)}
        className="w-full truncate bg-transparent text-xs font-medium text-neutral-200 outline-none"
        aria-label="Trading account"
      >
        <option value="all" className="bg-neutral-900">
          All accounts
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id} className="bg-neutral-900">
            {a.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Sidebar({ workspace, onNavigate }: { workspace: Workspace; onNavigate: () => void }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-(--accent) text-white shadow-lg">
          <LineChart size={17} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">Trading Journal</div>
          <div className="text-[11px] text-neutral-500">Trading & wealth</div>
        </div>
      </div>

      <div className="mx-3 mb-4 grid grid-cols-2 rounded-xl border border-(--border) bg-(--card) p-1">
        {(['trading', 'wealth'] as const).map((w) => (
          <button
            key={w}
            onClick={() => {
              onNavigate()
              navigate(HOME[w])
            }}
            className={`rounded-lg py-1.5 text-xs font-semibold capitalize transition ${
              workspace === w ? (w === 'trading' ? 'bg-blue-500/15 text-blue-300' : 'bg-teal-500/15 text-teal-300') : 'text-neutral-500 hover:text-neutral-200'
            }`}
          >
            {w}
          </button>
        ))}
      </div>

      {workspace === 'trading' && (
        <>
          <AccountSwitcher />
          <SyncStatus />
        </>
      )}

      <nav className="mt-1 flex flex-1 flex-col gap-0.5 px-3">
        {NAV[workspace].map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-(--accent-soft) text-(--accent-text)' : 'text-neutral-400 hover:bg-(--card) hover:text-neutral-100'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-(--border) px-3 py-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            `mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive ? 'bg-(--accent-soft) text-(--accent-text)' : 'text-neutral-400 hover:bg-(--card) hover:text-neutral-100'
            }`
          }
        >
          <Settings size={17} />
          Settings
        </NavLink>
        <div className="flex items-center justify-between gap-2 px-3 pt-1">
          <span className="truncate text-xs text-neutral-500">{user?.email}</span>
          <button onClick={() => signOut()} title="Sign out" className="rounded-md p-1.5 text-neutral-500 transition hover:bg-(--card) hover:text-white">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const [stored, setStored] = useState<Workspace>(readStoredWorkspace)
  const workspace = workspaceFor(location.pathname, stored)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (workspace !== stored) setStored(workspace)
    try {
      localStorage.setItem(STORAGE_KEY, workspace)
    } catch {
      /* private mode -- the area just won't be remembered */
    }
    // On <html> so slide-in panels and dialogs (rendered outside this tree) get the area's accent too.
    document.documentElement.dataset.workspace = workspace
  }, [workspace, stored])

  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="min-h-screen bg-(--bg) text-neutral-100">
      {/* Phone / tablet top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-(--border) bg-(--bg)/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-(--accent) text-white">
            <LineChart size={15} />
          </div>
          <span className="text-sm font-semibold capitalize text-white">{workspace}</span>
        </div>
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-lg p-1.5 text-neutral-300 hover:bg-(--card)">
          <Menu size={20} />
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="ui-fade-in absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <aside className="ui-slide-in relative h-full w-64 border-r border-(--border) bg-(--bg)">
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded-md p-1 text-neutral-500 hover:text-white">
              <X size={18} />
            </button>
            <Sidebar workspace={workspace} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-(--border) bg-(--bg) lg:block">
          <Sidebar workspace={workspace} onNavigate={() => {}} />
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
