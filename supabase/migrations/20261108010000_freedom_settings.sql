-- Towards financial freedom: the numbers behind the gauge on the Wealth page. Balances come
-- from net worth and portfolios; only these inputs are stored.
--
--   monthly_spending -- your own ongoing spending per month; null = use the suggested number
--   other_bills      -- bills not on cards, part of the suggested number
--   monthly_savings  -- your own monthly savings; null = use the suggested number
--   withdrawal_rate  -- % of your money you'd spend each year (25x spending at 4%)
--   real_return      -- expected yearly growth after inflation, %
--   coast_years      -- years until you'd stop working at the latest, for the Coast milestone
--
-- Safe to re-run.
begin;

create table if not exists freedom_settings (
    user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    monthly_spending numeric check (monthly_spending is null or monthly_spending >= 0),
    other_bills numeric not null default 0 check (other_bills >= 0),
    monthly_savings numeric check (monthly_savings is null or monthly_savings >= 0),
    withdrawal_rate numeric not null default 4 check (withdrawal_rate >= 1 and withdrawal_rate <= 10),
    real_return numeric not null default 5 check (real_return >= 0 and real_return <= 15),
    coast_years integer not null default 25 check (coast_years >= 0 and coast_years <= 60),
    updated_at timestamptz not null default now()
);

alter table freedom_settings enable row level security;
drop policy if exists "freedom_settings_own" on freedom_settings;
create policy "freedom_settings_own" on freedom_settings for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
