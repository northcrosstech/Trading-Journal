import { useOutletContext } from 'react-router-dom'

/** The app's two areas. They stay separate: each has its own pages, sidebar and accent. */
export type Workspace = 'trading' | 'wealth'

export const HOME: Record<Workspace, string> = { trading: '/', wealth: '/wealth' }

const WEALTH_PREFIXES = ['/wealth', '/portfolios', '/networth', '/cashflow', '/research']
const SHARED_PREFIXES = ['/settings', '/accounts']
const STORAGE_KEY = 'tj.workspace'
const LAST_PATH_KEY: Record<Workspace, string> = { trading: 'tj.lastPath.trading', wealth: 'tj.lastPath.wealth' }

const under = (prefixes: string[], path: string) => prefixes.some((p) => path === p || path.startsWith(`${p}/`))

/** Pages both areas use (Settings, Accounts). */
export const isSharedPath = (path: string) => under(SHARED_PREFIXES, path)

/** Which area a path belongs to; shared pages keep whichever area you came from. */
export function workspaceFor(path: string, fallback: Workspace): Workspace {
  if (under(WEALTH_PREFIXES, path)) return 'wealth'
  if (isSharedPath(path)) return fallback
  return 'trading'
}

export function readStoredWorkspace(): Workspace {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'wealth' ? 'wealth' : 'trading'
  } catch {
    return 'trading'
  }
}

export function storeWorkspace(workspace: Workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, workspace)
  } catch {
    /* private mode -- the area just won't be remembered */
  }
}

/** The page (with its ?query) last open in an area, or null when none is remembered. */
export function readLastPath(workspace: Workspace): string | null {
  try {
    const saved = localStorage.getItem(LAST_PATH_KEY[workspace])
    if (!saved || !saved.startsWith('/') || saved.startsWith('//')) return null
    const path = saved.split(/[?#]/)[0]
    // Ignore anything that isn't one of this area's own pages.
    if (isSharedPath(path) || workspaceFor(path, workspace) !== workspace) return null
    return saved
  } catch {
    return null
  }
}

/** Remember where you are in an area, so switching areas brings you back here. */
export function storeLastPath(workspace: Workspace, pathname: string, search: string) {
  if (isSharedPath(pathname) || workspaceFor(pathname, workspace) !== workspace) return
  // ?log= opens an entry form once; coming back later shouldn't open it again.
  const params = new URLSearchParams(search)
  params.delete('log')
  const query = params.toString()
  try {
    localStorage.setItem(LAST_PATH_KEY[workspace], query ? `${pathname}?${query}` : pathname)
  } catch {
    /* private mode -- switching areas just opens the area's first page */
  }
}

/** The area the sidebar is showing, for pages both areas share (Settings). */
export function useWorkspace(): Workspace {
  return useOutletContext<Workspace>()
}
