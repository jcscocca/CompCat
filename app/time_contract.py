"""Public serialization for SPD's Seattle wall-clock timestamp columns."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

SEATTLE_TZ = ZoneInfo("America/Los_Angeles")


def seattle_wall_clock_json(value: datetime | None) -> str | None:
    """Attach Seattle's real offset without converting the stored clock digits.

    The source columns are historical Seattle local wall-clock values. Legacy model
    names end in ``_utc`` and parsers attached UTC merely to make them timezone-aware;
    converting that placeholder instant would shift the clock. Replacing tzinfo instead
    preserves the source wall time and emits the truthful DST-aware -07:00/-08:00 offset.
    """
    if value is None:
        return None
    return value.replace(tzinfo=SEATTLE_TZ).isoformat()
