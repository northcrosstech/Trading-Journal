import { useCallback, useState } from 'react'

export type SortDir = 'asc' | 'desc'
export type SortState<K extends string> = { key: K; dir: SortDir } | null
type Value = number | string | null | undefined

const read = <K extends string>(id: string, keys: readonly K[]): SortState<K> | undefined => {
  try {
    const raw = localStorage.getItem(`sort:${id}`)
    if (raw === null) return undefined
    if (raw === 'default') return null
    const s = JSON.parse(raw) as { key: K; dir: SortDir }
    return keys.includes(s.key) && (s.dir === 'asc' || s.dir === 'desc') ? s : undefined
  } catch {
    return undefined
  }
}

/** Sort `rows` by `state`, using `get` to read each column's value. Empty values (null, '—')
 * always go last whichever way you sort; ties keep their original order. */
export function sortRows<T, K extends string>(rows: T[], state: SortState<K>, get: Record<K, (row: T) => Value>): T[] {
  if (!state) return rows
  const pick = get[state.key]
  const sign = state.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, v: pick(row) }))
    .sort((a, b) => {
      const an = a.v === null || a.v === undefined || (typeof a.v === 'number' && Number.isNaN(a.v))
      const bn = b.v === null || b.v === undefined || (typeof b.v === 'number' && Number.isNaN(b.v))
      if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1
      const c = typeof a.v === 'string' || typeof b.v === 'string' ? String(a.v).localeCompare(String(b.v)) : (a.v as number) - (b.v as number)
      return c === 0 ? a.i - b.i : c * sign
    })
    .map((x) => x.row)
}

/** Click-to-sort state for one table, remembered on this device under `id`. Clicking a column
 * sorts it high→low (low→high / A→Z for keys in `ascFirst`), clicking again flips it, and a
 * third click goes back to the table's own order. */
export function useSort<K extends string>(id: string, keys: readonly K[], ascFirst: readonly K[] = []) {
  const [state, setState] = useState<SortState<K>>(() => read(id, keys) ?? null)
  const toggle = useCallback(
    (key: K) => {
      setState((cur) => {
        const first: SortDir = ascFirst.includes(key) ? 'asc' : 'desc'
        const next: SortState<K> = cur?.key !== key ? { key, dir: first } : cur.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null
        try {
          localStorage.setItem(`sort:${id}`, next ? JSON.stringify(next) : 'default')
        } catch {
          /* private window: just don't remember */
        }
        return next
      })
    },
    [id, ascFirst],
  )
  return { state, toggle }
}
