from datetime import date, timedelta

from market_calendar import is_trading_day, us_market_holidays


def test_ten_holidays_per_year_across_a_decade():
    for year in range(2024, 2034):
        holidays = us_market_holidays(year)
        assert 9 <= len(holidays) <= 10, f"{year}: {sorted(holidays)}"


def test_fixed_monday_holidays_land_on_monday():
    for year in (2024, 2025, 2026, 2027, 2030):
        holidays = us_market_holidays(year)
        mlk = date(year, 1, 15)  # earliest possible 3rd Monday
        presidents = date(year, 2, 15)  # earliest possible 3rd Monday
        memorial = date(year, 5, 25)  # earliest possible last Monday
        labor = date(year, 9, 1)  # earliest possible 1st Monday

        mlk_days = [h for h in holidays if h.month == 1 and 15 <= h.day <= 21]
        presidents_days = [h for h in holidays if h.month == 2 and 15 <= h.day <= 21]
        memorial_days = [h for h in holidays if h.month == 5 and h.day >= 25]
        labor_days = [h for h in holidays if h.month == 9 and h.day <= 7]

        assert len(mlk_days) == 1 and mlk_days[0].weekday() == 0
        assert len(presidents_days) == 1 and presidents_days[0].weekday() == 0
        assert len(memorial_days) == 1 and memorial_days[0].weekday() == 0
        assert len(labor_days) == 1 and labor_days[0].weekday() == 0
        # sanity that the anchor dates above are even plausible (earliest bound)
        assert mlk_days[0] >= mlk
        assert presidents_days[0] >= presidents
        assert memorial_days[0] >= memorial
        assert labor_days[0] >= labor


def test_thanksgiving_is_fourth_thursday_of_november():
    for year in (2024, 2025, 2026, 2027):
        holidays = us_market_holidays(year)
        nov_thursdays = [h for h in holidays if h.month == 11]
        assert len(nov_thursdays) == 1
        assert nov_thursdays[0].weekday() == 3
        assert 22 <= nov_thursdays[0].day <= 28


def test_good_friday_is_a_friday_in_plausible_easter_window():
    for year in (2024, 2025, 2026, 2027, 2028):
        holidays = us_market_holidays(year)
        march_april = [h for h in holidays if (h.month == 3 and h.day >= 18) or (h.month == 4 and h.day <= 24)]
        assert len(march_april) == 1, f"{year}: {sorted(holidays)}"
        assert march_april[0].weekday() == 4


def test_weekend_observed_holidays_never_fall_on_a_weekend():
    for year in range(2024, 2034):
        for h in us_market_holidays(year):
            assert h.weekday() < 5, f"{h} ({h.strftime('%A')}) should have been shifted off the weekend"


def test_is_trading_day_excludes_weekends_and_holidays():
    for year in (2025, 2026):
        for h in us_market_holidays(year):
            assert is_trading_day(h) is False
        saturday = date(year, 3, 1)
        while saturday.weekday() != 5:
            saturday += timedelta(days=1)
        assert is_trading_day(saturday) is False
        assert is_trading_day(saturday + timedelta(days=1)) is False  # Sunday


def test_is_trading_day_true_on_an_ordinary_weekday():
    # July 8 2026 is a Wednesday, not near any holiday
    assert is_trading_day(date(2026, 7, 8)) is True


def test_roughly_the_expected_number_of_trading_days_per_year():
    for year in (2024, 2025, 2026):
        d = date(year, 1, 1)
        count = 0
        while d.year == year:
            if is_trading_day(d):
                count += 1
            d += timedelta(days=1)
        assert 249 <= count <= 253, f"{year}: {count} trading days"
