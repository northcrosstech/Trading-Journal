import { supabase } from './supabase'
import type {
  TradeWithDetails,
  TradeWithStrategies,
  TradeWithRules,
  DailyJournal,
  TargetSettings,
  SyncLog,
  DailyPlanWithStrategies,
} from './database.types'

const DAILY_PLAN_WITH_STRATEGIES_SELECT = '*, daily_plan_strategies(strategy_id, strategies(*))'

const TRADE_WITH_DETAILS_SELECT =
  '*, options_detail(*), executions(*), trade_strategies(strategy_id, strategies(*)), trade_rules(rule_id, status, rules(*))'

export async function fetchTradesWithDetails(): Promise<TradeWithDetails[]> {
  const { data, error } = await supabase
    .from('trades')
    .select(TRADE_WITH_DETAILS_SELECT)
    .order('first_in_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as TradeWithDetails[]
}

/** Lighter than fetchTradesWithDetails -- just the strategy join. Used by the daily
 * plan feature (Dashboard's Today's Plan card) which only needs "which setups were
 * traded," not executions/options_detail/trade_rules. */
export async function fetchTradesWithStrategies(): Promise<TradeWithStrategies[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*, trade_strategies(strategy_id, strategies(*))')
    .order('first_in_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as TradeWithStrategies[]
}

/** Lighter than fetchTradesWithDetails -- just the rules join. Used by the Dashboard's
 * most-expensive-rule card. */
export async function fetchTradesWithRules(): Promise<TradeWithRules[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*, trade_rules(rule_id, status, rules(*))')
    .order('first_in_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as TradeWithRules[]
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

export async function fetchStrategies() {
  const { data, error } = await supabase.from('strategies').select('*').order('name')
  if (error) throw error
  return data
}

export async function createStrategy(userId: string, name: string, color: string) {
  const { data, error } = await supabase
    .from('strategies')
    .insert({ user_id: userId, name, color, archived: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function renameStrategy(id: string, name: string) {
  const { error } = await supabase.from('strategies').update({ name }).eq('id', id)
  if (error) throw error
}

export async function updateStrategyColor(id: string, color: string) {
  const { error } = await supabase.from('strategies').update({ color }).eq('id', id)
  if (error) throw error
}

export async function setStrategyArchived(id: string, archived: boolean) {
  const { error } = await supabase.from('strategies').update({ archived }).eq('id', id)
  if (error) throw error
}

export async function fetchRules() {
  const { data, error } = await supabase.from('rules').select('*').order('type').order('name')
  if (error) throw error
  return data
}

export async function createRule(userId: string, name: string, type: 'entry' | 'exit') {
  const { data, error } = await supabase
    .from('rules')
    .insert({ user_id: userId, name, type, archived: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function renameRule(id: string, name: string) {
  const { error } = await supabase.from('rules').update({ name }).eq('id', id)
  if (error) throw error
}

export async function setRuleArchived(id: string, archived: boolean) {
  const { error } = await supabase.from('rules').update({ archived }).eq('id', id)
  if (error) throw error
}

export async function setTradeRuleStatus(tradeId: string, ruleId: string, status: 'followed' | 'broken' | 'na') {
  const { error } = await supabase
    .from('trade_rules')
    .upsert({ trade_id: tradeId, rule_id: ruleId, status }, { onConflict: 'trade_id,rule_id' })
  if (error) throw error
}

export async function addTradeStrategy(tradeId: string, strategyId: string) {
  const { error } = await supabase.from('trade_strategies').insert({ trade_id: tradeId, strategy_id: strategyId })
  if (error) throw error
}

export async function removeTradeStrategy(tradeId: string, strategyId: string) {
  const { error } = await supabase
    .from('trade_strategies')
    .delete()
    .eq('trade_id', tradeId)
    .eq('strategy_id', strategyId)
  if (error) throw error
}

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

export async function fetchDailyPlan(planDate: string): Promise<DailyPlanWithStrategies | null> {
  const { data, error } = await supabase
    .from('daily_plans')
    .select(DAILY_PLAN_WITH_STRATEGIES_SELECT)
    .eq('plan_date', planDate)
    .maybeSingle()
  if (error) throw error
  return data as unknown as DailyPlanWithStrategies | null
}

export async function fetchAllDailyPlans(): Promise<DailyPlanWithStrategies[]> {
  const { data, error } = await supabase.from('daily_plans').select(DAILY_PLAN_WITH_STRATEGIES_SELECT)
  if (error) throw error
  return (data ?? []) as unknown as DailyPlanWithStrategies[]
}

/** Upserts the plan row and returns it (with its id) so the caller can then set
 * daily_plan_strategies -- a separate step, same two-step shape as trade_strategies. */
export async function upsertDailyPlan(
  userId: string,
  planDate: string,
  fields: { planned_max_trades?: number | null; planned_max_loss?: number | null; plan_notes?: string | null },
): Promise<DailyPlanWithStrategies> {
  const { data, error } = await supabase
    .from('daily_plans')
    .upsert(
      { user_id: userId, plan_date: planDate, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,plan_date' },
    )
    .select(DAILY_PLAN_WITH_STRATEGIES_SELECT)
    .single()
  if (error) throw error
  return data as unknown as DailyPlanWithStrategies
}

export async function addDailyPlanStrategy(dailyPlanId: string, strategyId: string) {
  const { error } = await supabase.from('daily_plan_strategies').insert({ daily_plan_id: dailyPlanId, strategy_id: strategyId })
  if (error) throw error
}

export async function removeDailyPlanStrategy(dailyPlanId: string, strategyId: string) {
  const { error } = await supabase
    .from('daily_plan_strategies')
    .delete()
    .eq('daily_plan_id', dailyPlanId)
    .eq('strategy_id', strategyId)
  if (error) throw error
}
