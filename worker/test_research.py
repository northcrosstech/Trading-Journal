from datetime import date

import pytest

import research
from research import macro_rows, parse_fred_csv, parse_metric, pick_next_earnings


def test_parse_metric_maps_fields_and_drops_missing():
    body = {"metric": {"epsTTM": 7.9108, "epsGrowth5Y": 95.27, "grossMarginTTM": "74.67", "roeTTM": None, "other": 1}}
    m = parse_metric(body)
    assert m["eps_ttm"] == pytest.approx(7.9108)
    assert m["eps_growth_5y"] == pytest.approx(95.27)
    assert m["gross_margin"] == pytest.approx(74.67)
    assert m["roe"] is None and m["current_ratio"] is None
    assert parse_metric({}) == {col: None for col in research.METRIC_FIELDS.values()}


def test_next_earnings_is_the_earliest_upcoming_report():
    body = {
        "earningsCalendar": [
            {"date": "2027-02-23", "hour": "amc", "epsEstimate": 2.80},
            {"date": "2026-11-25", "hour": "amc", "epsEstimate": 2.5263},
            {"date": "2026-08-20", "hour": "amc", "epsEstimate": 2.0},  # already reported
        ]
    }
    assert pick_next_earnings(body, date(2026, 10, 27)) == {
        "next_earnings_date": "2026-11-25",
        "next_earnings_hour": "amc",
        "next_eps_estimate": pytest.approx(2.5263),
    }
    assert pick_next_earnings({}, date(2026, 10, 27))["next_earnings_date"] is None


def test_symbol_types():
    rows = [{"symbol": "VOO", "type": "ETP", "description": "VANGUARD S&P 500 ETF"}, {"symbol": "TSM", "type": "ADR", "description": "TAIWAN SEMICONDUCTOR-SP ADR"}, {"type": "x"}]
    assert research.symbol_types(rows) == {"VOO": ("ETP", "VANGUARD S&P 500 ETF"), "TSM": ("ADR", "TAIWAN SEMICONDUCTOR-SP ADR")}


def test_fred_csv_skips_missing_values():
    text = "observation_date,BAMLC0A1CAAAEY\n2026-10-22,5.51\n2026-10-23,.\n2026-10-26,5.56\n"
    assert parse_fred_csv(text) == [(date(2026, 10, 22), 5.51), (date(2026, 10, 26), 5.56)]


def test_macro_rows_latest_values_and_unemployment_low_over_12_months():
    series = {
        "aaa_yield": [(date(2026, 10, 23), 5.5), (date(2026, 10, 26), 5.56)],
        "unemployment_rate": [(date(2025, 8, 1), 3.9), (date(2025, 11, 1), 4.1), (date(2026, 3, 1), 4.0), (date(2026, 9, 1), 4.4)],
    }
    rows = {r["key"]: r for r in macro_rows(series)}
    assert rows["aaa_yield"]["value"] == 5.56 and rows["aaa_yield"]["as_of"] == "2026-10-26"
    assert rows["unemployment_rate"]["value"] == 4.4
    assert rows["unemployment_12m_low"]["value"] == 4.0  # Aug 2025's 3.9 is older than 12 months


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.rows = db, table, "select", []

    def select(self, *_a, **_k):
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
        return type("R", (), {"data": self.db.data.get(self.table, [])})


class _Db:
    def __init__(self, data):
        self.data, self.writes = data, {}

    def table(self, name):
        return _Q(self, name)


def test_run_research_fetches_held_and_watched_tickers_and_macro(monkeypatch):
    db = _Db(
        {
            "holdings": [{"symbol": "NVDA", "manual_price": None}, {"symbol": "FUND", "manual_price": 10}],
            "research_watchlist": [{"symbol": "GOOG"}],
            "fundamentals": [{"symbol": "GOOG", "name": "Alphabet Inc", "reporting_currency": "USD"}],
            "macro_indicators": [],
        }
    )
    calls = []

    def fake_finnhub(path, params, key, limiter):
        calls.append((path, params.get("symbol")))
        if path == "stock/metric":
            return {"metric": {"epsTTM": 7.9}}
        if path == "stock/profile2":
            return {"name": "NVIDIA Corp", "currency": "USD"}
        if path == "stock/symbol":
            return [{"symbol": "NVDA", "type": "Common Stock", "description": "NVIDIA CORP"}, {"symbol": "GOOG", "type": "Common Stock", "description": "ALPHABET INC-CL C"}]
        return {"earningsCalendar": [{"date": "2026-11-25", "hour": "amc", "epsEstimate": 2.5}]}

    monkeypatch.setattr(research, "_finnhub", fake_finnhub)
    monkeypatch.setattr(research, "_fred", lambda sid: [(date(2026, 10, 26), 5.56)])
    s = research.run_research(date(2026, 10, 27), client=db, api_key="k")
    assert s.error is None, s.error
    assert s.symbols_requested == 2 and s.fundamentals_saved == 2  # FUND has a manual price
    saved = {r["symbol"]: r for r in db.writes["fundamentals"]}
    assert saved["NVDA"]["name"] == "NVIDIA Corp" and saved["NVDA"]["next_earnings_date"] == "2026-11-25"
    assert saved["GOOG"]["name"] == "Alphabet Inc"
    assert saved["NVDA"]["security_type"] == "Common Stock" and saved["NVDA"]["description"] == "NVIDIA CORP"
    assert ("stock/profile2", "GOOG") not in calls  # name and currency already known: no extra call
    assert saved["NVDA"]["reporting_currency"] == "USD" and saved["GOOG"]["reporting_currency"] == "USD"
    assert {r["key"] for r in db.writes["macro_indicators"]} >= {"aaa_yield", "treasury_10y"}

    # only_new: GOOG already has fundamentals, so only NVDA is fetched
    db2 = _Db({**db.data, "macro_indicators": [{"key": "aaa_yield"}]})
    s2 = research.run_research(date(2026, 10, 27), client=db2, api_key="k", only_new=True)
    assert s2.symbols_requested == 1
    assert "macro_indicators" not in db2.writes  # already stored


def _est(rows):
    """[(fiscal year end, eps, analysts)] -> FMP analyst-estimates rows."""
    return [{"date": d, "epsAvg": e, "numAnalystsEps": n} for d, e, n in rows]


def test_forecast_growth_on_real_estimates():
    today = date(2026, 10, 27)
    googl = _est([("2025-12-31", 10.64, 37), ("2026-12-31", 20.60, 41), ("2027-12-31", 15.34, 40), ("2028-12-31", 18.36, 38), ("2029-12-31", 21.58, 27), ("2030-12-31", 25.69, 33)])
    g = research.forecast_growth(googl, today)
    # 2026 carries one-off gains, so growth runs 2027 -> 2030
    assert (g["forecast_from_year"], g["forecast_to_year"], g["forecast_analysts"]) == (2027, 2030, 33)
    assert g["eps_growth_forecast"] == pytest.approx(18.75, abs=0.01)
    # NVDA's fiscal year ends in January: FY2027 (Jan 2027) is the current one
    nvda = _est([("2026-01-25", 4.69, 30), ("2027-01-31", 9.29, 33), ("2028-01-30", 15.81, 32), ("2029-01-28", 21.38, 20), ("2030-01-27", 25.6, 9), ("2031-01-26", 26.6, 10)])
    n = research.forecast_growth(nvda, today)
    assert (n["forecast_from_year"], n["forecast_to_year"]) == (2028, 2031)
    # AAPL: 2029 and 2030 have under 3 analysts, leaving too few years to skip the current one
    aapl = _est([("2026-09-26", 8.84, 29), ("2027-09-25", 9.59, 30), ("2028-09-30", 10.61, 21), ("2029-09-29", 11.97, 2), ("2030-09-28", 12.11, 1)])
    a = research.forecast_growth(aapl, today)
    assert (a["forecast_from_year"], a["forecast_to_year"]) == (2027, 2028)
    assert a["eps_growth_forecast"] == pytest.approx(10.64, abs=0.01)


def test_forecast_growth_needs_positive_future_years():
    today = date(2026, 10, 27)
    assert research.forecast_growth([], today)["eps_growth_forecast"] is None
    assert research.forecast_growth(_est([("2026-12-31", 1.0, 5)]), today)["eps_growth_forecast"] is None
    # losing money now: no growth rate from a negative base
    assert research.forecast_growth(_est([("2026-12-31", -1.0, 5), ("2027-12-31", 0.5, 5)]), today)["eps_growth_forecast"] is None


def test_run_research_adds_forecast_and_survives_missing_columns(monkeypatch):
    data = {"holdings": [{"symbol": "GOOGL", "manual_price": None}], "research_watchlist": [], "fundamentals": [], "macro_indicators": [{"key": "aaa_yield"}]}
    monkeypatch.setattr(research, "_finnhub", lambda path, params, key, limiter: [] if path == "stock/symbol" else {"metric": {"epsTTM": 10.6}} if path == "stock/metric" else {})
    monkeypatch.setattr(research, "_fmp", lambda path, params, key, limiter: _est([("2026-12-31", 20.6, 41), ("2027-12-31", 15.34, 40), ("2030-12-31", 25.69, 33)]))
    db = _Db(data)
    s = research.run_research(date(2026, 10, 27), client=db, api_key="k", only_new=True, fmp_key="f")
    assert s.error is None and db.writes["fundamentals"][0]["forecast_to_year"] == 2030

    class _OldDb(_Db):  # database before the growth_forecast migration
        def table(self, name):
            q = _Q(self, name)
            if name == "fundamentals":
                real = q.upsert

                def upsert(row, **kw):
                    if "eps_growth_forecast" in row:
                        raise RuntimeError("Could not find the 'eps_growth_forecast' column of 'fundamentals'")
                    return real(row, **kw)

                q.upsert = upsert
            return q

    old = _OldDb(data)
    s2 = research.run_research(date(2026, 10, 27), client=old, api_key="k", only_new=True, fmp_key="f")
    assert s2.error is None and s2.fundamentals_saved == 1
    assert "eps_growth_forecast" not in old.writes["fundamentals"][0]
    assert any("eps_growth_forecast" in w and "migration" in w for w in s2.warnings)
