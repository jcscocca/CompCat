from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from app.schemas import CrimeIncidentData


@dataclass(frozen=True)
class TemporalProfile:
    hour_counts: list[int]  # length 24, local hour 0–23
    dow_counts: list[int]  # length 7, Mon=0 … Sun=6
    hour_by_dow: list[list[int]]  # 7×24 joint counts (rows = weekday, cols = hour)
    total_with_time: int
    without_time: int


def local_hour_dow(dt: datetime) -> tuple[int, int]:
    """Local ``(hour, weekday)`` for an incident's ``offense_start_utc``.

    SPD publishes naive Seattle wall-clock; ``parse_datetime`` stamps it UTC WITHOUT
    converting (see ``app/parsers/base.py``), so the stored value's wall-clock fields are
    ALREADY Seattle-local. Read them directly — a zoneinfo conversion would double-shift by
    ~7–8h. ``weekday()`` returns Mon=0 … Sun=6.
    """
    return dt.hour, dt.weekday()


def build_temporal_profile(incidents: Iterable[CrimeIncidentData]) -> TemporalProfile:
    hour_by_dow = [[0] * 24 for _ in range(7)]
    total_with_time = 0
    without_time = 0
    for incident in incidents:
        dt = incident.offense_start_utc
        if dt is None:
            without_time += 1
            continue
        hour, dow = local_hour_dow(dt)
        hour_by_dow[dow][hour] += 1
        total_with_time += 1
    hour_counts = [sum(hour_by_dow[d][h] for d in range(7)) for h in range(24)]
    dow_counts = [sum(row) for row in hour_by_dow]
    return TemporalProfile(
        hour_counts=hour_counts,
        dow_counts=dow_counts,
        hour_by_dow=hour_by_dow,
        total_with_time=total_with_time,
        without_time=without_time,
    )
