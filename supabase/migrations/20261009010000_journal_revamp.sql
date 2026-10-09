-- Journal revamp: a fast review loop instead of many separate journaling inputs.
--
--   trades.planned      -- was this trade on the pre-market plan? (null = not reviewed yet)
--   trades.mistakes     -- fixed short vocabulary (see web/src/lib/mistakes.ts); replaces
--                          phase-split emotions + per-rule checks as the thing reviewed and
--                          measured ("cost of mistakes")
--   trades.reviewed_at  -- set when the trade has been through the review queue
--   daily_plans.market_read / focus -- the 2 new fields of the slimmed pre-market plan
--                          (watchlist reuses plan_notes, max loss/trades reuse the existing
--                          planned_max_* columns)
--
-- Purely additive: no column, table, policy, or RPC is dropped or changed. The old
-- psychology/rules tables stay in place (just no longer shown). upsert_trade_bundle
-- never touches the new trades columns, so the sync worker can't overwrite a review.
-- Safe to re-run.
begin;

alter table trades add column if not exists planned boolean;
alter table trades add column if not exists mistakes text[] not null default '{}';
alter table trades add column if not exists reviewed_at timestamptz;

alter table daily_plans add column if not exists market_read text;
alter table daily_plans add column if not exists focus text;

-- One note box per trade now: fold any thesis/reflection text into notes so it stays
-- visible. The guard keeps a re-run from appending it twice.
update trades
set notes = concat_ws(
    E'\n\n',
    nullif(btrim(notes), ''),
    case when nullif(btrim(thesis_note), '') is not null then 'Why I took it: ' || btrim(thesis_note) end,
    case when nullif(btrim(reflection_note), '') is not null then 'After: ' || btrim(reflection_note) end
)
where (nullif(btrim(thesis_note), '') is not null or nullif(btrim(reflection_note), '') is not null)
  and coalesce(notes, '') not like '%Why I took it: %'
  and coalesce(notes, '') not like '%After: %';

-- The only existing emotion tags that map cleanly onto the new mistake vocabulary.
update trades t
set mistakes = array_append(t.mistakes, 'FOMO')
where not ('FOMO' = any (t.mistakes))
  and exists (
      select 1
      from trade_emotions te
      join emotions e on e.id = te.emotion_id
      where te.trade_id = t.id and lower(e.name) in ('fomo', 'chasing')
  );

-- Fresh start for the review queue: everything that booked before today (Central
-- Time, the app's trading-day timezone) counts as already reviewed, so the queue
-- starts with today's trades instead of a 300-trade backlog.
update trades
set reviewed_at = now()
where reviewed_at is null
  and coalesce(last_out_at, first_in_at)
      < ((now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago';

commit;
