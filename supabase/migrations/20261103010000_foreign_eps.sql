-- EPS for companies that report in another currency (TSM reports in Taiwan dollars, per
-- ordinary share; one TSM ADR is 5 of those). Finnhub's EPS for them isn't $ per share you
-- hold, but its P/E is, so the app uses price / P/E as their EPS.
--
--   fundamentals.pe_ttm             -- price / earnings, last 12 months (Finnhub)
--   fundamentals.reporting_currency -- currency the company reports in (USD, TWD, EUR...)
--
-- Requires 20261031010000_research.sql. Safe to re-run.
begin;

alter table fundamentals add column if not exists pe_ttm numeric;
alter table fundamentals add column if not exists reporting_currency text;

commit;
