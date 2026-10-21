-- Net worth tracker: accounts (assets and debts) and one balance per account per month.
--
--   networth_accounts  -- a named account in a category; opened_month / closed_month
--                         (first of the month) bound which months it shows up in, so
--                         closing an account drops it from the monthly form without
--                         losing its history
--   networth_balances  -- the account's balance for a month, always stored positive;
--                         whether it adds or subtracts comes from the category
--
-- Portfolios tagged brokerage / 401k / IRA feed net worth automatically from
-- portfolio_daily_values (see 20261021020000_portfolios.sql); they are not rows here.
-- Additive and safe to re-run.
begin;

create table if not exists networth_accounts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    category text not null check (category in (
        -- assets
        'home', 'cash', '401k', 'traditional_ira', 'roth_ira', 'brokerage', 'auto', 'misc_asset',
        -- debts
        'mortgage', 'auto_loan', 'credit_card', 'debt', 'other_debt'
    )),
    opened_month date not null,
    closed_month date,
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    check (closed_month is null or closed_month > opened_month)
);
create index if not exists networth_accounts_user_idx on networth_accounts (user_id);

create table if not exists networth_balances (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id uuid not null references networth_accounts(id) on delete cascade,
    month date not null,
    balance numeric not null check (balance >= 0),
    updated_at timestamptz not null default now(),
    unique (account_id, month)
);
create index if not exists networth_balances_user_month_idx on networth_balances (user_id, month);

alter table networth_accounts enable row level security;
alter table networth_balances enable row level security;

drop policy if exists "networth_accounts_own" on networth_accounts;
create policy "networth_accounts_own" on networth_accounts for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "networth_balances_own" on networth_balances;
create policy "networth_balances_own" on networth_balances for all
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and exists (select 1 from networth_accounts a where a.id = account_id and a.user_id = auth.uid())
    );

commit;
