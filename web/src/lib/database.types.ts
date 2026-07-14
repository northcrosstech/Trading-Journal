// Hand-written to match supabase/migrations/*.sql exactly (no linked Supabase CLI in
// this environment to auto-generate). Keep in sync if the schema changes.

export type AccountRow = {
  id: string
  user_id: string
  broker: 'webull' | 'schwab' | 'manual'
  label: string
  account_type: 'live' | 'paper'
  sync_mode: 'auto' | 'manual'
  enabled: boolean
  archived: boolean
  credential_ref: string | null
  created_at: string
}

export type TradeRow = {
  id: string
  user_id: string
  account_id: string | null
  symbol: string
  asset_type: string
  side: 'long' | 'short'
  status: 'OPEN' | 'CLOSED'
  avg_entry: number | null
  avg_exit: number | null
  hold_seconds: number | null
  total_contracts: number | null
  realized_pnl_gross: number | null
  realized_pnl_net: number | null
  estimated_fee: number
  actual_fee: number | null
  fee_source: 'estimated' | 'actual'
  trade_key: string | null
  notes: string | null
  screenshot_url: string | null
  first_in_at: string | null
  last_out_at: string | null
  created_at: string
}

export type ExecutionRow = {
  id: string
  user_id: string
  trade_id: string
  client_order_id: string
  filled_at: string
  action: 'entry' | 'add' | 'trim' | 'exit'
  price: number
  quantity: number
  side: 'buy' | 'sell'
  estimated_fee: number
  actual_fee: number | null
  created_at: string
}

export type OptionsDetailRow = {
  trade_id: string
  option_type: 'call' | 'put'
  strike: number
  expiration: string
  premium: number | null
  iv_at_entry: number | null
  delta_at_entry: number | null
  theta_at_entry: number | null
  assignment_risk: boolean
  assigned: boolean
}

export type PlaybookRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  color: string
  icon: string | null
  market_conditions: string | null
  example_chart_url: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export type PlaybookRuleGroupRow = {
  id: string
  playbook_id: string
  name: string
  sort_order: number
  created_at: string
}

export type PlaybookRuleRow = {
  id: string
  group_id: string
  text: string
  sort_order: number
  created_at: string
}

export type TradePlaybookRow = {
  trade_id: string
  playbook_id: string
}

export type TradeRuleCheckRow = {
  trade_id: string
  rule_id: string
  status: 'followed' | 'broken' | 'na'
}

export type DailyRuleRow = {
  id: string
  user_id: string
  text: string
  sort_order: number
  archived: boolean
  created_at: string
}

export type DailyRuleCheckRow = {
  user_id: string
  check_date: string
  rule_id: string
  checked: boolean
}

export type MissedTradeRow = {
  id: string
  user_id: string
  playbook_id: string
  missed_date: string
  symbol: string
  notes: string | null
  est_pnl_missed: number | null
  screenshot_url: string | null
  created_at: string
}

export type DailyJournalRow = {
  id: string
  user_id: string
  entry_date: string
  notes: string | null
  mood_rating: number | null
  created_at: string
}

export type DailyPlanRow = {
  id: string
  user_id: string
  plan_date: string
  planned_max_trades: number | null
  planned_max_loss: number | null
  plan_notes: string | null
  created_at: string
  updated_at: string
}

export type DailyPlanPlaybookRow = {
  daily_plan_id: string
  playbook_id: string
}

export type TargetSettingsRow = {
  id: string
  user_id: string
  profit_target_value: number | null
  loss_limit_value: number | null
  // Scaffolded for a future percent-of-capital mode -- unused by any current UI or
  // computation. See migration 20260709010000_target_settings.sql. TODO(percent-mode).
  profit_target_pct: number | null
  loss_limit_pct: number | null
  created_at: string
  updated_at: string
}

export type SyncLogRow = {
  id: string
  user_id: string
  ran_at: string
  status: 'success' | 'error'
  message: string | null
  trades_ingested: number | null
  orders_pulled: number | null
  warnings_count: number | null
}

function table<Row extends Record<string, unknown>>() {
  return {} as { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] }
}

export type Database = {
  public: {
    Tables: {
      accounts: ReturnType<typeof table<AccountRow>>
      trades: ReturnType<typeof table<TradeRow>>
      executions: ReturnType<typeof table<ExecutionRow>>
      options_detail: ReturnType<typeof table<OptionsDetailRow>>
      playbooks: ReturnType<typeof table<PlaybookRow>>
      playbook_rule_groups: ReturnType<typeof table<PlaybookRuleGroupRow>>
      playbook_rules: ReturnType<typeof table<PlaybookRuleRow>>
      trade_playbooks: ReturnType<typeof table<TradePlaybookRow>>
      trade_rule_checks: ReturnType<typeof table<TradeRuleCheckRow>>
      daily_rules: ReturnType<typeof table<DailyRuleRow>>
      daily_rule_checks: ReturnType<typeof table<DailyRuleCheckRow>>
      missed_trades: ReturnType<typeof table<MissedTradeRow>>
      daily_journal: ReturnType<typeof table<DailyJournalRow>>
      sync_log: ReturnType<typeof table<SyncLogRow>>
      target_settings: ReturnType<typeof table<TargetSettingsRow>>
      daily_plans: ReturnType<typeof table<DailyPlanRow>>
      daily_plan_playbooks: ReturnType<typeof table<DailyPlanPlaybookRow>>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Account = AccountRow
export type Trade = TradeRow
export type Execution = ExecutionRow
export type OptionsDetail = OptionsDetailRow
export type Playbook = PlaybookRow
export type PlaybookRuleGroup = PlaybookRuleGroupRow
export type PlaybookRule = PlaybookRuleRow
export type DailyRule = DailyRuleRow
export type MissedTrade = MissedTradeRow
export type DailyJournal = DailyJournalRow
export type TargetSettings = TargetSettingsRow
export type SyncLog = SyncLogRow
export type DailyPlan = DailyPlanRow

/** A playbook with its rule groups, each with their rules, ordered -- the full
 * "profile page" shape used by the playbook detail/edit view. */
export type PlaybookWithRules = Playbook & {
  playbook_rule_groups: (PlaybookRuleGroup & { playbook_rules: PlaybookRule[] })[]
}

export type TradeWithDetails = Trade & {
  options_detail: OptionsDetail | null
  executions: Execution[]
  // 1:1 (trade_playbooks.trade_id is its own primary key), same shape as
  // options_detail -- null until a playbook is linked.
  trade_playbooks: { playbook_id: string; playbooks: Playbook | null } | null
  trade_rule_checks: { rule_id: string; status: TradeRuleCheckRow['status']; playbook_rules: PlaybookRule | null }[]
}

/** Leaner than TradeWithDetails -- just the playbook link, for pages (like the
 * Dashboard) that need "which playbook was this trade" without the full executions/
 * options_detail/trade_rule_checks joins. */
export type TradeWithPlaybook = Trade & {
  trade_playbooks: { playbook_id: string; playbooks: Playbook | null } | null
}

export type DailyPlanWithPlaybooks = DailyPlan & {
  daily_plan_playbooks: { playbook_id: string; playbooks: Playbook | null }[]
}
