-- Rules feature: a global entry/exit rule library + a per-trade three-state
-- checklist (followed / broken / na), so follow-rate and P&L-when-followed-vs-broken
-- can be computed in aggregate across trades. Rules are global (not per-strategy) so
-- the aggregates hold even as strategy tagging evolves.

create table rules (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    type text not null check (type in ('entry', 'exit')),
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (user_id, name, type)
);

alter table rules enable row level security;

create policy "rules_select_own" on rules for select using (auth.uid() = user_id);
create policy "rules_insert_own" on rules for insert with check (auth.uid() = user_id);
create policy "rules_update_own" on rules for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rules_delete_own" on rules for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- trade_rules (per-trade checklist state, three-state: default 'na' so only
-- rules that actually applied to a trade need to be marked)
-- ---------------------------------------------------------------------------
create table trade_rules (
    trade_id uuid not null references trades(id) on delete cascade,
    rule_id uuid not null references rules(id) on delete cascade,
    status text not null check (status in ('followed', 'broken', 'na')) default 'na',
    primary key (trade_id, rule_id)
);

alter table trade_rules enable row level security;

create policy "trade_rules_select_own" on trade_rules for select using (
    exists (select 1 from trades where trades.id = trade_rules.trade_id and trades.user_id = auth.uid())
);
create policy "trade_rules_insert_own" on trade_rules for insert with check (
    exists (select 1 from trades where trades.id = trade_rules.trade_id and trades.user_id = auth.uid())
    and exists (select 1 from rules where rules.id = trade_rules.rule_id and rules.user_id = auth.uid())
);
create policy "trade_rules_update_own" on trade_rules for update using (
    exists (select 1 from trades where trades.id = trade_rules.trade_id and trades.user_id = auth.uid())
) with check (
    exists (select 1 from trades where trades.id = trade_rules.trade_id and trades.user_id = auth.uid())
);
create policy "trade_rules_delete_own" on trade_rules for delete using (
    exists (select 1 from trades where trades.id = trade_rules.trade_id and trades.user_id = auth.uid())
);
