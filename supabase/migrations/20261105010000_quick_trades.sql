-- Quick trades: fees on buys and sells, and several trades saved together.
--
--   portfolio_activity.fee -- the broker's fee on a buy or sell (0 = none)
--
-- A fee is part of what a trade really cost or paid, so the entry's price is stored after
-- fees, the way brokers report cost basis: a buy's price is (shares x fill price + fee) /
-- shares, a sale's is (shares x fill price - fee) / shares. Average cost, cash, realized
-- gain, undo and the audit all keep working from that price unchanged; `fee` records how much
-- of it was fees (fill price = price -/+ fee / shares).
--
--   portfolio_buy / portfolio_sell (..., p_fee)  -- same as before, plus an optional fee
--   portfolio_entry_edit (..., p_fee)            -- p_price is the fill price; the fee goes on top
--   portfolio_trades(portfolio, trades)          -- several buys/sells in one save: all are
--       saved or none. trades = [{"symbol","side":"buy"|"sell","quantity","price","fee","on"}].
--       A failing line is named in the error ("Line 2 (VOO): ...").
--
-- Requires 20261028020000_ledger_lockdown.sql. Safe to re-run.
begin;

alter table portfolio_activity add column if not exists fee numeric not null default 0;
alter table portfolio_activity drop constraint if exists portfolio_activity_fee_check;
alter table portfolio_activity add constraint portfolio_activity_fee_check check (fee >= 0);

-- The ledger stays append-only, fee included.
create or replace function _activity_append_only() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    -- Cascades (a portfolio, account or option row being deleted) run one trigger level down.
    if pg_trigger_depth() > 1 then
        return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'DELETE' then
        raise exception 'Activity entries are kept as history and can''t be deleted -- undo them in the app instead';
    end if;
    if (new.id, new.user_id, new.portfolio_id, new.occurred_on, new.kind, new.symbol, new.quantity, new.price,
        new.cash_change, new.external_flow, new.realized_gain, new.csp_id, new.option_id, new.created_at, new.fee)
       is distinct from
       (old.id, old.user_id, old.portfolio_id, old.occurred_on, old.kind, old.symbol, old.quantity, old.price,
        old.cash_change, old.external_flow, old.realized_gain, old.csp_id, old.option_id, old.created_at, old.fee)
       or (old.voided_at is not null and new.voided_at is distinct from old.voided_at)
       or (old.replaced_by is not null and new.replaced_by is distinct from old.replaced_by) then
        raise exception 'Activity entries can''t be changed -- edit or undo them in the app instead';
    end if;
    return new;
end $$;

-- Buy shares (or add existing ones). p_fee only applies to a buy from cash.
drop function if exists portfolio_buy(uuid, text, numeric, numeric, boolean, date);
create or replace function portfolio_buy(
    p_portfolio uuid, p_symbol text, p_quantity numeric, p_price numeric,
    p_from_cash boolean default true, p_on date default current_date, p_fee numeric default 0
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_sym text := upper(btrim(p_symbol));
    v_fee numeric := case when p_from_cash then coalesce(p_fee, 0) else 0 end;
    v_cost numeric := p_quantity * p_price + v_fee;
    v_flow_price numeric;
begin
    perform _own_portfolio(p_portfolio);
    if v_sym = '' then raise exception 'Ticker is required'; end if;
    if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;
    if v_fee < 0 then raise exception 'Fee can''t be negative'; end if;

    insert into holdings (user_id, portfolio_id, symbol, quantity, avg_cost)
    values (auth.uid(), p_portfolio, v_sym, p_quantity, v_cost / p_quantity)
    on conflict (portfolio_id, symbol) do update set
        avg_cost = (holdings.quantity * holdings.avg_cost + v_cost) / (holdings.quantity + p_quantity),
        quantity = holdings.quantity + p_quantity,
        updated_at = now();

    if p_from_cash then
        update portfolios set cash = cash - v_cost where id = p_portfolio;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, fee)
        values (auth.uid(), p_portfolio, p_on, 'buy', v_sym, p_quantity, v_cost / p_quantity, -v_cost, v_fee);
    else
        select close into v_flow_price from prices where symbol = v_sym order by price_date desc limit 1;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
        values (auth.uid(), p_portfolio, p_on, 'transfer_in', v_sym, p_quantity, p_price, p_quantity * coalesce(v_flow_price, p_price));
    end if;
end $$;

-- Sell shares (or move them out). p_fee only applies to a sale to cash.
drop function if exists portfolio_sell(uuid, text, numeric, numeric, boolean, date);
create or replace function portfolio_sell(
    p_portfolio uuid, p_symbol text, p_quantity numeric, p_price numeric,
    p_to_cash boolean default true, p_on date default current_date, p_fee numeric default 0
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_sym text := upper(btrim(p_symbol));
    h holdings%rowtype;
    v_fee numeric := case when p_to_cash then coalesce(p_fee, 0) else 0 end;
    v_proceeds numeric := p_quantity * p_price - v_fee;
    v_covered numeric;
begin
    perform _own_portfolio(p_portfolio);
    if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;
    if v_fee < 0 then raise exception 'Fee can''t be negative'; end if;
    if v_proceeds < 0 then raise exception 'The fee is more than the sale'; end if;

    select * into h from holdings where portfolio_id = p_portfolio and symbol = v_sym for update;
    if not found then raise exception 'You don''t hold %', v_sym; end if;
    if p_quantity > h.quantity then raise exception 'You only hold % shares of %', h.quantity, v_sym; end if;
    v_covered := _covered_shares(p_portfolio, v_sym);
    if h.quantity - p_quantity < v_covered then
        raise exception '% of your % shares are covering open calls — buy back or close those calls first', v_covered, v_sym;
    end if;

    if p_quantity = h.quantity then
        delete from holdings where id = h.id;
    else
        update holdings set quantity = quantity - p_quantity, updated_at = now() where id = h.id;
    end if;

    if p_to_cash then
        update portfolios set cash = cash + v_proceeds where id = p_portfolio;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, realized_gain, fee)
        values (auth.uid(), p_portfolio, p_on, 'sell', v_sym, p_quantity, v_proceeds / p_quantity, v_proceeds, v_proceeds - h.avg_cost * p_quantity, v_fee);
    else
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
        values (auth.uid(), p_portfolio, p_on, 'transfer_out', v_sym, p_quantity, p_price, -p_quantity * p_price);
    end if;
end $$;

-- Edit a stock or cash entry. For a buy or sale, p_price is the fill price and p_fee the fee.
drop function if exists portfolio_entry_edit(uuid, text, numeric, numeric, numeric, date);
create or replace function portfolio_entry_edit(
    p_activity uuid, p_symbol text, p_quantity numeric, p_price numeric, p_amount numeric, p_on date, p_fee numeric default 0
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    a portfolio_activity%rowtype;
    v_new uuid;
begin
    select * into a from portfolio_activity where id = p_activity and user_id = auth.uid() and voided_at is null;
    if not found then raise exception 'Entry not found'; end if;
    if a.kind not in ('buy', 'sell', 'transfer_in', 'deposit', 'withdrawal', 'dividend') then
        raise exception 'This entry can''t be edited — undo it and enter it again';
    end if;

    perform portfolio_entry_delete(a.id);

    if a.kind = 'buy' then
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, true, p_on, p_fee);
    elsif a.kind = 'transfer_in' then
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, false, p_on);
    elsif a.kind = 'sell' then
        perform portfolio_sell(a.portfolio_id, p_symbol, p_quantity, p_price, true, p_on, p_fee);
    else
        perform portfolio_cash(a.portfolio_id, a.kind, p_amount, p_symbol, p_on);
    end if;

    select id into v_new from portfolio_activity
    where portfolio_id = a.portfolio_id and kind = a.kind and voided_at is null and created_at = now()
    order by id limit 1;
    update portfolio_activity set replaced_by = v_new where id = a.id;
end $$;

-- Several buys and sells in one save, in the order given. Any failure undoes them all.
create or replace function portfolio_trades(p_portfolio uuid, p_trades jsonb) returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    t jsonb;
    i int;
    v_sym text;
    v_side text;
begin
    perform _own_portfolio(p_portfolio);
    if p_trades is null or jsonb_typeof(p_trades) <> 'array' or jsonb_array_length(p_trades) = 0 then
        raise exception 'Nothing to log';
    end if;
    for t, i in select value, ordinality from jsonb_array_elements(p_trades) with ordinality loop
        v_sym := upper(btrim(coalesce(t->>'symbol', '')));
        v_side := t->>'side';
        begin
            if v_sym = '' then raise exception 'Ticker is required'; end if;
            if v_side = 'buy' then
                perform portfolio_buy(p_portfolio, v_sym, (t->>'quantity')::numeric, (t->>'price')::numeric, true,
                    coalesce((t->>'on')::date, current_date), coalesce((t->>'fee')::numeric, 0));
            elsif v_side = 'sell' then
                perform portfolio_sell(p_portfolio, v_sym, (t->>'quantity')::numeric, (t->>'price')::numeric, true,
                    coalesce((t->>'on')::date, current_date), coalesce((t->>'fee')::numeric, 0));
            else
                raise exception 'Pick Bought or Sold';
            end if;
        exception when others then
            raise exception 'Line % (%): %', i, coalesce(nullif(v_sym, ''), 'no ticker'), sqlerrm;
        end;
    end loop;
    return jsonb_array_length(p_trades);
end $$;

commit;
