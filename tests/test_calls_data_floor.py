from datetime import date

from app.crime.seattle_socrata import CRIME_DATA_FLOOR, calls_data_floor, crime_data_floor


def test_calls_floor_matches_the_retired_constant_at_mid_2026():
    # First-of-month, 24 months back from mid-2026 == the old fixed date(2024, 7, 1),
    # so the rolling change is seamless.
    assert calls_data_floor(date(2026, 7, 2)) == date(2024, 7, 1)


def test_calls_floor_rolls_forward_with_time():
    assert calls_data_floor(date(2027, 3, 15)) == date(2025, 3, 1)
    assert calls_data_floor(date(2028, 12, 31)) == date(2026, 12, 1)


def test_calls_floor_anchors_to_first_of_month():
    assert calls_data_floor(date(2026, 2, 28)).day == 1
    # Leap-safe: a Feb-29 reference does not raise and still anchors to the 1st.
    assert calls_data_floor(date(2028, 2, 29)) == date(2026, 2, 1)


def test_crime_floor_is_fixed_and_ignores_today():
    assert crime_data_floor(date(2030, 1, 1)) == CRIME_DATA_FLOOR
    assert crime_data_floor() == CRIME_DATA_FLOOR


def test_calls_floor_is_exact_for_non_multiple_of_12_windows(monkeypatch):
    import app.crime.seattle_socrata as s

    monkeypatch.setattr(s, "CALLS_WINDOW_MONTHS", 18)
    # 18 months before 2026-07 is 2025-01 (not 2025-07, which the old //12 math would give).
    assert s.calls_data_floor(date(2026, 7, 2)) == date(2025, 1, 1)
