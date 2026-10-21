-- Adds the "Emergency fund" asset category to net worth accounts.
-- Requires 20261021010000_networth.sql. Safe to re-run.
begin;

alter table networth_accounts drop constraint if exists networth_accounts_category_check;
alter table networth_accounts add constraint networth_accounts_category_check check (category in (
    -- assets
    'home', 'cash', 'emergency_fund', '401k', 'traditional_ira', 'roth_ira', 'brokerage', 'auto', 'misc_asset',
    -- debts
    'mortgage', 'auto_loan', 'credit_card', 'debt', 'other_debt'
));

commit;
