"""Unit tests for the pure parts of prices.py -- no network, no database."""
import pytest

from prices import chunked, csp_liability, parse_eod_response, value_portfolio


def test_chunked_splits_into_batches():
    assert list(chunked(["A", "B", "C", "D", "E"], 2)) == [["A", "B"], ["C", "D"], ["E"]]


def test_parse_single_symbol_flat_response():
    body = {"symbol": "AAPL", "datetime": "2026-10-20", "close": "231.40"}
    closes, warnings = parse_eod_response(["AAPL"], body)
    assert closes == {"AAPL": ("2026-10-20", 231.40)}
    assert warnings == []


def test_parse_batch_response_with_one_failure():
    body = {
        "VOO": {"symbol": "VOO", "datetime": "2026-10-20", "close": "552.10"},
        "ZZZZ": {"code": 400, "message": "symbol not found", "status": "error"},
    }
    closes, warnings = parse_eod_response(["VOO", "ZZZZ"], body)
    assert closes == {"VOO": ("2026-10-20", 552.10)}
    assert len(warnings) == 1 and "ZZZZ" in warnings[0] and "symbol not found" in warnings[0]


def test_parse_missing_symbol_is_a_warning():
    closes, warnings = parse_eod_response(["A", "B"], {"A": {"datetime": "2026-10-20", "close": "1"}})
    assert set(closes) == {"A"}
    assert "B" in warnings[0]


def test_csp_liability_uses_mark_when_entered():
    assert csp_liability({"strike": 100, "contracts": 2, "mark": 1.5}, underlying_close=90.0) == pytest.approx(300.0)


def test_csp_liability_falls_back_to_intrinsic_value():
    # strike 100, stock 95 -> $5 in the money x 100 x 1
    assert csp_liability({"strike": 100, "contracts": 1, "mark": None}, underlying_close=95.0) == pytest.approx(500.0)
    # out of the money -> nothing to buy back at intrinsic value
    assert csp_liability({"strike": 100, "contracts": 1, "mark": None}, underlying_close=105.0) == 0.0
    # no price at all -> assume zero
    assert csp_liability({"strike": 100, "contracts": 1, "mark": None}, underlying_close=None) == 0.0


def test_value_portfolio_combines_holdings_cash_and_puts():
    portfolio = {"name": "Main", "cash": "1000"}
    holdings = [
        {"symbol": "VOO", "quantity": "10", "avg_cost": "400", "manual_price": None},
        {"symbol": "FUND", "quantity": "5", "avg_cost": "20", "manual_price": "25"},
    ]
    puts = [{"symbol": "AAPL", "strike": 200, "contracts": 1, "mark": None}]
    values, warnings = value_portfolio(portfolio, holdings, puts, {"VOO": 500.0, "AAPL": 190.0})
    assert values["holdings_value"] == pytest.approx(10 * 500 + 5 * 25)
    assert values["cost_basis"] == pytest.approx(10 * 400 + 5 * 20)
    assert values["csp_liability"] == pytest.approx(1000.0)  # (200 - 190) x 100
    assert values["total_value"] == pytest.approx(5125 + 1000 - 1000)
    assert warnings == []


def test_value_portfolio_unpriced_holding_uses_avg_cost_and_warns():
    values, warnings = value_portfolio(
        {"name": "Main", "cash": 0}, [{"symbol": "NEW", "quantity": 3, "avg_cost": 10, "manual_price": None}], [], {}
    )
    assert values["holdings_value"] == pytest.approx(30.0)
    assert "NEW" in warnings[0]


class _FakeQuery:
    """Just enough of the supabase query builder for run_pricing's reads/writes."""

    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op = db, table, [], "select"

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) < val)
        return self

    lte = gt = lt

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def range(self, *_a):
        return self

    def upsert(self, rows, **_k):
        self.op, self.rows = "upsert", rows if isinstance(rows, list) else [rows]
        return self

    def execute(self):
        if self.op == "upsert":
            self.db.writes.setdefault(self.table, []).extend(self.rows)
            return type("R", (), {"data": self.rows})
        rows = [r for r in self.db.data.get(self.table, []) if all(f(r) for f in self.filters)]
        return type("R", (), {"data": rows})


class _FakeDb:
    def __init__(self, data):
        self.data, self.writes = data, {}

    def table(self, name):
        return _FakeQuery(self, name)


def test_only_new_fetches_unpriced_tickers_and_skips_daily_values(monkeypatch):
    import prices

    db = _FakeDb(
        {
            "portfolios": [{"id": "p", "user_id": "u", "name": "Main", "cash": 0, "archived": False}],
            "holdings": [
                {"portfolio_id": "p", "symbol": "VOO", "quantity": 1, "avg_cost": 1, "manual_price": None},
                {"portfolio_id": "p", "symbol": "NEW", "quantity": 1, "avg_cost": 1, "manual_price": None},
            ],
            "csp_positions": [],
            "prices": [{"symbol": "VOO", "close": 500, "price_date": "2026-10-20"}],
        }
    )
    fetched = []
    monkeypatch.setattr(prices, "fetch_eod", lambda syms, key: fetched.append(syms) or {"symbol": "NEW", "datetime": "2026-10-20", "close": "12.5"})
    from datetime import date

    s = prices.run_pricing(date(2026, 10, 21), client=db, api_key="k", only_new=True)
    assert s.error is None
    assert fetched == [["NEW"]]
    assert s.prices_saved == 1
    assert "portfolio_daily_values" not in db.writes
