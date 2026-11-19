import { RotateCw } from 'lucide-react'
import { Button } from './Button'

const BLOCK = 'rounded-2xl border border-(--border) bg-(--card)'

/** A page that is still loading: grey shapes where the title, the headline numbers and the
 * first card will be, so the page doesn't jump when the data arrives. */
export function PageLoading({ label, tiles = 4 }: { label: string; tiles?: number }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-7xl animate-pulse flex-col gap-6">
      <span className="sr-only">{label}…</span>
      <div>
        <div className="h-7 w-44 rounded-lg bg-(--card-raised)" />
        <div className="mt-2.5 h-4 w-80 max-w-full rounded-md bg-(--card)" />
      </div>
      <div className={`grid grid-cols-2 gap-4 ${tiles === 5 ? 'lg:grid-cols-5' : tiles === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className={`h-24 ${BLOCK}`} />
        ))}
      </div>
      <div className={`h-72 ${BLOCK}`} />
    </div>
  )
}

/** A page that couldn't load: what failed, why, and a button to try again. */
export function PageError({ what, message, onRetry }: { what: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">
      <span className="min-w-0 wrap-break-word">
        Couldn’t load {what}: {message}
      </span>
      {onRetry && (
        <Button size="sm" icon={<RotateCw size={14} />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
