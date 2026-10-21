-- Wealth settings: per-user preferences for the Wealth side (kept apart from the trading
-- side's target_settings).
--
--   close_from_month -- first month the month-end close checklist applies to (yyyy-mm-01).
--                       Months before it are never asked to be closed. Null = no start set.
--
-- Requires nothing else. Safe to re-run.
begin;

create table if not exists wealth_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    close_from_month date,
    updated_at timestamptz not null default now()
);

alter table wealth_settings enable row level security;
drop policy if exists "wealth_settings_own" on wealth_settings;
create policy "wealth_settings_own" on wealth_settings for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

commit;
