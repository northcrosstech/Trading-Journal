-- Escrow on installments: the part of a monthly payment that isn't principal or interest
-- (property tax + home insurance held in escrow by the mortgage servicer).
--
--   networth_accounts.escrow_amount -- $ of payment_amount that goes to escrow, optional.
--                                      payment_amount stays the full amount you pay; the
--                                      payoff estimate uses payment_amount - escrow_amount.
--
-- Requires 20261023020000_installments.sql. Safe to re-run.
begin;

alter table networth_accounts add column if not exists escrow_amount numeric
    check (escrow_amount is null or escrow_amount >= 0);

commit;
