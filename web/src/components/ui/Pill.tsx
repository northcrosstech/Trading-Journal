import type { ReactNode } from 'react'

export type PillTone = 'neutral' | 'blue' | 'green' | 'red' | 'amber' | 'teal' | 'violet' | 'sky'

const TONE: Record<PillTone, string> = {
  neutral: 'bg-neutral-800 text-neutral-300 ring-neutral-700',
  blue: 'bg-blue-500/12 text-blue-300 ring-blue-500/25',
  sky: 'bg-sky-500/12 text-sky-300 ring-sky-500/25',
  green: 'bg-emerald-500/12 text-emerald-300 ring-emerald-500/25',
  red: 'bg-red-500/12 text-red-300 ring-red-500/25',
  amber: 'bg-amber-500/12 text-amber-300 ring-amber-500/25',
  teal: 'bg-teal-500/12 text-teal-300 ring-teal-500/25',
  violet: 'bg-violet-500/12 text-violet-300 ring-violet-500/25',
}

/** Small status label (Open, LEAPS, Hedge, To review…). */
export function Pill({ tone = 'neutral', children, title }: { tone?: PillTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  )
}
