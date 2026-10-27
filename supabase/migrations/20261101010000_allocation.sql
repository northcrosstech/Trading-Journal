-- Allocation targets. Money that can move together is one pool:
--   * all brokerage portfolios together -- a split between them (portfolios.target_pct)
--     and one mix-by-type target (allocation_targets scope 'brokerage')
--   * each retirement portfolio (401k / IRAs) on its own -- money can't move in or out, so
--     it's never in the split; it can have its own mix target (scope = its portfolio id)
--
--   portfolios.target_pct            -- brokerage only: % of all brokerage money
--   allocation_targets               -- per user per pool: % for etf / stock / bond / option / cash
--   ticker_types                     -- per user: your type for a ticker instead of the detected one
--   wealth_settings.allocation_tolerance -- how far off target before a warning (default 5%)
--   fundamentals.security_type / description -- Finnhub's type (Common Stock, ETP, ADR, REIT...)
--                                     and name, used to detect stock / ETF / bond
--
-- Requires 20261031010000_research.sql and 20261028020000_ledger_lockdown.sql. Safe to re-run.
begin;

alter table portfolios add column if not exists target_pct numeric check (target_pct is null or (target_pct >= 0 and target_pct <= 100));
-- the ledger lock lets users change only these portfolio columns directly
grant update (target_pct) on portfolios to authenticated;

alter table wealth_settings add column if not exists allocation_tolerance numeric not null default 5
    check (allocation_tolerance > 0 and allocation_tolerance <= 50);

alter table fundamentals add column if not exists security_type text;
alter table fundamentals add column if not exists description text;

create table if not exists allocation_targets (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    scope text not null,  -- 'brokerage', or a retirement portfolio's id
    etf numeric not null default 0 check (etf between 0 and 100),
    stock numeric not null default 0 check (stock between 0 and 100),
    bond numeric not null default 0 check (bond between 0 and 100),
    option numeric not null default 0 check (option between 0 and 100),
    cash numeric not null default 0 check (cash between 0 and 100),
    updated_at timestamptz not null default now(),
    primary key (user_id, scope),
    check (etf + stock + bond + option + cash = 100)
);

create table if not exists ticker_types (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    symbol text not null,
    asset_type text not null check (asset_type in ('stock', 'etf', 'bond')),
    updated_at timestamptz not null default now(),
    primary key (user_id, symbol)
);

alter table allocation_targets enable row level security;
alter table ticker_types enable row level security;
drop policy if exists "allocation_targets_own" on allocation_targets;
create policy "allocation_targets_own" on allocation_targets for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ticker_types_own" on ticker_types;
create policy "ticker_types_own" on ticker_types for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
