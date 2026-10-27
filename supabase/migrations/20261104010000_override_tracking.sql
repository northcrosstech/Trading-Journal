-- Research edits that keep up: each edit remembers the automatic number it replaced, so the
-- app can say when that number has moved ("automatic is now $18.00, was 98.25 when you
-- edited"), and EPS edits end a few days after the company's next earnings report, when EPS
-- changes anyway.
--
--   research_overrides.auto_value -- the automatic number when the edit was made (null =
--                                    edited before tracking; flagged once to be checked)
--   research_overrides.expires_on -- EPS edits: the automatic EPS is used again after this date
--
-- Requires 20261031010000_research.sql. Safe to re-run.
begin;

alter table research_overrides add column if not exists auto_value numeric;
alter table research_overrides add column if not exists expires_on date;

commit;
