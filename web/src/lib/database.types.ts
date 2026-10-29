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
  | 'margin' // display only: a portfolio's margin loan (negative cash); never stored on an account
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
  /** Part of payment_amount held in escrow (property tax + insurance). Absent until
   * migration 20261024020000_installment_escrow. */
  escrow_amount?: number | null
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

export type WealthSettingsRow = {
  user_id: string
  close_from_month: string | null // yyyy-mm-01
  /** Highest growth % fair value uses (default 30). Absent until migration 20261031010000_research. */
  growth_cap?: number
  /** Your own economy score (0-30) instead of the automatic one. */
  economy_override?: number | null
  /** How far off a target before a warning, in percentage points (default 5). */
  allocation_tolerance?: number
  updated_at: string
}

/** Per-ticker fundamentals from Finnhub, shared like prices; written by the worker. */
export type FundamentalsRow = {
  symbol: string
  name: string | null
  eps_ttm: number | null
  eps_growth_5y: number | null
  eps_growth_3y: number | null
  gross_margin: number | null
  roe: number | null
  net_margin: number | null
  debt_to_equity: number | null
  current_ratio: number | null
  next_earnings_date: string | null
  next_earnings_hour: string | null
  next_eps_estimate: number | null
  /** Analysts' expected EPS growth % per year, forecast_from_year -> forecast_to_year (FMP).
   * Optional until the growth_forecast migration has run. */
  eps_growth_forecast?: number | null
  forecast_from_year?: number | null
  forecast_to_year?: number | null
  forecast_analysts?: number | null
  /** P/E, last 12 months, and the currency the company reports in (TSM: TWD). Optional
   * until the foreign_eps migration has run. */
  pe_ttm?: number | null
  reporting_currency?: string | null
  /** Finnhub's type (Common Stock, ETP, ADR, REIT...) and name, for stock / ETF / bond. */
  security_type?: string | null
  description?: string | null
  updated_at: string
}

/** Mix target for one pool: 'brokerage' or a retirement portfolio's id. Percentages add to 100. */
export type AllocationTargetRow = { user_id: string; scope: string; etf: number; stock: number; bond: number; option: number; cash: number; updated_at: string }
/** A portfolio's target % for one ticker (its position plan). */
export type PositionTargetRow = { user_id: string; portfolio_id: string; symbol: string; target_pct: number; updated_at: string }
/** Why you own a ticker, and when to look at that again. */
export type TickerThesisRow = { user_id: string; symbol: string; thesis: string; review_on: string | null; updated_at: string }
export type TickerTypeRow = { user_id: string; symbol: string; asset_type: 'stock' | 'etf' | 'bond'; updated_at: string }

/** FRED indicators: aaa_yield, treasury_10y, unemployment_rate, unemployment_12m_low. */
export type MacroIndicatorRow = { key: string; value: number; as_of: string; updated_at: string }

export type ResearchWatchlistRow = { id: string; user_id: string; symbol: string; created_at: string }

export type ResearchOverrideField = 'eps' | 'growth' | 'valuation' | 'growth_score' | 'moat' | 'execution'
export type ResearchOverrideRow = {
  user_id: string
  symbol: string
  field: ResearchOverrideField
  value: number
  /** The automatic number when you made the edit, to tell you when it changes. Null = edited
   * before tracking existed. Optional until the override_tracking migration has run. */
  auto_value?: number | null
  /** EPS edits end on this date (a few days after the next earnings report). */
  expires_on?: string | null
  updated_at: string
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
  /** Brokerage only: % of all brokerage money. Absent until migration 20261101010000_allocation. */
  target_pct?: number | null
  /** Plan notes. Absent until migration 20261107010000_position_plans. */
  notes?: string | null
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
  | 'cash_adjust' // cash balance set to match the broker; price = the balance it was set to
  | 'split' // stock split; price = ratio (new shares per old), quantity = shares after
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
  /** Set when the entry was undone; it stays as history. */
  voided_at: string | null
  /** An edited (voided) entry points at the entry that replaced it. */
  replaced_by: string | null
  /** The broker's fee on a buy or sell. `price` is after it (cost basis / net proceeds per
   * share); fill price = price - fee / quantity (buy) or + fee / quantity (sell). Optional
   * until the quick_trades migration has run. */
  fee?: number
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
      wealth_settings: ReturnType<typeof table<WealthSettingsRow>>
      fundamentals: ReturnType<typeof table<FundamentalsRow>>
      macro_indicators: ReturnType<typeof table<MacroIndicatorRow>>
      research_watchlist: ReturnType<typeof table<ResearchWatchlistRow>>
      research_overrides: ReturnType<typeof table<ResearchOverrideRow>>
      allocation_targets: ReturnType<typeof table<AllocationTargetRow>>
      ticker_types: ReturnType<typeof table<TickerTypeRow>>
      position_targets: ReturnType<typeof table<PositionTargetRow>>
      ticker_theses: ReturnType<typeof table<TickerThesisRow>>
      portfolios: ReturnType<typeof table<PortfolioRow>>
      holdings: ReturnType<typeof table<HoldingRow>>
      csp_positions: ReturnType<typeof table<CspPositionRow>>
      portfolio_activity: ReturnType<typeof table<PortfolioActivityRow>>
      prices: ReturnType<typeof table<PriceRow>>
      portfolio_daily_values: ReturnType<typeof table<PortfolioDailyValueRow>>
      dividend_info: ReturnType<typeof table<DividendInfoRow>>
      option_positions: ReturnType<typeof table<OptionPositionRow>>
    }
    Views: {
      audit_summary: { Row: AuditProblem; Relationships: [] }
    }
    Functions: {
      portfolio_buy: {
        Args: { p_portfolio: string; p_symbol: string; p_quantity: number; p_price: number; p_from_cash?: boolean; p_on?: string; p_fee?: number }
        Returns: undefined
      }
      portfolio_sell: {
        Args: { p_portfolio: string; p_symbol: string; p_quantity: number; p_price: number; p_to_cash?: boolean; p_on?: string; p_fee?: number }
        Returns: undefined
      }
      portfolio_transfer: {
        Args: { p_from: string; p_symbol: string; p_quantity: number; p_to?: string | null; p_on?: string }
        Returns: undefined
      }
      portfolio_split: {
        Args: { p_portfolio: string; p_symbol: string; p_ratio: number; p_on?: string }
        Returns: undefined
      }
      portfolio_set_cash: {
        Args: { p_portfolio: string; p_balance: number; p_counts_in_return?: boolean; p_on?: string }
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
      portfolio_entry_delete: {
        Args: { p_activity: string }
        Returns: undefined
      }
      portfolio_entry_edit: {
        Args: { p_activity: string; p_symbol: string | null; p_quantity: number | null; p_price: number | null; p_amount: number | null; p_on: string; p_fee?: number }
        Returns: undefined
      }
      option_edit: {
        Args: { p_option: string; p_symbol: string; p_strike: number; p_expiration: string; p_contracts: number; p_price: number; p_is_hedge: boolean; p_on: string }
        Returns: string
      }
      csp_edit: {
        Args: { p_csp: string; p_symbol: string; p_strike: number; p_expiration: string; p_contracts: number; p_premium: number; p_on: string }
        Returns: string
      }
      set_position_plan: {
        Args: { p_portfolio: string; p_targets: { symbol: string; pct: number }[] }
        Returns: number
      }
      portfolio_trades: {
        Args: { p_portfolio: string; p_trades: { symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; fee: number; on: string }[] }
        Returns: number
      }
      position_undo_last: {
        Args: { p_option?: string | null; p_csp?: string | null }
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

/** One row of the audit_summary view: something stored that doesn't match Activity. */
export type AuditProblem = {
  user_id: string
  portfolio_id: string
  portfolio: string
  check_name: 'shares' | 'avg_cost' | 'cash' | 'position' | 'covered_call' | 'price' | 'daily_value'
  item: string | null
  detail: string
  fix: string
}
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
