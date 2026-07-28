"""_monthly_counts is a per-month tally over the analysis window.

The original scanned the whole incident list once per month (O(months x incidents)). With
the 3000-day span cap that is bounded at ~100 months, but a single pass is both cheaper
and simpler. These pin the behaviour so the rewrite is provably equivalent.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.schemas import CrimeIncidentData
from app.services.neighborhood_service import _monthly_counts


def _incident(when: datetime) -> CrimeIncidentData:
    return CrimeIncidentData(id=f"i-{when.isoformat()}", offense_start_utc=when)


def test_counts_group_by_month_across_the_window():
    incidents = [
        _incident(datetime(2024, 1, 5, tzinfo=UTC)),
        _incident(datetime(2024, 1, 20, tzinfo=UTC)),
        _incident(datetime(2024, 3, 2, tzinfo=UTC)),
    ]
    counts = _monthly_counts(incidents, date(2024, 1, 1), date(2024, 4, 30))
    assert counts == [2, 0, 1, 0]


def test_empty_window_months_are_zero_not_missing():
    counts = _monthly_counts([], date(2024, 1, 1), date(2024, 3, 31))
    assert counts == [0, 0, 0]


def test_incidents_outside_the_window_are_not_counted():
    incidents = [
        _incident(datetime(2023, 12, 31, tzinfo=UTC)),
        _incident(datetime(2024, 2, 1, tzinfo=UTC)),
        _incident(datetime(2024, 6, 1, tzinfo=UTC)),
    ]
    counts = _monthly_counts(incidents, date(2024, 1, 1), date(2024, 3, 31))
    assert counts == [0, 1, 0]
    assert sum(counts) == 1


def test_single_month_window():
    incidents = [_incident(datetime(2024, 5, 9, tzinfo=UTC))] * 4
    assert _monthly_counts(incidents, date(2024, 5, 1), date(2024, 5, 31)) == [4]


def test_window_spanning_a_year_boundary():
    incidents = [
        _incident(datetime(2023, 12, 15, tzinfo=UTC)),
        _incident(datetime(2024, 1, 15, tzinfo=UTC)),
        _incident(datetime(2024, 1, 16, tzinfo=UTC)),
    ]
    assert _monthly_counts(incidents, date(2023, 12, 1), date(2024, 2, 29)) == [1, 2, 0]
