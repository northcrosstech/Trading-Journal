type StatCardProps = {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'critical'
  sub?: string
}

const toneClass: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'text-neutral-100',
  good: 'text-(--status-good)',
  critical: 'text-(--status-critical)',
}

export function StatCard({ label, value, tone = 'neutral', sub }: StatCardProps) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-neutral-500">{sub}</div>}
    </div>
  )
}
