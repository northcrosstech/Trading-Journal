import type { TradeOrigin } from './database.types'

export const ORIGINS: { value: TradeOrigin; label: string; key: string }[] = [
  { value: 'planned', label: 'Planned', key: 'P' },
  { value: 'unplanned', label: 'Unplanned', key: 'U' },
  { value: 'followed', label: 'Followed', key: 'F' },
]

/** Text color per origin -- the ticker is tinted with it in trade lists. */
export const ORIGIN_TEXT: Record<TradeOrigin, string> = {
  planned: 'text-emerald-400',
  unplanned: 'text-amber-400',
  followed: 'text-sky-400',
}

export const ORIGIN_LABEL: Record<TradeOrigin, string> = {
  planned: 'Planned',
  unplanned: 'Unplanned',
  followed: 'Followed (someone else’s call)',
}
