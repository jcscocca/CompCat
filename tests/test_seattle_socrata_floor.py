from datetime import date

from app.crime.seattle_socrata import CRIME_DATA_FLOOR, floor_start_date


def test_floor_lifts_pre_2018_dates():
    assert floor_start_date(date(2015, 5, 1)) == CRIME_DATA_FLOOR


def test_floor_keeps_dates_on_or_after_2018():
    assert floor_start_date(date(2020, 3, 4)) == date(2020, 3, 4)


def test_floor_defaults_none_to_floor():
    assert floor_start_date(None) == CRIME_DATA_FLOOR
