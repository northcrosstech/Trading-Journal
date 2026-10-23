-- Ledger audit, part 1 of 2: read-only checks that every stored number matches the
-- Activity history. Changes no data.
--
--   portfolio_activity.voided_at    -- set when an entry is undone (part 2 switches undo
--                                      from deleting to voiding, so history is kept)
--   portfolio_activity.replaced_by  -- an edited entry points at the entry that replaced it
--
--   audit_rebuild_holdings()        -- replays live (not voided) entries in order and returns
--                                      the shares and average cost each holding should have
--   audit_summary (view)            -- one row per problem; empty means everything reconciles:
--       shares        holding shares <> what Activity adds up to
--       avg_cost      holding average cost <> the cost rebuilt from Activity
--       cash          portfolio cash <> the sum of Activity cash changes
--       position      an option/put without exactly one opening entry, or a closed one
--                     without exactly one closing entry (an open one with a closing entry)
--       covered_call  open covered calls need more shares than are held
--       price         a holding (no manual price) without the latest close
--       daily_value   an active portfolio without a value for the latest priced day
--
-- Views run with the caller's permissions (security_invoker), so each user sees only their
-- own rows; the SQL editor (postgres) sees everyone's -- join auth.users on user_id for emails.
-- Requires 20261027010000_portfolio_split.sql. Safe to re-run.
begin;

alter table portfolio_activity add column if not exists voided_at timestamptz;
alter table portfolio_activity add column if not exists replaced_by uuid references portfolio_activity(id) on delete set null;
create index if not exists portfolio_activity_live_symbol_idx on portfolio_activity (portfolio_id, symbol, created_at) where voided_at is null;

-- Replays every live entry that moves shares, oldest first, the same way the action
-- functions apply them: buys average in, sells and moves out leave the cost alone, a split
-- sets the shares and divides the cost, assignments/exercises add at their cost basis. A
-- transfer between portfolios carries the source's average cost at that moment.
create or replace function audit_rebuild_holdings()
returns table (portfolio_id uuid, symbol text, quantity numeric, avg_cost numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
    r record;
    st jsonb := '{}';       -- "portfolio|symbol" -> {q, a, p, s}
    moved jsonb := '{}';    -- "user|symbol|qty|created_at" -> source average cost
    k text;
    q numeric;
    av numeric;
    add_q numeric;
    add_c numeric;
begin
    for r in
        select a.id, a.user_id, a.portfolio_id, a.kind, a.symbol, a.quantity, a.price, a.created_at,
               o.strike as o_strike, o.open_price as o_open, c.strike as c_strike, c.premium as c_premium
        from portfolio_activity a
        left join option_positions o on o.id = a.option_id
        left join csp_positions c on c.id = a.csp_id
        where a.voided_at is null and a.symbol is not null
          and a.kind in ('buy', 'sell', 'transfer_in', 'transfer_out', 'split', 'csp_assign', 'option_exercise', 'option_assign')
        order by a.created_at, case when a.kind = 'transfer_out' then 0 else 1 end, a.id
    loop
        k := r.portfolio_id || '|' || r.symbol;
        q := coalesce((st -> k ->> 'q')::numeric, 0);
        av := coalesce((st -> k ->> 'a')::numeric, 0);
        add_q := null;

        if r.kind = 'buy' then
            add_q := r.quantity; add_c := r.price;
        elsif r.kind = 'transfer_in' then
            add_q := r.quantity;
            add_c := coalesce((moved ->> (r.user_id || '|' || r.symbol || '|' || r.quantity || '|' || r.created_at))::numeric, r.price);
        elsif r.kind = 'option_exercise' then
            add_q := r.quantity; add_c := r.o_strike + r.o_open;
        elsif r.kind = 'csp_assign' then
            add_q := r.quantity; add_c := greatest(r.c_strike - r.c_premium, 0);
        elsif r.kind in ('sell', 'option_assign') then
            q := q - r.quantity;
        elsif r.kind = 'transfer_out' then
            moved := moved || jsonb_build_object(r.user_id || '|' || r.symbol || '|' || r.quantity || '|' || r.created_at, av);
            q := q - r.quantity;
        elsif r.kind = 'split' then
            q := r.quantity; av := av / r.price;
        end if;

        if add_q is not null then
            av := case when q + add_q = 0 then 0 else (q * av + add_q * add_c) / (q + add_q) end;
            q := q + add_q;
        end if;
        if q <= 0 then av := 0; end if;
        st := st || jsonb_build_object(k, jsonb_build_object('q', q, 'a', av, 'p', r.portfolio_id, 's', r.symbol));
    end loop;

    return query
        select (v ->> 'p')::uuid, v ->> 's', (v ->> 'q')::numeric, (v ->> 'a')::numeric
        from jsonb_each(st) as e(key, v);
end $$;

create or replace view audit_summary with (security_invoker = true) as
with latest as (select max(price_date) as d from prices),
rebuilt as (select * from audit_rebuild_holdings()),
problems as (
    -- shares and average cost
    select coalesce(h.portfolio_id, r.portfolio_id) as portfolio_id,
           case when abs(coalesce(h.quantity, 0) - coalesce(r.quantity, 0)) > 0.000001 then 'shares' else 'avg_cost' end as check_name,
           coalesce(h.symbol, r.symbol) as item,
           case when abs(coalesce(h.quantity, 0) - coalesce(r.quantity, 0)) > 0.000001
                then format('Holding has %s shares; Activity adds up to %s', trim_scale(coalesce(h.quantity, 0)), trim_scale(round(coalesce(r.quantity, 0), 6)))
                else format('Holding average cost %s; Activity rebuilds %s', round(h.avg_cost, 4), round(r.avg_cost, 4)) end as detail,
           'Edit or undo the entries in Activity so they match what you hold' as fix
    from holdings h
    full join rebuilt r on r.portfolio_id = h.portfolio_id and r.symbol = h.symbol
    where abs(coalesce(h.quantity, 0) - coalesce(r.quantity, 0)) > 0.000001
       or (h.quantity > 0 and abs(h.avg_cost - coalesce(r.avg_cost, 0)) > 0.005)

    union all
    -- cash
    select p.id, 'cash', null,
           format('Cash is %s; Activity adds up to %s', round(p.cash, 2), round(coalesce(sum(a.cash_change), 0), 2)),
           'Use Trade > Cash > Set balance (Setup / correction) to record the difference'
    from portfolios p
    left join portfolio_activity a on a.portfolio_id = p.id and a.voided_at is null
    group by p.id, p.cash
    having abs(p.cash - coalesce(sum(a.cash_change), 0)) > 0.005

    union all
    -- options: one opening entry; one closing entry once closed
    select o.portfolio_id, 'position', o.symbol || ' ' || trim_scale(o.strike) || upper(left(o.option_type, 1)),
           format('Option is %s with %s opening and %s closing entries', o.status, x.opens, x.closes),
           'Undo or re-enter this option so its history is complete'
    from option_positions o
    cross join lateral (
        select count(*) filter (where a.kind in ('option_buy', 'option_write')) as opens,
               count(*) filter (where a.kind in ('option_sell', 'option_buyback', 'option_expire', 'option_exercise', 'option_assign')) as closes
        from portfolio_activity a where a.option_id = o.id and a.voided_at is null
    ) x
    where x.opens <> 1 or x.closes <> case when o.status = 'open' then 0 else 1 end

    union all
    -- cash-secured puts, same rule
    select c.portfolio_id, 'position', c.symbol || ' ' || trim_scale(c.strike) || 'P',
           format('Put is %s with %s opening and %s closing entries', c.status, x.opens, x.closes),
           'Undo or re-enter this put so its history is complete'
    from csp_positions c
    cross join lateral (
        select count(*) filter (where a.kind = 'csp_open') as opens,
               count(*) filter (where a.kind in ('csp_close', 'csp_expire', 'csp_assign')) as closes
        from portfolio_activity a where a.csp_id = c.id and a.voided_at is null
    ) x
    where x.opens <> 1 or x.closes <> case when c.status = 'open' then 0 else 1 end

    union all
    -- covered calls need the shares
    select o.portfolio_id, 'covered_call', o.symbol,
           format('Open covered calls need %s shares; %s held', sum(o.contracts) * 100, trim_scale(coalesce(max(h.quantity), 0))),
           'Buy back or close the calls, or record the shares you hold'
    from option_positions o
    left join holdings h on h.portfolio_id = o.portfolio_id and h.symbol = o.symbol
    where o.side = 'short' and o.status = 'open'
    group by o.portfolio_id, o.symbol
    having sum(o.contracts) * 100 > coalesce(max(h.quantity), 0)

    union all
    -- prices: every holding without a manual price has the latest close
    select h.portfolio_id, 'price', h.symbol,
           coalesce('Last close ' || to_char(pr.d, 'Mon DD') || ', latest is ' || to_char(latest.d, 'Mon DD'), 'No close yet'),
           'Use Get prices now, or set a manual price if this fund has no public ticker'
    from holdings h
    join portfolios p on p.id = h.portfolio_id and not p.archived
    cross join latest
    left join lateral (select max(price_date) as d from prices where prices.symbol = h.symbol) pr on true
    where h.manual_price is null and latest.d is not null and (pr.d is null or pr.d < latest.d)

    union all
    -- daily values: the 4:45 PM job saved today's value
    select p.id, 'daily_value', null,
           coalesce('Last saved value ' || to_char(v.d, 'Mon DD') || ', latest priced day ' || to_char(latest.d, 'Mon DD'), 'No saved value yet'),
           'The daily pricing job may have failed -- check the worker, or wait for the next run'
    from portfolios p
    cross join latest
    left join lateral (select max(value_date) as d from portfolio_daily_values where portfolio_id = p.id) v on true
    where not p.archived and latest.d is not null and p.created_at::date < latest.d and (v.d is null or v.d < latest.d)
)
select p.user_id, x.portfolio_id, p.name as portfolio, x.check_name, x.item, x.detail, x.fix
from problems x
join portfolios p on p.id = x.portfolio_id;

commit;
