import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { OptionPosition, Portfolio } from '../lib/database.types'
import { signedCurrency as signed, type PortfolioSnapshot } from '../lib/portfolio'
import { LARGE_POSITION_SHARE, TOP_HOLDINGS, combinedHoldings, type CombinedHoldings, type CombinedPart, type CombinedRow } from '../lib/combinedHoldings'
import { currency, percentFmt } from '../lib/format'
import { toneClass } from '../lib/ui'
import { sortRows, useSort } from '../lib/useSort'
import { CollapsibleSection } from './CollapsibleSection'
import { SortTh } from './SortTh'
import { Card } from './ui/Card'
import { Pill } from './ui/Pill'

type PerPortfolio = { portfolio: Portfolio; snap: PortfolioSnapshot }
type Props = { perPortfolio: PerPortfolio[]; combined: PortfolioSnapshot; openOptions: OptionPosition[] }

const STORAGE_KEY = 'portfolios-what-i-own-open'
const SORT_KEYS = ['holding', 'shares', 'value', 'share', 'gain', 'gainPct', 'portfolios'] as const
const ASC_FIRST = ['holding'] as const

const shareCount = (n: number) => Number(n.toFixed(6))
const sharePct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)
const wholePct = (n: number) => `${Math.round(n * 100)}%`
const largePct = wholePct(LARGE_POSITION_SHARE)

/** "What I own": every ticker added up across the active portfolios, in a section that is
 * open to begin with once there are two or more portfolios. */
export function CombinedHoldingsSection({ perPortfolio, combined, openOptions }: Props) {
  const n = perPortfolio.length
  return (
    <CollapsibleSection storageKey={STORAGE_KEY} defaultOpen={n >= 2} title="What I own" hint={n > 1 ? `Every ticker added up across your ${n} portfolios` : 'Every ticker, with cash and options, in one table'}>
      <CombinedHoldingsCard perPortfolio={perPortfolio} combined={combined} openOptions={openOptions} />
    </CollapsibleSection>
  )
}

function Summary({ data }: { data: CombinedHoldings }) {
  const { top } = data
  if (!top) {
    return data.tickers.length > 0 && data.total <= 0 ? (
      <p className="px-5 pb-3 pt-4 text-sm text-neutral-400">Percentages are left out: what you owe is more than what you hold, so there is no total to take a share of.</p>
    ) : null
  }
  const priced = data.tickers.filter((t) => t.value !== null).length
  const num = (s: string) => <span className="font-medium tabular-nums text-white">{s}</span>
  return (
    <p className="px-5 pb-3 pt-4 text-sm text-neutral-300" title="Of the combined value of all portfolios, cash included">
      {top.count === 1 ? (
        <>
          {top.symbol} is {num(wholePct(top.symbolShare))} of your investments.
        </>
      ) : (
        <>
          {priced > TOP_HOLDINGS ? `Top ${top.count}` : `Your ${top.count}`} holdings are {num(wholePct(top.share))} of your investments. {top.symbol} is{' '}
          {num(wholePct(top.symbolShare))}.
        </>
      )}
    </p>
  )
}

function HeldIn({ row, open, onToggle }: { row: CombinedRow; open: boolean; onToggle: () => void }) {
  if (row.parts.length === 0) return <span className="text-neutral-600">—</span>
  if (row.parts.length === 1) {
    const p = row.parts[0].portfolio
    return (
      <Link to={`/portfolios/${p.id}`} className="text-neutral-300 hover:text-white hover:underline">
        {p.name}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={row.parts.map((p) => p.portfolio.name).join(', ')}
      className="-ml-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs font-medium text-(--accent-text) transition hover:bg-(--card-raised)"
    >
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {row.parts.length} portfolios
    </button>
  )
}

function PartRow({ row, part }: { row: CombinedRow; part: CombinedPart }) {
  const borrowed = row.kind === 'cash' && part.value !== null && part.value < 0
  return (
    <tr className="border-b border-(--border) bg-white/2 text-xs last:border-0">
      <td className="py-2 pl-9 pr-3">
        <Link to={`/portfolios/${part.portfolio.id}`} className="text-neutral-300 hover:text-white hover:underline">
          {part.portfolio.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{part.shares === null ? '' : shareCount(part.shares)}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${part.value === null || borrowed ? 'text-amber-300' : 'text-neutral-300'}`}>
        {part.value === null ? 'no price yet' : borrowed ? `${currency(-part.value)} margin` : currency(part.value)}
      </td>
      <td className="px-3 py-2" />
      <td className={`px-3 py-2 text-right tabular-nums ${toneClass(part.gain)}`}>{part.gain === null ? '' : signed(part.gain)}</td>
      <td className="px-3 py-2" colSpan={2} />
    </tr>
  )
}

function CombinedHoldingsCard({ perPortfolio, combined, openOptions }: Props) {
  const data = useMemo(() => combinedHoldings(perPortfolio, combined, openOptions), [perPortfolio, combined, openOptions])
  const { state: sort, toggle: onSort } = useSort('combined-holdings', SORT_KEYS, ASC_FIRST)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (!next.delete(key)) next.add(key)
      return next
    })

  // Tickers sort; the options and cash lines stay underneath them.
  const rows = [
    ...sortRows(data.tickers, sort, {
      holding: (r) => r.label,
      shares: (r) => r.shares,
      value: (r) => r.value,
      share: (r) => r.share,
      gain: (r) => r.gain,
      gainPct: (r) => r.gainPct,
      portfolios: (r) => r.parts.length,
    }),
    ...(data.options ? [data.options] : []),
    data.cash,
  ]
  const borrowers = data.cash.parts.filter((p) => p.value !== null && p.value < 0).map((p) => p.portfolio.name)
  const negativeLine = (data.cash.value ?? 0) < 0 || (data.options?.value ?? 0) < 0

  return (
    <Card flush className="overflow-hidden">
      <Summary data={data} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-(--border) bg-white/2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <SortTh k="holding" sort={sort} onSort={onSort} className="px-5 py-2.5">Ticker</SortTh>
              <SortTh k="shares" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Shares</SortTh>
              <SortTh k="value" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right">Value</SortTh>
              <SortTh k="share" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right" title="Share of the combined value of all portfolios, cash included">Share</SortTh>
              <SortTh k="gain" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right" title="Value now less what you paid">Gain</SortTh>
              <SortTh k="gainPct" sort={sort} onSort={onSort} className="px-3 py-2.5 text-right" title="Gain as a percent of what you paid">Gain %</SortTh>
              <SortTh k="portfolios" sort={sort} onSort={onSort} className="px-3 py-2.5">Held in</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = r.parts.length > 1 && expanded.has(r.key)
              return (
                <Fragment key={r.key}>
                  <tr className="border-b border-(--border) transition last:border-0 hover:bg-white/2">
                    <td className="px-5 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={`font-semibold ${r.kind === 'ticker' ? 'text-white' : 'text-neutral-200'}`}>{r.label}</span>
                        {r.large && (
                          <Pill tone="amber" title={`More than ${largePct} of your investments is in this one ticker`}>
                            Large position
                          </Pill>
                        )}
                        {r.unpricedShares > 0 && (
                          <Pill tone="amber" title="Prices update once a day after the close">
                            price pending
                          </Pill>
                        )}
                        {r.kind === 'cash' && data.margin > 0 && (
                          <Pill tone="amber" title={`Borrowed in ${borrowers.join(', ')}`}>
                            {currency(data.margin)} margin
                          </Pill>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">{r.shares === null ? <span className="text-neutral-600">—</span> : shareCount(r.shares)}</td>
                    <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${r.value !== null && r.value < 0 ? 'text-amber-300' : 'text-white'}`}>
                      {r.value === null ? <span className="text-xs font-normal text-amber-300">no price yet</span> : currency(r.value)}
                      {r.value !== null && r.unpricedShares > 0 && (
                        <div className="text-xs font-normal text-amber-300">{shareCount(r.unpricedShares)} more with no price yet, not counted</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">{sharePct(r.share)}</td>
                    <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${r.gain === null ? 'text-neutral-600' : toneClass(r.gain)}`}>
                      {r.gain === null ? '—' : signed(r.gain)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${r.gainPct === null ? 'text-neutral-600' : toneClass(r.gainPct)}`}>
                      {r.gainPct === null ? '—' : percentFmt(r.gainPct)}
                    </td>
                    <td className="px-3 py-2.5">
                      <HeldIn row={r} open={open} onToggle={() => toggle(r.key)} />
                    </td>
                  </tr>
                  {open && r.parts.map((part) => <PartRow key={part.portfolio.id} row={r} part={part} />)}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-(--border) bg-white/2 text-neutral-200">
              <td className="px-5 py-2.5 font-semibold">Total</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-white">{currency(data.total)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">{data.total > 0 ? sharePct(1) : '—'}</td>
              <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${toneClass(data.gain)}`}>{signed(data.gain)}</td>
              <td className="px-3 py-2.5" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {(data.unpricedSymbols.length > 0 || data.options || negativeLine) && (
        <div className="flex flex-col gap-1 border-t border-(--border) px-5 py-3 text-xs text-neutral-500">
          {data.unpricedSymbols.length > 0 && (
            <p>
              No price yet for {data.unpricedSymbols.join(', ')}: shares bought for {currency(data.unpricedCost)} are left out of the values and percentages here. Total value at
              the top of the page counts them at what you paid.
            </p>
          )}
          {data.options && (
            <p>
              Options: what you bought, at the last price you entered (or what you paid if you have not entered one), less the estimated cost to buy back the calls and puts
              you sold.
              {data.putsOpen && ' The gain on that line leaves out sold puts.'}
            </p>
          )}
          {negativeLine && <p>An amount you owe counts as a negative share, so the lines above it add up to more than 100%.</p>}
        </div>
      )}
    </Card>
  )
}
