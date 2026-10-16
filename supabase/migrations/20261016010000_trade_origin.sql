-- Where a trade's idea came from: converts trades.planned (yes/no) in place into
-- trades.trade_origin with three values:
--   planned    -- on the pre-market plan
--   unplanned  -- the trader's own idea, not on the plan
--   followed   -- someone else's call (alert, Discord, mentor, signal)
-- null = not reviewed yet. Existing answers carry over: true -> planned, false -> unplanned.
--
-- Safe to re-run, and also handles a database where an earlier draft of this migration
-- already added trade_origin alongside planned (backfills it, then drops planned).
-- The sync worker's upsert never touches this column.
--
-- NOT backward compatible: the previous web build reads/writes trades.planned, so
-- deploy the matching web build right after running this.
do $$
declare
  has_planned boolean;
  has_origin boolean;
begin
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'trades' and column_name = 'planned')
    into has_planned;
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'trades' and column_name = 'trade_origin')
    into has_origin;

  if has_planned and not has_origin then
    alter table public.trades
      alter column planned type text
      using case when planned then 'planned' when not planned then 'unplanned' end;
    alter table public.trades rename column planned to trade_origin;
  elsif has_planned and has_origin then
    update public.trades
      set trade_origin = case when planned then 'planned' else 'unplanned' end
      where trade_origin is null and planned is not null;
    alter table public.trades drop column planned;
  end if;
end $$;

alter table public.trades drop constraint if exists trades_trade_origin_check;
alter table public.trades add constraint trades_trade_origin_check
  check (trade_origin in ('planned', 'unplanned', 'followed'));
