/** Curated GitHub-label-style swatch set for user-assigned strategy colors. Freeform
 * hex isn't offered in the picker -- a fixed set keeps every tag legible on the dark
 * surface and keeps the trade log/filters visually consistent no matter how many
 * strategies someone creates. */
export const TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#78716c', // stone
] as const

export function tagChipStyle(hex: string) {
  return {
    backgroundColor: `${hex}26`, // ~15% alpha wash, not a solid block
    color: hex,
    borderColor: `${hex}4d`, // ~30% alpha
  }
}
