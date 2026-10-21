-- Portfolio tracker: portfolios with a cash balance, simple holdings (quantity + average
-- cost), an activity log, manually entered cash-secured puts, daily closing prices, and
-- a daily value history per portfolio.
--
--   portfolios             -- kind tags which net-worth line the portfolio feeds
--   holdings               -- one row per ticker per portfolio
--   portfolio_activity     -- every buy / sell / cash move / CSP event. external_flow is
--                             money entering (+) or leaving (-) the portfolio from outside;
--                             it's what time-weighted return excludes. Buys and sells
--                             inside the portfolio move cash, not external_flow.
--   csp_positions          -- cash-secured puts, entered by hand
--   prices                 -- daily closes, shared by all users, written only by the
--                             worker (service role); any signed-in user can read
--   portfolio_daily_values -- written by the worker once per trading day after close
--
-- Multi-row actions go through the functions at the bottom so each one saves completely
-- or not at all. They run as the calling user, so row-level security still applies.
-- Safe to re-run.
begin;

create table if not exists portfolios (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    kind text not null default 'brokerage' check (kind in ('brokerage', '401k', 'traditional_ira', 'roth_ira')),
    cash numeric not null default 0,
    archived boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists portfolios_user_idx on portfolios (user_id);

create table if not exists holdings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    symbol text not null,
    quantity numeric not null check (quantity > 0),
    avg_cost numeric not null check (avg_cost >= 0),
    -- For funds with no public ticker (many 401k funds): used instead of a fetched close.
    manual_price numeric check (manual_price is null or manual_price >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (portfolio_id, symbol)
);
create index if not exists holdings_user_idx on holdings (user_id);

create table if not exists csp_positions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    symbol text not null,
    strike numeric not null check (strike > 0),
    expiration date not null,
    contracts int not null check (contracts > 0),
    premium numeric not null check (premium >= 0), -- per share, as quoted
    opened_on date not null default current_date,
    status text not null default 'open' check (status in ('open', 'expired', 'assigned', 'closed')),
    closed_on date,
    close_price numeric check (close_price is null or close_price >= 0), -- per share, buy-to-close
    mark numeric check (mark is null or mark >= 0), -- optional current option price, per share
    created_at timestamptz not null default now()
);
create index if not exists csp_positions_user_idx on csp_positions (user_id);

create table if not exists portfolio_activity (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    occurred_on date not null default current_date,
    kind text not null check (kind in (
        'deposit', 'withdrawal', 'dividend', 'buy', 'sell', 'transfer_in', 'transfer_out',
        'csp_open', 'csp_close', 'csp_expire', 'csp_assign'
    )),
    symbol text,
    quantity numeric,
    price numeric,
    cash_change numeric not null default 0,
    external_flow numeric not null default 0,
    realized_gain numeric,
    csp_id uuid references csp_positions(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists portfolio_activity_portfolio_idx on portfolio_activity (portfolio_id, created_at);

create table if not exists prices (
    symbol text not null,
    price_date date not null,
    close numeric not null,
    fetched_at timestamptz not null default now(),
    primary key (symbol, price_date)
);

create table if not exists portfolio_daily_values (
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    value_date date not null,
    holdings_value numeric not null,
    cash numeric not null,
    csp_liability numeric not null default 0,
    total_value numeric not null,
    cost_basis numeric not null,
    net_flow numeric not null default 0, -- external flows since the previous day's value
    computed_at timestamptz not null default now(),
    primary key (portfolio_id, value_date)
);
create index if not exists portfolio_daily_values_user_idx on portfolio_daily_values (user_id, value_date);

alter table portfolios enable row level security;
alter table holdings enable row level security;
alter table csp_positions enable row level security;
alter table portfolio_activity enable row level security;
alter table prices enable row level security;
alter table portfolio_daily_values enable row level security;

drop policy if exists "portfolios_own" on portfolios;
create policy "portfolios_own" on portfolios for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "holdings_own" on holdings;
create policy "holdings_own" on holdings for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and exists (select 1 from portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

drop policy if exists "csp_positions_own" on csp_positions;
create policy "csp_positions_own" on csp_positions for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and exists (select 1 from portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

drop policy if exists "portfolio_activity_own" on portfolio_activity;
create policy "portfolio_activity_own" on portfolio_activity for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and exists (select 1 from portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

-- Prices are public market data: readable by any signed-in user, writable only by the
-- worker's service role (which bypasses RLS), so no insert/update policy.
drop policy if exists "prices_read" on prices;
create policy "prices_read" on prices for select to authenticated using (true);

-- Written only by the worker; users read their own.
drop policy if exists "portfolio_daily_values_read_own" on portfolio_daily_values;
create policy "portfolio_daily_values_read_own" on portfolio_daily_values for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------

create or replace function _own_portfolio(p_portfolio uuid) returns void
language plpgsql as $$
begin
    perform 1 from portfolios where id = p_portfolio and user_id = auth.uid();
    if not found then raise exception 'Portfolio not found'; end if;
end $$;

-- Buy shares. p_from_cash = true: paid from the portfolio's cash (a buy). false: shares
-- you already own being added (a transfer in) -- counts as money entering the portfolio,
-- valued at the latest known close (or the given price if there's none yet).
create or replace function portfolio_buy(
    p_portfolio uuid, p_symbol text, p_quantity numeric, p_price numeric,
    p_from_cash boolean default true, p_on date default current_date
) returns void
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    v_cost numeric := p_quantity * p_price;
    v_flow_price numeric;
begin
    perform _own_portfolio(p_portfolio);
    if v_sym = '' then raise exception 'Ticker is required'; end if;
    if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;

    insert into holdings (user_id, portfolio_id, symbol, quantity, avg_cost)
    values (auth.uid(), p_portfolio, v_sym, p_quantity, p_price)
    on conflict (portfolio_id, symbol) do update set
        avg_cost = (holdings.quantity * holdings.avg_cost + v_cost) / (holdings.quantity + p_quantity),
        quantity = holdings.quantity + p_quantity,
        updated_at = now();

    if p_from_cash then
        update portfolios set cash = cash - v_cost where id = p_portfolio;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change)
        values (auth.uid(), p_portfolio, p_on, 'buy', v_sym, p_quantity, p_price, -v_cost);
    else
        select close into v_flow_price from prices where symbol = v_sym order by price_date desc limit 1;
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
        values (auth.uid(), p_portfolio, p_on, 'transfer_in', v_sym, p_quantity, p_price, p_quantity * coalesce(v_flow_price, p_price));
    end if;
end $$;

-- Sell shares. p_to_cash = true: proceeds go to the portfolio's cash (a sale).
-- false: shares leaving the portfolio (a transfer out) -- money leaving from outside's view.
create or replace function portfolio_sell(
    p_portfolio uuid, p_symbol text, p_quantity numeric, p_price numeric,
    p_to_cash boolean default true, p_on date default current_date
) returns void
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    h holdings%rowtype;
    v_proceeds numeric := p_quantity * p_price;
begin
    perform _own_portfolio(p_portfolio);
    if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;

    select * into h from holdings where portfolio_id = p_portfolio and symbol = v_sym for update;
    if not found then raise exception 'You don''t hold %', v_sym; end if;
    if p_quantity > h.quantity then raise exception 'You only hold % shares of %', h.quantity, v_sym; end if;

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

-- Cash moves: deposit (+cash, money in), withdrawal (-cash, money out), dividend
-- (+cash, earned inside the portfolio so not money in).
create or replace function portfolio_cash(
    p_portfolio uuid, p_kind text, p_amount numeric, p_symbol text default null, p_on date default current_date
) returns void
language plpgsql as $$
declare
    v_change numeric;
begin
    perform _own_portfolio(p_portfolio);
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
    if p_kind not in ('deposit', 'withdrawal', 'dividend') then raise exception 'Unknown cash action %', p_kind; end if;

    v_change := case when p_kind = 'withdrawal' then -p_amount else p_amount end;
    update portfolios set cash = cash + v_change where id = p_portfolio;
    insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, cash_change, external_flow)
    values (
        auth.uid(), p_portfolio, p_on, p_kind, nullif(upper(btrim(coalesce(p_symbol, ''))), ''), v_change,
        case when p_kind = 'dividend' then 0 else v_change end
    );
end $$;

-- Sell a cash-secured put: the premium lands in cash right away.
create or replace function csp_open(
    p_portfolio uuid, p_symbol text, p_strike numeric, p_expiration date, p_contracts int,
    p_premium numeric, p_on date default current_date
) returns uuid
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    v_id uuid;
    v_credit numeric := p_premium * 100 * p_contracts;
begin
    perform _own_portfolio(p_portfolio);
    if v_sym = '' then raise exception 'Ticker is required'; end if;
    if p_contracts is null or p_contracts <= 0 then raise exception 'Contracts must be positive'; end if;

    insert into csp_positions (user_id, portfolio_id, symbol, strike, expiration, contracts, premium, opened_on)
    values (auth.uid(), p_portfolio, v_sym, p_strike, p_expiration, p_contracts, p_premium, p_on)
    returning id into v_id;

    update portfolios set cash = cash + v_credit where id = p_portfolio;
    insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, cash_change, csp_id)
    values (auth.uid(), p_portfolio, p_on, 'csp_open', v_sym, p_contracts, p_premium, v_credit, v_id);
    return v_id;
end $$;

-- Resolve an open put:
--   expired  -- worthless; the premium was already kept
--   closed   -- bought back at p_price per share
--   assigned -- 100 shares per contract bought at the strike; their cost basis is
--               strike - premium, so the premium is folded into the shares, not
--               counted again as a gain
create or replace function csp_resolve(
    p_csp uuid, p_outcome text, p_price numeric default null, p_on date default current_date
) returns void
language plpgsql as $$
declare
    c csp_positions%rowtype;
    v_shares numeric;
    v_basis numeric;
    v_cost numeric;
begin
    select * into c from csp_positions where id = p_csp and user_id = auth.uid() for update;
    if not found then raise exception 'Put not found'; end if;
    if c.status <> 'open' then raise exception 'This put is already %', c.status; end if;

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

commit;
