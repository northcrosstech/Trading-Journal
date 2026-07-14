-- Multi-account support, Phase 1: broker-agnostic accounts table + trades.account_id.
-- Purely additive -- no table drops, no data loss. Existing Webull trades are backfilled
-- to one migrated "Webull" account per user so the current sync keeps working unchanged.
-- No real broker credentials are stored anywhere in this migration (credential_ref is
-- left null -- that's a later, security-focused phase).
begin;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table accounts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    broker text not null check (broker in ('webull', 'schwab', 'manual')),
    label text not null,
    account_type text not null check (account_type in ('live', 'paper')),
    sync_mode text not null check (sync_mode in ('auto', 'manual')),
    enabled boolean not null default true,
    -- Beyond the original column list, mirroring playbooks.archived: `enabled` pauses
    -- syncing temporarily, `archived` retires the account from default list views --
    -- accounts are never hard-deleted in this app, only archived/disabled.
    archived boolean not null default false,
    credential_ref text,
    created_at timestamptz not null default now(),
    unique (user_id, label)
);

alter table accounts enable row level security;

create policy "accounts_select_own" on accounts for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on accounts for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "accounts_delete_own" on accounts for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- trades.account_id
-- ---------------------------------------------------------------------------
-- on delete restrict, not cascade: accounts are only ever archived/disabled in this
-- app's UI, never hard-deleted. restrict makes an accidental `delete from accounts`
-- fail loudly instead of silently orphaning trade history.
alter table trades add column account_id uuid references accounts(id) on delete restrict;
create index trades_account_id_idx on trades (account_id);

-- Tighten insert/update RLS to verify a provided account_id actually belongs to the
-- same user -- same cross-table ownership-check shape used for trade_rule_checks in
-- the playbooks migration. The FK alone only checks the account exists, not that it's
-- yours; without this a user could in principle stamp a trade with someone else's
-- account id.
drop policy "trades_insert_own" on trades;
create policy "trades_insert_own" on trades for insert with check (
    auth.uid() = user_id
    and (account_id is null or exists (select 1 from accounts where accounts.id = trades.account_id and accounts.user_id = auth.uid()))
);

drop policy "trades_update_own" on trades;
create policy "trades_update_own" on trades for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (account_id is null or exists (select 1 from accounts where accounts.id = trades.account_id and accounts.user_id = auth.uid()))
);

-- ---------------------------------------------------------------------------
-- Backfill: one migrated "Webull" account per user who already has trades, then point
-- their existing trades at it. Scoped per-user (not a hardcoded id) so this is correct
-- even if more than one user already has synced data. A no-op if trades is empty.
-- ---------------------------------------------------------------------------
insert into accounts (user_id, broker, label, account_type, sync_mode, enabled)
select distinct user_id, 'webull', 'Webull', 'live', 'auto', true
from trades;

update trades t
set account_id = a.id
from accounts a
where a.user_id = t.user_id and a.broker = 'webull' and a.label = 'Webull' and t.account_id is null;

-- ---------------------------------------------------------------------------
-- upsert_trade_bundle: same atomic-write shape as before (see hybrid_fee_model
-- migration), extended to accept and stamp account_id.
--
-- *** DURABLE LIMITATION -- READ BEFORE ADDING A SECOND SAME-BROKER ACCOUNT ***
-- The idempotency constraint this function upserts against is STILL
-- `unique (user_id, trade_key)` (defined in the fees_and_idempotency migration) --
-- it does NOT include account_id. That's correct today (exactly one Webull account per
-- user), but breaks the moment a user connects a SECOND account of the SAME broker
-- (e.g. a Webull margin account alongside a Webull cash account): trade_key is a hash
-- of (contract_key + first execution's client_order_id), which says nothing about
-- which account the order came from, so two different accounts' trades could collide
-- on the same key, or a webull-vs-webull dedup could silently overwrite the wrong
-- account's trade instead of inserting a new one.
--
-- BEFORE CONNECTING A SECOND SAME-BROKER ACCOUNT: change the constraint to
-- `unique (user_id, account_id, trade_key)` and update this function's
-- `on conflict (user_id, trade_key)` clauses (both the trades upsert and, if given
-- account-scoped executions later, any similar key) to match. Also tracked in
-- claude.md under "Known limitations / TODOs" -- keep both in sync if this changes.
-- ---------------------------------------------------------------------------
create or replace function upsert_trade_bundle(payload jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
    v_trade_id uuid;
    v_user_id uuid;
    v_exec jsonb;
begin
    v_user_id := (payload -> 'trade' ->> 'user_id')::uuid;

    insert into trades (
        user_id, account_id, trade_key, symbol, asset_type, side, status,
        avg_entry, avg_exit, hold_seconds, total_contracts,
        realized_pnl_gross, realized_pnl_net, estimated_fee, actual_fee, fee_source,
        first_in_at, last_out_at
    )
    values (
        v_user_id,
        (payload -> 'trade' ->> 'account_id')::uuid,
        payload -> 'trade' ->> 'trade_key',
        payload -> 'trade' ->> 'symbol',
        payload -> 'trade' ->> 'asset_type',
        payload -> 'trade' ->> 'side',
        payload -> 'trade' ->> 'status',
        (payload -> 'trade' ->> 'avg_entry')::numeric,
        (payload -> 'trade' ->> 'avg_exit')::numeric,
        (payload -> 'trade' ->> 'hold_seconds')::numeric,
        (payload -> 'trade' ->> 'total_contracts')::numeric,
        (payload -> 'trade' ->> 'realized_pnl_gross')::numeric,
        (payload -> 'trade' ->> 'realized_pnl_net')::numeric,
        coalesce((payload -> 'trade' ->> 'estimated_fee')::numeric, 0),
        (payload -> 'trade' ->> 'actual_fee')::numeric,
        coalesce(payload -> 'trade' ->> 'fee_source', 'estimated'),
        (payload -> 'trade' ->> 'first_in_at')::timestamptz,
        (payload -> 'trade' ->> 'last_out_at')::timestamptz
    )
    on conflict (user_id, trade_key) do update set
        account_id = excluded.account_id,
        status = excluded.status,
        avg_entry = excluded.avg_entry,
        avg_exit = excluded.avg_exit,
        hold_seconds = excluded.hold_seconds,
        total_contracts = excluded.total_contracts,
        realized_pnl_gross = excluded.realized_pnl_gross,
        realized_pnl_net = excluded.realized_pnl_net,
        estimated_fee = excluded.estimated_fee,
        actual_fee = excluded.actual_fee,
        fee_source = excluded.fee_source,
        last_out_at = excluded.last_out_at
    returning id into v_trade_id;

    for v_exec in select * from jsonb_array_elements(payload -> 'executions')
    loop
        insert into executions (
            user_id, trade_id, client_order_id, filled_at, action, price, quantity, side,
            estimated_fee, actual_fee
        )
        values (
            v_user_id,
            v_trade_id,
            v_exec ->> 'client_order_id',
            (v_exec ->> 'filled_at')::timestamptz,
            v_exec ->> 'action',
            (v_exec ->> 'price')::numeric,
            (v_exec ->> 'quantity')::numeric,
            v_exec ->> 'side',
            coalesce((v_exec ->> 'estimated_fee')::numeric, 0),
            (v_exec ->> 'actual_fee')::numeric
        )
        on conflict (user_id, client_order_id) do update set
            trade_id = excluded.trade_id,
            filled_at = excluded.filled_at,
            action = excluded.action,
            price = excluded.price,
            quantity = excluded.quantity,
            side = excluded.side,
            estimated_fee = excluded.estimated_fee,
            actual_fee = excluded.actual_fee;
    end loop;

    if payload ? 'options_detail' and payload -> 'options_detail' is not null then
        insert into options_detail (trade_id, option_type, strike, expiration, premium)
        values (
            v_trade_id,
            payload -> 'options_detail' ->> 'option_type',
            (payload -> 'options_detail' ->> 'strike')::numeric,
            (payload -> 'options_detail' ->> 'expiration')::date,
            (payload -> 'options_detail' ->> 'premium')::numeric
        )
        on conflict (trade_id) do update set
            option_type = excluded.option_type,
            strike = excluded.strike,
            expiration = excluded.expiration,
            premium = excluded.premium;
    end if;

    return v_trade_id;
end;
$$;

commit;
