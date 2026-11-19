import type { PostgrestError } from '@supabase/supabase-js'

/** The most rows the API returns for one request. */
const PAGE_SIZE = 1000

type Page<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>

/** Every row of a list read, however many there are. `page` builds the query for rows
 * from..to (`.range(from, to)`); it runs for one page after another until a short page comes
 * back. The query must end its ordering on a unique column, or rows that tie could repeat on
 * one page and be missing from the next. Throws the query's error. */
export async function fetchAllRows<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = data ?? []
    for (const row of batch) rows.push(row)
    if (batch.length < PAGE_SIZE) return rows
  }
}
