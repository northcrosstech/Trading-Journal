import type { ReactNode } from 'react'

/** The standard surface: a rounded panel with an optional title row (title, subtitle,
 * actions on the right). `flush` drops the body padding for edge-to-edge tables. */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  flush = false,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  flush?: boolean
}) {
  const hasHeader = title !== undefined || actions !== undefined
  return (
    <section className={`rounded-2xl border border-(--border) bg-(--card) ${className}`}>
      {hasHeader && (
        <header className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 ${flush ? 'pb-3' : 'pb-1'}`}>
          <div className="min-w-0">
            {title !== undefined && <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children !== undefined && <div className={flush ? '' : hasHeader ? 'px-5 pb-5 pt-3' : 'p-5'}>{children}</div>}
    </section>
  )
}
