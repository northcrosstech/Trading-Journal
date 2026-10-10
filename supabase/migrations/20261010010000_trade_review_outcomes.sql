-- Review outcomes: the positive side of the review and the "what if" of each exit.
--
--   strengths       -- "done right" tags, the mirror of trades.mistakes (fixed vocabulary
--                      in web/src/lib/strengths.ts)
--   stop_price      -- planned stop, option premium (same units as avg_entry/avg_exit);
--                      defines 1R of risk
--   target_price    -- planned target, option premium; gives planned R
--   alt_exit_price  -- where the whole position could have exited instead (held to
--                      target, honored the stop, ...); gives the what-if P&L
--
-- Additive and safe to re-run. The sync worker's upsert never touches these columns.
alter table trades add column if not exists strengths text[] not null default '{}';
alter table trades add column if not exists stop_price numeric;
alter table trades add column if not exists target_price numeric;
alter table trades add column if not exists alt_exit_price numeric;
