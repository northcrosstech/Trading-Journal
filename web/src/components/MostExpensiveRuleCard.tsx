import type { RuleCheckStat } from '../lib/metrics'
import { currency } from '../lib/format'

/** Cross-playbook headline: the single rule (from any playbook) that has cost the
 * most money when broken. `stat` is null once there's nothing broken yet to report. */
export function MostExpensiveRuleCard({ stat }: { stat: RuleCheckStat | null }) {
  if (!stat) return null

  return (
    <div className="rounded-xl border border-(--status-critical)/30 bg-(--status-critical)/5 p-4">
      <h2 className="mb-1 text-sm font-medium text-neutral-300">Most Expensive Broken Rule</h2>
      <p className="text-sm text-neutral-200">{stat.rule.text}</p>
      <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
        <span className="font-medium tabular-nums text-(--status-critical)">
          {currency(stat.pnlBroken)} across {stat.brokenCount} trade{stat.brokenCount === 1 ? '' : 's'}
        </span>
        {stat.followRate !== null && <span>{(stat.followRate * 100).toFixed(0)}% followed overall</span>}
      </div>
    </div>
  )
}
