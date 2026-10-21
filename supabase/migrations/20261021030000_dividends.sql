-- Dividend projections: per user, per ticker, the annual dividend per share, how often
-- it pays, and the month of one payment (the rest of the cycle follows from the
-- frequency -- quarterly + March = Mar/Jun/Sep/Dec). Entered once per ticker and
-- applied to every portfolio holding it. Monthly payers need no month.
--
-- Dividends actually received stay in portfolio_activity (kind = 'dividend').
-- Requires 20261021020000_portfolios.sql. Safe to re-run.
begin;

create table if not exists dividend_info (
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null,
    annual_per_share numeric not null check (annual_per_share >= 0),
    frequency text not null check (frequency in ('monthly', 'quarterly', 'semiannual', 'annual')),
    pay_month int check (pay_month between 1 and 12),
    updated_at timestamptz not null default now(),
    primary key (user_id, symbol),
    check (frequency = 'monthly' or pay_month is not null)
);

alter table dividend_info enable row level security;

drop policy if exists "dividend_info_own" on dividend_info;
create policy "dividend_info_own" on dividend_info for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
