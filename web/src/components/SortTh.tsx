import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SortState } from '../lib/useSort'

/** A table header you can click to sort by. Keeps the header's own classes (padding, alignment);
 * right-aligned headers put the arrow on the left so the label stays over the numbers. */
export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  className = '',
  title,
  children,
}: {
  k: K
  sort: SortState<K>
  onSort: (key: K) => void
  className?: string
  title?: string
  children: ReactNode
}) {
  const active = sort?.key === k
  const right = className.includes('text-right')
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  const icon = <Icon size={11} className={`shrink-0 ${active ? 'text-(--accent)' : 'opacity-0 transition group-hover/sort:opacity-60'}`} aria-hidden />
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(k)}
        title={title ? `${title} · click to sort` : 'Click to sort'}
        className={`group/sort inline-flex items-center gap-1 [text-transform:inherit] transition hover:text-neutral-300 ${active ? 'text-neutral-200' : ''}`}
      >
        {right && icon}
        {children}
        {!right && icon}
      </button>
    </th>
  )
}
