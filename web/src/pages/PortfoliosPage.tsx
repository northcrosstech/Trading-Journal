import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ChevronRight, Plus, Wallet } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { PortfolioKind } from '../lib/database.types'
import { createPortfolio, updatePortfolio } from '../lib/wealthQueries'
import { KIND_TONE, PORTFOLIO_KINDS, kindLabel, seriesFor, signedCurrency as signed, timeWeightedReturn } from '../lib/portfolio'
import { currency, percentFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { useWealthPortfolios } from '../lib/useWealthPortfolios'
import { AllocationDonut, ValueHistoryChart } from '../components/WealthCharts'
import { Kpi, ReturnsRow } from '../components/WealthBits'
import { DividendsCard } from '../components/DividendsCard'
import { GetPricesButton } from '../components/GetPricesButton'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { EmptyState } from '../components/ui/EmptyState'

const pctChip = (n: number, base: number) => (base > 0 ? percentFmt(n / base) : undefined)

export function PortfoliosPage() {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const w = useWealthPortfolios()
  const [showArchived, setShowArchived] = useState(false)

  async function newPortfolio() {
    if (!user) return
    const v = await dialog.form({
      title: 'New portfolio',
      description: 'The type decides which Net worth line the portfolio’s value fills.',
      submitLabel: 'Create portfolio',
      fields: [
        { name: 'name', label: 'Name', placeholder: 'e.g. Fidelity long-term' },
        { name: 'kind', label: 'Type', type: 'select', defaultValue: 'brokerage', options: PORTFOLIO_KINDS.map((k) => ({ value: k.value, label: k.label })) },
      ],
    })
    if (!v) return
    try {
      await createPortfolio(user.id, { name: v.name, kind: v.kind as PortfolioKind })
      toast(`Created “${v.name}”`)
      w.load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  if (w.error) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">Failed to load portfolios: {w.error}</div>
  if (!w.portfolios) return <div className="text-neutral-500">Loading portfolios…</div>

  const { combined, active } = w
  const archived = w.portfolios.filter((p) => p.archived)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Portfolios"
        subtitle="Long-term investments, valued at each trading day’s close."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={newPortfolio}>
            New portfolio
          </Button>
        }
      />

      {w.pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-200">
          <span>
            Waiting for a first price: <span className="font-medium">{w.pending.join(', ')}</span>. Prices update once a day after the close.
          </span>
          <GetPricesButton symbols={w.pending} onDone={w.load} />
        </div>
      )}

      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={22} />}
            title="No portfolios yet"
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={newPortfolio}>
                Create your first portfolio
              </Button>
            }
          >
            Add a brokerage, 401k or IRA, then bring in the shares and cash you already hold.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Total value" value={currency(combined.total)} sub={`${active.length} portfolio${active.length === 1 ? '' : 's'}`} accent />
            <Kpi
              label="Today"
              value={signed(combined.dayChange)}
              tone={combined.dayChange}
              chip={pctChip(combined.dayChange, combined.total - combined.dayChange)}
              chipTone={combined.dayChange}
            />
            <Kpi
              label="Unrealized gain"
              value={signed(combined.unrealized)}
              tone={combined.unrealized}
              chip={pctChip(combined.unrealized, combined.cost)}
              chipTone={combined.unrealized}
            />
            <Kpi label="Realized gain" value={signed(w.realizedTotal)} tone={w.realizedTotal} sub="sales, options and puts" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {w.perPortfolio.map(({ portfolio: p, snap }) => {
              const ret = timeWeightedReturn(seriesFor(w.values, p.id))
              return (
                <Link
                  key={p.id}
                  to={`/portfolios/${p.id}`}
                  className="group flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--card) p-5 transition hover:border-(--accent)/50 hover:bg-(--card-raised)"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-white">{p.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Pill tone={KIND_TONE[p.kind]}>{kindLabel(p.kind)}</Pill>
                        <span className="text-xs text-neutral-500">
                          {snap.holdings.length} holding{snap.holdings.length === 1 ? '' : 's'}
                        </span>
                        {snap.unpriced > 0 && <Pill tone="amber">{snap.unpriced} price pending</Pill>}
                      </div>
                    </div>
                    <ChevronRight size={18} className="mt-1 shrink-0 text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300" />
                  </div>
                  <div className="text-2xl font-semibold tracking-tight tabular-nums text-white">{currency(snap.total)}</div>
                  <div className="grid grid-cols-3 gap-2 border-t border-(--border) pt-3 text-xs">
                    <div>
                      <div className="text-neutral-500">Today</div>
                      <div className={`mt-0.5 font-medium tabular-nums ${toneClass(snap.dayChange)}`}>{signed(snap.dayChange)}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">Unrealized</div>
                      <div className={`mt-0.5 font-medium tabular-nums ${toneClass(snap.unrealized)}`}>{signed(snap.unrealized)}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">Since start</div>
                      <div className={`mt-0.5 font-medium tabular-nums ${toneClass(ret?.cumulative)}`}>{ret ? percentFmt(ret.cumulative) : '—'}</div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <Card title="Value" subtitle="All portfolios, at each trading day’s close" className="xl:col-span-3">
              <ValueHistoryChart data={w.series.map((s) => ({ date: s.date, total: s.total }))} />
            </Card>
            <Card title="Allocation" subtitle="All portfolios combined" className="xl:col-span-2">
              <AllocationDonut allocation={w.allocation} centerLabel="All portfolios" />
            </Card>
          </div>

          <Card title="Returns" subtitle="All portfolios combined">
            <ReturnsRow series={w.series} />
          </Card>

          <DividendsCard holdings={w.activeHoldings} prices={w.prices} holdingsValue={combined.holdingsValue} portfolioIds={w.activeIds} />
        </>
      )}

      {archived.length > 0 && (
        <div className="text-sm">
          <button onClick={() => setShowArchived((v) => !v)} className="inline-flex items-center gap-1.5 text-neutral-500 transition hover:text-neutral-200">
            <Archive size={15} />
            {showArchived ? 'Hide' : 'Show'} {archived.length} archived portfolio{archived.length === 1 ? '' : 's'}
          </button>
          {showArchived && (
            <div className="mt-3 flex flex-col gap-2">
              {archived.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-(--border) bg-(--card) px-4 py-3">
                  <Link to={`/portfolios/${p.id}`} className="text-neutral-300 hover:text-white">
                    {p.name}
                  </Link>
                  <Button
                    size="sm"
                    onClick={() =>
                      updatePortfolio(p.id, { archived: false })
                        .then(() => {
                          toast(`Restored “${p.name}”`)
                          w.load()
                        })
                        .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
                    }
                  >
                    Unarchive
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
