import type { NetworthLine } from '../lib/networth'
import { categoryTotals } from '../lib/networth'
import { allocationSlices } from '../lib/allocation'
import { currency } from '../lib/format'
import { AllocationDonut } from './WealthCharts'
import { Card } from './ui/Card'

/** How a month's net worth is made up: a donut of what you own by category, the totals of
 * what you owe by category, and the net. Every category total is listed (e.g. all credit
 * cards together, all 401k accounts together). */
export function NetWorthComposition({ lines, monthName }: { lines: NetworthLine[]; monthName: string }) {
  const totals = categoryTotals(lines)
  const assets = totals.filter((t) => !t.debt)
  const debts = totals.filter((t) => t.debt)
  const assetTotal = assets.reduce((s, t) => s + t.total, 0)
  const debtTotal = debts.reduce((s, t) => s + t.total, 0)
  const maxDebt = Math.max(1, ...debts.map((d) => d.total))
  const donut = allocationSlices(
    assets.map((a) => ({ key: a.category, label: a.count > 1 ? `${a.label} (${a.count})` : a.label, value: a.total })),
    0,
    undefined,
    0, // every category gets its own slice -- there are only a handful
  )

  if (totals.length === 0) return null

  return (
    <Card title="Composition" subtitle={`What makes up your net worth · ${monthName}`}>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h3 className="mb-3 flex items-baseline justify-between text-sm font-semibold text-neutral-100">
            What you own <span className="tabular-nums text-teal-300">{currency(assetTotal)}</span>
          </h3>
          {assets.length === 0 ? <p className="text-sm text-neutral-500">No assets this month.</p> : <AllocationDonut allocation={donut} centerLabel="Assets" noun="Categories" />}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <div>
            <h3 className="mb-3 flex items-baseline justify-between text-sm font-semibold text-neutral-100">
              What you owe <span className="tabular-nums text-red-300">−{currency(debtTotal)}</span>
            </h3>
            {debts.length === 0 ? (
              <p className="text-sm text-neutral-500">No debts this month.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {debts.map((d) => (
                  <div key={d.category} className="text-sm">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="text-neutral-200">
                        {d.label}
                        {d.count > 1 && <span className="text-neutral-500"> · {d.count} accounts</span>}
                      </span>
                      <span className="font-medium tabular-nums text-red-300">−{currency(d.total)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                      <div className="h-full rounded-full bg-red-400/80" style={{ width: `${(d.total / maxDebt) * 100}%` }} />
                    </div>
                    {debtTotal > 0 && <div className="mt-0.5 text-xs text-neutral-500">{((d.total / debtTotal) * 100).toFixed(1)}% of debt</div>}
                    {d.count > 1 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5 border-l border-(--border) pl-3 text-xs">
                        {lines
                          .filter((l) => l.category === d.category)
                          .sort((a, b) => a.amount - b.amount)
                          .map((l) => (
                            <li key={l.key} className="flex justify-between gap-3">
                              <span className="truncate text-neutral-400">{l.name}</span>
                              <span className="tabular-nums text-neutral-400">−{currency(Math.abs(l.amount))}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-(--card-raised) p-4 text-sm">
            <div className="flex justify-between py-0.5">
              <span className="text-neutral-400">Assets</span>
              <span className="tabular-nums text-neutral-100">{currency(assetTotal)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-neutral-400">Debts</span>
              <span className="tabular-nums text-red-300">−{currency(debtTotal)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-(--border) pt-2 text-base font-semibold">
              <span className="text-white">Net worth</span>
              <span className="tabular-nums text-white">{currency(assetTotal - debtTotal)}</span>
            </div>
            {assetTotal > 0 && (
              <div className="mt-1 text-xs text-neutral-500">
                Debt is {((debtTotal / assetTotal) * 100).toFixed(1)}% of what you own
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
