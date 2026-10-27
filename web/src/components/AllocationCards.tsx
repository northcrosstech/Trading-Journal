import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Settings2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { FundamentalsRow, OptionPosition, Portfolio } from '../lib/database.types'
import {
  fetchAllocationTargets,
  fetchAllocationTolerance,
  fetchFundamentals,
  fetchTickerTypes,
  saveAllocationTarget,
  setAllocationTolerance,
  setTickerType,
  updatePortfolio,
  type SymbolPrice,
} from '../lib/wealthQueries'
import {
  ASSET_TYPES,
  PRESETS,
  TYPE_LABEL,
  classify,
  compareToTargets,
  isRetirement,
  mixOf,
  type AssetType,
  type Mix,
  type TargetRow,
  type Targets,
  type TickerType,
} from '../lib/allocationPlan'
import { optionValue, kindLabel, type PortfolioSnapshot } from '../lib/portfolio'
import { currency } from '../lib/format'
import { INPUT_SM } from '../lib/ui'
import { useToast } from '../lib/toastContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { Drawer } from './ui/Drawer'

// --- Data --------------------------------------------------------------------------------------

/** Mix targets, your ticker types, the tolerance, and Finnhub's type per ticker. */
export function useAllocationData(symbols: string[]) {
  const key = [...new Set(symbols)].sort().join(',')
  const [targets, setTargets] = useState<Map<string, Targets>>(new Map())
  const [overrides, setOverrides] = useState<Map<string, TickerType>>(new Map())
  const [fund, setFund] = useState<Map<string, FundamentalsRow>>(new Map())
  const [tolerance, setTolerance] = useState(5)

  const load = useCallback(() => {
    Promise.all([fetchAllocationTargets(), fetchTickerTypes(), fetchAllocationTolerance(), fetchFundamentals(key ? key.split(',') : [])])
      .then(([t, o, tol, f]) => {
        setTargets(new Map(t.map((r) => [r.scope, { etf: Number(r.etf), stock: Number(r.stock), bond: Number(r.bond), option: Number(r.option), cash: Number(r.cash) }])))
        setOverrides(new Map(o.map((r) => [r.symbol, r.asset_type])))
        setTolerance(tol)
        setFund(f)
      })
      .catch(() => {})
  }, [key])
  useEffect(load, [load])

  const typeOf = useCallback((symbol: string) => classify(symbol, fund.get(symbol), overrides.get(symbol)), [fund, overrides])
  return { targets, tolerance, typeOf, reload: load }
}

/** One portfolio's (or several portfolios') mix by type. */
export function poolMix(snaps: PortfolioSnapshot[], options: OptionPosition[], prices: Map<string, SymbolPrice>, typeOf: (s: string) => { type: TickerType; edited: boolean }): Mix {
  const holdings = snaps.flatMap((s) => s.holdings.map((v) => ({ symbol: v.holding.symbol, value: v.value })))
  const longOptions = options.filter((o) => o.side === 'long').reduce((s, o) => s + optionValue(o, prices), 0)
  const cash = snaps.reduce((s, x) => s + x.cash, 0)
  return mixOf(holdings, longOptions, cash, typeOf)
}

// --- Rows --------------------------------------------------------------------------------------

const STATUS_PILL = { on: { tone: 'green', text: 'On target' }, over: { tone: 'amber', text: 'Over' }, under: { tone: 'amber', text: 'Under' }, none: { tone: 'neutral', text: '' } } as const

function TargetBar({ r }: { r: TargetRow }) {
  const fill = r.status === 'on' ? 'bg-emerald-400' : r.status === 'none' ? 'bg-neutral-400' : 'bg-amber-400'
  return (
    <span className="relative block h-2 w-full overflow-visible rounded-full bg-neutral-800">
      <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.min(r.pct, 100)}%` }} />
      {r.target !== null && <span className="absolute -top-1 h-4 w-0.5 rounded bg-white/80" style={{ left: `calc(${Math.min(r.target, 100)}% - 1px)` }} title={`Target ${r.target}%`} />}
    </span>
  )
}

function RowLine({ r, onToggle, open }: { r: TargetRow; onToggle?: () => void; open?: boolean }) {
  const pill = STATUS_PILL[r.status]
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 py-2 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_11rem_7rem_8rem]">
      <button onClick={onToggle} disabled={!onToggle} className="flex items-center gap-1 truncate text-left text-neutral-200 disabled:cursor-default">
        {onToggle && <ChevronDown size={13} className={`shrink-0 text-neutral-500 transition ${open ? 'rotate-180' : ''}`} />}
        <span className="truncate">{r.label}</span>
      </button>
      <TargetBar r={r} />
      <span className="col-start-2 text-xs tabular-nums text-neutral-400 sm:col-start-auto sm:text-sm">
        <span className="text-neutral-100">{r.pct.toFixed(0)}%</span>
        {r.target !== null && <span> · target {r.target}%</span>}
        <span className="text-neutral-600"> · {currency(r.value)}</span>
      </span>
      <span className="col-start-2 sm:col-start-auto">
        {r.status !== 'none' && (
          <Pill tone={pill.tone}>
            {pill.text}
            {r.status !== 'on' && ` ${Math.abs(r.diff).toFixed(0)}%`}
          </Pill>
        )}
      </span>
      <span className="col-start-2 text-xs tabular-nums sm:col-start-auto sm:text-right sm:text-sm">
        {r.status === 'over' && <span className="text-amber-300">Trim {currency(-r.move)}</span>}
        {r.status === 'under' && <span className="text-amber-300">Add {currency(r.move)}</span>}
      </span>
    </div>
  )
}

/** Mix by type; ETF/stock/bond rows open to show their tickers, each with a type you can change. */
function MixRows({ mix, targets, tolerance, onTypeChange }: { mix: Mix; targets: Targets | null; tolerance: number; onTypeChange: (symbol: string, type: TickerType | null) => void }) {
  const [open, setOpen] = useState<AssetType | null>(null)
  const cmp = compareToTargets(ASSET_TYPES.map((k) => ({ key: k, label: TYPE_LABEL[k], value: mix.values[k] })), targets, tolerance)
  return (
    <div className="divide-y divide-(--border)">
      {cmp.rows.map((r) => {
        const k = r.key as AssetType
        const expandable = (k === 'etf' || k === 'stock' || k === 'bond') && mix.tickers[k].length > 0
        return (
          <div key={k}>
            <RowLine r={r} open={open === k} onToggle={expandable ? () => setOpen(open === k ? null : k) : undefined} />
            {expandable && open === k && (
              <ul className="mb-2 ml-4 grid gap-1 rounded-xl bg-(--card-raised) px-3 py-2 text-xs sm:grid-cols-2">
                {mix.tickers[k as TickerType].map((t) => (
                  <li key={t.symbol} className="flex items-center justify-between gap-2">
                    <span className="text-neutral-200">
                      {t.symbol} <span className="text-neutral-500">{currency(t.value)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {t.edited && <Pill tone="violet">edited</Pill>}
                      <select
                        value={t.edited ? t.type : 'auto'}
                        onChange={(e) => onTypeChange(t.symbol, e.target.value === 'auto' ? null : (e.target.value as TickerType))}
                        className={`${INPUT_SM} w-auto py-0.5 text-xs`}
                        title="Change this ticker's type"
                      >
                        <option value="auto">{t.edited ? 'Auto (detected)' : `Auto (${TYPE_LABEL[t.type].replace(/s$/, '')})`}</option>
                        <option value="stock">Stock</option>
                        <option value="etf">ETF</option>
                        <option value="bond">Bond</option>
                      </select>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function useTypeChanger(reload: () => void) {
  const { user } = useAuth()
  const toast = useToast()
  return async (symbol: string, type: TickerType | null) => {
    if (!user) return
    try {
      await setTickerType(user.id, symbol, type)
      toast(type === null ? `${symbol}: back to the detected type` : `${symbol} counted as ${TYPE_LABEL[type].replace(/s$/, '')}`)
      reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(/ticker_types/.test(msg) ? 'Run the allocation migration first' : msg, 'error')
    }
  }
}

// --- Targets editor ------------------------------------------------------------------------------

function TargetsDrawer({
  open,
  onClose,
  title,
  scope,
  current,
  split,
  tolerance,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  title: string
  scope: string
  current: Targets | null
  split?: { id: string; name: string; target: number | null }[]
  tolerance: number
  onSaved: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [mix, setMix] = useState<Record<AssetType, string>>(() => toStrings(current))
  const [shares, setShares] = useState<Record<string, string>>({})
  const [tol, setTol] = useState(String(tolerance))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setMix(toStrings(current))
    setShares(Object.fromEntries((split ?? []).map((p) => [p.id, p.target !== null ? String(p.target) : ''])))
    setTol(String(tolerance))
  }, [open, current, split, tolerance])

  const n = (s: string) => (s.trim() === '' ? 0 : Number(s))
  const mixTotal = ASSET_TYPES.reduce((s, k) => s + n(mix[k]), 0)
  const mixEmpty = ASSET_TYPES.every((k) => mix[k].trim() === '')
  const splitTotal = (split ?? []).reduce((s, p) => s + n(shares[p.id] ?? ''), 0)
  const splitEmpty = (split ?? []).every((p) => (shares[p.id] ?? '').trim() === '')
  const valid = (mixEmpty || Math.abs(mixTotal - 100) < 0.01) && (!split || splitEmpty || Math.abs(splitTotal - 100) < 0.01) && n(tol) > 0 && n(tol) <= 50

  async function save() {
    if (!user || !valid) return
    setSaving(true)
    try {
      await saveAllocationTarget(user.id, scope, mixEmpty ? null : (Object.fromEntries(ASSET_TYPES.map((k) => [k, n(mix[k])])) as Targets))
      if (split) for (const p of split) await updatePortfolio(p.id, { target_pct: splitEmpty || (shares[p.id] ?? '').trim() === '' ? (splitEmpty ? null : 0) : n(shares[p.id]) })
      if (n(tol) !== tolerance) await setAllocationTolerance(user.id, n(tol))
      toast('Targets saved')
      onSaved()
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(/allocation_targets|target_pct|allocation_tolerance/.test(msg) ? 'Run the allocation migration first' : msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  const total = (t: number) => (
    <span className={`text-xs tabular-nums ${Math.abs(t - 100) < 0.01 ? 'text-emerald-300' : 'text-amber-300'}`}>
      Total {t}%{Math.abs(t - 100) < 0.01 ? ' ✓' : t < 100 ? ` · ${100 - t}% left` : ` · ${t - 100}% too much`}
    </span>
  )

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle="Leave a section blank to have no targets for it.">
      <div className="flex flex-col gap-6 text-sm">
        {split && (
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Split between brokerage accounts</h3>
              {!splitEmpty && total(splitTotal)}
            </div>
            <div className="flex flex-col gap-2">
              {split.map((p) => (
                <label key={p.id} className="flex items-center justify-between gap-3">
                  <span className="text-neutral-200">{p.name}</span>
                  <PctInput value={shares[p.id] ?? ''} onChange={(v) => setShares((s) => ({ ...s, [p.id]: v }))} />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">Retirement accounts aren't part of the split — money can't move in or out of them.</p>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Mix by type</h3>
            {!mixEmpty && total(mixTotal)}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p.name} size="sm" onClick={() => setMix(toStrings(p.targets))} title={ASSET_TYPES.filter((k) => p.targets[k] > 0).map((k) => `${TYPE_LABEL[k]} ${p.targets[k]}%`).join(' · ')}>
                {p.name}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {ASSET_TYPES.map((k) => (
              <label key={k} className="flex items-center justify-between gap-3">
                <span className="text-neutral-200">{TYPE_LABEL[k]}</span>
                <PctInput value={mix[k]} onChange={(v) => setMix((m) => ({ ...m, [k]: v }))} />
              </label>
            ))}
          </div>
        </section>

        <section>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="text-neutral-200">Warn me when off by more than</span>
              <span className="block text-xs text-neutral-500">Same for every account</span>
            </span>
            <PctInput value={tol} onChange={setTol} />
          </label>
        </section>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => { setMix(toStrings(null)); setShares(Object.fromEntries((split ?? []).map((p) => [p.id, '']))) }}>
            Clear targets
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Save targets'}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}

const toStrings = (t: Targets | null): Record<AssetType, string> => Object.fromEntries(ASSET_TYPES.map((k) => [k, t ? String(t[k]) : ''])) as Record<AssetType, string>

function PctInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="relative w-24">
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="—" className={`${INPUT_SM} pr-6 text-right tabular-nums`} />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">%</span>
    </span>
  )
}

// --- Cards ---------------------------------------------------------------------------------------

type PerPortfolio = { portfolio: Portfolio; snap: PortfolioSnapshot }

/** Portfolios page: the brokerage pool (split between brokerage accounts + combined mix) and a
 * line per retirement account showing whether its own mix is on target. */
export function BrokerageAllocationCard({ perPortfolio, options, prices, onChanged }: { perPortfolio: PerPortfolio[]; options: OptionPosition[]; prices: Map<string, SymbolPrice>; onChanged: () => void }) {
  const symbols = useMemo(() => perPortfolio.flatMap((p) => p.snap.holdings.map((v) => v.holding.symbol)), [perPortfolio])
  const data = useAllocationData(symbols)
  const changeType = useTypeChanger(data.reload)
  const [editing, setEditing] = useState(false)

  const brokerage = perPortfolio.filter((p) => !isRetirement(p.portfolio.kind))
  const retirement = perPortfolio.filter((p) => isRetirement(p.portfolio.kind))
  const brokerageIds = new Set(brokerage.map((p) => p.portfolio.id))
  const hasSplit = brokerage.some((p) => p.portfolio.target_pct != null)
  const split = compareToTargets(
    brokerage.map((p) => ({ key: p.portfolio.id, label: p.portfolio.name, value: p.snap.total })),
    hasSplit ? Object.fromEntries(brokerage.map((p) => [p.portfolio.id, Number(p.portfolio.target_pct ?? 0)])) : null,
    data.tolerance,
  )
  const mix = poolMix(brokerage.map((p) => p.snap), options.filter((o) => brokerageIds.has(o.portfolio_id)), prices, data.typeOf)
  const brokerageTargets = data.targets.get('brokerage') ?? null
  const mixCmp = compareToTargets(ASSET_TYPES.map((k) => ({ key: k, label: k, value: mix.values[k] })), brokerageTargets, data.tolerance)
  const retirementStatus = retirement.map((p) => {
    const t = data.targets.get(p.portfolio.id) ?? null
    const m = poolMix([p.snap], options.filter((o) => o.portfolio_id === p.portfolio.id), prices, data.typeOf)
    return { p, off: t ? compareToTargets(ASSET_TYPES.map((k) => ({ key: k, label: k, value: m.values[k] })), t, data.tolerance).off : null }
  })
  const off = (hasSplit ? split.off : 0) + (brokerageTargets ? mixCmp.off : 0)
  const noTargets = !hasSplit && !brokerageTargets

  if (brokerage.length === 0 && retirement.length === 0) return null

  return (
    <Card
      title="Allocation"
      subtitle={
        noTargets ? (
          'Your brokerage money by account and by type — set targets to see what to rebalance.'
        ) : off === 0 ? (
          <span className="text-emerald-300">Everything on target (±{data.tolerance}%)</span>
        ) : (
          <span className="text-amber-300">
            {off} {off === 1 ? 'thing' : 'things'} off target (±{data.tolerance}%)
          </span>
        )
      }
      actions={
        brokerage.length > 0 ? (
          <Button size="sm" icon={<Settings2 size={14} />} onClick={() => setEditing(true)}>
            {noTargets ? 'Set targets' : 'Edit targets'}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {brokerage.length >= 2 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Split between brokerage accounts</h3>
            <div className="divide-y divide-(--border)">
              {split.rows.map((r) => (
                <RowLine key={r.key} r={r} />
              ))}
            </div>
          </section>
        )}
        {brokerage.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Brokerage mix by type <span className="font-normal normal-case text-neutral-600">· open a row to see or change its tickers</span>
            </h3>
            <MixRows mix={mix} targets={brokerageTargets} tolerance={data.tolerance} onTypeChange={changeType} />
            {mix.margin > 0 && <p className="mt-1 text-xs text-neutral-500">{currency(mix.margin)} of margin isn't counted in the mix.</p>}
          </section>
        )}
        {retirement.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Retirement accounts · each balanced on its own</h3>
            <ul className="divide-y divide-(--border)">
              {retirementStatus.map(({ p, off: o }) => (
                <li key={p.portfolio.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-neutral-200">
                    {p.portfolio.name} <span className="text-xs text-neutral-500">{kindLabel(p.portfolio.kind)}</span>
                  </span>
                  <Link to={`/portfolios/${p.portfolio.id}`} className="text-xs">
                    {o === null ? <span className="text-neutral-500 hover:text-white">No targets · set on its page ›</span> : o === 0 ? <Pill tone="green">On target</Pill> : <Pill tone="amber">{o} off target ›</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <TargetsDrawer
        open={editing}
        onClose={() => setEditing(false)}
        title="Brokerage targets"
        scope="brokerage"
        current={brokerageTargets}
        split={brokerage.length >= 2 ? brokerage.map((p) => ({ id: p.portfolio.id, name: p.portfolio.name, target: p.portfolio.target_pct != null ? Number(p.portfolio.target_pct) : null })) : undefined}
        tolerance={data.tolerance}
        onSaved={() => {
          data.reload()
          onChanged()
        }}
      />
    </Card>
  )
}

/** A portfolio's own page: its mix by type. A retirement account has its own targets; a
 * brokerage account shows its mix and points to the shared brokerage targets. */
export function AccountAllocationCard({ portfolio, snap, options, prices }: { portfolio: Portfolio; snap: PortfolioSnapshot; options: OptionPosition[]; prices: Map<string, SymbolPrice> }) {
  const symbols = useMemo(() => snap.holdings.map((v) => v.holding.symbol), [snap])
  const data = useAllocationData(symbols)
  const changeType = useTypeChanger(data.reload)
  const [editing, setEditing] = useState(false)
  const retirement = isRetirement(portfolio.kind)
  const mix = poolMix([snap], options.filter((o) => o.status === 'open'), prices, data.typeOf)
  const targets = retirement ? (data.targets.get(portfolio.id) ?? null) : null
  const off = targets ? compareToTargets(ASSET_TYPES.map((k) => ({ key: k, label: k, value: mix.values[k] })), targets, data.tolerance).off : 0

  return (
    <Card
      title="Mix by type"
      subtitle={
        retirement ? (
          !targets ? (
            'This account is balanced on its own — set targets to see what to rebalance.'
          ) : off === 0 ? (
            <span className="text-emerald-300">On target (±{data.tolerance}%)</span>
          ) : (
            <span className="text-amber-300">
              {off} off target (±{data.tolerance}%)
            </span>
          )
        ) : (
          <>
            This account only. Targets are set for all brokerage accounts together on{' '}
            <Link to="/portfolios" className="text-(--accent-text) hover:underline">
              Portfolios
            </Link>
            .
          </>
        )
      }
      actions={
        retirement ? (
          <Button size="sm" icon={<Settings2 size={14} />} onClick={() => setEditing(true)}>
            {targets ? 'Edit targets' : 'Set targets'}
          </Button>
        ) : undefined
      }
    >
      <MixRows mix={mix} targets={targets} tolerance={data.tolerance} onTypeChange={changeType} />
      {mix.margin > 0 && <p className="mt-1 text-xs text-neutral-500">{currency(mix.margin)} of margin isn't counted in the mix.</p>}
      {retirement && (
        <TargetsDrawer
          open={editing}
          onClose={() => setEditing(false)}
          title={`${portfolio.name} targets`}
          scope={portfolio.id}
          current={targets}
          tolerance={data.tolerance}
          onSaved={data.reload}
        />
      )}
    </Card>
  )
}

