import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronRight, Plus, Telescope } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { Holding } from '../lib/database.types'
import { addToWatchlist, fetchFundamentals, fetchHoldings, fetchLatestPrices, fetchWatchlist, removeFromWatchlist, requestMarketData } from '../lib/wealthQueries'
import { useResearch } from '../lib/useResearch'
import type { Research } from '../lib/research'
import { currency, dateFmt, priceFmt } from '../lib/format'
import { INPUT } from '../lib/ui'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { FairBar, ScoreBadge } from '../components/ResearchBits'
import { ResearchDrawer } from '../components/ResearchDrawer'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { Segmented } from '../components/ui/Tabs'
import { EmptyState } from '../components/ui/EmptyState'

type Show = 'holdings' | 'watchlist' | 'all'
type Sort = 'score' | 'value' | 'earnings'

const POLL_MS = 10_000
const POLL_TRIES = 18 // about 3 minutes: the worker paces Finnhub at ~1 call a second

/** One list of every ticker you hold or watch: price, fair value, how cheap it is, score and
 * the next earnings date. Clicking a row opens the full breakdown. */
export function ResearchPage() {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [prices, setPrices] = useState<Map<string, number>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [show, setShow] = useState<Show>('all')
  const [sort, setSort] = useState<Sort>('score')
  const [open, setOpen] = useState<string | null>(null)
  const [fetching, setFetching] = useState<string[]>([])
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)

  const held = useMemo(() => new Set(holdings.map((h) => h.symbol)), [holdings])
  const symbols = useMemo(() => [...new Set([...held, ...watchlist])].sort(), [held, watchlist])

  const loadBase = useCallback(() => {
    Promise.all([fetchHoldings(), fetchWatchlist()])
      .then(async ([h, w]) => {
        const all = [...new Set([...h.map((x) => x.symbol), ...w])]
        const latest = await fetchLatestPrices(all)
        const p = new Map<string, number>()
        for (const s of all) {
          const manual = h.find((x) => x.symbol === s && x.manual_price !== null)
          const close = latest.get(s)?.close
          if (manual) p.set(s, Number(manual.manual_price))
          else if (close !== undefined) p.set(s, close)
        }
        setHoldings(h)
        setWatchlist(w)
        setPrices(p)
        setLoaded(true)
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }, [toast])
  useEffect(loadBase, [loadBase])
  useEffect(() => () => {
    if (poll.current) clearTimeout(poll.current)
  }, [])

  const { rows, macro, settings, ready, reload } = useResearch(symbols, prices)

  /** After adding a ticker: ask the worker for its price and fundamentals, then check back
   * until they've arrived. */
  function waitForData(list: string[], attempt = 0) {
    fetchFundamentals(list)
      .then((found) => {
        const missing = list.filter((s) => !found.has(s))
        if (missing.length === 0 || attempt >= POLL_TRIES) {
          setFetching([])
          loadBase()
          reload()
          if (missing.length > 0) toast(`No data yet for ${missing.join(', ')} — check the ticker, or it'll fill in after tonight's run.`, 'error')
          return
        }
        poll.current = setTimeout(() => waitForData(list, attempt + 1), POLL_MS)
      })
      .catch(() => setFetching([]))
  }

  async function addTicker() {
    if (!user) return
    const v = await dialog.form({
      title: 'Add to watchlist',
      description: 'Fair value, score and earnings date appear in about a minute.',
      submitLabel: 'Add',
      fields: [{ name: 'symbol', label: 'Ticker', placeholder: 'e.g. NVDA', validate: (s) => (/^[A-Za-z.\-]{1,10}$/.test(s.trim()) ? null : 'Enter a ticker, e.g. NVDA') }],
    })
    if (!v) return
    const symbol = v.symbol.trim().toUpperCase()
    try {
      await addToWatchlist(user.id, symbol)
      toast(`${symbol} added — fetching its data`)
      loadBase()
      if (await requestMarketData()) {
        setFetching([symbol])
        waitForData([symbol])
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(/research_watchlist/.test(msg) ? 'Run the research migration first' : msg, 'error')
    }
  }

  async function remove(symbol: string) {
    try {
      await removeFromWatchlist(symbol)
      setOpen(null)
      toast(`${symbol} removed from your watchlist`)
      loadBase()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const list = useMemo(() => {
    const pick = symbols.filter((s) => (show === 'holdings' ? held.has(s) : show === 'watchlist' ? watchlist.includes(s) : true))
    const items = pick.map((s) => rows.get(s)).filter((r): r is Research => r !== undefined)
    const last = (n: number | null | undefined, desc = false) => (n === null || n === undefined ? (desc ? -Infinity : Infinity) : n)
    return items.sort((a, b) =>
      sort === 'score'
        ? last(b.total, true) - last(a.total, true) || a.symbol.localeCompare(b.symbol)
        : sort === 'value'
          ? last(a.pct) - last(b.pct) || a.symbol.localeCompare(b.symbol)
          : last(a.earnings?.days) - last(b.earnings?.days) || a.symbol.localeCompare(b.symbol),
    )
  }, [symbols, show, held, watchlist, rows, sort])

  const current = open ? (rows.get(open) ?? null) : null

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Research"
        subtitle="Fair value and a 100-point score for everything you hold or watch — click a row for the breakdown."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={addTicker}>
            Add ticker
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Show>
          options={[
            { value: 'all', label: `All (${symbols.length})` },
            { value: 'holdings', label: `Holdings (${held.size})` },
            { value: 'watchlist', label: `Watchlist (${watchlist.length})` },
          ]}
          value={show}
          onChange={setShow}
          size="sm"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${INPUT} w-auto py-1.5`}>
            <option value="score">Best score</option>
            <option value="value">Cheapest vs fair value</option>
            <option value="earnings">Earnings soonest</option>
          </select>
        </label>
      </div>

      <Card flush>
        {!loaded || !ready ? (
          <div className="px-5 py-10 text-center text-sm text-neutral-500">Loading…</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Telescope size={20} />}
            title={show === 'watchlist' ? 'Your watchlist is empty' : 'Nothing to research yet'}
            action={
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={addTicker}>
                Add a ticker
              </Button>
            }
          >
            Add tickers you're thinking about buying to see their fair value and score next to what you already own.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-(--border)">
            {list.map((r) => (
              <li key={r.symbol}>
                <button onClick={() => setOpen(r.symbol)} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition hover:bg-white/2 md:grid-cols-[minmax(0,1.6fr)_6rem_6rem_9rem_9rem_minmax(0,1fr)_1rem]">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-white">{r.symbol}</span>
                      {show === 'all' && held.has(r.symbol) && <Pill tone="teal">Held</Pill>}
                      {fetching.includes(r.symbol) && <Pill tone="amber">Fetching…</Pill>}
                      {r.checks.length > 0 && (
                        <Pill tone="amber" title="An edit of yours needs a look: open to see">
                          Check edit{r.checks.length === 1 ? '' : 's'}
                        </Pill>
                      )}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">{r.name ?? (r.kind === 'etf' ? 'Fund (ETF)' : ' ')}</span>
                  </span>
                  <span className="text-right tabular-nums text-neutral-200 md:order-0">{r.price !== null ? priceFmt(r.price) : '—'}</span>
                  {r.kind === 'etf' && r.fair === null ? (
                    <span className="col-span-2 text-xs text-neutral-500 md:col-span-3">ETF · no fair value</span>
                  ) : r.fair === null && r.total === null ? (
                    <span className="col-span-2 text-xs text-neutral-500 md:col-span-3">{fetching.includes(r.symbol) ? 'Fetching data…' : 'No earnings data yet'}</span>
                  ) : (
                    <>
                      <span className="text-right text-xs tabular-nums text-neutral-400 md:text-sm">{r.fair !== null ? `FV ${currency(r.fair)}` : 'FV —'}</span>
                      <span className="justify-self-end md:justify-self-start">{r.pct !== null ? <FairBar pct={r.pct} /> : <span className="text-xs text-neutral-600">—</span>}</span>
                      <span className="md:justify-self-start">
                        <ScoreBadge r={r} />
                      </span>
                    </>
                  )}
                  <span className="justify-self-end text-xs md:justify-self-start">
                    {r.earnings && r.earnings.days <= 30 && (
                      <span className={`inline-flex items-center gap-1 ${r.earnings.days <= 7 ? 'text-amber-300' : 'text-neutral-400'}`}>
                        <CalendarClock size={12} /> Earnings {dateFmt(r.earnings.date)} · {r.earnings.days}d
                      </span>
                    )}
                  </span>
                  <ChevronRight size={16} className="hidden text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300 md:block" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-neutral-600">
        Fair value uses Graham's revised formula with free data from Finnhub (earnings) and FRED (AAA bond yield, economy), refreshed after each trading day's close. Estimates, not advice.
      </p>

      <ResearchDrawer
        r={current}
        macro={macro}
        settings={settings}
        onClose={() => setOpen(null)}
        onChanged={reload}
        onRemove={current && watchlist.includes(current.symbol) && !held.has(current.symbol) ? () => remove(current.symbol) : undefined}
      />
    </div>
  )
}
