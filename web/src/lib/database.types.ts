// Hand-written to match supabase/migrations/*.sql exactly (no linked Supabase CLI in
// this environment to auto-generate). Keep in sync if the schema changes.

export type AccountRow = {
  id: string
  user_id: string
  broker: 'webull' | 'schwab' | 'manual' | 'robinhood'
  label: string
  account_type: 'live' | 'paper'
  sync_mode: 'auto' | 'manual'
  enabled: boolean
  archived: boolean
  credential_ref: string | null
  default_asset_type: 'stock' | 'option'
  per_contract_fee: number
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
  import_key: string | null
  manually_closed: boolean
  notes: string | null
  thesis_note: string | null
  reflection_note: string | null
  screenshot_url: string | null
  /** Whose idea the trade was; null = not reviewed yet. */
  trade_origin: TradeOrigin | null
  mistakes: string[]
  strengths: string[]
  stop_price: number | null
  target_price: number | null
  alt_exit_price: number | null
  reviewed_at: string | null
  first_in_at: string | null
  last_out_at: string | null
  created_at: string
}

export type EmotionRow = {
  id: string
  user_id: string
  phase: 'before' | 'during' | 'after'
  name: string
  sort_order: number
  archived: boolean
  created_at: string
}

export type TradeEmotionRow = {
  trade_id: string
  emotion_id: string
  phase: 'before' | 'during' | 'after'
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
  plan_notes: string | null // the watchlist + triggers
  market_read: string | null
  focus: string | null
  created_at: string
  updated_at: string
}

export type DailyPlanPlaybookRow = {
  daily_plan_id: string
  playbook_id: string
}

export type TradeOrigin = 'planned' | 'unplanned' | 'followed'

export type TargetSettingsRow = {
  id: string
  user_id: string
  profit_target_value: number | null
  loss_limit_value: number | null
  // Scaffolded for a future percent-of-capital mode -- unused by any current UI or
  // computation. See migration 20260709010000_target_settings.sql. TODO(percent-mode).
  profit_target_pct: number | null
  loss_limit_pct: number | null
  /** Absent until migration 20261017010000_review_checklist is applied; null = default list.
   * Read via normalizeChecklist(). */
  review_checklist?: unknown
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

export type NetworthCategory =
  | 'home'
  | 'cash'
  | 'emergency_fund'
  | '401k'
  | 'traditional_ira'
  | 'roth_ira'
  | 'brokerage'
  | 'auto'
  | 'misc_asset'
  | 'mortgage'
  | 'auto_loan'
  | 'credit_card'
  | 'debt'
  | 'other_debt'

export type NetworthAccountRow = {
  id: string
  user_id: string
  name: string
  category: NetworthCategory
  opened_month: string // yyyy-mm-01
  closed_month: string | null // yyyy-mm-01; the account is gone from this month on
  sort_order: number
  /** Installment details (debts only). Absent until migration 20261023020000_installments. */
  payment_amount?: number | null
  payment_day?: number | null // 1-31
  interest_rate?: number | null // APR, percent
  created_at: string
}

export type InstallmentPaymentRow = {
  id: string
  user_id: string
  account_id: string
  month: string // yyyy-mm-01
  amount: number
  paid_on: string
  created_at: string
}

export type NetworthBalanceRow = {
  id: string
  user_id: string
  account_id: string
  month: string // yyyy-mm-01
  balance: number // always positive; the category decides asset vs debt
  updated_at: string
}

export type PortfolioKind = 'brokerage' | '401k' | 'traditional_ira' | 'roth_ira'

export type PortfolioRow = {
  id: string
  user_id: string
  name: string
  kind: PortfolioKind
  cash: number
  archived: boolean
  created_at: string
}

export type HoldingRow = {
  id: string
  user_id: string
  portfolio_id: string
  symbol: string
  quantity: number
  avg_cost: number
  manual_price: number | null
  created_at: string
  updated_at: string
}

export type CspStatus = 'open' | 'expired' | 'assigned' | 'closed'

export type CspPositionRow = {
  id: string
  user_id: string
  portfolio_id: string
  symbol: string
  strike: number
  expiration: string
  contracts: number
  premium: number // per share
  opened_on: string
  status: CspStatus
  closed_on: string | null
  close_price: number | null // per share
  mark: number | null // per share
  created_at: string
}

export type PortfolioActivityKind =
  | 'deposit'
  | 'withdrawal'
  | 'dividend'
  | 'buy'
  | 'sell'
  | 'transfer_in'
  | 'transfer_out'
  | 'csp_open'
  | 'csp_close'
  | 'csp_expire'
  | 'csp_assign'
  | 'option_buy'
  | 'option_sell'
  | 'option_write'
  | 'option_buyback'
  | 'option_expire'
  | 'option_exercise'
  | 'option_assign'

export type PortfolioActivityRow = {
  id: string
  user_id: string
  portfolio_id: string
  occurred_on: string
  kind: PortfolioActivityKind
  symbol: string | null
  quantity: number | null
  price: number | null
  cash_change: number
  external_flow: number
  realized_gain: number | null
  csp_id: string | null
  option_id: string | null
  created_at: string
}

export type PriceRow = {
  symbol: string
  price_date: string
  close: number
  fetched_at: string
}

export type PortfolioDailyValueRow = {
  portfolio_id: string
  user_id: string
  value_date: string
  holdings_value: number
  cash: number
  csp_liability: number
  options_value: number
  total_value: number
  cost_basis: number
  net_flow: number
  computed_at: string
}

export type OptionStatus = 'open' | 'closed' | 'expired' | 'exercised' | 'assigned'

/** Long calls/puts (bought) and covered calls (sold). Cash-secured puts are CspPositionRow. */
export type OptionPositionRow = {
  id: string
  user_id: string
  portfolio_id: string
  symbol: string
  option_type: 'call' | 'put'
  side: 'long' | 'short'
  strike: number
  expiration: string
  contracts: number
  open_price: number // per share: paid (long) or received (short)
  opened_on: string
  status: OptionStatus
  closed_on: string | null
  close_price: number | null
  mark: number | null
  is_hedge: boolean
  created_at: string
}

export type DividendFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export type DividendInfoRow = {
  user_id: string
  symbol: string
  annual_per_share: number
  frequency: DividendFrequency
  pay_month: number | null // 1-12; null for monthly payers
  updated_at: string
}

function table<Row extends Record<string, unknown>>() {
  return {} as { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] }
}

export type Database = {
  public: {
    Tables: {
      accounts: ReturnType<typeof table<AccountRow>>
      trades: ReturnType<typeof table<TradeRow>>
      emotions: ReturnType<typeof table<EmotionRow>>
      trade_emotions: ReturnType<typeof table<TradeEmotionRow>>
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
      networth_accounts: ReturnType<typeof table<NetworthAccountRow>>
      networth_balances: ReturnType<typeof table<NetworthBalanceRow>>
      installment_payments: ReturnType<typeof table<InstallmentPaymentRow>>
      portfolios: ReturnType<typeof table<PortfolioRow>>
      holdings: ReturnType<typeof table<HoldingRow>>
      csp_positions: ReturnType<typeof table<CspPositionRow>>
      portfolio_activity: ReturnType<typeof table<PortfolioActivityRow>>
      prices: ReturnType<typeof table<PriceRow>>
      portfolio_daily_values: ReturnType<typeof table<PortfolioDailyValueRow>>
      dividend_info: ReturnType<typeof table<DividendInfoRow>>
      option_positions: ReturnType<typeof table<OptionPositionRow>>
    }
    Views: Record<string, never>
    Functions: {
      portfolio_buy: {
        Args: { p_portfolio: string; p_symbol: string; p_quantity: number; p_price: number; p_from_cash?: boolean; p_on?: string }
        Returns: undefined
      }
      portfolio_sell: {
        Args: { p_portfolio: string; p_symbol: string; p_quantity: number; p_price: number; p_to_cash?: boolean; p_on?: string }
        Returns: undefined
      }
      portfolio_transfer: {
        Args: { p_from: string; p_symbol: string; p_quantity: number; p_to?: string | null; p_on?: string }
        Returns: undefined
      }
      portfolio_cash: {
        Args: { p_portfolio: string; p_kind: 'deposit' | 'withdrawal' | 'dividend'; p_amount: number; p_symbol?: string | null; p_on?: string }
        Returns: undefined
      }
      csp_open: {
        Args: {
          p_portfolio: string
          p_symbol: string
          p_strike: number
          p_expiration: string
          p_contracts: number
          p_premium: number
          p_on?: string
        }
        Returns: string
      }
      option_open: {
        Args: {
          p_portfolio: string
          p_symbol: string
          p_option_type: 'call' | 'put'
          p_side: 'long' | 'short'
          p_strike: number
          p_expiration: string
          p_contracts: number
          p_price: number
          p_is_hedge?: boolean
          p_on?: string
        }
        Returns: string
      }
      option_close: {
        Args: { p_option: string; p_outcome: 'closed' | 'expired' | 'exercised' | 'assigned'; p_price?: number | null; p_on?: string }
        Returns: undefined
      }
      csp_resolve: {
        Args: { p_csp: string; p_outcome: 'expired' | 'closed' | 'assigned'; p_price?: number | null; p_on?: string }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Account = AccountRow
export type Trade = TradeRow
export type Emotion = EmotionRow
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
export type NetworthAccount = NetworthAccountRow
export type NetworthBalance = NetworthBalanceRow
export type InstallmentPayment = InstallmentPaymentRow
export type Portfolio = PortfolioRow
export type Holding = HoldingRow
export type CspPosition = CspPositionRow
export type PortfolioActivity = PortfolioActivityRow
export type PortfolioDailyValue = PortfolioDailyValueRow
export type DividendInfo = DividendInfoRow
export type OptionPosition = OptionPositionRow

export type TradeWithDetails = Trade & {
  options_detail: OptionsDetail | null
  executions: Execution[]
  // 1:1 (trade_playbooks.trade_id is its own primary key), same shape as
  // options_detail -- null until a playbook is linked.
  trade_playbooks: { playbook_id: string; playbooks: Playbook | null } | null
}

export type DailyPlanWithPlaybooks = DailyPlan & {
  daily_plan_playbooks: { playbook_id: string; playbooks: Playbook | null }[]
}
