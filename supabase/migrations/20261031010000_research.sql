-- Research: fair value (Graham's revised formula) and a 100-point score for each holding
-- and watchlist ticker, from free data the worker fetches daily.
--
--   fundamentals        -- per ticker, shared like `prices`: Finnhub EPS, growth, margins,
--                          debt, next earnings date. Written only by the worker (service role).
--   macro_indicators    -- shared: FRED AAA corporate yield, 10-year Treasury, unemployment
--                          (latest and 12-month low). Written only by the worker.
--   research_watchlist  -- per user: tickers to research beyond what's held
--   research_overrides  -- per user: a number you set in place of an automatic one
--                          (eps, growth, or a score part), per ticker
--   wealth_settings.growth_cap        -- highest growth % the fair value uses (default 30)
--   wealth_settings.economy_override  -- your own economy score (0-30) instead of the automatic one
--
-- Requires 20261024010000_wealth_settings.sql. Safe to re-run.
begin;

create table if not exists fundamentals (
    symbol text primary key,
    name text,
    eps_ttm numeric,
    eps_growth_5y numeric,      -- % per year, past 5 years
    eps_growth_3y numeric,      -- % per year, past 3 years
    gross_margin numeric,       -- %, trailing 12 months
    roe numeric,                -- return on equity %, trailing 12 months
    net_margin numeric,         -- %, trailing 12 months
    debt_to_equity numeric,
    current_ratio numeric,
    next_earnings_date date,
    next_earnings_hour text,    -- bmo (before open) / amc (after close)
    next_eps_estimate numeric,
    updated_at timestamptz not null default now()
);

create table if not exists macro_indicators (
    key text primary key,       -- aaa_yield, treasury_10y, unemployment_rate, unemployment_12m_low
    value numeric not null,
    as_of date not null,
    updated_at timestamptz not null default now()
);

create table if not exists research_watchlist (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    symbol text not null check (symbol <> '' and symbol = upper(symbol)),
    created_at timestamptz not null default now(),
    unique (user_id, symbol)
);

create table if not exists research_overrides (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    symbol text not null,
    field text not null check (field in ('eps', 'growth', 'valuation', 'growth_score', 'moat', 'execution')),
    value numeric not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, symbol, field)
);

alter table wealth_settings add column if not exists growth_cap numeric not null default 30 check (growth_cap > 0 and growth_cap <= 100);
alter table wealth_settings add column if not exists economy_override numeric check (economy_override is null or economy_override between 0 and 30);

alter table fundamentals enable row level security;
alter table macro_indicators enable row level security;
alter table research_watchlist enable row level security;
alter table research_overrides enable row level security;

-- Market data: any signed-in user reads, only the worker (service role) writes.
drop policy if exists "fundamentals_read" on fundamentals;
create policy "fundamentals_read" on fundamentals for select to authenticated using (true);
drop policy if exists "macro_indicators_read" on macro_indicators;
create policy "macro_indicators_read" on macro_indicators for select to authenticated using (true);

drop policy if exists "research_watchlist_own" on research_watchlist;
create policy "research_watchlist_own" on research_watchlist for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "research_overrides_own" on research_overrides;
create policy "research_overrides_own" on research_overrides for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
