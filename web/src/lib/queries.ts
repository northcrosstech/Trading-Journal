import { supabase } from './supabase'
import type { TradeWithDetails, DailyJournal } from './database.types'

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
