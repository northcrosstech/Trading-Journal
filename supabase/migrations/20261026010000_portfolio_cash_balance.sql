-- Set a portfolio's cash balance to what the broker shows -- including a negative balance
-- for margin used (e.g. -33,481.61). Recorded as a 'cash_adjust' Activity entry, so it can
-- be undone like any other.
--
--   portfolio_set_cash(portfolio, balance, counts_in_return, on)
--     counts_in_return = false (default): a setup / correction -- the change is treated as
--         money in or out (external_flow), so it isn't a gain or loss in returns. Use it to
--         bring the app in line with the broker, e.g. shares added with Add existing that
--         were really bought on margin.
--     counts_in_return = true: margin interest or fees -- a real cost, so it lowers returns.
--   Neither counts as "Invested" on the Cash flow page (only deposits and withdrawals do).
--
-- Also re-creates portfolio_entry_delete so a balance change can be undone.
-- Requires 20261025010000_portfolio_entry_edit.sql. Safe to re-run.
begin;

alter table portfolio_activity drop constraint if exists portfolio_activity_kind_check;
alter table portfolio_activity add constraint portfolio_activity_kind_check check (kind in (
    'deposit', 'withdrawal', 'dividend', 'cash_adjust', 'buy', 'sell', 'transfer_in', 'transfer_out',
    'csp_open', 'csp_close', 'csp_expire', 'csp_assign',
    'option_buy', 'option_sell', 'option_write', 'option_buyback', 'option_expire', 'option_exercise', 'option_assign'
));

create or replace function portfolio_set_cash(
    p_portfolio uuid, p_balance numeric, p_counts_in_return boolean default false, p_on date default current_date
) returns void
language plpgsql as $$
declare
    v_cash numeric;
    v_delta numeric;
begin
    perform _own_portfolio(p_portfolio);
    if p_balance is null then raise exception 'Enter the cash balance'; end if;
    select cash into v_cash from portfolios where id = p_portfolio for update;
    v_delta := p_balance - v_cash;
    if v_delta = 0 then raise exception 'Cash is already %', p_balance; end if;

    update portfolios set cash = p_balance where id = p_portfolio;
    -- price holds the balance it was set to, for the Activity list
    insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, price, cash_change, external_flow)
    values (auth.uid(), p_portfolio, p_on, 'cash_adjust', p_balance, v_delta,
            case when p_counts_in_return then 0 else v_delta end);
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

commit;
