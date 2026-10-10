import { supabase } from './supabase'
import type {
  Trade,
  Execution,
  TradeWithDetails,
  DailyJournal,
  TargetSettings,
  SyncLog,
  DailyPlanWithPlaybooks,
  Playbook,
  Account,
} from './database.types'
import { summarizeFills, computeRealizedPnlGross, executionSide, type FillAction, type FillInput } from './manualTrade'

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase.from('accounts').select('*').order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createAccount(
  userId: string,
  fields: {
    broker: Account['broker']
    label: string
    account_type: Account['account_type']
    sync_mode: Account['sync_mode']
    default_asset_type?: Account['default_asset_type']
    per_contract_fee?: number
  },
): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({ user_id: userId, enabled: true, archived: false, default_asset_type: 'stock', per_contract_fee: 0, ...fields })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateAccount(
  id: string,
  fields: Partial<Pick<Account, 'label' | 'account_type' | 'sync_mode' | 'default_asset_type' | 'per_contract_fee'>>,
) {
  const { error } = await supabase.from('accounts').update(fields).eq('id', id)
  if (error) throw error
}

export async function setAccountEnabled(id: string, enabled: boolean) {
  const { error } = await supabase.from('accounts').update({ enabled }).eq('id', id)
  if (error) throw error
}

export async function setAccountArchived(id: string, archived: boolean) {
  const { error } = await supabase.from('accounts').update({ archived }).eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Manual trade entry (also the CSV import path -- both funnel through this)
// ---------------------------------------------------------------------------

const OPTION_MULTIPLIER = 100

const FILL_ACTION_TO_DB: Record<FillAction, Execution['action']> = { open: 'entry', add: 'add', trim: 'trim', close: 'exit' }

export type ManualTradeFields = {
  accountId: string
  symbol: string
  side: 'long' | 'short'
  fills: FillInput[] // at least one -- see lib/manualTrade.ts for the shape/math
  fees: number // total, applied to the last fill (mirrors where the old single-exit-fill fee lived)
  optionType?: 'call' | 'put'
  strike?: number
  expiration?: string // date, yyyy-mm-dd
  notes?: string
}

/** Shared between createManualTrade and updateManualTrade: turns ManualTradeFields
 * into the trades-table row and the derived isOption/summary values both callers
 * need for their own subsequent executions/options_detail writes. */
function computeManualTradeRow(fields: ManualTradeFields) {
  const isOption = fields.optionType !== undefined && fields.strike !== undefined && !!fields.expiration
  const multiplier = isOption ? OPTION_MULTIPLIER : 1
  const direction = fields.side === 'long' ? 1 : -1

  const summary = summarizeFills(fields.fills)
  const realizedPnlGross = computeRealizedPnlGross(summary, multiplier, direction)
  const realizedPnlNet = realizedPnlGross !== null ? realizedPnlGross - fields.fees : null
  const holdSeconds =
    summary.closed && summary.firstFillTime && summary.lastExitFillTime
      ? Math.round((new Date(summary.lastExitFillTime).getTime() - new Date(summary.firstFillTime).getTime()) / 1000)
      : null

  return {
    isOption,
    summary,
    row: {
      account_id: fields.accountId,
      symbol: fields.symbol,
      asset_type: isOption ? ('option' as const) : ('stock' as const),
      side: fields.side,
      status: summary.closed ? ('CLOSED' as const) : ('OPEN' as const),
      avg_entry: summary.avgEntry,
      avg_exit: summary.closed ? summary.avgExit : null,
      hold_seconds: holdSeconds,
      total_contracts: summary.entryQty,
      realized_pnl_gross: summary.closed ? realizedPnlGross : null,
      realized_pnl_net: summary.closed ? realizedPnlNet : null,
      // Manual entry has no "estimate pending confirmation" phase -- whatever fee the
      // user enters IS the real number, so it's stamped straight to 'actual'.
      estimated_fee: fields.fees,
      actual_fee: fields.fees,
      fee_source: 'actual' as const,
      first_in_at: summary.firstFillTime,
      last_out_at: summary.closed ? summary.lastExitFillTime : null,
      notes: fields.notes?.trim() || null,
    },
  }
}

/** One executions row per fill, fee landing on the last fill in the list (the form/
 * importer keep fills in chronological order) -- same place a single exit fill's fee
 * lived before fills became a list. */
function buildFillExecutions(userId: string, tradeId: string, fields: ManualTradeFields) {
  const executions = fields.fills.map((f, i) => ({
    user_id: userId,
    trade_id: tradeId,
    client_order_id: `manual-${tradeId}-${i}`,
    filled_at: f.time,
    action: FILL_ACTION_TO_DB[f.action],
    price: f.price,
    quantity: f.quantity,
    side: executionSide(f.action, fields.side),
    estimated_fee: 0,
    actual_fee: 0,
  }))
  if (executions.length > 0) {
    const last = executions[executions.length - 1]
    last.estimated_fee = fields.fees
    last.actual_fee = fields.fees
  }
  return executions
}

/** Writes a manually-entered (or CSV-imported) trade as real trades + executions
 * (+ options_detail) rows -- one row per fill (open/add/trim/close), so it's
 * first-class in the executions pipeline (per-trade executions view, any
 * execution-based analytics) rather than a flattened summary row. Supports any
 * number of fills (trims included), not just one entry + one exit -- see
 * lib/manualTrade.ts for the shared avg-entry/avg-exit/closed math, used identically
 * here and in the form's live preview so they can never disagree.
 *
 * Ordinary RLS-scoped inserts (not upsert_trade_bundle -- that RPC is
 * security-definer, worker/service-role-only). Sequential, not a single transaction
 * (the supabase-js client has no multi-statement transaction API, same constraint
 * noted in worker/db_writer.py) -- acceptable here since this is a one-off,
 * user-initiated write, not a repeated high-volume sync.
 */
export async function createManualTrade(userId: string, fields: ManualTradeFields): Promise<Trade> {
  const { isOption, summary, row } = computeManualTradeRow(fields)

  const { data: trade, error: tradeError } = await supabase
    .from('trades')
    .insert({
      user_id: userId,
      trade_key: null, // no dedup key needed -- a unique constraint on a nullable column allows multiple nulls
      ...row,
    })
    .select()
    .single()
  if (tradeError) throw tradeError

  const { error: execError } = await supabase.from('executions').insert(buildFillExecutions(userId, trade.id, fields))
  if (execError) throw execError

  if (isOption) {
    const { error: optError } = await supabase.from('options_detail').insert({
      trade_id: trade.id,
      option_type: fields.optionType!,
      strike: fields.strike!,
      expiration: fields.expiration!,
      premium: summary.avgEntry,
    })
    if (optError) throw optError
  }

  return trade
}

/** Edits a trade previously created by createManualTrade -- only ever called for
 * trades with trade_key === null (the marker for "not synced from a broker"; see
 * TradeDetailPage's isManualTrade check). Replaces executions and options_detail
 * wholesale rather than diffing individual fills -- simpler and correct for
 * arbitrary add/remove/reorder edits to the fill list. */
export async function updateManualTrade(tradeId: string, fields: ManualTradeFields): Promise<Trade> {
  const { isOption, summary, row } = computeManualTradeRow(fields)

  const { data: trade, error: tradeError } = await supabase.from('trades').update(row).eq('id', tradeId).select().single()
  if (tradeError) throw tradeError

  const { error: delExecError } = await supabase.from('executions').delete().eq('trade_id', tradeId)
  if (delExecError) throw delExecError

  const { error: execError } = await supabase.from('executions').insert(buildFillExecutions(trade.user_id, tradeId, fields))
  if (execError) throw execError

  if (isOption) {
    const { error: optError } = await supabase
      .from('options_detail')
      .upsert(
        { trade_id: tradeId, option_type: fields.optionType!, strike: fields.strike!, expiration: fields.expiration!, premium: summary.avgEntry },
        { onConflict: 'trade_id' },
      )
    if (optError) throw optError
  } else {
    const { error: delOptError } = await supabase.from('options_detail').delete().eq('trade_id', tradeId)
    if (delOptError) throw delOptError
  }

  return trade
}

/** Deletes a trade previously created by createManualTrade -- only ever called for
 * trades with trade_key === null (see updateManualTrade's comment). Executions,
 * options_detail, trade_playbooks, and trade_emotions all cascade via FK. */
export async function deleteManualTrade(tradeId: string) {
  const { error } = await supabase.from('trades').delete().eq('id', tradeId)
  if (error) throw error
}

/** Closes a still-OPEN option trade at $0 -- for a worthless expiration, which never
 * produces a broker order (nothing was traded), so the Webull sync worker can never
 * derive this on its own; it just keeps re-deriving OPEN forever from the same
 * unchanging order history. Works for ANY trade regardless of trade_key (synced or
 * manual) -- unlike a full edit, this only ever touches the six "outcome" fields
 * (status/avg_exit/hold_seconds/realized P&L/last_out_at), which is exactly what
 * upsert_trade_bundle's on-conflict clause skips overwriting once manually_closed is
 * true, so a broker resync 15 minutes later can't silently revert it. */
export async function markTradeExpiredWorthless(
  trade: Pick<Trade, 'id' | 'side' | 'asset_type' | 'avg_entry' | 'total_contracts' | 'first_in_at' | 'actual_fee' | 'estimated_fee' | 'fee_source'>,
  expirationDate: string, // yyyy-mm-dd
): Promise<void> {
  const multiplier = trade.asset_type === 'option' ? OPTION_MULTIPLIER : 1
  const direction = trade.side === 'long' ? 1 : -1
  const qty = trade.total_contracts ?? 0
  const avgEntry = trade.avg_entry ?? 0
  // Long: full loss of premium paid. Short: full gain of premium collected.
  const realizedPnlGross = (0 - avgEntry) * qty * multiplier * direction
  const feeUsed = trade.fee_source === 'actual' ? (trade.actual_fee ?? 0) : trade.estimated_fee
  const realizedPnlNet = realizedPnlGross - feeUsed
  // Approximate US market close on expiration day -- Webull/Robinhood don't give an
  // intraday expiration timestamp either, since nothing was actually traded.
  const lastOutAt = new Date(`${expirationDate}T20:00:00.000Z`).toISOString()
  const holdSeconds = trade.first_in_at
    ? Math.round((new Date(lastOutAt).getTime() - new Date(trade.first_in_at).getTime()) / 1000)
    : null

  const { error } = await supabase
    .from('trades')
    .update({
      status: 'CLOSED',
      avg_exit: 0,
      hold_seconds: holdSeconds,
      realized_pnl_gross: realizedPnlGross,
      realized_pnl_net: realizedPnlNet,
      last_out_at: lastOutAt,
      manually_closed: true,
    })
    .eq('id', trade.id)
  if (error) throw error
}

/** Reverts markTradeExpiredWorthless -- lets the next broker resync (if any) take
 * back over deriving this trade's outcome. Doesn't itself recompute status back to
 * OPEN; that only happens once the worker actually re-syncs. */
export async function clearManualOverride(tradeId: string) {
  const { error } = await supabase.from('trades').update({ manually_closed: false }).eq('id', tradeId)
  if (error) throw error
}

export type ImportedTradeFields = {
  accountId: string
  symbol: string
  side: 'long' | 'short'
  assetType: 'stock' | 'option'
  optionType?: 'call' | 'put'
  strike?: number
  expiration?: string
  fills: FillInput[] // chronological order, exactly like ManualTradeFields
  fee: number
  /** true = a standalone closing fill with no matching open in the source export --
   * avg_entry/first_in_at/realized P&L are all genuinely unknown, not just
   * unfavorable to compute, so they're written null rather than guessed. */
  orphanEntry: boolean
  /** Dedup key for trades.import_key -- deliberately NOT trade_key (see the migration
   * comment): trade_key belongs solely to the Webull worker's upsert_trade_bundle RPC.
   * Importers write trade_key = null, same as any manual trade. */
  importKey: string
}

/** Writes one CSV-importer-sourced trade (Robinhood today) as real trades +
 * executions (+ options_detail) rows, mirroring createManualTrade's shape and math
 * (see lib/manualTrade.ts) but adding orphanEntry handling and import_key dedup that
 * a hand-entered trade never needs. A unique_violation on (user_id, account_id,
 * import_key) means this trade was already imported -- callers should let that
 * surface as a distinguishable "already imported" outcome rather than a generic
 * failure (see RobinhoodImportPage). */
export async function createImportedTrade(userId: string, fields: ImportedTradeFields): Promise<Trade> {
  const isOption = fields.assetType === 'option'
  const multiplier = isOption ? OPTION_MULTIPLIER : 1
  const direction = fields.side === 'long' ? 1 : -1
  const summary = summarizeFills(fields.fills)

  const closed = fields.orphanEntry || summary.closed
  const avgEntry = fields.orphanEntry ? null : summary.avgEntry
  const avgExit = closed ? summary.avgExit : null
  const realizedPnlGross = fields.orphanEntry ? null : computeRealizedPnlGross(summary, multiplier, direction)
  const realizedPnlNet = realizedPnlGross !== null ? realizedPnlGross - fields.fee : null
  // Orphan trades have no known open fills (entryQty is 0 by construction), so their
  // real size is the quantity that closed, not summary.entryQty.
  const totalContracts = fields.orphanEntry ? summary.exitQty : summary.entryQty
  const lastFillTime = fields.fills.length > 0 ? fields.fills[fields.fills.length - 1].time : null
  const holdSeconds =
    !fields.orphanEntry && summary.closed && summary.firstFillTime && summary.lastExitFillTime
      ? Math.round((new Date(summary.lastExitFillTime).getTime() - new Date(summary.firstFillTime).getTime()) / 1000)
      : null

  const { data: trade, error: tradeError } = await supabase
    .from('trades')
    .insert({
      user_id: userId,
      trade_key: null,
      import_key: fields.importKey,
      account_id: fields.accountId,
      symbol: fields.symbol,
      asset_type: fields.assetType,
      side: fields.side,
      status: closed ? ('CLOSED' as const) : ('OPEN' as const),
      avg_entry: avgEntry,
      avg_exit: avgExit,
      hold_seconds: holdSeconds,
      total_contracts: totalContracts,
      realized_pnl_gross: realizedPnlGross,
      realized_pnl_net: realizedPnlNet,
      estimated_fee: fields.fee,
      actual_fee: fields.fee,
      fee_source: 'actual' as const,
      first_in_at: fields.orphanEntry ? null : summary.firstFillTime,
      last_out_at: closed ? (fields.orphanEntry ? lastFillTime : summary.lastExitFillTime) : null,
    })
    .select()
    .single()
  if (tradeError) throw tradeError

  const executions = fields.fills.map((f, i) => ({
    user_id: userId,
    trade_id: trade.id,
    client_order_id: `rh-${trade.id}-${i}`,
    filled_at: f.time,
    action: FILL_ACTION_TO_DB[f.action],
    price: f.price,
    quantity: f.quantity,
    side: executionSide(f.action, fields.side),
    estimated_fee: 0,
    actual_fee: 0,
  }))
  if (executions.length > 0) {
    const last = executions[executions.length - 1]
    last.estimated_fee = fields.fee
    last.actual_fee = fields.fee
  }
  const { error: execError } = await supabase.from('executions').insert(executions)
  if (execError) throw execError

  if (isOption) {
    const { error: optError } = await supabase.from('options_detail').insert({
      trade_id: trade.id,
      option_type: fields.optionType!,
      strike: fields.strike!,
      expiration: fields.expiration!,
      premium: avgEntry ?? avgExit ?? 0,
    })
    if (optError) throw optError
  }

  return trade
}

const DAILY_PLAN_WITH_PLAYBOOKS_SELECT = '*, daily_plan_playbooks(playbook_id, playbooks(*))'

const TRADE_WITH_DETAILS_SELECT =
  '*, options_detail(*), executions(*), trade_playbooks(playbook_id, playbooks(*))'

/** Bare trades, no joins -- for pages (like the trade page's side list) that
 * only need the raw trade rows. `accountId` is the account switcher's selection:
 * omit/null/undefined for "All accounts" (no filter). */
export async function fetchTrades(accountId?: string | null): Promise<Trade[]> {
  let query = supabase.from('trades').select('*').order('first_in_at', { ascending: true })
  if (accountId) query = query.eq('account_id', accountId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function fetchTradesWithDetails(accountId?: string | null): Promise<TradeWithDetails[]> {
  let query = supabase.from('trades').select(TRADE_WITH_DETAILS_SELECT).order('first_in_at', { ascending: false })
  if (accountId) query = query.eq('account_id', accountId)
  const { data, error } = await query

  if (error) throw error
  return (data ?? []) as unknown as TradeWithDetails[]
}

export async function fetchTradeWithDetails(tradeId: string): Promise<TradeWithDetails | null> {
  const { data, error } = await supabase
    .from('trades')
    .select(TRADE_WITH_DETAILS_SELECT)
    .eq('id', tradeId)
    .maybeSingle()

  if (error) throw error
  return data as unknown as TradeWithDetails | null
}

/** The review fields a trader edits on a trade (review queue + trade detail). */
export type TradeJournalPatch = Partial<Pick<
  Trade,
  'planned' | 'mistakes' | 'strengths' | 'notes' | 'reviewed_at' | 'stop_price' | 'target_price' | 'alt_exit_price'
>>

export async function updateTradeJournal(tradeId: string, patch: TradeJournalPatch) {
  const { error } = await supabase.from('trades').update(patch).eq('id', tradeId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Trade psychology: emotions vocabulary + per-trade tagging
// ---------------------------------------------------------------------------

export async function updateTradeScreenshot(tradeId: string, screenshotUrl: string | null) {
  const { error } = await supabase.from('trades').update({ screenshot_url: screenshotUrl }).eq('id', tradeId)
  if (error) throw error
}

/** Uploads to the private `trade-screenshots` bucket under `${userId}/${tradeId}/...`
 * (RLS on storage.objects restricts each user to their own folder -- see the storage
 * migration). Returns the storage PATH, not a URL -- the bucket is private, so
 * trades.screenshot_url stores this path and a fresh signed URL is minted on read
 * (see getTradeScreenshotUrl) rather than persisting a URL that would expire. */
export async function uploadTradeScreenshot(userId: string, tradeId: string, file: File): Promise<string> {
  const path = `${userId}/${tradeId}/${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from('trade-screenshots').upload(path, file, {
    upsert: false,
  })
  if (uploadError) throw uploadError
  return path
}

export async function getTradeScreenshotUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('trade-screenshots').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function deleteTradeScreenshot(path: string) {
  const { error } = await supabase.storage.from('trade-screenshots').remove([path])
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

export async function fetchPlaybooks(): Promise<Playbook[]> {
  const { data, error } = await supabase.from('playbooks').select('*').order('name')
  if (error) throw error
  return data ?? []
}

export async function createPlaybook(
  userId: string,
  fields: { name: string; color: string; description?: string | null; icon?: string | null; market_conditions?: string | null },
): Promise<Playbook> {
  const { data, error } = await supabase
    .from('playbooks')
    .insert({ user_id: userId, archived: false, ...fields })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePlaybook(
  id: string,
  fields: Partial<Pick<Playbook, 'name' | 'description' | 'color' | 'icon' | 'market_conditions' | 'example_chart_url'>>,
) {
  const { error } = await supabase
    .from('playbooks')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function setPlaybookArchived(id: string, archived: boolean) {
  const { error } = await supabase
    .from('playbooks')
    .update({ archived, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Playbook rule groups + rules
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-trade playbook link + rule checks
// ---------------------------------------------------------------------------

export async function setTradePlaybook(tradeId: string, playbookId: string) {
  const { error } = await supabase
    .from('trade_playbooks')
    .upsert({ trade_id: tradeId, playbook_id: playbookId }, { onConflict: 'trade_id' })
  if (error) throw error
}

export async function removeTradePlaybook(tradeId: string) {
  const { error } = await supabase.from('trade_playbooks').delete().eq('trade_id', tradeId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Daily rules (global qualitative discipline checklist) + per-day checks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Missed trades
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Journal, targets, sync log, daily plan
// ---------------------------------------------------------------------------

export async function fetchDailyJournal(entryDate: string): Promise<DailyJournal | null> {
  const { data, error } = await supabase
    .from('daily_journal')
    .select('*')
    .eq('entry_date', entryDate)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchAllDailyJournal(): Promise<DailyJournal[]> {
  const { data, error } = await supabase.from('daily_journal').select('*')
  if (error) throw error
  return data ?? []
}

export async function upsertDailyJournal(
  userId: string,
  entryDate: string,
  fields: { notes?: string | null; mood_rating?: number | null },
) {
  const { error } = await supabase
    .from('daily_journal')
    .upsert({ user_id: userId, entry_date: entryDate, ...fields }, { onConflict: 'user_id,entry_date' })
  if (error) throw error
}

export async function fetchTargetSettings(): Promise<TargetSettings | null> {
  const { data, error } = await supabase.from('target_settings').select('*').maybeSingle()
  if (error) throw error
  return data
}

export async function upsertTargetSettings(
  userId: string,
  fields: { profit_target_value: number | null; loss_limit_value: number | null },
) {
  const { error } = await supabase
    .from('target_settings')
    .upsert(
      { user_id: userId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (error) throw error
}

export async function fetchLatestSyncLog(): Promise<SyncLog | null> {
  const { data, error } = await supabase
    .from('sync_log')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchDailyPlan(planDate: string): Promise<DailyPlanWithPlaybooks | null> {
  const { data, error } = await supabase
    .from('daily_plans')
    .select(DAILY_PLAN_WITH_PLAYBOOKS_SELECT)
    .eq('plan_date', planDate)
    .maybeSingle()
  if (error) throw error
  return data as unknown as DailyPlanWithPlaybooks | null
}

export async function fetchAllDailyPlans(): Promise<DailyPlanWithPlaybooks[]> {
  const { data, error } = await supabase.from('daily_plans').select(DAILY_PLAN_WITH_PLAYBOOKS_SELECT)
  if (error) throw error
  return (data ?? []) as unknown as DailyPlanWithPlaybooks[]
}

/** Upserts the plan row and returns it (with its id) so the caller can then set
 * daily_plan_playbooks -- a separate step, same two-step shape as trade_playbooks. */
export async function upsertDailyPlan(
  userId: string,
  planDate: string,
  fields: {
    planned_max_trades?: number | null
    planned_max_loss?: number | null
    plan_notes?: string | null
    market_read?: string | null
    focus?: string | null
  },
): Promise<DailyPlanWithPlaybooks> {
  const { data, error } = await supabase
    .from('daily_plans')
    .upsert(
      { user_id: userId, plan_date: planDate, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,plan_date' },
    )
    .select(DAILY_PLAN_WITH_PLAYBOOKS_SELECT)
    .single()
  if (error) throw error
  return data as unknown as DailyPlanWithPlaybooks
}

export async function addDailyPlanPlaybook(dailyPlanId: string, playbookId: string) {
  const { error } = await supabase.from('daily_plan_playbooks').insert({ daily_plan_id: dailyPlanId, playbook_id: playbookId })
  if (error) throw error
}

export async function removeDailyPlanPlaybook(dailyPlanId: string, playbookId: string) {
  const { error } = await supabase
    .from('daily_plan_playbooks')
    .delete()
    .eq('daily_plan_id', dailyPlanId)
    .eq('playbook_id', playbookId)
  if (error) throw error
}
