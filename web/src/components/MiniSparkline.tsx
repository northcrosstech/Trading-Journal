/** Tiny inline SVG equity trajectory for a daily feed card. Hand-rolled rather than a
 * recharts instance -- at this size (a few dozen px tall) a chart library's axes/tooltip
 * machinery is dead weight; a bare polyline is lighter and renders predictably small.
 * Uses the same sequential blue as the full-size EquityCurveChart (--series-1) since
 * it's the same kind of signal (single-series magnitude over sequence) -- the day's
 * net P&L number carries the polarity color, so the line doesn't need to repeat it. */
export function MiniSparkline({ points, width = 96, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-[10px] text-neutral-700">—</div>
  }

  const min = Math.min(0, ...points)
  const max = Math.max(0, ...points)
  const range = max - min || 1
  const pad = 2

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return `${x},${y}`
  })

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={coords.join(' ')} fill="none" stroke="var(--series-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
