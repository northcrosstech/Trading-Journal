-- Closes two holes that let a signed-up (or anonymous) caller reach another user's data.
--
-- 1. upsert_trade_bundle runs as the database owner and trusts the user_id inside its
--    payload. It was callable with the public key, so anyone could write trades into any
--    account. Only the sync worker calls it, and the worker uses the service role, so
--    everyone else loses the right to call it. Nothing in the app calls it.
-- 2. The five backup_*_20260711 tables were made with CREATE TABLE AS, so they had no
--    row-level security and were readable and writable with the public key. They are kept
--    (nothing is deleted) but are now closed to everyone except the owner and the worker.
--
-- To check afterwards (both should return false):
--   select has_function_privilege('anon', 'public.upsert_trade_bundle(jsonb)', 'execute');
--   select has_function_privilege('authenticated', 'public.upsert_trade_bundle(jsonb)', 'execute');
--
-- Safe to re-run.
begin;

revoke execute on function upsert_trade_bundle(jsonb) from public, anon, authenticated;
grant execute on function upsert_trade_bundle(jsonb) to service_role;
alter function upsert_trade_bundle(jsonb) set search_path = public, pg_temp;

do $$
declare
    t text;
begin
    foreach t in array array[
        'backup_strategies_20260711',
        'backup_trade_strategies_20260711',
        'backup_rules_20260711',
        'backup_trade_rules_20260711',
        'backup_daily_plan_strategies_20260711'
    ] loop
        if to_regclass('public.' || t) is not null then
            execute format('alter table public.%I enable row level security', t);
            execute format('revoke all on table public.%I from public, anon, authenticated', t);
        end if;
    end loop;
end $$;

commit;
