/** Categorical slots for the allocation donut -- the validated 8-color palette, dark-mode
 * steps (dataviz skill palette.md), checked against the card surface including the
 * last-to-first pair a donut adds. Order matters: it's what keeps neighbors apart. */
export const SLICE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
/** Neutral roles, outside the categorical slots so they never use one up. */
export const CASH_COLOR = '#8a9aa8'
export const OTHER_COLOR = '#6f6e69'

/** A position gets its own slice at this weight or above. */
export const SLICE_THRESHOLD = 0.05

export type AllocItem = { key: string; label: string; value: number; sub?: string }

export type Slice = {
  key: string
  label: string
  value: number
  weight: number
  color: string
  role: 'position' | 'other' | 'cash'
  members: AllocItem[] // the positions inside "Other"
}

export type Allocation = { total: number; slices: Slice[] }

// Weights compare at 0.1% -- what the legend shows -- so positions that read as equal are equal.
const level = (w: number) => Math.round(w * 1000)

/** Splits holdings into donut slices. Every position at SLICE_THRESHOLD or above gets its own
 * colored slice; the rest are grouped into "Other". Positions at the same weight are always
 * kept together. With more than SLICE_COLORS qualifying, the line moves up to the next
 * weight level -- never between two equal weights -- so every slice keeps a distinct color.
 * Cash is its own neutral slice. */
export function allocationSlices(positions: AllocItem[], cash: number, cashSub?: string, threshold = SLICE_THRESHOLD): Allocation {
  const cashValue = Math.max(0, cash)
  const pos = positions.filter((p) => p.value > 0)
  const total = pos.reduce((s, p) => s + p.value, 0) + cashValue
  if (total <= 0) return { total: 0, slices: [] }

  const ranked = pos.map((p) => ({ ...p, weight: p.value / total })).sort((a, b) => b.value - a.value)
  let sliced = ranked.filter((p) => level(p.weight) >= level(threshold))
  if (sliced.length > SLICE_COLORS.length) {
    const cut = level(sliced[SLICE_COLORS.length].weight)
    sliced = sliced.filter((p) => level(p.weight) > cut)
  }
  const slicedKeys = new Set(sliced.map((p) => p.key))
  const rest = ranked.filter((p) => !slicedKeys.has(p.key))

  const slices: Slice[] = sliced.map((p, i) => ({
    key: p.key,
    label: p.label,
    value: p.value,
    weight: p.weight,
    color: SLICE_COLORS[i],
    role: 'position',
    members: [],
  }))
  if (rest.length > 0) {
    const value = rest.reduce((s, p) => s + p.value, 0)
    slices.push({
      key: 'other',
      label: rest.length === 1 ? rest[0].label : 'Other',
      value,
      weight: value / total,
      color: OTHER_COLOR,
      role: 'other',
      members: rest,
    })
  }
  if (cashValue > 0) {
    slices.push({
      key: 'cash',
      label: 'Cash',
      value: cashValue,
      weight: cashValue / total,
      color: CASH_COLOR,
      role: 'cash',
      members: cashSub ? [{ key: 'cash-sub', label: cashSub, value: cashValue }] : [],
    })
  }
  return { total, slices }
}
