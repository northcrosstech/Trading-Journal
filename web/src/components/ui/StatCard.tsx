import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'

/** A headline number. `tone` colors the value by sign (gain green / loss red, with an
 * arrow so it never rests on color alone); `chip` is a small colored change badge under
 * the value, e.g. a percent. `accent` tints the card edge for the page's key figure. */
export function StatCard({
  label,
  value,
  sub,
  tone,
  chip,
  chipTone,
  icon,
  accent = false,
  warning = false,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: number | null
  chip?: ReactNode
  chipTone?: number | null
  icon?: ReactNode
  accent?: boolean
  /** Amber value -- something to keep an eye on (e.g. margin used), not a loss. */
  warning?: boolean
}) {
  const valueColor = warning ? 'text-amber-300' : tone == null || tone === 0 ? 'text-white' : tone > 0 ? 'text-(--status-good)' : 'text-(--status-critical)'
  const chipColor =
    chipTone == null || chipTone === 0
      ? 'bg-neutral-800 text-neutral-300'
      : chipTone > 0
        ? 'bg-emerald-500/12 text-emerald-300'
        : 'bg-red-500/12 text-red-300'
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-(--card) p-4 ${accent ? 'border-(--accent)/40' : 'border-(--border)'}`}
    >
      {accent && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-(--accent)" />}
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        {icon && <span className="text-neutral-500">{icon}</span>}
        {label}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 text-2xl font-semibold tracking-tight tabular-nums ${valueColor}`}>
        {tone != null && tone !== 0 && (tone > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />)}
        <span className="truncate">{value}</span>
      </div>
      {(chip || sub) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          {chip && <span className={`rounded-md px-1.5 py-0.5 font-medium tabular-nums ${chipColor}`}>{chip}</span>}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
    </div>
  )
}
