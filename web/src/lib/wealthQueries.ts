import { supabase } from './supabase'
import type {
  AllocationTargetRow,
  TickerTypeRow,
  FundamentalsRow,
  MacroIndicatorRow,
  ResearchOverrideField,
  ResearchOverrideRow,
  AuditProblem,
  CspPosition,
  InstallmentPayment,
  DividendInfo,
  OptionPosition,
  Holding,
  NetworthAccount,
  NetworthBalance,
  NetworthCategory,
  Portfolio,
  PortfolioActivity,
  PortfolioDailyValue,
  PortfolioKind,
} from './database.types'

// ---------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------

export async function fetchNetworthAccounts(): Promise<NetworthAccount[]> {
  const { data, error } = await supabase.from('networth_accounts').select('*').order('sort_order').order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createNetworthAccount(
  userId: string,
  fields: { name: string; category: NetworthCategory; opened_month: string },
): Promise<NetworthAccount> {
  const { data, error } = await supabase
    .from('networth_accounts')
    .insert({ user_id: userId, ...fields })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateNetworthAccount(
  id: string,
  patch: Partial<Pick<NetworthAccount, 'name' | 'category' | 'opened_month' | 'closed_month' | 'sort_order' | 'payment_amount' | 'payment_day' | 'interest_rate' | 'escrow_amount'>>,
) {
  const { error } = await supabase.from('networth_accounts').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteNetworthAccount(id: string) {
  const { error } = await supabase.from('networth_accounts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchNetworthBalances(): Promise<NetworthBalance[]> {
  const { data, error } = await supabase.from('networth_balances').select('*').order('month')
  if (error) throw error
  return data ?? []
}

/** Saves one month's form: a number upserts that account's balance, null removes it. */
export async function saveMonthBalances(userId: string, month: string, entries: { accountId: string; balance: number | null }[]) {
  const upserts = entries
    .filter((e) => e.balance !== null)
    .map((e) => ({ user_id: userId, account_id: e.accountId, month, balance: e.balance!, updated_at: new Date().toISOString() }))
  const removals = entries.filter((e) => e.balance === null).map((e) => e.accountId)
  if (upserts.length) {
    const { error } = await supabase.from('networth_balances').upsert(upserts, { onConflict: 'account_id,month' })
    if (error) throw error
  }
  if (removals.length) {
    const { error } = await supabase.from('networth_balances').delete().eq('month', month).in('account_id', removals)
    if (error) throw error
  }
}

// ---------------------------------------------------------------------------
// Portfolios
// ---------------------------------------------------------------------------

export async function fetchPortfolios(): Promise<Portfolio[]> {
  const { data, error } = await supabase.from('portfolios').select('*').order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createPortfolio(userId: string, fields: { name: string; kind: PortfolioKind }): Promise<Portfolio> {
  const { data, error } = await supabase
    .from('portfolios')
    .insert({ user_id: userId, ...fields })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updatePortfolio(id: string, patch: Partial<Pick<Portfolio, 'name' | 'kind' | 'archived' | 'target_pct'>>) {
  const { error } = await supabase.from('portfolios').update(patch).eq('id', id)
  if (error) throw error
}

export async function fetchHoldings(portfolioId?: string): Promise<Holding[]> {
  let q = supabase.from('holdings').select('*').order('symbol')
  if (portfolioId) q = q.eq('portfolio_id', portfolioId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/** Direct correction (e.g. after a stock split, or setting a manual price) -- no cash or
 * money-in/out effect. Buying and selling go through portfolioBuy / portfolioSell. */
/** Only the manual price can be set directly; shares and cost change through Activity. */
export async function updateHolding(id: string, patch: Pick<Holding, 'manual_price'>) {
  const { error } = await supabase
    .from('holdings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function fetchCsps(portfolioId?: string): Promise<CspPosition[]> {
  let q = supabase.from('csp_positions').select('*').order('expiration')
  if (portfolioId) q = q.eq('portfolio_id', portfolioId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function setCspMark(id: string, mark: number | null) {
  const { error } = await supabase.from('csp_positions').update({ mark }).eq('id', id)
  if (error) throw error
}

export async function fetchActivity(portfolioId: string): Promise<PortfolioActivity[]> {
  const { data, error } = await supabase
    .from('portfolio_activity')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Problems from the audit_summary view (empty = everything reconciles); null when the
 * audit migration hasn't been run yet. */
export async function fetchAuditProblems(): Promise<AuditProblem[] | null> {
  const { data, error } = await supabase.from('audit_summary').select('*').order('portfolio').order('check_name')
  if (error) {
    if (error.code === '42P01' || /audit_summary/.test(error.message)) return null
    throw error
  }
  return data ?? []
}

/** Realized gains for every portfolio (activity rows that carry one). */
export async function fetchRealizedGains(): Promise<Pick<PortfolioActivity, 'portfolio_id' | 'realized_gain'>[]> {
  const { data, error } = await supabase.from('portfolio_activity').select('portfolio_id, realized_gain').not('realized_gain', 'is', null).is('voided_at', null)
  if (error) throw error
  return data ?? []
}

export async function fetchDailyValues(portfolioId?: string): Promise<PortfolioDailyValue[]> {
  let q = supabase.from('portfolio_daily_values').select('*').order('value_date')
  if (portfolioId) q = q.eq('portfolio_id', portfolioId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export type SymbolPrice = { close: number; date: string; prevClose: number | null }

/** Latest close (and the one before it, for today's change) for each symbol. */
export async function fetchLatestPrices(symbols: string[]): Promise<Map<string, SymbolPrice>> {
  const out = new Map<string, SymbolPrice>()
  if (symbols.length === 0) return out
  const { data, error } = await supabase
    .from('prices')
    .select('symbol, close, price_date')
    .in('symbol', symbols)
    .order('price_date', { ascending: false })
    .limit(symbols.length * 10)
  if (error) throw error
  for (const row of data ?? []) {
    const existing = out.get(row.symbol)
    if (!existing) out.set(row.symbol, { close: Number(row.close), date: row.price_date, prevClose: null })
    else if (existing.prevClose === null && row.price_date < existing.date) existing.prevClose = Number(row.close)
  }
  return out
}

// ---------------------------------------------------------------------------
// Actions (database functions -- each saves completely or not at all)
// ---------------------------------------------------------------------------

export async function portfolioBuy(p: { portfolioId: string; symbol: string; quantity: number; price: number; fromCash: boolean; on: string }) {
  const { error } = await supabase.rpc('portfolio_buy', {
    p_portfolio: p.portfolioId,
    p_symbol: p.symbol,
    p_quantity: p.quantity,
    p_price: p.price,
    p_from_cash: p.fromCash,
    p_on: p.on,
  })
  if (error) throw error
}

export async function portfolioSell(p: { portfolioId: string; symbol: string; quantity: number; price: number; toCash: boolean; on: string }) {
  const { error } = await supabase.rpc('portfolio_sell', {
    p_portfolio: p.portfolioId,
    p_symbol: p.symbol,
    p_quantity: p.quantity,
    p_price: p.price,
    p_to_cash: p.toCash,
    p_on: p.on,
  })
  if (error) throw error
}

/** Set cash to the broker's balance (negative = margin used). countsInReturn = false for a
 * setup/correction (treated as money in/out), true for margin interest or fees. */
export async function portfolioSetCash(p: { portfolioId: string; balance: number; countsInReturn: boolean; on: string }) {
  const { error } = await supabase.rpc('portfolio_set_cash', {
    p_portfolio: p.portfolioId,
    p_balance: p.balance,
    p_counts_in_return: p.countsInReturn,
    p_on: p.on,
  })
  if (error) throw error
}

/** A stock split: quantity x ratio, average cost / ratio, no cash. ratio = new shares per
 * old share (2 for 2-for-1, 0.1 for a 1-for-10 reverse split). */
export async function portfolioSplit(p: { portfolioId: string; symbol: string; ratio: number; on: string }) {
  const { error } = await supabase.rpc('portfolio_split', { p_portfolio: p.portfolioId, p_symbol: p.symbol, p_ratio: p.ratio, p_on: p.on })
  if (error) throw error
}

/** Move shares to another of your portfolios (toPortfolioId) or out of the app (null).
 * The average cost carries over; no gain or loss is realized. */
export async function portfolioTransfer(p: { fromPortfolioId: string; symbol: string; quantity: number; toPortfolioId: string | null; on: string }) {
  const { error } = await supabase.rpc('portfolio_transfer', {
    p_from: p.fromPortfolioId,
    p_symbol: p.symbol,
    p_quantity: p.quantity,
    p_to: p.toPortfolioId,
    p_on: p.on,
  })
  if (error) throw error
}

export async function portfolioCash(p: {
  portfolioId: string
  kind: 'deposit' | 'withdrawal' | 'dividend'
  amount: number
  symbol?: string | null
  on: string
}) {
  const { error } = await supabase.rpc('portfolio_cash', {
    p_portfolio: p.portfolioId,
    p_kind: p.kind,
    p_amount: p.amount,
    p_symbol: p.symbol ?? null,
    p_on: p.on,
  })
  if (error) throw error
}

export async function cspOpen(p: {
  portfolioId: string
  symbol: string
  strike: number
  expiration: string
  contracts: number
  premium: number
  on: string
}) {
  const { error } = await supabase.rpc('csp_open', {
    p_portfolio: p.portfolioId,
    p_symbol: p.symbol,
    p_strike: p.strike,
    p_expiration: p.expiration,
    p_contracts: p.contracts,
    p_premium: p.premium,
    p_on: p.on,
  })
  if (error) throw error
}

export async function cspResolve(p: { cspId: string; outcome: 'expired' | 'closed' | 'assigned'; price?: number | null; on: string }) {
  const { error } = await supabase.rpc('csp_resolve', {
    p_csp: p.cspId,
    p_outcome: p.outcome,
    p_price: p.price ?? null,
    p_on: p.on,
  })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

export async function fetchDividendInfo(): Promise<DividendInfo[]> {
  const { data, error } = await supabase.from('dividend_info').select('*')
  if (error) throw error
  return data ?? []
}

export async function saveDividendInfo(userId: string, info: Pick<DividendInfo, 'symbol' | 'annual_per_share' | 'frequency' | 'pay_month'>) {
  const { error } = await supabase
    .from('dividend_info')
    .upsert({ user_id: userId, ...info, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' })
  if (error) throw error
}

export async function deleteDividendInfo(symbol: string) {
  const { error } = await supabase.from('dividend_info').delete().eq('symbol', symbol)
  if (error) throw error
}

/** Dividends actually received (recorded with the Dividend cash action) since a date. */
export async function fetchDividendsReceived(since: string, portfolioId?: string): Promise<PortfolioActivity[]> {
  let q = supabase.from('portfolio_activity').select('*').eq('kind', 'dividend').is('voided_at', null).gte('occurred_on', since).order('occurred_on')
  if (portfolioId) q = q.eq('portfolio_id', portfolioId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------------
// Options (long calls / puts, covered calls)
// ---------------------------------------------------------------------------

export async function fetchOptions(portfolioId?: string): Promise<OptionPosition[]> {
  let q = supabase.from('option_positions').select('*').order('expiration')
  if (portfolioId) q = q.eq('portfolio_id', portfolioId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function setOptionMark(id: string, mark: number | null) {
  const { error } = await supabase.from('option_positions').update({ mark }).eq('id', id)
  if (error) throw error
}

export async function optionOpen(p: {
  portfolioId: string
  symbol: string
  optionType: 'call' | 'put'
  side: 'long' | 'short'
  strike: number
  expiration: string
  contracts: number
  price: number
  isHedge: boolean
  on: string
}) {
  const { error } = await supabase.rpc('option_open', {
    p_portfolio: p.portfolioId,
    p_symbol: p.symbol,
    p_option_type: p.optionType,
    p_side: p.side,
    p_strike: p.strike,
    p_expiration: p.expiration,
    p_contracts: p.contracts,
    p_price: p.price,
    p_is_hedge: p.isHedge,
    p_on: p.on,
  })
  if (error) throw error
}

export async function optionClose(p: { optionId: string; outcome: 'closed' | 'expired' | 'exercised' | 'assigned'; price?: number | null; on: string }) {
  const { error } = await supabase.rpc('option_close', {
    p_option: p.optionId,
    p_outcome: p.outcome,
    p_price: p.price ?? null,
    p_on: p.on,
  })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Fixing mistakes: each call reverses the original exactly and (for edits) re-applies it
// with the new values in the same save.
// ---------------------------------------------------------------------------

/** Undo one Activity entry (cash, shares, average cost, option status all reversed). */
export async function deleteActivityEntry(activityId: string) {
  const { error } = await supabase.rpc('portfolio_entry_delete', { p_activity: activityId })
  if (error) throw error
}

/** Edit a buy / sell / add-existing (symbol, quantity, price) or a deposit / withdrawal /
 * dividend (amount, dividend symbol). The kind stays the same. */
export async function editActivityEntry(p: { activityId: string; symbol: string | null; quantity: number | null; price: number | null; amount: number | null; on: string }) {
  const { error } = await supabase.rpc('portfolio_entry_edit', {
    p_activity: p.activityId,
    p_symbol: p.symbol,
    p_quantity: p.quantity,
    p_price: p.price,
    p_amount: p.amount,
    p_on: p.on,
  })
  if (error) throw error
}

export async function optionEdit(p: { optionId: string; symbol: string; strike: number; expiration: string; contracts: number; price: number; isHedge: boolean; on: string }) {
  const { error } = await supabase.rpc('option_edit', {
    p_option: p.optionId,
    p_symbol: p.symbol,
    p_strike: p.strike,
    p_expiration: p.expiration,
    p_contracts: p.contracts,
    p_price: p.price,
    p_is_hedge: p.isHedge,
    p_on: p.on,
  })
  if (error) throw error
}

export async function cspEdit(p: { cspId: string; symbol: string; strike: number; expiration: string; contracts: number; premium: number; on: string }) {
  const { error } = await supabase.rpc('csp_edit', {
    p_csp: p.cspId,
    p_symbol: p.symbol,
    p_strike: p.strike,
    p_expiration: p.expiration,
    p_contracts: p.contracts,
    p_premium: p.premium,
    p_on: p.on,
  })
  if (error) throw error
}

/** Undo a position's newest entry: a closed/expired/assigned/exercised one reopens, an
 * open one is deleted (its premium reversed). */
export async function undoPositionLast(p: { optionId?: string; cspId?: string }) {
  const { error } = await supabase.rpc('position_undo_last', { p_option: p.optionId ?? null, p_csp: p.cspId ?? null })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Installments (monthly payments on debts)
// ---------------------------------------------------------------------------

/** Payments marked paid. Empty (not an error) until the installments migration is applied. */
export async function fetchInstallmentPayments(): Promise<InstallmentPayment[]> {
  const { data, error } = await supabase.from('installment_payments').select('*').order('month')
  if (error) {
    if (error.code === '42P01' || /installment_payments/.test(error.message)) return []
    throw error
  }
  return data ?? []
}

export async function markInstallmentPaid(userId: string, p: { accountId: string; month: string; amount: number; paidOn: string }) {
  const { error } = await supabase
    .from('installment_payments')
    .upsert({ user_id: userId, account_id: p.accountId, month: p.month, amount: p.amount, paid_on: p.paidOn }, { onConflict: 'account_id,month' })
  if (error) throw error
}

export async function unmarkInstallmentPaid(accountId: string, month: string) {
  const { error } = await supabase.from('installment_payments').delete().eq('account_id', accountId).eq('month', month)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Research: fundamentals, economic indicators, watchlist, your overrides
// (each read tolerates the tables not existing before the research migration)
// ---------------------------------------------------------------------------

const missingTable = (error: { code?: string; message: string }, name: string) => error.code === '42P01' || new RegExp(name).test(error.message)

export async function fetchFundamentals(symbols: string[]): Promise<Map<string, FundamentalsRow>> {
  const out = new Map<string, FundamentalsRow>()
  if (symbols.length === 0) return out
  const { data, error } = await supabase.from('fundamentals').select('*').in('symbol', symbols)
  if (error) {
    if (missingTable(error, 'fundamentals')) return out
    throw error
  }
  for (const r of data ?? []) out.set(r.symbol, r)
  return out
}

export async function fetchMacroIndicators(): Promise<MacroIndicatorRow[]> {
  const { data, error } = await supabase.from('macro_indicators').select('*')
  if (error) {
    if (missingTable(error, 'macro_indicators')) return []
    throw error
  }
  return data ?? []
}

export async function fetchWatchlist(): Promise<string[]> {
  const { data, error } = await supabase.from('research_watchlist').select('symbol').order('symbol')
  if (error) {
    if (missingTable(error, 'research_watchlist')) return []
    throw error
  }
  return (data ?? []).map((r) => r.symbol)
}

export async function addToWatchlist(userId: string, symbol: string) {
  const { error } = await supabase.from('research_watchlist').upsert({ user_id: userId, symbol: symbol.trim().toUpperCase() }, { onConflict: 'user_id,symbol' })
  if (error) throw error
}

export async function removeFromWatchlist(symbol: string) {
  const { error } = await supabase.from('research_watchlist').delete().eq('symbol', symbol)
  if (error) throw error
}

export async function fetchResearchOverrides(): Promise<ResearchOverrideRow[]> {
  const { data, error } = await supabase.from('research_overrides').select('*')
  if (error) {
    if (missingTable(error, 'research_overrides')) return []
    throw error
  }
  return data ?? []
}

/** Set your own number for a ticker's input or score part; null puts the automatic one back. */
export async function setResearchOverride(userId: string, symbol: string, field: ResearchOverrideField, value: number | null) {
  const { error } =
    value === null
      ? await supabase.from('research_overrides').delete().eq('symbol', symbol).eq('field', field)
      : await supabase
          .from('research_overrides')
          .upsert({ user_id: userId, symbol, field, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol,field' })
  if (error) throw error
}

export type ResearchSettings = { growthCap: number; economyOverride: number | null }

export async function fetchResearchSettings(): Promise<ResearchSettings> {
  const { data, error } = await supabase.from('wealth_settings').select('growth_cap, economy_override').maybeSingle()
  if (error) {
    if (missingTable(error, 'wealth_settings') || /growth_cap|economy_override/.test(error.message)) return { growthCap: 30, economyOverride: null }
    throw error
  }
  return { growthCap: data?.growth_cap != null ? Number(data.growth_cap) : 30, economyOverride: data?.economy_override != null ? Number(data.economy_override) : null }
}

export async function setResearchSettings(userId: string, patch: Partial<{ growth_cap: number; economy_override: number | null }>) {
  const { error } = await supabase
    .from('wealth_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
}

/** Ask the worker to fetch prices and research data for tickers that have none yet (the
 * same request as Get prices now). Returns false when the request wasn't accepted. */
export async function requestMarketData(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return false
  const res = await fetch('/api/trigger-sync?job=prices', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => null)
  return !!res && (res.status === 202 || res.status === 409)
}

// ---------------------------------------------------------------------------
// Allocation: mix targets per pool, ticker types, tolerance
// ---------------------------------------------------------------------------

export async function fetchAllocationTargets(): Promise<AllocationTargetRow[]> {
  const { data, error } = await supabase.from('allocation_targets').select('*')
  if (error) {
    if (missingTable(error, 'allocation_targets')) return []
    throw error
  }
  return data ?? []
}

/** Save a pool's mix target ('brokerage' or a retirement portfolio id); null removes it. */
export async function saveAllocationTarget(userId: string, scope: string, t: { etf: number; stock: number; bond: number; option: number; cash: number } | null) {
  const { error } =
    t === null
      ? await supabase.from('allocation_targets').delete().eq('scope', scope)
      : await supabase.from('allocation_targets').upsert({ user_id: userId, scope, ...t, updated_at: new Date().toISOString() }, { onConflict: 'user_id,scope' })
  if (error) throw error
}

export async function fetchTickerTypes(): Promise<TickerTypeRow[]> {
  const { data, error } = await supabase.from('ticker_types').select('*')
  if (error) {
    if (missingTable(error, 'ticker_types')) return []
    throw error
  }
  return data ?? []
}

/** Your type for a ticker; null goes back to the detected one. */
export async function setTickerType(userId: string, symbol: string, type: 'stock' | 'etf' | 'bond' | null) {
  const { error } =
    type === null
      ? await supabase.from('ticker_types').delete().eq('symbol', symbol)
      : await supabase.from('ticker_types').upsert({ user_id: userId, symbol, asset_type: type, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' })
  if (error) throw error
}

export async function fetchAllocationTolerance(): Promise<number> {
  const { data, error } = await supabase.from('wealth_settings').select('allocation_tolerance').maybeSingle()
  if (error) {
    if (missingTable(error, 'wealth_settings') || /allocation_tolerance/.test(error.message)) return 5
    throw error
  }
  return data?.allocation_tolerance != null ? Number(data.allocation_tolerance) : 5
}

export async function setAllocationTolerance(userId: string, tolerance: number) {
  const { error } = await supabase
    .from('wealth_settings')
    .upsert({ user_id: userId, allocation_tolerance: tolerance, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
}

/** First month the month-end close applies to (null = not set, or the table isn't there yet). */
export async function fetchCloseFromMonth(): Promise<string | null> {
  const { data, error } = await supabase.from('wealth_settings').select('close_from_month').maybeSingle()
  if (error) {
    if (error.code === '42P01' || /wealth_settings/.test(error.message)) return null
    throw error
  }
  return data?.close_from_month ?? null
}

export async function setCloseFromMonth(userId: string, month: string) {
  const { error } = await supabase
    .from('wealth_settings')
    .upsert({ user_id: userId, close_from_month: month, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
}

/** Money in/out of every portfolio (activity rows that carry an external flow), for cash flow. */
export async function fetchExternalFlows(): Promise<Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>[]> {
  const { data, error } = await supabase
    .from('portfolio_activity')
    .select('portfolio_id, kind, external_flow, occurred_on')
    .neq('external_flow', 0)
    .is('voided_at', null)
  if (error) throw error
  return data ?? []
}
