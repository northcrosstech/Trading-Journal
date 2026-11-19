import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'

/** A headline number. `tone` colors the value by sign (gain green / loss red, with an
 * arrow so it never rests on color alone); `chip` is a small colored change badge under
 * the value, e.g. a percent. `accent` tints the card edge for the page's key figure. With
 * `to` the whole card is a link to the page that explains the number. */
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
  to,
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
  /** Where the number is explained: makes the card a link. */
  to?: string
}) {
  const valueColor = warning ? 'text-amber-300' : tone == null || tone === 0 ? 'text-white' : tone > 0 ? 'text-(--status-good)' : 'text-(--status-critical)'
  const chipColor =
    chipTone == null || chipTone === 0
      ? 'bg-neutral-800 text-neutral-300'
      : chipTone > 0
        ? 'bg-emerald-500/12 text-emerald-300'
        : 'bg-red-500/12 text-red-300'
  const frame = `relative block overflow-hidden rounded-2xl border bg-(--card) p-4 ${accent ? 'border-(--accent)/40' : 'border-(--border)'}`
  const body = (
    <>
      {accent && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-(--accent)" />}
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        {icon && <span className="text-neutral-500">{icon}</span>}
        {label}
        {to && <ChevronRight size={14} className="ml-auto shrink-0 text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300" />}
      </div>
      <div className={`mt-1.5 flex items-center gap-1.5 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl ${valueColor}`}>
        {tone != null && tone !== 0 && (tone > 0 ? <TrendingUp size={18} className="shrink-0" /> : <TrendingDown size={18} className="shrink-0" />)}
        <span className="min-w-0 wrap-break-word">{value}</span>
      </div>
      {(chip || sub) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          {chip && <span className={`rounded-md px-1.5 py-0.5 font-medium tabular-nums ${chipColor}`}>{chip}</span>}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
    </>
  )
  if (to)
    return (
      <Link
        to={to}
        className={`${frame} group transition hover:border-(--accent)/50 hover:bg-(--card-raised) focus-visible:border-(--accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-soft)`}
      >
        {body}
      </Link>
    )
  return <div className={frame}>{body}</div>
}
