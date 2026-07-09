import type { PlaybookWithRules, TradeWithDetails } from '../lib/database.types'

type Status = 'followed' | 'broken' | 'na'

const STATUS_OPTIONS: { value: Status; label: string; activeClass: string }[] = [
  { value: 'na', label: 'N/A', activeClass: 'bg-neutral-700 text-neutral-200' },
  { value: 'followed', label: 'Followed', activeClass: 'bg-(--status-good)/25 text-(--status-good)' },
  { value: 'broken', label: 'Broken', activeClass: 'bg-(--status-critical)/25 text-(--status-critical)' },
]

function RuleRow({ text, status, onChange }: { text: string; status: Status; onChange: (status: Status) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-neutral-300">{text}</span>
      <div className="flex shrink-0 overflow-hidden rounded-md border border-neutral-700 text-xs">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2 py-1 transition ${status === opt.value ? opt.activeClass : 'bg-neutral-950 text-neutral-500 hover:bg-neutral-800'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

type Props = {
  playbook: PlaybookWithRules | null // the TRADE's linked playbook, with its rule groups -- null if none linked
  tradeRuleChecks: TradeWithDetails['trade_rule_checks']
  onSetStatus: (ruleId: string, status: Status) => void
}

/** Three-state checklist against the trade's LINKED playbook's rules, grouped the
 * same way the playbook itself is (Entry Criteria, Exit Rules, ...). Replaces the old
 * flat global-rules checklist -- rules only show up here once a playbook is linked. */
export function PlaybookRuleChecklist({ playbook, tradeRuleChecks, onSetStatus }: Props) {
  if (!playbook) {
    return <p className="text-sm text-neutral-500">Link a playbook above to check off its rules.</p>
  }

  const groups = playbook.playbook_rule_groups.filter((g) => g.playbook_rules.length > 0)
  if (groups.length === 0) {
    return <p className="text-sm text-neutral-500">This playbook has no rules yet -- add some from its page.</p>
  }

  const statusFor = (ruleId: string): Status => tradeRuleChecks.find((tr) => tr.rule_id === ruleId)?.status ?? 'na'

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{group.name}</div>
          <div className="flex flex-col divide-y divide-neutral-800/60">
            {group.playbook_rules.map((rule) => (
              <RuleRow key={rule.id} text={rule.text} status={statusFor(rule.id)} onChange={(s) => onSetStatus(rule.id, s)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
