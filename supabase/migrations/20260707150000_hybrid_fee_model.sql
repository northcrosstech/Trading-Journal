-- Replaces the pending/resolved fee model with a hybrid estimated/actual one.
--
-- Previously: total_fees/realized_pnl_net stayed NULL until every execution's real fee
-- had been fetched via get_order_detail, which meant a freshly-synced trade had no net
-- P&L at all, and backfilling the whole backlog in one go is what caused a 429 storm.
--
-- Now: estimated_fee is computed instantly with zero API calls (fee_rates.py) at
-- normalize time, so realized_pnl_net is ALWAYS available immediately. actual_fee
-- backfills lazily in the background (a small batch per sync cycle -- see
-- fees.annotate_execution_fees) and fee_source flips estimated -> actual once every
-- execution in the trade has a real fee.

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
alter table trades drop column total_fees;
alter table trades drop column fees_pending;

alter table trades
    add column estimated_fee numeric not null default 0,
    add column actual_fee numeric,
    add column fee_source text not null default 'estimated' check (fee_source in ('estimated', 'actual'));

-- ---------------------------------------------------------------------------
-- executions
-- ---------------------------------------------------------------------------
alter table executions drop column fee;

alter table executions
    add column estimated_fee numeric not null default 0,
    add column actual_fee numeric;

-- ---------------------------------------------------------------------------
-- upsert_trade_bundle: same atomic-write shape as before, updated for the new columns
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
        realized_pnl_gross, realized_pnl_net, estimated_fee, actual_fee, fee_source,
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
        coalesce((payload -> 'trade' ->> 'estimated_fee')::numeric, 0),
        (payload -> 'trade' ->> 'actual_fee')::numeric,
        coalesce(payload -> 'trade' ->> 'fee_source', 'estimated'),
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
