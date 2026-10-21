-- Long calls, long puts (LEAPS, hedges) and covered calls, entered by hand. Cash-secured
-- puts stay in csp_positions.
--
--   option_positions.side      long = bought (premium paid), short = sold covered call
--   open_price                 per share: paid for long, received for short
--   mark                       optional current option price per share; with none,
--                              a long option is valued at what was paid and a covered
--                              call at its intrinsic value (max(0, stock - strike))
--   is_hedge                   just a label
--
-- Adds activity kinds for options and portfolio_daily_values.options_value (long option
-- value minus covered-call buy-back cost). Requires 20261021020000_portfolios.sql.
-- Safe to re-run.
begin;

create table if not exists option_positions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    symbol text not null,
    option_type text not null check (option_type in ('call', 'put')),
    side text not null check (side in ('long', 'short')),
    strike numeric not null check (strike > 0),
    expiration date not null,
    contracts int not null check (contracts > 0),
    open_price numeric not null check (open_price >= 0),
    opened_on date not null default current_date,
    status text not null default 'open' check (status in ('open', 'closed', 'expired', 'exercised', 'assigned')),
    closed_on date,
    close_price numeric check (close_price is null or close_price >= 0),
    mark numeric check (mark is null or mark >= 0),
    is_hedge boolean not null default false,
    created_at timestamptz not null default now(),
    -- short puts are cash-secured puts (csp_positions); short calls here are covered calls
    check (side = 'long' or option_type = 'call')
);
create index if not exists option_positions_user_idx on option_positions (user_id);

alter table option_positions enable row level security;
drop policy if exists "option_positions_own" on option_positions;
create policy "option_positions_own" on option_positions for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and exists (select 1 from portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

alter table portfolio_activity add column if not exists option_id uuid references option_positions(id) on delete set null;
alter table portfolio_activity drop constraint if exists portfolio_activity_kind_check;
alter table portfolio_activity add constraint portfolio_activity_kind_check check (kind in (
    'deposit', 'withdrawal', 'dividend', 'buy', 'sell', 'transfer_in', 'transfer_out',
    'csp_open', 'csp_close', 'csp_expire', 'csp_assign',
    'option_buy', 'option_sell', 'option_write', 'option_buyback', 'option_expire', 'option_exercise', 'option_assign'
));

alter table portfolio_daily_values add column if not exists options_value numeric not null default 0;

-- Shares of a ticker already promised to open covered calls in a portfolio.
create or replace function _covered_shares(p_portfolio uuid, p_symbol text, p_except uuid default null) returns numeric
language sql stable as $$
    select coalesce(sum(contracts * 100), 0) from option_positions
    where portfolio_id = p_portfolio and symbol = p_symbol and side = 'short' and status = 'open'
      and (p_except is null or id <> p_except)
$$;

-- portfolio_sell, unchanged except it refuses to sell shares promised to open covered calls.
create or replace function portfolio_sell(
    p_portfolio uuid, p_symbol text, p_quantity numeric, p_price numeric,
    p_to_cash boolean default true, p_on date default current_date
) returns void
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    h holdings%rowtype;
    v_proceeds numeric := p_quantity * p_price;
    v_covered numeric;
begin
    perform _own_portfolio(p_portfolio);
    if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;

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
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, realized_gain)
        values (auth.uid(), p_portfolio, p_on, 'sell', v_sym, p_quantity, p_price, v_proceeds, (p_price - h.avg_cost) * p_quantity);
    else
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
        values (auth.uid(), p_portfolio, p_on, 'transfer_out', v_sym, p_quantity, p_price, -v_proceeds);
    end if;
end $$;

-- Open a position. Long: the premium is paid from cash. Short (covered call): the
-- premium lands in cash, and 100 uncovered shares per contract must be held.
create or replace function option_open(
    p_portfolio uuid, p_symbol text, p_option_type text, p_side text, p_strike numeric, p_expiration date,
    p_contracts int, p_price numeric, p_is_hedge boolean default false, p_on date default current_date
) returns uuid
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    v_total numeric := p_price * 100 * p_contracts;
    v_held numeric;
    v_id uuid;
begin
    perform _own_portfolio(p_portfolio);
    if v_sym = '' then raise exception 'Ticker is required'; end if;
    if p_contracts is null or p_contracts <= 0 then raise exception 'Contracts must be positive'; end if;
    if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;
    if p_side = 'short' and p_option_type <> 'call' then raise exception 'Sold puts go under Cash-secured puts'; end if;

    if p_side = 'short' then
        select coalesce(quantity, 0) into v_held from holdings where portfolio_id = p_portfolio and symbol = v_sym;
        if coalesce(v_held, 0) - _covered_shares(p_portfolio, v_sym) < 100 * p_contracts then
            raise exception 'A covered call needs 100 uncovered % shares per contract (you have % uncovered)',
                v_sym, greatest(coalesce(v_held, 0) - _covered_shares(p_portfolio, v_sym), 0);
        end if;
    end if;

    insert into option_positions (user_id, portfolio_id, symbol, option_type, side, strike, expiration, contracts, open_price, opened_on, is_hedge)
    values (auth.uid(), p_portfolio, v_sym, p_option_type, p_side, p_strike, p_expiration, p_contracts, p_price, p_on, coalesce(p_is_hedge, false))
    returning id into v_id;

    update portfolios set cash = cash + case when p_side = 'long' then -v_total else v_total end where id = p_portfolio;
    insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, option_id)
    values (auth.uid(), p_portfolio, p_on, case when p_side = 'long' then 'option_buy' else 'option_write' end,
            v_sym, p_contracts, p_price, case when p_side = 'long' then -v_total else v_total end, v_id);
    return v_id;
end $$;

-- Resolve an open position:
--   long:  closed (sold at p_price) | expired (worthless) | exercised (calls only: buys
--          100 shares per contract at the strike; cost basis = strike + premium paid)
--   short: closed (bought back at p_price) | expired (premium kept) | assigned (shares
--          sold at the strike; gain = strike - average cost + premium, per share)
create or replace function option_close(
    p_option uuid, p_outcome text, p_price numeric default null, p_on date default current_date
) returns void
language plpgsql as $$
declare
    o option_positions%rowtype;
    h holdings%rowtype;
    v_shares numeric;
    v_amount numeric;
    v_basis numeric;
begin
    select * into o from option_positions where id = p_option and user_id = auth.uid() for update;
    if not found then raise exception 'Option not found'; end if;
    if o.status <> 'open' then raise exception 'This option is already %', o.status; end if;
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

commit;
