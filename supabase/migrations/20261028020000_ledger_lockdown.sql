-- Ledger audit, part 2 of 2: Activity becomes an append-only ledger, and the action
-- functions become the only way to change holdings, cash and positions.
--
-- 1. Undo voids instead of deleting. portfolio_entry_delete marks the entry voided_at (it
--    stays as history); an edit voids the original and links it to its replacement
--    (replaced_by). A trigger rejects any other change or delete on portfolio_activity --
--    from the app, the API or the SQL editor. Deletes cascading from removing a portfolio,
--    an account or an option row still go through.
-- 2. The action functions run as the database owner (security definer, fixed search_path)
--    and keep their checks that the portfolio/entry is the caller's. Signed-in users lose
--    direct insert/update/delete on holdings, portfolio_activity, option_positions and
--    csp_positions, and direct writes to portfolio cash. What stays editable directly:
--    portfolio name/type/archived (and creating one), a holding's manual price, and an
--    option's or put's current price (mark).
--
-- In an emergency the owner can still bypass the trigger with
--   alter table portfolio_activity disable trigger portfolio_activity_append_only;
-- Requires 20261028010000_ledger_audit.sql. Safe to re-run.
begin;

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
        new.cash_change, new.external_flow, new.realized_gain, new.csp_id, new.option_id, new.created_at)
       is distinct from
       (old.id, old.user_id, old.portfolio_id, old.occurred_on, old.kind, old.symbol, old.quantity, old.price,
        old.cash_change, old.external_flow, old.realized_gain, old.csp_id, old.option_id, old.created_at)
       or (old.voided_at is not null and new.voided_at is distinct from old.voided_at)
       or (old.replaced_by is not null and new.replaced_by is distinct from old.replaced_by) then
        raise exception 'Activity entries can''t be changed -- edit or undo them in the app instead';
    end if;
    return new;
end $$;

drop trigger if exists portfolio_activity_append_only on portfolio_activity;
create trigger portfolio_activity_append_only
    before update or delete on portfolio_activity
    for each row execute function _activity_append_only();

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
    -- kept as history: voided, never deleted
    update portfolio_activity set voided_at = now() where id = a.id;
    if a.kind in ('option_buy', 'option_write') and a.option_id is not null then
        delete from option_positions where id = a.option_id;
    elsif a.kind = 'csp_open' and a.csp_id is not null then
        delete from csp_positions where id = a.csp_id;
    end if;
end $$;

create or replace function portfolio_entry_edit(
    p_activity uuid, p_symbol text, p_quantity numeric, p_price numeric, p_amount numeric, p_on date
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
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, true, p_on);
    elsif a.kind = 'transfer_in' then
        perform portfolio_buy(a.portfolio_id, p_symbol, p_quantity, p_price, false, p_on);
    elsif a.kind = 'sell' then
        perform portfolio_sell(a.portfolio_id, p_symbol, p_quantity, p_price, true, p_on);
    else
        perform portfolio_cash(a.portfolio_id, a.kind, p_amount, p_symbol, p_on);
    end if;

    select id into v_new from portfolio_activity
    where portfolio_id = a.portfolio_id and kind = a.kind and voided_at is null and created_at = now()
    order by id limit 1;
    update portfolio_activity set replaced_by = v_new where id = a.id;
end $$;

create or replace function option_edit(
    p_option uuid, p_symbol text, p_strike numeric, p_expiration date, p_contracts int,
    p_price numeric, p_is_hedge boolean, p_on date
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    o option_positions%rowtype;
    v_open uuid;
    v_id uuid;
begin
    select * into o from option_positions where id = p_option and user_id = auth.uid();
    if not found then raise exception 'Option not found'; end if;
    if o.status <> 'open' then raise exception 'Only open options can be edited — reopen it first'; end if;
    select id into v_open from portfolio_activity where option_id = o.id and kind in ('option_buy', 'option_write') and voided_at is null limit 1;
    if v_open is null then raise exception 'This option''s opening entry is missing — delete it and add it again'; end if;

    perform portfolio_entry_delete(v_open);
    v_id := option_open(o.portfolio_id, p_symbol, o.option_type, o.side, p_strike, p_expiration, p_contracts, p_price, p_is_hedge, p_on);
    update portfolio_activity set replaced_by = (select id from portfolio_activity where option_id = v_id and voided_at is null limit 1)
    where id = v_open;
    if upper(btrim(p_symbol)) = o.symbol and p_strike = o.strike and p_expiration = o.expiration then
        update option_positions set mark = o.mark where id = v_id;
    end if;
    return v_id;
end $$;

create or replace function csp_edit(
    p_csp uuid, p_symbol text, p_strike numeric, p_expiration date, p_contracts int, p_premium numeric, p_on date
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    c csp_positions%rowtype;
    v_open uuid;
    v_id uuid;
begin
    select * into c from csp_positions where id = p_csp and user_id = auth.uid();
    if not found then raise exception 'Put not found'; end if;
    if c.status <> 'open' then raise exception 'Only open puts can be edited — reopen it first'; end if;
    select id into v_open from portfolio_activity where csp_id = c.id and kind = 'csp_open' and voided_at is null limit 1;
    if v_open is null then raise exception 'This put''s opening entry is missing — delete it and add it again'; end if;

    perform portfolio_entry_delete(v_open);
    v_id := csp_open(c.portfolio_id, p_symbol, p_strike, p_expiration, p_contracts, p_premium, p_on);
    update portfolio_activity set replaced_by = (select id from portfolio_activity where csp_id = v_id and voided_at is null limit 1)
    where id = v_open;
    if upper(btrim(p_symbol)) = c.symbol and p_strike = c.strike and p_expiration = c.expiration then
        update csp_positions set mark = c.mark where id = v_id;
    end if;
    return v_id;
end $$;

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
    order by created_at desc
    limit 1;
    if v_id is null then raise exception 'Nothing to undo for this position'; end if;
    perform portfolio_entry_delete(v_id);
end $$;

-- The rest of the action functions: same code, now run as the owner with a fixed search_path.
alter function portfolio_buy(uuid, text, numeric, numeric, boolean, date) security definer set search_path = public, pg_temp;
alter function portfolio_sell(uuid, text, numeric, numeric, boolean, date) security definer set search_path = public, pg_temp;
alter function portfolio_cash(uuid, text, numeric, text, date) security definer set search_path = public, pg_temp;
alter function portfolio_set_cash(uuid, numeric, boolean, date) security definer set search_path = public, pg_temp;
alter function portfolio_transfer(uuid, text, numeric, uuid, date) security definer set search_path = public, pg_temp;
alter function portfolio_split(uuid, text, numeric, date) security definer set search_path = public, pg_temp;
alter function csp_open(uuid, text, numeric, date, int, numeric, date) security definer set search_path = public, pg_temp;
alter function csp_resolve(uuid, text, numeric, date) security definer set search_path = public, pg_temp;
alter function option_open(uuid, text, text, text, numeric, date, int, numeric, boolean, date) security definer set search_path = public, pg_temp;
alter function option_close(uuid, text, numeric, date) security definer set search_path = public, pg_temp;
-- Helpers run inside the actions; called directly they have the caller's (now read-only) rights.
alter function _own_portfolio(uuid) set search_path = public, pg_temp;
alter function _covered_shares(uuid, text, uuid) set search_path = public, pg_temp;
alter function _holding_unadd(uuid, text, numeric, numeric) set search_path = public, pg_temp;
alter function _holding_readd(uuid, text, numeric, numeric) set search_path = public, pg_temp;

-- Signed-in users: read everything of theirs, write only through the actions above.
revoke insert, update, delete on holdings, portfolio_activity, option_positions, csp_positions from anon, authenticated;
revoke insert, update, delete on portfolios from anon, authenticated;
grant insert (user_id, name, kind) on portfolios to authenticated;
grant update (name, kind, archived) on portfolios to authenticated;
grant update (manual_price, updated_at) on holdings to authenticated;
grant update (mark) on option_positions to authenticated;
grant update (mark) on csp_positions to authenticated;

commit;
