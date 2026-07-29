-- Lets a trade's outcome (status/avg_exit/realized P&L/hold time/last_out_at) be
-- manually set and have it STICK, even for a broker-synced trade -- needed for
-- options that expire worthless. Webull's order history never contains an
-- "expiration" event (nothing was traded, so no order exists), and the sync worker
-- does a full resync from a fixed start date every run (not incremental), so a
-- worthless-expiry position stays perpetually OPEN and would keep getting
-- re-derived as OPEN by upsert_trade_bundle's on-conflict update on every single
-- sync cycle -- silently reverting any direct manual edit within 15 minutes.
begin;

alter table trades add column manually_closed boolean not null default false;

-- Re-point at the same signature; only the on-conflict SET clause changes (the six
-- "outcome" fields are now a no-op when manually_closed is true, everything else
-- keeps syncing normally -- e.g. fee data can still get more accurate over time).
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
        status = case when trades.manually_closed then trades.status else excluded.status end,
        avg_entry = excluded.avg_entry,
        avg_exit = case when trades.manually_closed then trades.avg_exit else excluded.avg_exit end,
        hold_seconds = case when trades.manually_closed then trades.hold_seconds else excluded.hold_seconds end,
        total_contracts = excluded.total_contracts,
        realized_pnl_gross = case when trades.manually_closed then trades.realized_pnl_gross else excluded.realized_pnl_gross end,
        realized_pnl_net = case when trades.manually_closed then trades.realized_pnl_net else excluded.realized_pnl_net end,
        estimated_fee = excluded.estimated_fee,
        actual_fee = excluded.actual_fee,
        fee_source = excluded.fee_source,
        last_out_at = case when trades.manually_closed then trades.last_out_at else excluded.last_out_at end
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
