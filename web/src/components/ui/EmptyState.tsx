import type { ReactNode } from 'react'

/** Friendly placeholder for an empty list, pointing at the next step. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 rounded-2xl bg-(--accent-soft) p-3 text-(--accent-text)">{icon}</div>}
      <div className="text-sm font-medium text-neutral-200">{title}</div>
      {children && <div className="max-w-sm text-sm text-neutral-500">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
