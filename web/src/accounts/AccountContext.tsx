import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchAccounts } from '../lib/queries'
import type { Account } from '../lib/database.types'

const STORAGE_KEY = 'tj_selected_account_id'

type AccountContextValue = {
  accounts: Account[] // non-archived, for the switcher
  selectedAccountId: string | null // null = "All accounts" (no filter)
  setSelectedAccountId: (id: string | null) => void
  reloadAccounts: () => void
}

const AccountContext = createContext<AccountContextValue | null>(null)

/** Holds the account-switcher selection app-wide, persisted to localStorage so it
 * survives a refresh. Every trade-fetching query reads `selectedAccountId` from here
 * and passes it through as an optional filter -- null means "All accounts" (no
 * filter), not "no accounts exist." */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : localStorage.getItem(STORAGE_KEY),
  )

  const reloadAccounts = useCallback(() => {
    fetchAccounts().then((all) => setAccounts(all.filter((a) => !a.archived)))
  }, [])

  useEffect(() => {
    if (user) reloadAccounts()
  }, [user, reloadAccounts])

  // A persisted selection can go stale (the account was archived/deleted elsewhere,
  // or this is a leftover value from before any accounts existed) -- fall back to
  // "All accounts" rather than silently filtering everything down to zero rows.
  useEffect(() => {
    if (selectedAccountId && accounts.length > 0 && !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountIdState(null)
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [accounts, selectedAccountId])

  const setSelectedAccountId = useCallback((id: string | null) => {
    setSelectedAccountIdState(id)
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  }, [])

  // Memoized so consumers only re-render when a value they actually read changes,
  // not on every render of this provider -- a fresh object literal here would
  // otherwise be a new context value every time, regardless of whether accounts or
  // selectedAccountId actually changed.
  const value = useMemo(
    () => ({ accounts, selectedAccountId, setSelectedAccountId, reloadAccounts }),
    [accounts, selectedAccountId, setSelectedAccountId, reloadAccounts],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccountFilter(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccountFilter must be used within an AccountProvider')
  return ctx
}
