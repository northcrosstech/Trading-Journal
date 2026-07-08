-- Daily profit-target / max-loss-limit settings, one row per user (per account --
-- there's only one broker account per user in this app today; if multi-account
-- support is ever added, this should gain an account_id column and move the unique
-- constraint to (user_id, account_id)).
create table target_settings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade unique,
    profit_target_value numeric,
    loss_limit_value numeric,
    -- Scaffolded for a possible future percent-of-capital mode. NOT read or written by
    -- any current UI or computation -- dollar-only for now. TODO(percent-mode): wire
    -- these up alongside a mode selector if/when percent mode is actually built.
    profit_target_pct numeric,
    loss_limit_pct numeric,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table target_settings enable row level security;

create policy "target_settings_select_own" on target_settings for select using (auth.uid() = user_id);
create policy "target_settings_insert_own" on target_settings for insert with check (auth.uid() = user_id);
create policy "target_settings_update_own" on target_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "target_settings_delete_own" on target_settings for delete using (auth.uid() = user_id);
