import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { Holding, Portfolio } from '../lib/database.types'
import { fetchHoldings, fetchPortfolios, fetchWatchlist } from '../lib/wealthQueries'
import type { Workspace } from '../lib/workspace'
import { NavDialog } from './NavDialog'

type Data = { portfolios: Portfolio[]; holdings: Holding[]; watchlist: string[] }

/** One thing Search can open. `name` is what typing is matched against; `words` are other
 * things people call it. */
type Entry = { key: string; name: string; label?: string; hint: string; to: string; words?: string[] }

type Page = Omit<Entry, 'key' | 'hint'> & { area: Workspace | 'shared'; hint?: string }

const PAGES: Page[] = [
  { area: 'trading', name: 'Today', to: '/', words: ['plan', 'home'] },
  { area: 'trading', name: 'Journal', to: '/journal', words: ['calendar', 'notes'] },
  { area: 'trading', name: 'Review', to: '/review', words: ['checklist'] },
  { area: 'trading', name: 'Trades', to: '/trades', words: ['trade log', 'history'] },
  { area: 'trading', name: 'Insights', to: '/insights', words: ['stats', 'statistics', 'analytics'] },
  { area: 'trading', name: 'Add a trade', to: '/trades/new', words: ['new trade', 'manual'] },
  { area: 'trading', name: 'Import CSV', to: '/trades/import', words: ['upload', 'webull'] },
  { area: 'trading', name: 'Import Robinhood CSV', to: '/trades/import/robinhood', words: ['upload'] },
  { area: 'wealth', name: 'Overview', to: '/wealth', words: ['wealth', 'dashboard', 'financial freedom'] },
  { area: 'wealth', name: 'Portfolios', to: '/portfolios', words: ['dividends', 'holdings', 'positions', 'allocation', 'investments'] },
  { area: 'wealth', name: 'Net worth', to: '/networth', words: ['payments', 'balances', 'debts', 'installments', 'month-end close'] },
  { area: 'wealth', name: 'Cash flow', to: '/networth?view=cashflow', words: ['cashflow', 'income', 'spending', 'money in', 'money out'] },
  { area: 'wealth', name: 'Research', to: '/research', words: ['watchlist', 'fair value', 'stocks'] },
  { area: 'shared', name: 'Broker accounts', to: '/accounts', words: ['brokers', 'sync', 'webull', 'robinhood'] },
  { area: 'trading', name: 'Settings · Trading', hint: '', to: '/settings?group=trading', words: ['risk limits', 'daily loss', 'setups', 'review checklist', 'profile', 'sign out'] },
  { area: 'wealth', name: 'Settings · Wealth', hint: '', to: '/settings?group=wealth', words: ['tolerance', 'growth cap', 'month-end close', 'profile', 'sign out'] },
]

const AREA_HINT = { trading: 'Trading', wealth: 'Wealth', shared: '' }

function buildEntries(data: Data | null, workspace: Workspace): Entry[] {
  // The area you're in comes first when two things match equally well.
  const order = (p: Page) => (p.area === workspace ? 0 : p.area === 'shared' ? 1 : 2)
  const pages = [...PAGES].sort((a, b) => order(a) - order(b)).map((p): Entry => ({ ...p, key: `page:${p.to}`, hint: p.hint ?? AREA_HINT[p.area] }))
  if (!data) return pages
  const open = data.portfolios.filter((p) => !p.archived)
  const nameOf = new Map(open.map((p) => [p.id, p.name]))
  return [
    ...pages,
    ...open.map((p): Entry => ({ key: `portfolio:${p.id}`, name: p.name, hint: 'Portfolio', to: `/portfolios/${p.id}` })),
    ...data.holdings
      .filter((h) => nameOf.has(h.portfolio_id) && Number(h.quantity) > 0)
      .map((h): Entry => ({ key: `holding:${h.id}`, name: h.symbol, label: `${h.symbol} · ${nameOf.get(h.portfolio_id)}`, hint: 'Holding', to: `/portfolios/${h.portfolio_id}` })),
    ...data.watchlist.map((s): Entry => ({ key: `watch:${s}`, name: s, label: `${s} · Watchlist`, hint: 'Research', to: '/research' })),
  ]
}

/** Lower is better: the name starts with what you typed, then one of its words does, then
 * another name for it does, then it appears anywhere. Null = no match. */
function rank(e: Entry, q: string): number | null {
  const name = e.name.toLowerCase()
  const words = e.words ?? []
  if (name.startsWith(q)) return 0
  if (name.split(/[\s·]+/).some((w) => w.startsWith(q))) return 1
  if (words.some((w) => w.startsWith(q) || w.split(' ').some((part) => part.startsWith(q)))) return 2
  if (name.includes(q)) return 3
  if (words.some((w) => w.includes(q))) return 4
  return null
}

function find(entries: Entry[], query: string): Entry[] {
  const q = query.trim().toLowerCase()
  // Nothing typed yet: the pages, as a way in.
  if (q === '') return entries.filter((e) => e.key.startsWith('page:'))
  return entries
    .map((e, i) => ({ e, i, r: rank(e, q) }))
    .filter((x): x is { e: Entry; i: number; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, 12)
    .map((x) => x.e)
}

function SearchPanel({ data, workspace, onClose }: { data: Data | null; workspace: Workspace; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => buildEntries(data, workspace), [data, workspace])
  const results = useMemo(() => find(entries, query), [entries, query])
  const at = Math.min(active, results.length - 1)

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  function go(e: Entry) {
    onClose()
    navigate(e.to)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length > 0) setActive((at + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[at]) go(results[at])
    }
  }

  return (
    <NavDialog label="Search" onClose={onClose}>
      <label className="flex items-center gap-2.5 border-b border-(--border) px-4">
        <Search size={16} className="shrink-0 text-neutral-500" />
        <input
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, portfolios, tickers"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={results[at] ? `search-${results[at].key}` : undefined}
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent py-3.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
        />
      </label>
      <div ref={listRef} id="search-results" role="listbox" aria-label="Results" className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5">
        {results.map((r, i) => (
          <div
            key={r.key}
            id={`search-${r.key}`}
            role="option"
            aria-selected={i === at}
            onMouseMove={() => i !== at && setActive(i)}
            onClick={() => go(r)}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
              i === at ? 'bg-(--accent-soft) text-(--accent-text)' : 'text-neutral-300'
            }`}
          >
            <span className="truncate">{r.label ?? r.name}</span>
            {r.hint && <span className="shrink-0 text-xs text-neutral-500">{r.hint}</span>}
          </div>
        ))}
        {results.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-neutral-500">
            {data === null ? 'Loading your portfolios and tickers…' : `Nothing matches “${query.trim()}”.`}
          </div>
        )}
      </div>
      <div className="hidden border-t border-(--border) px-4 py-2 text-[11px] text-neutral-600 sm:block">↑ ↓ to move · Enter to open · Esc to close</div>
    </NavDialog>
  )
}

/** Search (Ctrl+K): jump to a page of either area, a portfolio, or a ticker you hold or
 * watch. Portfolios and tickers load when it opens, and are refreshed each time it does. */
export function SearchDialog({ open, workspace, onClose }: { open: boolean; workspace: Workspace; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    // Each list loads on its own, so one failing still leaves the rest searchable.
    Promise.all([
      fetchPortfolios().catch((): Portfolio[] => []),
      fetchHoldings().catch((): Holding[] => []),
      fetchWatchlist().catch((): string[] => []),
    ]).then(([portfolios, holdings, watchlist]) => {
      if (live) setData({ portfolios, holdings, watchlist })
    })
    return () => {
      live = false
    }
  }, [open])

  if (!open) return null
  return <SearchPanel data={data} workspace={workspace} onClose={onClose} />
}
