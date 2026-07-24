import { supabase } from './supabase'
import type {
  Trade,
  Execution,
  TradeWithDetails,
  TradeWithPlaybook,
  DailyJournal,
  TargetSettings,
  SyncLog,
  DailyPlanWithPlaybooks,
  Playbook,
  PlaybookWithRules,
  PlaybookRule,
  DailyRule,
  MissedTrade,
  Account,
  Emotion,
} from './database.types'
import { summarizeFills, computeRealizedPnlGross, executionSide, type FillAction, type FillInput } from './manualTrade'
import { DEFAULT_EMOTIONS } from './emotions'

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
  },
): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({ user_id: userId, enabled: true, archived: false, default_asset_type: 'stock', ...fields })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateAccount(
  id: string,
  fields: Partial<Pick<Account, 'label' | 'account_type' | 'sync_mode' | 'default_asset_type'>>,
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
  thesisNote?: string
  reflectionNote?: string
  notes?: string
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

  const { data: trade, error: tradeError } = await supabase
    .from('trades')
    .insert({
      user_id: userId,
      account_id: fields.accountId,
      symbol: fields.symbol,
      asset_type: isOption ? 'option' : 'stock',
      side: fields.side,
      status: summary.closed ? 'CLOSED' : 'OPEN',
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
      fee_source: 'actual',
      trade_key: null, // no dedup key needed -- a unique constraint on a nullable column allows multiple nulls
      first_in_at: summary.firstFillTime,
      last_out_at: summary.closed ? summary.lastExitFillTime : null,
      notes: fields.notes?.trim() || null,
      thesis_note: fields.thesisNote?.trim() || null,
      reflection_note: fields.reflectionNote?.trim() || null,
    })
    .select()
    .single()
  if (tradeError) throw tradeError

  const executions = fields.fills.map((f, i) => ({
    user_id: userId,
    trade_id: trade.id,
    client_order_id: `manual-${trade.id}-${i}`,
    filled_at: f.time,
    action: FILL_ACTION_TO_DB[f.action],
    price: f.price,
    quantity: f.quantity,
    side: executionSide(f.action, fields.side),
    estimated_fee: 0,
    actual_fee: 0,
  }))
  // Total fee lands on the last fill in the list (the form/importer keep fills in
  // chronological order) -- same place a single exit fill's fee lived before fills
  // became a list.
  if (executions.length > 0) {
    const last = executions[executions.length - 1]
    last.estimated_fee = fields.fees
    last.actual_fee = fields.fees
  }

  const { error: execError } = await supabase.from('executions').insert(executions)
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

const DAILY_PLAN_WITH_PLAYBOOKS_SELECT = '*, daily_plan_playbooks(playbook_id, playbooks(*))'

const TRADE_WITH_DETAILS_SELECT =
  '*, options_detail(*), executions(*), trade_playbooks(playbook_id, playbooks(*)), trade_rule_checks(rule_id, status, playbook_rules(*)), trade_emotions(emotion_id, phase, emotions(*))'

/** Bare trades, no joins -- for pages (Dashboard, Calendar, Layout's balance) that
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

/** Lighter than fetchTradesWithDetails -- just the playbook link. Used by the daily
 * plan feature (Dashboard's Today's Plan card) which only needs "which playbook was
 * each trade," not executions/options_detail/trade_rule_checks. */
export async function fetchTradesWithPlaybook(accountId?: string | null): Promise<TradeWithPlaybook[]> {
  let query = supabase.from('trades').select('*, trade_playbooks(playbook_id, playbooks(*))').order('first_in_at', { ascending: false })
  if (accountId) query = query.eq('account_id', accountId)
  const { data, error } = await query

  if (error) throw error
  return (data ?? []) as unknown as TradeWithPlaybook[]
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

export async function updateTradeNotes(tradeId: string, notes: string) {
  const { error } = await supabase.from('trades').update({ notes }).eq('id', tradeId)
  if (error) throw error
}

export async function updateTradeThesisNote(tradeId: string, thesisNote: string) {
  const { error } = await supabase.from('trades').update({ thesis_note: thesisNote }).eq('id', tradeId)
  if (error) throw error
}

export async function updateTradeReflectionNote(tradeId: string, reflectionNote: string) {
  const { error } = await supabase.from('trades').update({ reflection_note: reflectionNote }).eq('id', tradeId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Trade psychology: emotions vocabulary + per-trade tagging
// ---------------------------------------------------------------------------

export async function fetchEmotions(): Promise<Emotion[]> {
  const { data, error } = await supabase.from('emotions').select('*').order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createEmotion(userId: string, phase: Emotion['phase'], name: string, sortOrder: number): Promise<Emotion> {
  const { data, error } = await supabase
    .from('emotions')
    .insert({ user_id: userId, phase, name, sort_order: sortOrder, archived: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function setEmotionArchived(id: string, archived: boolean) {
  const { error } = await supabase.from('emotions').update({ archived }).eq('id', id)
  if (error) throw error
}

/** Seeds the default vocabulary (see lib/emotions.ts) the first time this user has
 * none -- lazy, client-side, and idempotent (unique(user_id, phase, name) means a
 * re-run/race just no-ops on conflict) rather than a SQL seed, so it also covers
 * future signups with no migration needed. No-ops if the user already has any
 * emotions, including if they've deleted down to zero on purpose -- checked by the
 * caller passing the current count, not re-derived here. */
export async function ensureDefaultEmotions(userId: string): Promise<void> {
  const existing = await fetchEmotions()
  if (existing.length > 0) return
  const rows = DEFAULT_EMOTIONS.map((e, i) => ({ user_id: userId, phase: e.phase, name: e.name, sort_order: i, archived: false }))
  const { error } = await supabase.from('emotions').upsert(rows, { onConflict: 'user_id,phase,name', ignoreDuplicates: true })
  if (error) throw error
}

export async function setTradeEmotion(tradeId: string, emotionId: string, phase: Emotion['phase']) {
  const { error } = await supabase.from('trade_emotions').upsert({ trade_id: tradeId, emotion_id: emotionId, phase }, { onConflict: 'trade_id,emotion_id' })
  if (error) throw error
}

export async function removeTradeEmotion(tradeId: string, emotionId: string) {
  const { error } = await supabase.from('trade_emotions').delete().eq('trade_id', tradeId).eq('emotion_id', emotionId)
  if (error) throw error
}

/** All trade_emotions rows for a set of trade ids in one query -- used by the quick
 * psych pass to figure out which of today's trades have zero tags yet, without an
 * N+1 per trade. */
export async function fetchTradeEmotionCounts(tradeIds: string[]): Promise<Map<string, number>> {
  if (tradeIds.length === 0) return new Map()
  const { data, error } = await supabase.from('trade_emotions').select('trade_id').in('trade_id', tradeIds)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) counts.set(row.trade_id, (counts.get(row.trade_id) ?? 0) + 1)
  return counts
}

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

/** Full "profile page" shape: the playbook plus its rule groups, each with their
 * rules, ordered. */
export async function fetchPlaybookWithRules(playbookId: string): Promise<PlaybookWithRules | null> {
  const { data, error } = await supabase
    .from('playbooks')
    .select('*, playbook_rule_groups(*, playbook_rules(*))')
    .eq('id', playbookId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  // Sort groups and rules by sort_order client-side -- PostgREST embeds don't
  // support ORDER BY on nested resources.
  const withRules = data as unknown as PlaybookWithRules
  withRules.playbook_rule_groups.sort((a, b) => a.sort_order - b.sort_order)
  for (const group of withRules.playbook_rule_groups) {
    group.playbook_rules.sort((a, b) => a.sort_order - b.sort_order)
  }
  return withRules
}

/** Every playbook's rules, flattened -- used for the Dashboard's cross-playbook
 * "most expensive broken rule" headline, which needs every rule regardless of which
 * playbook it belongs to. */
export async function fetchAllPlaybookRules(): Promise<PlaybookRule[]> {
  const { data, error } = await supabase.from('playbooks').select('playbook_rule_groups(playbook_rules(*))').eq('archived', false)
  if (error) throw error
  const groups = (data ?? []) as unknown as { playbook_rule_groups: { playbook_rules: PlaybookRule[] }[] }[]
  return groups.flatMap((p) => p.playbook_rule_groups.flatMap((g) => g.playbook_rules))
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

/** Uploads to the private `playbook-assets` bucket under `${userId}/playbooks/${playbookId}/...`. */
export async function uploadPlaybookChart(userId: string, playbookId: string, file: File): Promise<string> {
  const path = `${userId}/playbooks/${playbookId}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('playbook-assets').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export async function getPlaybookAssetUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('playbook-assets').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function deletePlaybookAsset(path: string) {
  const { error } = await supabase.storage.from('playbook-assets').remove([path])
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Playbook rule groups + rules
// ---------------------------------------------------------------------------

export async function createRuleGroup(playbookId: string, name: string, sortOrder: number) {
  const { data, error } = await supabase
    .from('playbook_rule_groups')
    .insert({ playbook_id: playbookId, name, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function renameRuleGroup(id: string, name: string) {
  const { error } = await supabase.from('playbook_rule_groups').update({ name }).eq('id', id)
  if (error) throw error
}

export async function reorderRuleGroup(id: string, sortOrder: number) {
  const { error } = await supabase.from('playbook_rule_groups').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export async function deleteRuleGroup(id: string) {
  const { error } = await supabase.from('playbook_rule_groups').delete().eq('id', id)
  if (error) throw error
}

export async function createPlaybookRule(groupId: string, text: string, sortOrder: number) {
  const { data, error } = await supabase
    .from('playbook_rules')
    .insert({ group_id: groupId, text, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePlaybookRuleText(id: string, text: string) {
  const { error } = await supabase.from('playbook_rules').update({ text }).eq('id', id)
  if (error) throw error
}

export async function reorderPlaybookRule(id: string, sortOrder: number) {
  const { error } = await supabase.from('playbook_rules').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export async function deletePlaybookRule(id: string) {
  const { error } = await supabase.from('playbook_rules').delete().eq('id', id)
  if (error) throw error
}

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

export async function setTradeRuleCheckStatus(tradeId: string, ruleId: string, status: 'followed' | 'broken' | 'na') {
  const { error } = await supabase
    .from('trade_rule_checks')
    .upsert({ trade_id: tradeId, rule_id: ruleId, status }, { onConflict: 'trade_id,rule_id' })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Daily rules (global qualitative discipline checklist) + per-day checks
// ---------------------------------------------------------------------------

export async function fetchDailyRules(): Promise<DailyRule[]> {
  const { data, error } = await supabase.from('daily_rules').select('*').order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createDailyRule(userId: string, text: string, sortOrder: number) {
  const { data, error } = await supabase
    .from('daily_rules')
    .insert({ user_id: userId, text, sort_order: sortOrder, archived: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function renameDailyRule(id: string, text: string) {
  const { error } = await supabase.from('daily_rules').update({ text }).eq('id', id)
  if (error) throw error
}

export async function setDailyRuleArchived(id: string, archived: boolean) {
  const { error } = await supabase.from('daily_rules').update({ archived }).eq('id', id)
  if (error) throw error
}

export async function fetchDailyRuleChecks(checkDate: string): Promise<Map<string, boolean>> {
  const { data, error } = await supabase.from('daily_rule_checks').select('rule_id, checked').eq('check_date', checkDate)
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.rule_id, r.checked]))
}

/** All daily_rule_checks ever recorded -- used by the consistency stat ("days all
 * rules followed %"), which needs every day at once rather than one day at a time. */
export async function fetchAllDailyRuleChecks(): Promise<{ check_date: string; rule_id: string; checked: boolean }[]> {
  const { data, error } = await supabase.from('daily_rule_checks').select('check_date, rule_id, checked')
  if (error) throw error
  return data ?? []
}

export async function setDailyRuleCheck(userId: string, checkDate: string, ruleId: string, checked: boolean) {
  const { error } = await supabase
    .from('daily_rule_checks')
    .upsert({ user_id: userId, check_date: checkDate, rule_id: ruleId, checked }, { onConflict: 'user_id,check_date,rule_id' })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Missed trades
// ---------------------------------------------------------------------------

export async function fetchMissedTrades(playbookId?: string): Promise<MissedTrade[]> {
  let query = supabase.from('missed_trades').select('*').order('missed_date', { ascending: false })
  if (playbookId) query = query.eq('playbook_id', playbookId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createMissedTrade(
  userId: string,
  fields: {
    playbook_id: string
    missed_date: string
    symbol: string
    notes?: string | null
    est_pnl_missed?: number | null
    screenshot_url?: string | null
  },
): Promise<MissedTrade> {
  const { data, error } = await supabase
    .from('missed_trades')
    .insert({ user_id: userId, ...fields })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMissedTrade(id: string) {
  const { error } = await supabase.from('missed_trades').delete().eq('id', id)
  if (error) throw error
}

export async function updateMissedTradeScreenshot(id: string, screenshotUrl: string) {
  const { error } = await supabase.from('missed_trades').update({ screenshot_url: screenshotUrl }).eq('id', id)
  if (error) throw error
}

/** Uploads to the private `playbook-assets` bucket under `${userId}/missed-trades/${missedTradeId}/...`. */
export async function uploadMissedTradeScreenshot(userId: string, missedTradeId: string, file: File): Promise<string> {
  const path = `${userId}/missed-trades/${missedTradeId}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('playbook-assets').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

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
  fields: { planned_max_trades?: number | null; planned_max_loss?: number | null; plan_notes?: string | null },
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
