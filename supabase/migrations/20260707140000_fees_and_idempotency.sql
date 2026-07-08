-- Adds fee tracking, idempotency keys, and an atomic upsert path for the sync worker.
-- No existing rows are affected -- these tables have never been written to yet.

-- ---------------------------------------------------------------------------
-- trades: gross/net P&L split, fee totals, status, and a derived idempotency key
-- ---------------------------------------------------------------------------
alter table trades rename column pnl to realized_pnl_net;
alter table trades rename column fees to total_fees;

alter table trades
    add column realized_pnl_gross numeric,
    add column fees_pending boolean not null default true,
    add column status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
    add column total_contracts numeric,
    add column trade_key text;

-- trade_key is a deterministic hash of (contract_key + first-open execution's
-- client_order_id) computed in worker/db_writer.py -- regrouping the same executions
-- always yields the same key, and a contract that flattens then reopens later gets a
-- distinct key (the first-open order id differs), so it doesn't collapse into one row.
alter table trades add constraint trades_user_id_trade_key_key unique (user_id, trade_key);

-- ---------------------------------------------------------------------------
-- executions: one row per Webull order, keyed by client_order_id for idempotent upsert
-- ---------------------------------------------------------------------------
-- Denormalized user_id (rather than relying solely on the trades join) so the sync
-- worker -- which writes with the service-role key, outside any user session -- can
-- upsert directly on (user_id, client_order_id) without an extra lookup, and so RLS
-- can check ownership directly on this table too.
alter table executions
    add column user_id uuid not null references auth.users(id) on delete cascade,
    add column client_order_id text not null,
    add column fee numeric;

alter table executions add constraint executions_user_id_client_order_id_key unique (user_id, client_order_id);

create index executions_user_id_idx on executions (user_id);

-- ---------------------------------------------------------------------------
-- sync_log: richer audit trail per run
-- ---------------------------------------------------------------------------
alter table sync_log
    add column orders_pulled integer,
    add column warnings_count integer;

-- ---------------------------------------------------------------------------
-- upsert_trade_bundle: writes one trade + its executions + its options_detail as a
-- single atomic unit. The Python client has no multi-statement transaction API, so
-- this is a plpgsql function instead of sequential .table().upsert() calls -- if
-- anything inside fails, the whole call rolls back rather than leaving a trade with
-- missing executions.
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
        user_id, trade_key, symbol, asset_type, side, status,
        avg_entry, avg_exit, hold_seconds, total_contracts,
        realized_pnl_gross, realized_pnl_net, total_fees, fees_pending,
        first_in_at, last_out_at
    )
    values (
        v_user_id,
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
        (payload -> 'trade' ->> 'total_fees')::numeric,
        (payload -> 'trade' ->> 'fees_pending')::boolean,
        (payload -> 'trade' ->> 'first_in_at')::timestamptz,
        (payload -> 'trade' ->> 'last_out_at')::timestamptz
    )
    on conflict (user_id, trade_key) do update set
        status = excluded.status,
        avg_entry = excluded.avg_entry,
        avg_exit = excluded.avg_exit,
        hold_seconds = excluded.hold_seconds,
        total_contracts = excluded.total_contracts,
        realized_pnl_gross = excluded.realized_pnl_gross,
        realized_pnl_net = excluded.realized_pnl_net,
        total_fees = excluded.total_fees,
        fees_pending = excluded.fees_pending,
        last_out_at = excluded.last_out_at
    returning id into v_trade_id;

    for v_exec in select * from jsonb_array_elements(payload -> 'executions')
    loop
        insert into executions (
            user_id, trade_id, client_order_id, filled_at, action, price, quantity, side, fee
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
            (v_exec ->> 'fee')::numeric
        )
        on conflict (user_id, client_order_id) do update set
            trade_id = excluded.trade_id,
            filled_at = excluded.filled_at,
            action = excluded.action,
            price = excluded.price,
            quantity = excluded.quantity,
            side = excluded.side,
            fee = excluded.fee;
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
