-- Installments: the monthly payment on a debt (mortgage, auto loan, credit card, other
-- debt) and a record of each month's payment being made.
--
--   networth_accounts.payment_amount  -- the usual monthly payment ($)
--   networth_accounts.payment_day     -- day of the month it's due (1-31; short months use
--                                        their last day)
--   networth_accounts.interest_rate   -- APR in percent (e.g. 6.25), optional; drives the
--                                        payoff estimate
--   installment_payments              -- one row per account per month once marked paid
--
-- Payments don't change balances: balances still come from your statements each month.
-- Requires 20261021010000_networth.sql. Safe to re-run.
begin;

alter table networth_accounts add column if not exists payment_amount numeric check (payment_amount is null or payment_amount >= 0);
alter table networth_accounts add column if not exists payment_day int check (payment_day is null or payment_day between 1 and 31);
alter table networth_accounts add column if not exists interest_rate numeric check (interest_rate is null or interest_rate >= 0);

create table if not exists installment_payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id uuid not null references networth_accounts(id) on delete cascade,
    month date not null, -- first of the month the payment belongs to
    amount numeric not null check (amount >= 0),
    paid_on date not null default current_date,
    created_at timestamptz not null default now(),
    unique (account_id, month)
);
create index if not exists installment_payments_user_month_idx on installment_payments (user_id, month);

alter table installment_payments enable row level security;
drop policy if exists "installment_payments_own" on installment_payments;
create policy "installment_payments_own" on installment_payments for all
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and exists (select 1 from networth_accounts a where a.id = account_id and a.user_id = auth.uid())
    );

commit;
