import { Link } from 'react-router-dom'
import type { RuleStat } from '../lib/metrics'
import { currency } from '../lib/format'

/** Dashboard headline for feature 2 (rule-violation cost accounting): surfaces the
 * single rule that has cost the most money when broken, reusing computeRuleStats'
 * existing followed-vs-broken rollup (already shown in full on the Rules page) --
 * this card just picks out the worst one and puts a dollar figure on it. */
export function MostExpensiveRuleCard({ rule }: { rule: RuleStat | null }) {
  if (!rule) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-500">
        No rule violations tracked yet -- mark rules followed/broken on your trades to see the discipline cost here.{' '}
        <Link to="/rules" className="text-blue-400 hover:underline">
          Manage rules
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-300">Most Expensive Broken Rule</h2>
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-neutral-100">{rule.rule.name}</span>
        <span className="text-xl font-semibold tabular-nums text-(--status-critical)">{currency(rule.pnlBroken)}</span>
        <span className="text-xs text-neutral-500">
          across {rule.brokenCount} trade{rule.brokenCount === 1 ? '' : 's'}
        </span>
      </div>
      {rule.followedCount > 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          vs.{' '}
          <span className={rule.pnlFollowed >= 0 ? 'text-(--status-good)' : 'text-(--status-critical)'}>
            {currency(rule.pnlFollowed)}
          </span>{' '}
          across {rule.followedCount} trade{rule.followedCount === 1 ? '' : 's'} when followed
        </p>
      )}
    </div>
  )
}
