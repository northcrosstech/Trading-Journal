-- Forecast growth for fair value: analysts' expected EPS growth per year over the next few
-- years (Financial Modeling Prep annual estimates), used in place of past growth when there
-- is one. Written only by the worker, like the rest of `fundamentals`.
--
--   fundamentals.eps_growth_forecast -- % per year, from the first to the last forecast year
--   fundamentals.forecast_from_year  -- fiscal year the growth is measured from
--   fundamentals.forecast_to_year    -- fiscal year it's measured to
--   fundamentals.forecast_analysts   -- analysts behind the last year's estimate
--
-- Requires 20261031010000_research.sql. Safe to re-run.
begin;

alter table fundamentals add column if not exists eps_growth_forecast numeric;
alter table fundamentals add column if not exists forecast_from_year int;
alter table fundamentals add column if not exists forecast_to_year int;
alter table fundamentals add column if not exists forecast_analysts int;

commit;
