import { useEffect, useState } from 'react'
import type { DailyRule } from '../lib/database.types'
import { fetchDailyRules, fetchDailyRuleChecks, setDailyRuleCheck } from '../lib/queries'

/** Today's discipline checklist -- the daily_rules equivalent of the pre-market
 * plan's numeric limits, but for qualitative rules that can't be auto-derived from
 * trade data. Composes alongside TodayPlanCard rather than duplicating it: that
 * card covers "what did I plan to trade," this one covers "did I stick to my
 * process today." */
export function DailyRulesChecklist({ userId, date }: { userId: string; date: string }) {
  const [rules, setRules] = useState<DailyRule[] | null>(null)
  const [checks, setChecks] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    let cancelled = false
    fetchDailyRules().then((r) => {
      if (!cancelled) setRules(r.filter((rule) => !rule.archived))
    })
    fetchDailyRuleChecks(date).then((c) => {
      if (!cancelled) setChecks(c)
    })
    return () => {
      cancelled = true
    }
  }, [date])

  async function toggle(ruleId: string) {
    const next = !(checks.get(ruleId) ?? false)
    setChecks((prev) => new Map(prev).set(ruleId, next))
    await setDailyRuleCheck(userId, date, ruleId, next)
  }

  if (!rules || rules.length === 0) return null

  const followedCount = rules.filter((r) => checks.get(r.id)).length

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-300">Daily Rules</h2>
        <span className="text-xs text-neutral-500">
          {followedCount}/{rules.length} followed
        </span>
      </div>
      <div className="flex flex-col divide-y divide-neutral-800/60">
        {rules.map((rule) => {
          const checked = checks.get(rule.id) ?? false
          return (
            <label key={rule.id} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(rule.id)}
                className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 accent-blue-600"
              />
              <span className={checked ? 'text-neutral-300' : 'text-neutral-400'}>{rule.text}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
