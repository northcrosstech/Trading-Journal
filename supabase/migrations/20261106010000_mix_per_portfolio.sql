-- Mix targets per portfolio: every portfolio (brokerage too, not just retirement) now has its
-- own mix-by-type target, scope = its id. The split between brokerage accounts is unchanged
-- (portfolios.target_pct).
--
-- The old shared brokerage mix (scope 'brokerage') is copied to each active brokerage
-- portfolio that has no mix of its own yet, as its starting point, then removed.
--
-- Requires 20261101010000_allocation.sql. Safe to re-run.
begin;

insert into allocation_targets (user_id, scope, etf, stock, bond, option, cash, updated_at)
select b.user_id, p.id::text, b.etf, b.stock, b.bond, b.option, b.cash, now()
from allocation_targets b
join portfolios p on p.user_id = b.user_id and p.kind = 'brokerage' and not p.archived
where b.scope = 'brokerage'
on conflict (user_id, scope) do nothing;

delete from allocation_targets where scope = 'brokerage';

commit;
