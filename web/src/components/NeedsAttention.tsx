import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight, Clock, ShieldAlert } from 'lucide-react'
import type { AttentionLink } from '../lib/attention'
import { Card } from './ui/Card'

const ICON: Record<AttentionLink['kind'], typeof ShieldAlert> = { health: ShieldAlert, expiry: CalendarClock, price: Clock }

/** The short list of things waiting on you, each a link to where it is fixed. Renders nothing
 * when the list is empty. */
export function NeedsAttention({ items }: { items: AttentionLink[] }) {
  if (items.length === 0) return null
  return (
    <Card title="Needs attention" flush className="overflow-hidden">
      <ul className="divide-y divide-(--border) border-t border-(--border)">
        {items.map((item) => {
          const Icon = ICON[item.kind]
          return (
            <li key={item.key}>
              <Link to={item.to} className="group flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-(--card-raised)">
                <span className="shrink-0 rounded-lg bg-amber-500/12 p-1.5 text-amber-300">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-neutral-100">{item.text}</span>
                  {item.detail && <span className="block text-xs text-neutral-500">{item.detail}</span>}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-(--accent-text)">
                  <span className="hidden sm:inline">{item.action}</span>
                  <ChevronRight size={14} className="transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
