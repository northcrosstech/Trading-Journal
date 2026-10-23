-- Audit: measure "latest" by the last daily pricing run (the newest saved portfolio value),
-- not by the newest price of any single ticker. Running Get prices now for one ticker during
-- the day no longer makes every other ticker and portfolio look a day behind.
--   price        a ticker that priced before is older than the last daily run
--   daily_value  a portfolio missed a run the others got, or nothing saved for 4+ days
-- Same view otherwise. Requires 20261029010000_audit_price_check.sql. Safe to re-run.
begin;

create or replace view audit_summary with (security_invoker = true) as
with latest as (select max(value_date) as d from portfolio_daily_values),  -- last daily run
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
    -- prices: the last daily run didn't price a ticker that used to price (delisted, renamed).
    -- No close yet is left to the "Waiting for a first price" banner; a ticker priced early
    -- with Get prices now doesn't move the baseline.
    select h.portfolio_id, 'price', h.symbol,
           'Last close ' || to_char(pr.d, 'Mon DD') || ', but the daily run priced through ' || to_char(latest.d, 'Mon DD'),
           'It may have been delisted or renamed -- use Get prices now, or set a manual price'
    from holdings h
    join portfolios p on p.id = h.portfolio_id and not p.archived
    cross join latest
    left join lateral (select max(price_date) as d from prices where prices.symbol = h.symbol) pr on true
    where h.manual_price is null and latest.d is not null and pr.d is not null and pr.d < latest.d

    union all
    -- daily values: a portfolio missed a run the others got, or nothing saved for 4+ days
    -- (the daily job stopped; 4 days allows for a weekend plus a holiday)
    select p.id, 'daily_value', null,
           coalesce('Last saved value ' || to_char(v.d, 'Mon DD'), 'No saved value yet'),
           'The daily pricing job may have stopped -- check the worker on Fly'
    from portfolios p
    cross join latest
    left join lateral (select max(value_date) as d from portfolio_daily_values where portfolio_id = p.id) v on true
    where not p.archived and p.created_at::date < current_date - 4
      and (v.d is null or v.d < current_date - 4 or v.d < latest.d)
)
select p.user_id, x.portfolio_id, p.name as portfolio, x.check_name, x.item, x.detail, x.fix
from problems x
join portfolios p on p.id = x.portfolio_id;

commit;
