-- Month-end close, the way a business closes its books.
--
--   networth_month_closes -- one row per closed month; changed only by the two functions below
--   networth_close_log    -- every close and reopen, with the reason for a reopen; never edited
--   close_networth_month(month)          -- closes a finished month once its checklist is done
--   reopen_networth_month(month, reason) -- reopens it and any later closed months
--
-- A closed month's balances and payments can't be changed, and neither can an account in a way
-- that alters a closed month. Months close in order, so a month's cash flow always starts from
-- a closed balance; reopening one reopens the months after it for the same reason.
--
-- Months up to September 2026 with a balance for every open account start closed. October 2026
-- onward stays open to be reviewed and closed by hand.
--
-- Requires 20261023020000_installments.sql and 20261024010000_wealth_settings.sql. Safe to re-run.
begin;

create table if not exists networth_month_closes (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    month date not null check (extract(day from month) = 1),
    closed_at timestamptz not null default now(),
    primary key (user_id, month)
);

create table if not exists networth_close_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    month date not null,
    action text not null check (action in ('close', 'reopen')),
    reason text,
    at timestamptz not null default now()
);
create index if not exists networth_close_log_user_month on networth_close_log (user_id, month, at);

-- Read-only to users: only the security definer functions below write here.
alter table networth_month_closes enable row level security;
alter table networth_close_log enable row level security;
drop policy if exists "networth_month_closes_read" on networth_month_closes;
create policy "networth_month_closes_read" on networth_month_closes for select using (auth.uid() = user_id);
drop policy if exists "networth_close_log_read" on networth_close_log;
create policy "networth_close_log_read" on networth_close_log for select using (auth.uid() = user_id);

-- Existing history, once: a user with any log row has already been through this.
with complete as (
    select distinct b.user_id, b.month
    from networth_balances b
    where b.month <= date '2026-09-01'
      and not exists (select 1 from networth_close_log l where l.user_id = b.user_id)
      and not exists (
          select 1 from networth_accounts a
          where a.user_id = b.user_id
            and a.opened_month <= b.month and (a.closed_month is null or b.month < a.closed_month)
            and not exists (select 1 from networth_balances x where x.account_id = a.id and x.month = b.month)
      )
), added as (
    insert into networth_month_closes (user_id, month)
    select user_id, month from complete
    on conflict do nothing
    returning user_id, month
)
insert into networth_close_log (user_id, month, action, reason)
select user_id, month, 'close', 'Closed automatically when month closing was added' from added;

create or replace function close_networth_month(p_month date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    prev date := (p_month - interval '1 month')::date;
    close_from date;
    names text;
begin
    if uid is null then
        raise exception 'Not signed in';
    end if;
    if extract(day from p_month) <> 1 then
        raise exception 'A month starts on the 1st';
    end if;
    if p_month >= date_trunc('month', now() at time zone 'America/Chicago')::date then
        raise exception '% isn''t over yet', to_char(p_month, 'FMMonth YYYY');
    end if;
    if exists (select 1 from networth_month_closes where user_id = uid and month = p_month) then
        raise exception '% is already closed', to_char(p_month, 'FMMonth YYYY');
    end if;

    select close_from_month into close_from from wealth_settings where user_id = uid;
    if (close_from is null or prev >= close_from)
       and exists (select 1 from networth_balances where user_id = uid and month = prev)
       and not exists (select 1 from networth_month_closes where user_id = uid and month = prev)
       -- An old gap that was never closed doesn't hold back a month that has been closed before.
       and (exists (select 1 from networth_close_log where user_id = uid and month = prev)
            or not exists (select 1 from networth_close_log where user_id = uid and month = p_month)) then
        raise exception 'Close % first', to_char(prev, 'FMMonth YYYY');
    end if;

    select string_agg(a.name, ', ' order by a.name) into names
    from networth_accounts a
    where a.user_id = uid
      and a.opened_month <= p_month and (a.closed_month is null or p_month < a.closed_month)
      and not exists (select 1 from networth_balances b where b.account_id = a.id and b.month = p_month);
    if names is not null then
        raise exception 'Still needs a balance: %', names;
    end if;

    -- A fixed payment, or a card with a balance to pay.
    select string_agg(a.name, ', ' order by a.name) into names
    from networth_accounts a
    where a.user_id = uid
      and a.category in ('mortgage', 'auto_loan', 'credit_card', 'debt', 'other_debt')
      and a.opened_month <= p_month and (a.closed_month is null or p_month < a.closed_month)
      and (
          coalesce(a.payment_amount, 0) > 0
          or (a.payment_day is not null and coalesce(
                (select b.balance from networth_balances b where b.account_id = a.id and b.month <= p_month order by b.month desc limit 1), 0) > 0)
      )
      and not exists (select 1 from installment_payments p where p.account_id = a.id and p.month = p_month);
    if names is not null then
        raise exception 'Payment not marked paid: %', names;
    end if;

    insert into networth_month_closes (user_id, month) values (uid, p_month);
    insert into networth_close_log (user_id, month, action) values (uid, p_month, 'close');
end;
$$;

create or replace function reopen_networth_month(p_month date, p_reason text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    n int;
begin
    if uid is null then
        raise exception 'Not signed in';
    end if;
    if p_reason is null or length(trim(p_reason)) = 0 then
        raise exception 'Give a reason for reopening';
    end if;
    if length(p_reason) > 500 then
        raise exception 'Keep the reason under 500 characters';
    end if;
    if not exists (select 1 from networth_month_closes where user_id = uid and month = p_month) then
        raise exception '% isn''t closed', to_char(p_month, 'FMMonth YYYY');
    end if;

    insert into networth_close_log (user_id, month, action, reason)
    select uid, c.month, 'reopen',
           case when c.month = p_month then trim(p_reason)
                else 'Reopened with ' || to_char(p_month, 'FMMonth YYYY') || ': ' || trim(p_reason) end
    from networth_month_closes c
    where c.user_id = uid and c.month >= p_month;

    delete from networth_month_closes where user_id = uid and month >= p_month;
    get diagnostics n = row_count;
    return n;
end;
$$;

revoke execute on function close_networth_month(date) from public, anon;
revoke execute on function reopen_networth_month(date, text) from public, anon;
grant execute on function close_networth_month(date) to authenticated;
grant execute on function reopen_networth_month(date, text) to authenticated;

-- The lock. Deleting a user removes their rows, so a user who's gone isn't checked.
create or replace function _guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    r record;
begin
    for r in
        select (case when tg_op = 'DELETE' then old.user_id else new.user_id end) as user_id,
               (case when tg_op = 'DELETE' then old.month else new.month end) as month
        union all
        select old.user_id, old.month where tg_op = 'UPDATE'
    loop
        if exists (select 1 from networth_month_closes c where c.user_id = r.user_id and c.month = r.month)
           and exists (select 1 from auth.users u where u.id = r.user_id) then
            raise exception '% is closed. Reopen it to make changes.', to_char(r.month, 'FMMonth YYYY');
        end if;
    end loop;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_closed_month on networth_balances;
create trigger guard_closed_month before insert or update or delete on networth_balances
    for each row execute function _guard_closed_month();
drop trigger if exists guard_closed_month on installment_payments;
create trigger guard_closed_month before insert or update or delete on installment_payments
    for each row execute function _guard_closed_month();

-- An account's balances count in a closed month if one is on or before it. Deleting the account
-- or changing its category or dates would change that month, so those are refused.
create or replace function _guard_closed_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    from_month date;
    hit date;
begin
    if tg_op = 'UPDATE' then
        if new.category is distinct from old.category then
            from_month := '-infinity';
        else
            if new.opened_month is distinct from old.opened_month then
                from_month := least(new.opened_month, old.opened_month);
            end if;
            if new.closed_month is distinct from old.closed_month then
                from_month := least(from_month, new.closed_month, old.closed_month);
            end if;
        end if;
        if from_month is null then
            return new;
        end if;
    else
        from_month := '-infinity';
    end if;

    select min(c.month) into hit
    from networth_month_closes c
    where c.user_id = old.user_id and c.month >= from_month
      and exists (select 1 from networth_balances b where b.account_id = old.id and b.month <= c.month)
      and exists (select 1 from auth.users u where u.id = old.user_id);
    if hit is not null then
        raise exception '“%” has balances in %, which is closed. Reopen it to change this, or close the account from a later month.', old.name, to_char(hit, 'FMMonth YYYY');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_closed_account on networth_accounts;
create trigger guard_closed_account before update or delete on networth_accounts
    for each row execute function _guard_closed_account();

commit;
