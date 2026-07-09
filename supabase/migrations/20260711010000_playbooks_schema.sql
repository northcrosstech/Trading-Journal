-- Replaces the old strategies/rules concept with a unified Playbook system, plus
-- daily_rules (global qualitative discipline checklist -- deliberately NOT numeric
-- limits, since target_settings + daily_plans already auto-track max trades/max
-- loss from real trade data; see the migration plan discussion) and missed_trades.
--
-- VERIFIED before writing this (not assumed): grepped every worker/*.py file and
-- read every function ever defined in supabase/migrations/*.sql. The worker's ENTIRE
-- database surface is one direct write (sync_log) and one RPC call
-- (upsert_trade_bundle, which only touches trades/executions/options_detail). No
-- trigger anywhere references strategies/trade_strategies/rules/trade_rules. Dropping
-- these five tables cannot break sync, fees, or P&L.
--
-- Safety: the five tables being dropped are snapshotted into backup_* tables first,
-- in the same transaction, so "the data isn't useful" stays reversible for as long as
-- the backups are kept around. Drop them yourself once you're sure (they don't have
-- RLS and aren't referenced by the app, so leaving them briefly costs nothing but
-- doesn't need to be permanent).

begin;

-- ---------------------------------------------------------------------------
-- Backups (snapshot before touching anything)
-- ---------------------------------------------------------------------------
create table backup_strategies_20260711 as select * from strategies;
create table backup_trade_strategies_20260711 as select * from trade_strategies;
create table backup_rules_20260711 as select * from rules;
create table backup_trade_rules_20260711 as select * from trade_rules;
create table backup_daily_plan_strategies_20260711 as select * from daily_plan_strategies;

-- ---------------------------------------------------------------------------
-- playbooks (a documented setup)
-- ---------------------------------------------------------------------------
create table playbooks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    color text not null default '#3b82f6',
    icon text, -- freeform emoji, e.g. '📈' -- no icon library, just a short text field
    market_conditions text,
    example_chart_url text,
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, name)
);

alter table playbooks enable row level security;

create policy "playbooks_select_own" on playbooks for select using (auth.uid() = user_id);
create policy "playbooks_insert_own" on playbooks for insert with check (auth.uid() = user_id);
create policy "playbooks_update_own" on playbooks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "playbooks_delete_own" on playbooks for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- playbook_rule_groups (rules are grouped, not flat -- e.g. "Entry Criteria")
-- ---------------------------------------------------------------------------
create table playbook_rule_groups (
    id uuid primary key default gen_random_uuid(),
    playbook_id uuid not null references playbooks(id) on delete cascade,
    name text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

alter table playbook_rule_groups enable row level security;

create policy "playbook_rule_groups_select_own" on playbook_rule_groups for select using (
    exists (select 1 from playbooks where playbooks.id = playbook_rule_groups.playbook_id and playbooks.user_id = auth.uid())
);
create policy "playbook_rule_groups_insert_own" on playbook_rule_groups for insert with check (
    exists (select 1 from playbooks where playbooks.id = playbook_rule_groups.playbook_id and playbooks.user_id = auth.uid())
);
create policy "playbook_rule_groups_update_own" on playbook_rule_groups for update using (
    exists (select 1 from playbooks where playbooks.id = playbook_rule_groups.playbook_id and playbooks.user_id = auth.uid())
) with check (
    exists (select 1 from playbooks where playbooks.id = playbook_rule_groups.playbook_id and playbooks.user_id = auth.uid())
);
create policy "playbook_rule_groups_delete_own" on playbook_rule_groups for delete using (
    exists (select 1 from playbooks where playbooks.id = playbook_rule_groups.playbook_id and playbooks.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- playbook_rules
-- ---------------------------------------------------------------------------
create table playbook_rules (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references playbook_rule_groups(id) on delete cascade,
    text text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

alter table playbook_rules enable row level security;

create policy "playbook_rules_select_own" on playbook_rules for select using (
    exists (
        select 1 from playbook_rule_groups
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rule_groups.id = playbook_rules.group_id and playbooks.user_id = auth.uid()
    )
);
create policy "playbook_rules_insert_own" on playbook_rules for insert with check (
    exists (
        select 1 from playbook_rule_groups
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rule_groups.id = playbook_rules.group_id and playbooks.user_id = auth.uid()
    )
);
create policy "playbook_rules_update_own" on playbook_rules for update using (
    exists (
        select 1 from playbook_rule_groups
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rule_groups.id = playbook_rules.group_id and playbooks.user_id = auth.uid()
    )
) with check (
    exists (
        select 1 from playbook_rule_groups
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rule_groups.id = playbook_rules.group_id and playbooks.user_id = auth.uid()
    )
);
create policy "playbook_rules_delete_own" on playbook_rules for delete using (
    exists (
        select 1 from playbook_rule_groups
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rule_groups.id = playbook_rules.group_id and playbooks.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- trade_playbooks (exactly ONE playbook per trade -- primary key on trade_id
-- alone, not a composite key, so "change the playbook" is a plain UPDATE rather
-- than delete+insert. Confirmed intentional: a trade executes one setup; a day's
-- PLAN can still name several watched playbooks, see daily_plan_playbooks below.)
-- ---------------------------------------------------------------------------
create table trade_playbooks (
    trade_id uuid primary key references trades(id) on delete cascade,
    playbook_id uuid not null references playbooks(id) on delete cascade
);

alter table trade_playbooks enable row level security;

create policy "trade_playbooks_select_own" on trade_playbooks for select using (
    exists (select 1 from trades where trades.id = trade_playbooks.trade_id and trades.user_id = auth.uid())
);
create policy "trade_playbooks_insert_own" on trade_playbooks for insert with check (
    exists (select 1 from trades where trades.id = trade_playbooks.trade_id and trades.user_id = auth.uid())
    and exists (select 1 from playbooks where playbooks.id = trade_playbooks.playbook_id and playbooks.user_id = auth.uid())
);
create policy "trade_playbooks_update_own" on trade_playbooks for update using (
    exists (select 1 from trades where trades.id = trade_playbooks.trade_id and trades.user_id = auth.uid())
) with check (
    exists (select 1 from trades where trades.id = trade_playbooks.trade_id and trades.user_id = auth.uid())
    and exists (select 1 from playbooks where playbooks.id = trade_playbooks.playbook_id and playbooks.user_id = auth.uid())
);
create policy "trade_playbooks_delete_own" on trade_playbooks for delete using (
    exists (select 1 from trades where trades.id = trade_playbooks.trade_id and trades.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- trade_rule_checks (per-trade three-state checklist against the LINKED
-- playbook's rules -- direct successor to the old global trade_rules, scoped to
-- playbook_rules instead of a flat global rules table)
-- ---------------------------------------------------------------------------
create table trade_rule_checks (
    trade_id uuid not null references trades(id) on delete cascade,
    rule_id uuid not null references playbook_rules(id) on delete cascade,
    status text not null check (status in ('followed', 'broken', 'na')) default 'na',
    primary key (trade_id, rule_id)
);

alter table trade_rule_checks enable row level security;

create policy "trade_rule_checks_select_own" on trade_rule_checks for select using (
    exists (select 1 from trades where trades.id = trade_rule_checks.trade_id and trades.user_id = auth.uid())
);
create policy "trade_rule_checks_insert_own" on trade_rule_checks for insert with check (
    exists (select 1 from trades where trades.id = trade_rule_checks.trade_id and trades.user_id = auth.uid())
    and exists (
        select 1 from playbook_rules
        join playbook_rule_groups on playbook_rule_groups.id = playbook_rules.group_id
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rules.id = trade_rule_checks.rule_id and playbooks.user_id = auth.uid()
    )
);
create policy "trade_rule_checks_update_own" on trade_rule_checks for update using (
    exists (select 1 from trades where trades.id = trade_rule_checks.trade_id and trades.user_id = auth.uid())
) with check (
    exists (select 1 from trades where trades.id = trade_rule_checks.trade_id and trades.user_id = auth.uid())
    and exists (
        select 1 from playbook_rules
        join playbook_rule_groups on playbook_rule_groups.id = playbook_rules.group_id
        join playbooks on playbooks.id = playbook_rule_groups.playbook_id
        where playbook_rules.id = trade_rule_checks.rule_id and playbooks.user_id = auth.uid()
    )
);
create policy "trade_rule_checks_delete_own" on trade_rule_checks for delete using (
    exists (select 1 from trades where trades.id = trade_rule_checks.trade_id and trades.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- daily_rules (global, qualitative-only discipline checklist -- deliberately
-- NOT numeric limits like max trades / max loss, which already live in
-- target_settings + daily_plans and are computed automatically from real trade
-- data. This holds things that can't be auto-derived, e.g. "waited for
-- confirmation candle," "no revenge entries." `archived` added beyond the
-- original spec for consistency with every other user-managed list in this app
-- (strategies/rules both had it) -- lets you retire a rule without losing its
-- historical daily_rule_checks.)
-- ---------------------------------------------------------------------------
create table daily_rules (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    text text not null,
    sort_order integer not null default 0,
    archived boolean not null default false,
    created_at timestamptz not null default now()
);

alter table daily_rules enable row level security;

create policy "daily_rules_select_own" on daily_rules for select using (auth.uid() = user_id);
create policy "daily_rules_insert_own" on daily_rules for insert with check (auth.uid() = user_id);
create policy "daily_rules_update_own" on daily_rules for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_rules_delete_own" on daily_rules for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- daily_rule_checks (checked off per day -- the progress-tracker data).
-- Column named check_date, not date, matching this app's existing convention of
-- avoiding the bare reserved-adjacent word (daily_journal.entry_date,
-- daily_plans.plan_date).
-- ---------------------------------------------------------------------------
create table daily_rule_checks (
    user_id uuid not null references auth.users(id) on delete cascade,
    check_date date not null,
    rule_id uuid not null references daily_rules(id) on delete cascade,
    checked boolean not null default false,
    primary key (user_id, check_date, rule_id)
);

alter table daily_rule_checks enable row level security;

create policy "daily_rule_checks_select_own" on daily_rule_checks for select using (auth.uid() = user_id);
create policy "daily_rule_checks_insert_own" on daily_rule_checks for insert with check (
    auth.uid() = user_id
    and exists (select 1 from daily_rules where daily_rules.id = daily_rule_checks.rule_id and daily_rules.user_id = auth.uid())
);
create policy "daily_rule_checks_update_own" on daily_rule_checks for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from daily_rules where daily_rules.id = daily_rule_checks.rule_id and daily_rules.user_id = auth.uid())
);
create policy "daily_rule_checks_delete_own" on daily_rule_checks for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- missed_trades (setups that fit a playbook perfectly but weren't taken).
-- playbook_id is required (not nullable) -- the whole point is it fits a KNOWN
-- playbook. Column named missed_date, same reserved-word-avoidance convention.
-- ---------------------------------------------------------------------------
create table missed_trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    playbook_id uuid not null references playbooks(id) on delete cascade,
    missed_date date not null,
    symbol text not null,
    notes text,
    est_pnl_missed numeric,
    screenshot_url text,
    created_at timestamptz not null default now()
);

alter table missed_trades enable row level security;

create policy "missed_trades_select_own" on missed_trades for select using (auth.uid() = user_id);
create policy "missed_trades_insert_own" on missed_trades for insert with check (
    auth.uid() = user_id
    and exists (select 1 from playbooks where playbooks.id = missed_trades.playbook_id and playbooks.user_id = auth.uid())
);
create policy "missed_trades_update_own" on missed_trades for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "missed_trades_delete_own" on missed_trades for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- daily_plan_playbooks (replaces daily_plan_strategies). Many-to-many on
-- purpose, unlike trade_playbooks -- a day's PLAN can name several watched
-- setups ("watching EMA Bounce, Scalp, and Breakout today"); each individual
-- TRADE taken still resolves to exactly one playbook via trade_playbooks. The
-- plan-vs-reality comparison should show "planned to watch 3, traded 1" as a
-- plain fact, not a miss -- watching more setups than you end up trading is
-- normal and good, not incomplete execution.
-- ---------------------------------------------------------------------------
create table daily_plan_playbooks (
    daily_plan_id uuid not null references daily_plans(id) on delete cascade,
    playbook_id uuid not null references playbooks(id) on delete cascade,
    primary key (daily_plan_id, playbook_id)
);

alter table daily_plan_playbooks enable row level security;

create policy "daily_plan_playbooks_select_own" on daily_plan_playbooks for select using (
    exists (select 1 from daily_plans where daily_plans.id = daily_plan_playbooks.daily_plan_id and daily_plans.user_id = auth.uid())
);
create policy "daily_plan_playbooks_insert_own" on daily_plan_playbooks for insert with check (
    exists (select 1 from daily_plans where daily_plans.id = daily_plan_playbooks.daily_plan_id and daily_plans.user_id = auth.uid())
    and exists (select 1 from playbooks where playbooks.id = daily_plan_playbooks.playbook_id and playbooks.user_id = auth.uid())
);
create policy "daily_plan_playbooks_delete_own" on daily_plan_playbooks for delete using (
    exists (select 1 from daily_plans where daily_plans.id = daily_plan_playbooks.daily_plan_id and daily_plans.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- Drop legacy tables, in dependency order. Backups above preserve the data.
-- ---------------------------------------------------------------------------
drop table trade_rules;
drop table rules;
drop table daily_plan_strategies;
drop table trade_strategies;
drop table strategies;

commit;
