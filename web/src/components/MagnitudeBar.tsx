/** Horizontal bar anchored at a zero baseline, diverging green/red by sign -- used
 * across the Stats tables (per-strategy, per-rule, per-bucket net P&L) instead of a
 * pulled-in chart library, since these are single bars in a table row. */
export function MagnitudeBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.min(100, (Math.abs(value) / maxAbs) * 100) : 0
  const color = value >= 0 ? 'var(--status-good)' : 'var(--status-critical)'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}
