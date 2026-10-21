-- Move shares between two of your portfolios (or out of the app, p_to = null) in one
-- save. The average cost carries over -- a transfer is not a sale, so no gain or loss is
-- realized. Each side records money out / money in at the latest close (else the
-- average cost), so neither portfolio's time-weighted return sees a fake jump, and in
-- the combined view the two cancel. Shares covering open calls can't be moved.
-- Requires 20261022010000_option_positions.sql. Safe to re-run.
begin;

create or replace function portfolio_transfer(
    p_from uuid, p_symbol text, p_quantity numeric, p_to uuid default null, p_on date default current_date
) returns void
language plpgsql as $$
declare
    v_sym text := upper(btrim(p_symbol));
    h holdings%rowtype;
    v_price numeric;
    v_value numeric;
    v_covered numeric;
begin
    perform _own_portfolio(p_from);
    if p_to is not null then
        perform _own_portfolio(p_to);
        if p_to = p_from then raise exception 'Pick a different portfolio to transfer to'; end if;
    end if;
    if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

    select * into h from holdings where portfolio_id = p_from and symbol = v_sym for update;
    if not found then raise exception 'You don''t hold %', v_sym; end if;
    if p_quantity > h.quantity then raise exception 'You only hold % shares of %', h.quantity, v_sym; end if;
    v_covered := _covered_shares(p_from, v_sym);
    if h.quantity - p_quantity < v_covered then
        raise exception '% of your % shares are covering open calls — buy back or close those calls first', v_covered, v_sym;
    end if;

    select close into v_price from prices where symbol = v_sym order by price_date desc limit 1;
    v_price := coalesce(v_price, h.avg_cost);
    v_value := p_quantity * v_price;

    if p_quantity = h.quantity then
        delete from holdings where id = h.id;
    else
        update holdings set quantity = quantity - p_quantity, updated_at = now() where id = h.id;
    end if;
    insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
    values (auth.uid(), p_from, p_on, 'transfer_out', v_sym, p_quantity, v_price, -v_value);

    if p_to is not null then
        insert into holdings (user_id, portfolio_id, symbol, quantity, avg_cost)
        values (auth.uid(), p_to, v_sym, p_quantity, h.avg_cost)
        on conflict (portfolio_id, symbol) do update set
            avg_cost = (holdings.quantity * holdings.avg_cost + p_quantity * h.avg_cost) / (holdings.quantity + p_quantity),
            quantity = holdings.quantity + p_quantity,
            updated_at = now();
        insert into portfolio_activity (user_id, portfolio_id, occurred_on, kind, symbol, quantity, price, external_flow)
        values (auth.uid(), p_to, p_on, 'transfer_in', v_sym, p_quantity, v_price, v_value);
    end if;
end $$;

commit;
