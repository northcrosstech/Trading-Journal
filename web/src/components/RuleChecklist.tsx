import type { Rule, TradeWithDetails } from '../lib/database.types'

type Status = 'followed' | 'broken' | 'na'

const STATUS_OPTIONS: { value: Status; label: string; activeClass: string }[] = [
  { value: 'na', label: 'N/A', activeClass: 'bg-neutral-700 text-neutral-200' },
  { value: 'followed', label: 'Followed', activeClass: 'bg-(--status-good)/25 text-(--status-good)' },
  { value: 'broken', label: 'Broken', activeClass: 'bg-(--status-critical)/25 text-(--status-critical)' },
]

function RuleRow({
  rule,
  status,
  onChange,
}: {
  rule: Rule
  status: Status
  onChange: (status: Status) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-neutral-300">{rule.name}</span>
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
  rules: Rule[]
  tradeRules: TradeWithDetails['trade_rules']
  onSetStatus: (ruleId: string, status: Status) => void
}

export function RuleChecklist({ rules, tradeRules, onSetStatus }: Props) {
  const activeRules = rules.filter((r) => !r.archived)
  const entryRules = activeRules.filter((r) => r.type === 'entry')
  const exitRules = activeRules.filter((r) => r.type === 'exit')

  const statusFor = (ruleId: string): Status => tradeRules.find((tr) => tr.rule_id === ruleId)?.status ?? 'na'

  if (entryRules.length === 0 && exitRules.length === 0) {
    return <p className="text-sm text-neutral-500">No rules defined yet. Add some in Rules.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {entryRules.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Entry Rules</div>
          <div className="flex flex-col divide-y divide-neutral-800/60">
            {entryRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} status={statusFor(rule.id)} onChange={(s) => onSetStatus(rule.id, s)} />
            ))}
          </div>
        </div>
      )}
      {exitRules.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Exit Rules</div>
          <div className="flex flex-col divide-y divide-neutral-800/60">
            {exitRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} status={statusFor(rule.id)} onChange={(s) => onSetStatus(rule.id, s)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
