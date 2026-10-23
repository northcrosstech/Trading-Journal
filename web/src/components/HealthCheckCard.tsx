import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { AuditProblem } from '../lib/database.types'
import { fetchAuditProblems } from '../lib/wealthQueries'

const CHECK_LABEL: Record<AuditProblem['check_name'], string> = {
  shares: 'Shares',
  avg_cost: 'Average cost',
  cash: 'Cash',
  position: 'Option / put',
  covered_call: 'Covered call',
  price: 'Price',
  daily_value: 'Daily value',
}

/** Does every stored number match the Activity history? One read of the audit_summary view
 * when the page opens: a quiet green line when everything reconciles, else each problem with
 * what to do. Hidden until the audit migration has been run. */
export function HealthCheckCard() {
  const [problems, setProblems] = useState<AuditProblem[] | null | undefined>(undefined)

  useEffect(() => {
    fetchAuditProblems()
      .then(setProblems)
      .catch(() => setProblems(null))
  }, [])

  if (problems === undefined || problems === null) return null

  if (problems.length === 0)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-200">
        <ShieldCheck size={16} className="shrink-0 text-emerald-400" />
        Everything reconciles — shares, average cost, cash and options all match Activity.
      </div>
    )

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
        <ShieldAlert size={16} className="shrink-0 text-amber-300" />
        Health check · {problems.length} {problems.length === 1 ? 'issue' : 'issues'}
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-amber-500/10 text-sm">
        {problems.map((p, i) => (
          <li key={`${p.portfolio_id}-${p.check_name}-${p.item ?? ''}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
            <span className="min-w-0">
              <Link to={`/portfolios/${p.portfolio_id}`} className="font-medium text-amber-100 hover:underline">
                {p.portfolio}
              </Link>
              <span className="text-amber-200/70">
                {' '}
                · {CHECK_LABEL[p.check_name] ?? p.check_name}
                {p.item && ` · ${p.item}`}
              </span>
              <span className="block text-amber-200/90">{p.detail}</span>
            </span>
            <span className="text-xs text-amber-200/60">{p.fix}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
