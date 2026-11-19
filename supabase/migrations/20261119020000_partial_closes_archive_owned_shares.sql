-- Three rule changes.
--
-- 1. Part of an option or put can be closed.
--      option_close(..., p_contracts)  /  csp_resolve(..., p_contracts)
--    Leaving p_contracts out (or passing the full count) works exactly as before. A smaller
--    count first splits the purchase in two, the same way an edit works: the opening entry
--    is undone (kept as history) and entered again as two purchases with the same price and
--    date, one for the part being closed and one for the rest. The part is then closed as
--    usual. Cash, cost and realized gain are the same as if two purchases had been entered
--    in the first place, every purchase still has one opening and one closing entry, and
--    undoing the close leaves two open purchases that the app shows as one position.
--    position_undo_last now undoes the closing entry first when a purchase was opened and
--    closed in the same save.
--
-- 2. An archived portfolio keeps its place in earlier months.
--      portfolios.archived_on  -- the day it was archived (US Central), set automatically
--    Net worth and Cash flow leave an archived portfolio out from the month it was archived
--    onward and keep it in the months before. Portfolios already archived get the day of
--    their last saved value, or the day they were created when they have none.
--
-- 3. Shares you already own, for a ticker with no saved price.
--      portfolio_buy(..., p_market_price)
--    Bringing in shares records money coming in at the latest saved close. With no saved
--    close it used the average cost, which turned the difference into a gain the portfolio
--    never earned. p_market_price is used in that case; the average cost is the last resort.
--    Editing such an entry keeps the price it was first recorded at.
--
-- Also: the "can't be undone" message for shares moved out names the current menu item.
--
-- Requires 20261105010000_quick_trades.sql. Safe to re-run.
begin;

-- ---------------------------------------------------------------------------
-- 1. Partial closes
-- ---------------------------------------------------------------------------

drop function if exists option_close(uuid, text, numeric, date);
create or replace function option_close(
    p_option uuid, p_outcome text, p_price numeric default null, p_on date default current_date,
    p_contracts int default null
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    o option_positions%rowtype;
    h holdings%rowtype;
    v_shares numeric;
    v_amount numeric;
    v_basis numeric;
    v_open uuid;
    v_rest uuid;
    v_part uuid;
begin
    select * into o from option_positions where id = p_option and user_id = auth.uid() for update;
    if not found then raise exception 'Option not found'; end if;
    if o.status <> 'open' then raise exception 'This option is already %', o.status; end if;

    -- Closing only part: split the purchase into the part and the rest, then close the part.
    if p_contracts is not null and p_contracts <> o.contracts then
        if p_contracts <= 0 or p_contracts > o.contracts then
            raise exception 'This purchase has % contracts — enter a number from 1 to %', o.contracts, o.contracts;
        end if;
        select id into v_open from portfolio_activity
        where option_id = o.id and kind in ('option_buy', 'option_write') and voided_at is null limit 1;
        if v_open is null then raise exception 'This option''s opening entry is missing — undo it and add it again'; end if;

        perform portfolio_entry_delete(v_open);
        v_rest := option_open(o.portfolio_id, o.symbol, o.option_type, o.side, o.strike, o.expiration,
                              o.contracts - p_contracts, o.open_price, o.is_hedge, o.opened_on);
        v_part := option_open(o.portfolio_id, o.symbol, o.option_type, o.side, o.strike, o.expiration,
                              p_contracts, o.open_price, o.is_hedge, o.opened_on);
        -- Both halves keep the original's place in oldest-first order and its current price.
        update option_positions set mark = o.mark, created_at = o.created_at where id in (v_rest, v_part);
        update portfolio_activity
        set replaced_by = (select id from portfolio_activity where option_id = v_rest and voided_at is null limit 1)
        where id = v_open;
        select * into o from option_positions where id = v_part for update;
    end if;

    v_shares := 100 * o.contracts;

    if p_outcome = 'closed' then
        if p_price is null or p_price < 0 then raise exception 'Price is required'; end if;
        v_amount := p_price * v_shares;
        update option_positions set status = 'closed', closed_on = p_on, close_price = p_price where id = o.id;
        update portfolios set cash = cash + case when o.side = 'long' then v_amount else -v_amount end where id = o.portfolio_id;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, realized_gain, option_id)
        values (auth.uid(), o.portfolio_id, p_on, case when o.side = 'long' then 'option_sell' else 'option_buyback' end,
                o.symbol, o.contracts, p_price, case when o.side = 'long' then v_amount else -v_amount end,
                case when o.side = 'long' then (p_price - o.open_price) else (o.open_price - p_price) end * v_shares, o.id);

    elsif p_outcome = 'expired' then
        update option_positions set status = 'expired', closed_on = p_on where id = o.id;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, realized_gain, option_id)
        values (auth.uid(), o.portfolio_id, p_on, 'option_expire', o.symbol, o.contracts,
                case when o.side = 'long' then -o.open_price else o.open_price end * v_shares, o.id);

    elsif p_outcome = 'exercised' then
        if o.side <> 'long' or o.option_type <> 'call' then raise exception 'Only long calls can be exercised here — sell a put instead'; end if;
        v_amount := o.strike * v_shares;
        v_basis := o.strike + o.open_price;
        update option_positions set status = 'exercised', closed_on = p_on where id = o.id;
        update portfolios set cash = cash - v_amount where id = o.portfolio_id;
        insert into holdings (user_id, portfolio_id, symbol, quantity, avg_cost)
        values (auth.uid(), o.portfolio_id, o.symbol, v_shares, v_basis)
        on conflict (portfolio_id, symbol) do update set
            avg_cost = (holdings.quantity * holdings.avg_cost + v_shares * v_basis) / (holdings.quantity + v_shares),
            quantity = holdings.quantity + v_shares,
            updated_at = now();
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, option_id)
        values (auth.uid(), o.portfolio_id, p_on, 'option_exercise', o.symbol, v_shares, o.strike, -v_amount, o.id);

    elsif p_outcome = 'assigned' then
        if o.side <> 'short' then raise exception 'Only sold calls can be assigned'; end if;
        select * into h from holdings where portfolio_id = o.portfolio_id and symbol = o.symbol for update;
        if not found or h.quantity < v_shares then raise exception 'You no longer hold % shares of % to deliver', v_shares, o.symbol; end if;
        v_amount := o.strike * v_shares;
        update option_positions set status = 'assigned', closed_on = p_on where id = o.id;
        if h.quantity = v_shares then
            delete from holdings where id = h.id;
        else
            update holdings set quantity = quantity - v_shares, updated_at = now() where id = h.id;
        end if;
        update portfolios set cash = cash + v_amount where id = o.portfolio_id;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, realized_gain, option_id)
        values (auth.uid(), o.portfolio_id, p_on, 'option_assign', o.symbol, v_shares, o.strike, v_amount,
                (o.strike - h.avg_cost + o.open_price) * v_shares, o.id);

    else
        raise exception 'Unknown outcome %', p_outcome;
    end if;
end $$;

drop function if exists csp_resolve(uuid, text, numeric, date);
create or replace function csp_resolve(
    p_csp uuid, p_outcome text, p_price numeric default null, p_on date default current_date,
    p_contracts int default null
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    c csp_positions%rowtype;
    v_shares numeric;
    v_basis numeric;
    v_cost numeric;
    v_open uuid;
    v_rest uuid;
    v_part uuid;
begin
    select * into c from csp_positions where id = p_csp and user_id = auth.uid() for update;
    if not found then raise exception 'Put not found'; end if;
    if c.status <> 'open' then raise exception 'This put is already %', c.status; end if;

    -- Closing only part: split the sale into the part and the rest, then close the part.
    if p_contracts is not null and p_contracts <> c.contracts then
        if p_contracts <= 0 or p_contracts > c.contracts then
            raise exception 'This sale has % contracts — enter a number from 1 to %', c.contracts, c.contracts;
        end if;
        select id into v_open from portfolio_activity
        where csp_id = c.id and kind = 'csp_open' and voided_at is null limit 1;
        if v_open is null then raise exception 'This put''s opening entry is missing — undo it and add it again'; end if;

        perform portfolio_entry_delete(v_open);
        v_rest := csp_open(c.portfolio_id, c.symbol, c.strike, c.expiration, c.contracts - p_contracts, c.premium, c.opened_on);
        v_part := csp_open(c.portfolio_id, c.symbol, c.strike, c.expiration, p_contracts, c.premium, c.opened_on);
        update csp_positions set mark = c.mark, created_at = c.created_at where id in (v_rest, v_part);
        update portfolio_activity
        set replaced_by = (select id from portfolio_activity where csp_id = v_rest and voided_at is null limit 1)
        where id = v_open;
        select * into c from csp_positions where id = v_part for update;
    end if;

    if p_outcome = 'expired' then
        update csp_positions set status = 'expired', closed_on = p_on where id = c.id;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, realized_gain, csp_id)
        values (auth.uid(), c.portfolio_id, p_on, 'csp_expire', c.symbol, c.contracts, c.premium * 100 * c.contracts, c.id);

    elsif p_outcome = 'closed' then
        if p_price is null or p_price < 0 then raise exception 'Buy-back price is required'; end if;
        v_cost := p_price * 100 * c.contracts;
        update csp_positions set status = 'closed', closed_on = p_on, close_price = p_price where id = c.id;
        update portfolios set cash = cash - v_cost where id = c.portfolio_id;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, realized_gain, csp_id)
        values (auth.uid(), c.portfolio_id, p_on, 'csp_close', c.symbol, c.contracts, p_price, -v_cost, (c.premium - p_price) * 100 * c.contracts, c.id);

    elsif p_outcome = 'assigned' then
        v_shares := 100 * c.contracts;
        v_basis := greatest(c.strike - c.premium, 0);
        v_cost := c.strike * v_shares;
        update csp_positions set status = 'assigned', closed_on = p_on where id = c.id;
        update portfolios set cash = cash - v_cost where id = c.portfolio_id;
        insert into holdings (user_id, portfolio_id, symbol, quantity, avg_cost)
        values (auth.uid(), c.portfolio_id, c.symbol, v_shares, v_basis)
        on conflict (portfolio_id, symbol) do update set
            avg_cost = (holdings.quantity * holdings.avg_cost + v_shares * v_basis) / (holdings.quantity + v_shares),
            quantity = holdings.quantity + v_shares,
            updated_at = now();
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, csp_id)
        values (auth.uid(), c.portfolio_id, p_on, 'csp_assign', c.symbol, v_shares, c.strike, -v_cost, c.id);

    else
        raise exception 'Unknown outcome %', p_outcome;
    end if;
end $$;

-- A part closed in the same save it was split off has its opening and closing entries at
-- the same instant: the closing one is the newer of the two.
create or replace function position_undo_last(p_option uuid default null, p_csp uuid default null) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
begin
    select id into v_id from portfolio_activity
    where user_id = auth.uid() and voided_at is null
      and ((p_option is not null and option_id = p_option) or (p_csp is not null and csp_id = p_csp))
    order by created_at desc, (kind in ('option_buy', 'option_write', 'csp_open')), id
    limit 1;
    if v_id is null then raise exception 'Nothing to undo for this position'; end if;
    perform portfolio_entry_delete(v_id);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Archived portfolios keep their earlier months
-- ---------------------------------------------------------------------------

alter table portfolios add column if not exists archived_on date;

update portfolios p
set archived_on = coalesce(
    (select max(v.value_date) from portfolio_daily_values v where v.portfolio_id = p.id),
    (p.created_at at time zone 'America/Chicago')::date
)
where p.archived and p.archived_on is null;

create or replace function _portfolio_archived_on() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if new.archived and not old.archived then
        new.archived_on := (now() at time zone 'America/Chicago')::date;
    elsif not new.archived then
        new.archived_on := null;
    end if;
    return new;
end $$;

drop trigger if exists portfolios_archived_on on portfolios;
create trigger portfolios_archived_on
    before update on portfolios
    for each row execute function _portfolio_archived_on();

-- ---------------------------------------------------------------------------
-- 3. Shares you already own, with no saved price
-- ---------------------------------------------------------------------------

drop function if exists portfolio_buy(uuid, text, numeric, numeric, boolean, date, numeric);
create or replace function portfolio_buy(
    p_portfolio uuid, p_symbol text, p_quantity numeric, p_price numeric,
    p_from_cash boolean default true, p_on date default current_date, p_fee numeric default 0,
    p_market_price numeric default null
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
    if p_market_price is not null and p_market_price < 0 then raise exception 'Today''s price must be zero or more'; end if;

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
        -- Money in is counted at what the shares are worth: the latest saved close, else the
        -- price given, else (last resort) the average cost.
        select close into v_flow_price from prices where symbol = v_sym order by price_date desc limit 1;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
        values (auth.uid(), p_portfolio, p_on, 'transfer_in', v_sym, p_quantity, p_price,
                p_quantity * coalesce(v_flow_price, p_market_price, p_price));
    end if;
end $$;

-- Same as before, except an edited "shares I already own" entry keeps the price its money-in
-- was first counted at when no close has been saved for the ticker since.
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
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, false, p_on, 0,
            case when upper(btrim(p_symbol)) = a.symbol and a.quantity > 0 then a.external_flow / a.quantity end);
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

-- ---------------------------------------------------------------------------
-- Wording: the undo message for shares moved out names the current menu item.
-- The function is otherwise unchanged from 20261028020000_ledger_lockdown.sql.
-- ---------------------------------------------------------------------------

create or replace function portfolio_entry_delete(p_activity uuid) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    a portfolio_activity%rowtype;
    o option_positions%rowtype;
    c csp_positions%rowtype;
    h holdings%rowtype;
begin
    select * into a from portfolio_activity where id = p_activity and user_id = auth.uid() and voided_at is null for update;
    if not found then raise exception 'Entry not found, or already undone'; end if;

    if a.kind in ('buy', 'sell', 'transfer_in', 'option_exercise', 'option_assign', 'csp_assign', 'split')
       and exists (
           select 1 from portfolio_activity x
           where x.portfolio_id = a.portfolio_id and x.symbol = a.symbol and x.id <> a.id
             and x.created_at > a.created_at and x.voided_at is null
             and x.kind in ('buy', 'sell', 'transfer_in', 'transfer_out', 'option_exercise', 'option_assign', 'csp_assign', 'split')
       ) then
        raise exception 'Newer % entries depend on this one — undo those first, newest first', a.symbol;
    end if;

    case
    when a.kind in ('deposit', 'withdrawal', 'dividend', 'cash_adjust') then
        null; -- cash only

    when a.kind = 'buy' then
        perform _holding_unadd(a.portfolio_id, a.symbol, a.quantity, a.price);

    when a.kind = 'transfer_in' then
        if exists (
            select 1 from portfolio_activity x
            where x.user_id = a.user_id and x.kind = 'transfer_out' and x.symbol = a.symbol
              and x.quantity = a.quantity and x.created_at = a.created_at and x.portfolio_id <> a.portfolio_id
              and x.voided_at is null
        ) then
            raise exception 'These % shares were transferred from another portfolio — transfer them back instead', a.symbol;
        end if;
        perform _holding_unadd(a.portfolio_id, a.symbol, a.quantity, a.price);

    when a.kind = 'sell' then
        if a.realized_gain is null or a.quantity is null or a.quantity = 0 then
            raise exception 'This sale is missing its cost basis and can''t be undone — sell or add the shares to match instead';
        end if;
        perform _holding_readd(a.portfolio_id, a.symbol, a.quantity, a.price - a.realized_gain / a.quantity);

    when a.kind = 'split' then
        -- price holds the ratio (new shares per old share): divide it back out
        select * into h from holdings where portfolio_id = a.portfolio_id and symbol = a.symbol for update;
        if not found then raise exception 'You no longer hold % — the split can''t be undone', a.symbol; end if;
        if h.quantity / a.price < _covered_shares(a.portfolio_id, a.symbol) then
            raise exception 'Those % shares are covering open calls — buy back or close those calls first', a.symbol;
        end if;
        update holdings set quantity = h.quantity / a.price, avg_cost = h.avg_cost * a.price, updated_at = now() where id = h.id;

    when a.kind = 'transfer_out' then
        raise exception 'Shares moved out can''t be undone here — transfer them back, or log them again with Shares I already own';

    when a.kind in ('option_buy', 'option_write') then
        select * into o from option_positions where id = a.option_id for update;
        if found and o.status <> 'open' then
            raise exception 'This option is %. Reopen it first (undo its close), then undo it', o.status;
        end if;

    when a.kind in ('option_sell', 'option_buyback', 'option_expire', 'option_exercise', 'option_assign') then
        select * into o from option_positions where id = a.option_id for update;
        if not found then raise exception 'Option not found'; end if;
        if o.status = 'open' then raise exception 'This option is already open'; end if;
        if a.kind = 'option_exercise' then
            perform _holding_unadd(a.portfolio_id, a.symbol, a.quantity, o.strike + o.open_price);
        elsif a.kind = 'option_assign' then
            perform _holding_readd(a.portfolio_id, a.symbol, a.quantity, o.strike + o.open_price - coalesce(a.realized_gain, 0) / a.quantity);
        end if;
        update option_positions set status = 'open', closed_on = null, close_price = null where id = o.id;

    when a.kind = 'csp_open' then
        select * into c from csp_positions where id = a.csp_id for update;
        if found and c.status <> 'open' then
            raise exception 'This put is %. Reopen it first (undo its close), then undo it', c.status;
        end if;

    when a.kind in ('csp_close', 'csp_expire', 'csp_assign') then
        select * into c from csp_positions where id = a.csp_id for update;
        if not found then raise exception 'Put not found'; end if;
        if c.status = 'open' then raise exception 'This put is already open'; end if;
        if a.kind = 'csp_assign' then
            perform _holding_unadd(a.portfolio_id, a.symbol, a.quantity, greatest(c.strike - c.premium, 0));
        end if;
        update csp_positions set status = 'open', closed_on = null, close_price = null where id = c.id;

    else
        raise exception 'Unknown entry %', a.kind;
    end case;

    update portfolios set cash = cash - a.cash_change where id = a.portfolio_id;
    -- kept as history: voided, never deleted
    update portfolio_activity set voided_at = now() where id = a.id;
    if a.kind in ('option_buy', 'option_write') and a.option_id is not null then
        delete from option_positions where id = a.option_id;
    elsif a.kind = 'csp_open' and a.csp_id is not null then
        delete from csp_positions where id = a.csp_id;
    end if;
end $$;

commit;
