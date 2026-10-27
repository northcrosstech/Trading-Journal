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
            "fundamentals": [{"symbol": "GOOG", "name": "Alphabet Inc"}],
            "macro_indicators": [],
        }
    )
    calls = []

    def fake_finnhub(path, params, key, limiter):
        calls.append((path, params["symbol"]))
        if path == "stock/metric":
            return {"metric": {"epsTTM": 7.9}}
        if path == "stock/profile2":
            return {"name": "NVIDIA Corp"}
        return {"earningsCalendar": [{"date": "2026-11-25", "hour": "amc", "epsEstimate": 2.5}]}

    monkeypatch.setattr(research, "_finnhub", fake_finnhub)
    monkeypatch.setattr(research, "_fred", lambda sid: [(date(2026, 10, 26), 5.56)])
    s = research.run_research(date(2026, 10, 27), client=db, api_key="k")
    assert s.error is None, s.error
    assert s.symbols_requested == 2 and s.fundamentals_saved == 2  # FUND has a manual price
    saved = {r["symbol"]: r for r in db.writes["fundamentals"]}
    assert saved["NVDA"]["name"] == "NVIDIA Corp" and saved["NVDA"]["next_earnings_date"] == "2026-11-25"
    assert saved["GOOG"]["name"] == "Alphabet Inc"
    assert ("stock/profile2", "GOOG") not in calls  # name already known: no extra call
    assert {r["key"] for r in db.writes["macro_indicators"]} >= {"aaa_yield", "treasury_10y"}

    # only_new: GOOG already has fundamentals, so only NVDA is fetched
    db2 = _Db({**db.data, "macro_indicators": [{"key": "aaa_yield"}]})
    s2 = research.run_research(date(2026, 10, 27), client=db2, api_key="k", only_new=True)
    assert s2.symbols_requested == 1
    assert "macro_indicators" not in db2.writes  # already stored
