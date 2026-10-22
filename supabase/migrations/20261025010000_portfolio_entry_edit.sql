-- Fixing mistakes in portfolio entries: undo (delete) any entry, edit stock/cash entries,
-- and edit open options and cash-secured puts.
--
-- Entries are applied straight to holdings and cash when made, so undoing one reverses
-- exactly what it did (cash, shares, average cost, option status), and editing one is
-- undo + make it again with the corrected values -- in a single save, so a failed edit
-- leaves the original untouched.
--
--   portfolio_entry_delete(activity)  -- undo one Activity entry
--   portfolio_entry_edit(activity, ...) -- buy / sell / add existing / deposit /
--                                        withdrawal / dividend, same kind, new values
--   option_edit(option, ...)          -- an open long option or covered call
--   csp_edit(csp, ...)                -- an open cash-secured put
--   position_undo_last(option, csp)   -- reopen a closed/expired/assigned/exercised
--                                        position, or delete an open one
--
-- To keep the maths exact, an entry that changed a holding can only be undone while it's
-- the newest entry that changed that ticker in that portfolio (undo newer ones first).
-- Transfers between portfolios and shares moved out can't be undone here: transfer them
-- back, or use Add existing.
--
-- Requires 20261022020000_portfolio_transfer.sql. Safe to re-run.
begin;

-- Take back shares an entry added at p_cost per share (the reverse of a buy).
create or replace function _holding_unadd(p_portfolio uuid, p_symbol text, p_qty numeric, p_cost numeric) returns void
language plpgsql as $$
declare
    h holdings%rowtype;
    v_left numeric;
begin
    select * into h from holdings where portfolio_id = p_portfolio and symbol = p_symbol for update;
    if not found or h.quantity < p_qty then
        raise exception 'You no longer hold the % % shares this entry added — fix the holding with Edit instead', p_qty, p_symbol;
    end if;
    v_left := h.quantity - p_qty;
    if v_left < _covered_shares(p_portfolio, p_symbol) then
        raise exception 'Those % shares are covering open calls — buy back or close those calls first', p_symbol;
    end if;
    if v_left = 0 then
        delete from holdings where id = h.id;
    else
        update holdings
        set quantity = v_left,
            avg_cost = greatest((h.quantity * h.avg_cost - p_qty * p_cost) / v_left, 0),
            updated_at = now()
        where id = h.id;
    end if;
end $$;

-- Put back shares an entry removed, at their p_cost per share (the reverse of a sale).
create or replace function _holding_readd(p_portfolio uuid, p_symbol text, p_qty numeric, p_cost numeric) returns void
language plpgsql as $$
begin
    insert into holdings (user_id, portfolio_id, symbol, quantity, avg_cost)
    values (auth.uid(), p_portfolio, p_symbol, p_qty, greatest(p_cost, 0))
    on conflict (portfolio_id, symbol) do update set
        avg_cost = (holdings.quantity * holdings.avg_cost + p_qty * greatest(p_cost, 0)) / (holdings.quantity + p_qty),
        quantity = holdings.quantity + p_qty,
        updated_at = now();
end $$;

create or replace function portfolio_entry_delete(p_activity uuid) returns void
language plpgsql as $$
declare
    a portfolio_activity%rowtype;
    o option_positions%rowtype;
    c csp_positions%rowtype;
begin
    select * into a from portfolio_activity where id = p_activity and user_id = auth.uid() for update;
    if not found then raise exception 'Entry not found'; end if;

    if a.kind in ('buy', 'sell', 'transfer_in', 'option_exercise', 'option_assign', 'csp_assign')
       and exists (
           select 1 from portfolio_activity x
           where x.portfolio_id = a.portfolio_id and x.symbol = a.symbol and x.id <> a.id
             and x.created_at > a.created_at
             and x.kind in ('buy', 'sell', 'transfer_in', 'transfer_out', 'option_exercise', 'option_assign', 'csp_assign')
       ) then
        raise exception 'Newer % entries depend on this one — undo those first (newest first), or fix the holding with Edit', a.symbol;
    end if;

    case
    when a.kind in ('deposit', 'withdrawal', 'dividend') then
        null; -- cash only

    when a.kind = 'buy' then
        perform _holding_unadd(a.portfolio_id, a.symbol, a.quantity, a.price);

    when a.kind = 'transfer_in' then
        if exists (
            select 1 from portfolio_activity x
            where x.user_id = a.user_id and x.kind = 'transfer_out' and x.symbol = a.symbol
              and x.quantity = a.quantity and x.created_at = a.created_at and x.portfolio_id <> a.portfolio_id
        ) then
            raise exception 'These % shares were transferred from another portfolio — transfer them back instead', a.symbol;
        end if;
        perform _holding_unadd(a.portfolio_id, a.symbol, a.quantity, a.price);

    when a.kind = 'sell' then
        if a.realized_gain is null or a.quantity is null or a.quantity = 0 then
            raise exception 'This sale is missing its cost basis and can''t be undone — fix the holding with Edit instead';
        end if;
        perform _holding_readd(a.portfolio_id, a.symbol, a.quantity, a.price - a.realized_gain / a.quantity);

    when a.kind = 'transfer_out' then
        raise exception 'Shares moved out can''t be undone here — transfer them back, or use Add existing';

    when a.kind in ('option_buy', 'option_write') then
        select * into o from option_positions where id = a.option_id for update;
        if found and o.status <> 'open' then
            raise exception 'This option is %. Reopen it first (undo its close), then delete it', o.status;
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
            raise exception 'This put is %. Reopen it first (undo its close), then delete it', c.status;
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
    delete from portfolio_activity where id = a.id;
    if a.kind in ('option_buy', 'option_write') and a.option_id is not null then
        delete from option_positions where id = a.option_id;
    elsif a.kind = 'csp_open' and a.csp_id is not null then
        delete from csp_positions where id = a.csp_id;
    end if;
end $$;

-- Edit a stock or cash entry: same kind, corrected values. p_amount is for cash entries;
-- p_symbol / p_quantity / p_price for share entries (p_symbol also names a dividend).
create or replace function portfolio_entry_edit(
    p_activity uuid, p_symbol text, p_quantity numeric, p_price numeric, p_amount numeric, p_on date
) returns void
language plpgsql as $$
declare
    a portfolio_activity%rowtype;
begin
    select * into a from portfolio_activity where id = p_activity and user_id = auth.uid();
    if not found then raise exception 'Entry not found'; end if;
    if a.kind not in ('buy', 'sell', 'transfer_in', 'deposit', 'withdrawal', 'dividend') then
        raise exception 'This entry can''t be edited — undo it and enter it again';
    end if;

    perform portfolio_entry_delete(a.id);

    if a.kind = 'buy' then
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, true, p_on);
    elsif a.kind = 'transfer_in' then
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, false, p_on);
    elsif a.kind = 'sell' then
        perform portfolio_sell(a.portfolio_id, p_symbol, p_quantity, p_price, true, p_on);
    else
        perform portfolio_cash(a.portfolio_id, a.kind, p_amount, p_symbol, p_on);
    end if;
end $$;

-- Edit an open long option or covered call. Type and side stay; for those, delete and
-- add it again. The current price you entered is kept if the contract didn't change.
create or replace function option_edit(
    p_option uuid, p_symbol text, p_strike numeric, p_expiration date, p_contracts int,
    p_price numeric, p_is_hedge boolean, p_on date
) returns uuid
language plpgsql as $$
declare
    o option_positions%rowtype;
    v_open uuid;
    v_id uuid;
begin
    select * into o from option_positions where id = p_option and user_id = auth.uid();
    if not found then raise exception 'Option not found'; end if;
    if o.status <> 'open' then raise exception 'Only open options can be edited — reopen it first'; end if;
    select id into v_open from portfolio_activity where option_id = o.id and kind in ('option_buy', 'option_write') limit 1;
    if v_open is null then raise exception 'This option''s opening entry is missing — delete it and add it again'; end if;

    perform portfolio_entry_delete(v_open);
    v_id := option_open(o.portfolio_id, p_symbol, o.option_type, o.side, p_strike, p_expiration, p_contracts, p_price, p_is_hedge, p_on);
    if upper(btrim(p_symbol)) = o.symbol and p_strike = o.strike and p_expiration = o.expiration then
        update option_positions set mark = o.mark where id = v_id;
    end if;
    return v_id;
end $$;

-- Edit an open cash-secured put.
create or replace function csp_edit(
    p_csp uuid, p_symbol text, p_strike numeric, p_expiration date, p_contracts int, p_premium numeric, p_on date
) returns uuid
language plpgsql as $$
declare
    c csp_positions%rowtype;
    v_open uuid;
    v_id uuid;
begin
    select * into c from csp_positions where id = p_csp and user_id = auth.uid();
    if not found then raise exception 'Put not found'; end if;
    if c.status <> 'open' then raise exception 'Only open puts can be edited — reopen it first'; end if;
    select id into v_open from portfolio_activity where csp_id = c.id and kind = 'csp_open' limit 1;
    if v_open is null then raise exception 'This put''s opening entry is missing — delete it and add it again'; end if;

    perform portfolio_entry_delete(v_open);
    v_id := csp_open(c.portfolio_id, p_symbol, p_strike, p_expiration, p_contracts, p_premium, p_on);
    if upper(btrim(p_symbol)) = c.symbol and p_strike = c.strike and p_expiration = c.expiration then
        update csp_positions set mark = c.mark where id = v_id;
    end if;
    return v_id;
end $$;

-- Undo the newest entry of a position: a closed one reopens, an open one is deleted.
create or replace function position_undo_last(p_option uuid default null, p_csp uuid default null) returns void
language plpgsql as $$
declare
    v_id uuid;
begin
    select id into v_id from portfolio_activity
    where user_id = auth.uid()
      and ((p_option is not null and option_id = p_option) or (p_csp is not null and csp_id = p_csp))
    order by created_at desc
    limit 1;
    if v_id is null then raise exception 'Nothing to undo for this position'; end if;
    perform portfolio_entry_delete(v_id);
end $$;

commit;
