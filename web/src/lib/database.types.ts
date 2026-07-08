// Hand-written to match supabase/migrations/*.sql exactly (no linked Supabase CLI in
// this environment to auto-generate). Keep in sync if the schema changes.

export type TradeRow = {
  id: string
  user_id: string
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

export type StrategyRow = {
  id: string
  user_id: string
  name: string
  color: string
  archived: boolean
  created_at: string
}

export type TradeStrategyRow = {
  trade_id: string
  strategy_id: string
}

export type RuleRow = {
  id: string
  user_id: string
  name: string
  type: 'entry' | 'exit'
  archived: boolean
  created_at: string
}

export type TradeRuleRow = {
  trade_id: string
  rule_id: string
  status: 'followed' | 'broken' | 'na'
}

export type DailyJournalRow = {
  id: string
  user_id: string
  entry_date: string
  notes: string | null
  mood_rating: number | null
  created_at: string
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
      trades: ReturnType<typeof table<TradeRow>>
      executions: ReturnType<typeof table<ExecutionRow>>
      options_detail: ReturnType<typeof table<OptionsDetailRow>>
      strategies: ReturnType<typeof table<StrategyRow>>
      trade_strategies: ReturnType<typeof table<TradeStrategyRow>>
      rules: ReturnType<typeof table<RuleRow>>
      trade_rules: ReturnType<typeof table<TradeRuleRow>>
      daily_journal: ReturnType<typeof table<DailyJournalRow>>
      sync_log: ReturnType<typeof table<SyncLogRow>>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Trade = TradeRow
export type Execution = ExecutionRow
export type OptionsDetail = OptionsDetailRow
export type Strategy = StrategyRow
export type Rule = RuleRow
export type DailyJournal = DailyJournalRow

export type TradeWithDetails = Trade & {
  options_detail: OptionsDetail | null
  executions: Execution[]
  trade_strategies: { strategy_id: string; strategies: Strategy | null }[]
  trade_rules: { rule_id: string; status: TradeRuleRow['status']; rules: Rule | null }[]
}
