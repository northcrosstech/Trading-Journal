-- Shares and average cost now change only through Activity entries; the holding's pencil
-- edit keeps just the manual price. A stock split, the one change that moves quantity and
-- cost without cash, becomes its own entry:
--
--   portfolio_split(portfolio, symbol, ratio, on)
--     ratio = new shares per old share: 2 for a 2-for-1 split, 0.1 for a 1-for-10 reverse
--     split. Quantity x ratio, average cost / ratio -- total cost unchanged, no cash moves.
--     Recorded as a 'split' entry (price = ratio, quantity = shares after) and undoable.
--
-- Also re-creates _holding_unadd (message only) and portfolio_entry_delete so a split can be undone, and so it counts as a
-- holding change under the "newest entry for this ticker" rule.
-- Requires 20261026010000_portfolio_cash_balance.sql. Safe to re-run.
begin;

alter table portfolio_activity drop constraint if exists portfolio_activity_kind_check;
alter table portfolio_activity add constraint portfolio_activity_kind_check check (kind in (
    'deposit', 'withdrawal', 'dividend', 'cash_adjust', 'buy', 'sell', 'transfer_in', 'transfer_out', 'split',
    'csp_open', 'csp_close', 'csp_expire', 'csp_assign',
    'option_buy', 'option_sell', 'option_write', 'option_buyback', 'option_expire', 'option_exercise', 'option_assign'
));

-- Take back shares an entry added at p_cost per share (the reverse of a buy).
create or replace function _holding_unadd(p_portfolio uuid, p_symbol text, p_qty numeric, p_cost numeric) returns void
language plpgsql as $$
declare
    h holdings%rowtype;
    v_left numeric;
begin
    select * into h from holdings where portfolio_id = p_portfolio and symbol = p_symbol for update;
    if not found or h.quantity < p_qty then
        raise exception 'You no longer hold the % % shares this entry added — undo the newer entries for it first', p_qty, p_symbol;
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

create or replace function portfolio_split(p_portfolio uuid, p_symbol text, p_ratio numeric, p_on date default current_date) returns void
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    h holdings%rowtype;
    v_qty numeric;
begin
    perform _own_portfolio(p_portfolio);
    if p_ratio is null or p_ratio <= 0 or p_ratio = 1 then raise exception 'Enter a split ratio, e.g. 2 for 1'; end if;
    select * into h from holdings where portfolio_id = p_portfolio and symbol = v_sym for update;
    if not found then raise exception 'You don''t hold %', v_sym; end if;
    v_qty := h.quantity * p_ratio;
    if v_qty < _covered_shares(p_portfolio, v_sym) then
        raise exception 'After the split you''d hold fewer % shares than your open calls cover', v_sym;
    end if;

    update holdings set quantity = v_qty, avg_cost = h.avg_cost / p_ratio, updated_at = now() where id = h.id;
    insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price)
    values (auth.uid(), p_portfolio, p_on, 'split', v_sym, v_qty, p_ratio);
end $$;

create or replace function portfolio_entry_delete(p_activity uuid) returns void
language plpgsql as $$
declare
    a portfolio_activity%rowtype;
    o option_positions%rowtype;
    c csp_positions%rowtype;
    h holdings%rowtype;
begin
    select * into a from portfolio_activity where id = p_activity and user_id = auth.uid() for update;
    if not found then raise exception 'Entry not found'; end if;

    if a.kind in ('buy', 'sell', 'transfer_in', 'option_exercise', 'option_assign', 'csp_assign', 'split')
       and exists (
           select 1 from portfolio_activity x
           where x.portfolio_id = a.portfolio_id and x.symbol = a.symbol and x.id <> a.id
             and x.created_at > a.created_at
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

commit;
