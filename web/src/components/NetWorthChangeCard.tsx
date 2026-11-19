import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { NetWorthChange } from '../lib/netWorthChange'
import { currency } from '../lib/format'
import { signedCurrency as signed } from '../lib/portfolio'
import { toneClass } from '../lib/ui'
import { Card } from './ui/Card'

const monthName = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long' })
const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`)
const LINK = 'text-(--accent-text) hover:underline'

/** Why net worth changed in one finished month: the change in words, then what it was made of.
 * Says so in words when the month can't be split honestly, and renders nothing when the month
 * has nothing recorded. */
export function NetWorthChangeCard({ change: c, allMonthsTo }: { change: NetWorthChange; allMonthsTo: string }) {
  if (c.state === 'none') return null
  const name = monthName(c.month)
  const allMonths = (
    <Link to={allMonthsTo} className={`inline-flex items-center gap-0.5 text-xs ${LINK}`}>
      See all months
      <ChevronRight size={14} />
    </Link>
  )

  if (c.state === 'first')
    return (
      <Card title="Why your net worth changed">
        <p className="text-sm text-neutral-400">{name} is the first month on record. This fills in once there is a month before it to compare with.</p>
      </Card>
    )

  if (c.state === 'carried')
    return (
      <Card title={`Why your net worth changed in ${name}`} actions={allMonths}>
        <p className="text-sm text-neutral-400">
          Not shown yet: {list(c.carried)} {c.carried.length === 1 ? 'uses a balance' : 'use balances'} carried from an earlier month, so the split would be a guess.{' '}
          <Link to={`/networth?month=${c.fixMonth.slice(0, 7)}`} className={LINK}>
            Enter {monthName(c.fixMonth)} balances
          </Link>
        </p>
      </Card>
    )

  const flat = c.change > -0.005 && c.change < 0.005
  const maxAbs = Math.max(...c.parts.map((p) => Math.abs(p.value)))
  return (
    <Card
      title={
        <span className="text-base">
          Net worth{' '}
          {flat ? (
            'didn’t change'
          ) : (
            <span className={`tabular-nums ${toneClass(c.change)}`}>
              {c.change > 0 ? 'rose' : 'fell'} {currency(Math.abs(c.change))}
            </span>
          )}{' '}
          in {name}
        </span>
      }
      actions={allMonths}
    >
      {c.parts.length === 0 ? (
        <p className="text-sm text-neutral-400">Saving, investing, debt and growth each came to zero for the month.</p>
      ) : (
        <dl className="grid grid-cols-5 gap-x-6">
          {c.parts.map((p) => (
            <div key={p.key} title={p.hint}>
              <dt className="truncate text-xs text-neutral-400">{p.label}</dt>
              <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${toneClass(p.value)}`}>
                {signed(p.value)}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-800">
                  <div className={`h-full rounded-full ${p.value > 0 ? 'bg-(--status-good)' : 'bg-(--status-critical)'}`} style={{ width: `${Math.max(2, (Math.abs(p.value) / maxAbs) * 100)}%` }} />
                </div>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {c.added.length > 0 && c.parts.some((p) => p.key === 'other') && (
        <p className="mt-3 text-xs text-neutral-500">
          Other changes includes the starting value of {list(c.added)}, first recorded in {name}.
        </p>
      )}
    </Card>
  )
}
