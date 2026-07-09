-- Pre-market plan + intention-vs-reality. Purely additive: new tables only, no
-- changes to any existing table, column, RPC function, or policy.
create table daily_plans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    plan_date date not null,
    planned_max_trades integer,
    planned_max_loss numeric,
    plan_notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, plan_date)
);

alter table daily_plans enable row level security;

create policy "daily_plans_select_own" on daily_plans for select using (auth.uid() = user_id);
create policy "daily_plans_insert_own" on daily_plans for insert with check (auth.uid() = user_id);
create policy "daily_plans_update_own" on daily_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_plans_delete_own" on daily_plans for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- daily_plan_strategies (planned setups -- same many-to-many shape as the existing
-- trade_strategies join table, so "planned vs actual" setups is an exact set
-- comparison against the same strategy tags used everywhere else in the app)
-- ---------------------------------------------------------------------------
create table daily_plan_strategies (
    daily_plan_id uuid not null references daily_plans(id) on delete cascade,
    strategy_id uuid not null references strategies(id) on delete cascade,
    primary key (daily_plan_id, strategy_id)
);

alter table daily_plan_strategies enable row level security;

create policy "daily_plan_strategies_select_own" on daily_plan_strategies for select using (
    exists (select 1 from daily_plans where daily_plans.id = daily_plan_strategies.daily_plan_id and daily_plans.user_id = auth.uid())
);
create policy "daily_plan_strategies_insert_own" on daily_plan_strategies for insert with check (
    exists (select 1 from daily_plans where daily_plans.id = daily_plan_strategies.daily_plan_id and daily_plans.user_id = auth.uid())
    and exists (select 1 from strategies where strategies.id = daily_plan_strategies.strategy_id and strategies.user_id = auth.uid())
);
create policy "daily_plan_strategies_delete_own" on daily_plan_strategies for delete using (
    exists (select 1 from daily_plans where daily_plans.id = daily_plan_strategies.daily_plan_id and daily_plans.user_id = auth.uid())
);
