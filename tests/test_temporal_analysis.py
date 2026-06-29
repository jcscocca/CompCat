from datetime import UTC, datetime

from app.analysis.temporal import build_temporal_profile, local_hour_dow
from app.schemas import CrimeIncidentData


def _inc(dt: datetime | None) -> CrimeIncidentData:
    return CrimeIncidentData(offense_start_utc=dt)


def test_local_hour_dow_reads_wall_clock_without_shift():
    # offense_start_utc holds naive Seattle local stamped UTC (app/parsers/base.py),
    # so 23:30 must read as hour 23 — NOT shifted. 2024-02-10 is a Saturday (weekday 5).
    assert local_hour_dow(datetime(2024, 2, 10, 23, 30, tzinfo=UTC)) == (23, 5)


def test_build_temporal_profile_buckets_hour_and_dow():
    incidents = [
        _inc(datetime(2024, 2, 10, 23, 30, tzinfo=UTC)),  # Sat 23
        _inc(datetime(2024, 2, 12, 8, 0, tzinfo=UTC)),    # Mon 08
        _inc(datetime(2024, 2, 12, 8, 45, tzinfo=UTC)),   # Mon 08
        _inc(None),                                        # no recorded time
    ]
    profile = build_temporal_profile(incidents)

    assert profile.total_with_time == 3
    assert profile.without_time == 1
    assert len(profile.hour_counts) == 24
    assert len(profile.dow_counts) == 7
    assert profile.hour_counts[23] == 1
    assert profile.hour_counts[8] == 2
    assert profile.dow_counts[5] == 1  # Saturday
    assert profile.dow_counts[0] == 2  # Monday
    assert profile.hour_by_dow[0][8] == 2
    assert profile.hour_by_dow[5][23] == 1
    # marginals must equal the joint matrix collapsed each way
    assert profile.hour_counts == [
        sum(profile.hour_by_dow[d][h] for d in range(7)) for h in range(24)
    ]
    assert profile.dow_counts == [sum(profile.hour_by_dow[d]) for d in range(7)]


def test_build_temporal_profile_empty():
    profile = build_temporal_profile([])
    assert profile.total_with_time == 0
    assert profile.without_time == 0
    assert profile.hour_counts == [0] * 24
    assert profile.dow_counts == [0] * 7
    assert profile.hour_by_dow == [[0] * 24 for _ in range(7)]
