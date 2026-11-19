import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** One piece of view state (a tab, a month, a filter) kept in the page link as ?key=value,
 * so Back, refresh and links from other pages land on the same view. The default value is
 * left out of the link. Pass `allowed` to ignore anything else typed into the address bar. */
export function useUrlState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (v: T | null) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback

  const set = useCallback(
    (v: T | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v === null || v === fallback) next.delete(key)
          else next.set(key, v)
          return next
        },
        { replace: true },
      )
    },
    [key, fallback, setParams],
  )

  return [value, set]
}
