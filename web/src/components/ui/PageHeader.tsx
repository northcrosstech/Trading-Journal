import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

/** Page title row: optional back link, title + subtitle on the left, the page's main
 * actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  badge,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { to: string; label: string }
  badge?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1 inline-flex items-center gap-0.5 text-xs text-neutral-500 transition hover:text-neutral-200">
            <ChevronLeft size={14} />
            {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
