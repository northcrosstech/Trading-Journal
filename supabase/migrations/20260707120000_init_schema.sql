-- Trading Journal initial schema
-- Tables: trades, executions, options_detail, strategies, trade_strategies, daily_journal, sync_log
-- All tables use row-level security keyed to auth.uid() so each user only sees their own data.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
create table trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null,
    asset_type text not null check (asset_type in ('stock', 'option')),
    side text not null check (side in ('long', 'short')),
    avg_entry numeric,
    avg_exit numeric,
    hold_seconds integer,
    pnl numeric,
    fees numeric,
    notes text,
    screenshot_url text,
    first_in_at timestamptz,
    last_out_at timestamptz,
    created_at timestamptz not null default now()
);

create index trades_user_id_idx on trades (user_id);
create index trades_user_id_first_in_at_idx on trades (user_id, first_in_at desc);

alter table trades enable row level security;

create policy "trades_select_own" on trades for select using (auth.uid() = user_id);
create policy "trades_insert_own" on trades for insert with check (auth.uid() = user_id);
create policy "trades_update_own" on trades for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trades_delete_own" on trades for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- executions (individual fills belonging to a trade)
-- ---------------------------------------------------------------------------
create table executions (
    id uuid primary key default gen_random_uuid(),
    trade_id uuid not null references trades(id) on delete cascade,
    filled_at timestamptz not null,
    action text not null check (action in ('entry', 'add', 'trim', 'exit')),
    price numeric not null,
    quantity numeric not null,
    side text not null check (side in ('buy', 'sell')),
    created_at timestamptz not null default now()
);

create index executions_trade_id_idx on executions (trade_id);

alter table executions enable row level security;

create policy "executions_select_own" on executions for select using (
    exists (select 1 from trades where trades.id = executions.trade_id and trades.user_id = auth.uid())
);
create policy "executions_insert_own" on executions for insert with check (
    exists (select 1 from trades where trades.id = executions.trade_id and trades.user_id = auth.uid())
);
create policy "executions_update_own" on executions for update using (
    exists (select 1 from trades where trades.id = executions.trade_id and trades.user_id = auth.uid())
) with check (
    exists (select 1 from trades where trades.id = executions.trade_id and trades.user_id = auth.uid())
);
create policy "executions_delete_own" on executions for delete using (
    exists (select 1 from trades where trades.id = executions.trade_id and trades.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- options_detail (one-to-one with an options trade)
-- ---------------------------------------------------------------------------
create table options_detail (
    trade_id uuid primary key references trades(id) on delete cascade,
    option_type text not null check (option_type in ('call', 'put')),
    strike numeric not null,
    expiration date not null,
    premium numeric,
    iv_at_entry numeric,
    delta_at_entry numeric,
    theta_at_entry numeric,
    assignment_risk boolean not null default false,
    assigned boolean not null default false
);

alter table options_detail enable row level security;

create policy "options_detail_select_own" on options_detail for select using (
    exists (select 1 from trades where trades.id = options_detail.trade_id and trades.user_id = auth.uid())
);
create policy "options_detail_insert_own" on options_detail for insert with check (
    exists (select 1 from trades where trades.id = options_detail.trade_id and trades.user_id = auth.uid())
);
create policy "options_detail_update_own" on options_detail for update using (
    exists (select 1 from trades where trades.id = options_detail.trade_id and trades.user_id = auth.uid())
) with check (
    exists (select 1 from trades where trades.id = options_detail.trade_id and trades.user_id = auth.uid())
);
create policy "options_detail_delete_own" on options_detail for delete using (
    exists (select 1 from trades where trades.id = options_detail.trade_id and trades.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- strategies (user-managed tags)
-- ---------------------------------------------------------------------------
create table strategies (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (user_id, name)
);

alter table strategies enable row level security;

create policy "strategies_select_own" on strategies for select using (auth.uid() = user_id);
create policy "strategies_insert_own" on strategies for insert with check (auth.uid() = user_id);
create policy "strategies_update_own" on strategies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "strategies_delete_own" on strategies for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- trade_strategies (many-to-many join)
-- ---------------------------------------------------------------------------
create table trade_strategies (
    trade_id uuid not null references trades(id) on delete cascade,
    strategy_id uuid not null references strategies(id) on delete cascade,
    primary key (trade_id, strategy_id)
);

alter table trade_strategies enable row level security;

create policy "trade_strategies_select_own" on trade_strategies for select using (
    exists (select 1 from trades where trades.id = trade_strategies.trade_id and trades.user_id = auth.uid())
);
create policy "trade_strategies_insert_own" on trade_strategies for insert with check (
    exists (select 1 from trades where trades.id = trade_strategies.trade_id and trades.user_id = auth.uid())
    and exists (select 1 from strategies where strategies.id = trade_strategies.strategy_id and strategies.user_id = auth.uid())
);
create policy "trade_strategies_delete_own" on trade_strategies for delete using (
    exists (select 1 from trades where trades.id = trade_strategies.trade_id and trades.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- daily_journal
-- ---------------------------------------------------------------------------
create table daily_journal (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    entry_date date not null,
    notes text,
    mood_rating integer,
    created_at timestamptz not null default now(),
    unique (user_id, entry_date)
);

alter table daily_journal enable row level security;

create policy "daily_journal_select_own" on daily_journal for select using (auth.uid() = user_id);
create policy "daily_journal_insert_own" on daily_journal for insert with check (auth.uid() = user_id);
create policy "daily_journal_update_own" on daily_journal for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_journal_delete_own" on daily_journal for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- sync_log
-- ---------------------------------------------------------------------------
create table sync_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    ran_at timestamptz not null default now(),
    status text not null check (status in ('success', 'error')),
    message text,
    trades_ingested integer
);

create index sync_log_user_id_ran_at_idx on sync_log (user_id, ran_at desc);

alter table sync_log enable row level security;

create policy "sync_log_select_own" on sync_log for select using (auth.uid() = user_id);
create policy "sync_log_insert_own" on sync_log for insert with check (auth.uid() = user_id);
