-- Position plans, plan notes and stock theses.
--
--   position_targets   -- per portfolio: a target % for each ticker (what's left over is the
--                         cash target). Saved all at once with set_position_plan().
--   portfolios.notes   -- the portfolio's plan notes (its rules / reasons, in your words)
--   ticker_theses      -- per user per ticker: why you own it, and when to review that
--
-- Requires 20261101010000_allocation.sql. Safe to re-run.
begin;

alter table portfolios add column if not exists notes text check (notes is null or length(notes) <= 10000);
-- the ledger lock lets users change only these portfolio columns directly
grant update (notes) on portfolios to authenticated;

create table if not exists position_targets (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z0-9.\-]{1,12}$'),
    target_pct numeric not null check (target_pct > 0 and target_pct <= 100),
    updated_at timestamptz not null default now(),
    primary key (portfolio_id, symbol)
);
create index if not exists position_targets_user on position_targets (user_id);

alter table position_targets enable row level security;
drop policy if exists "position_targets_own" on position_targets;
create policy "position_targets_own" on position_targets for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and exists (select 1 from portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

create table if not exists ticker_theses (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    symbol text not null,
    thesis text not null default '' check (length(thesis) <= 10000),
    review_on date,
    updated_at timestamptz not null default now(),
    primary key (user_id, symbol)
);

alter table ticker_theses enable row level security;
drop policy if exists "ticker_theses_own" on ticker_theses;
create policy "ticker_theses_own" on ticker_theses for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Replace a portfolio's whole plan in one go (an empty list clears it). Runs as the caller,
-- so the policies above still apply.
create or replace function set_position_plan(p_portfolio uuid, p_targets jsonb)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    n int;
begin
    if not exists (select 1 from portfolios where id = p_portfolio and user_id = auth.uid()) then
        raise exception 'Portfolio not found';
    end if;
    if jsonb_typeof(coalesce(p_targets, '[]'::jsonb)) <> 'array' then
        raise exception 'Targets must be a list';
    end if;
    if (select coalesce(sum((t->>'pct')::numeric), 0) from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) t) > 100.0001 then
        raise exception 'Targets add up to more than 100%%';
    end if;

    delete from position_targets where portfolio_id = p_portfolio;
    insert into position_targets (user_id, portfolio_id, symbol, target_pct)
    select auth.uid(), p_portfolio, upper(trim(t->>'symbol')), (t->>'pct')::numeric
    from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) t;
    get diagnostics n = row_count;
    return n;
end;
$$;
grant execute on function set_position_plan(uuid, jsonb) to authenticated;

commit;
