from __future__ import annotations

from datetime import UTC, date, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.services.incident_query_service import (
    bounding_box_for_points,
    incidents_in_bbox,
)


def test_bounding_box_pads_extent_by_radius():
    box = bounding_box_for_points([(47.61, -122.33)], radius_m=1000)
    assert box.min_lat < 47.61 < box.max_lat
    assert box.min_lon < -122.33 < box.max_lon
    # ~1 km is ~0.009 deg latitude; padding must be in that ballpark, not zero or huge.
    assert 0.005 < (box.max_lat - 47.61) < 0.02


def test_bounding_box_spans_multiple_points():
    box = bounding_box_for_points([(47.60, -122.34), (47.62, -122.30)], radius_m=250)
    assert box.min_lat < 47.60 and box.max_lat > 47.62
    assert box.min_lon < -122.34 and box.max_lon > -122.30


def _seed(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'q.sqlite3'}")
    session = get_sessionmaker()()
    rows = [
        ("in-box-in-date", 47.610, -122.330, datetime(2026, 3, 1, tzinfo=UTC), "PROPERTY"),
        ("out-of-box", 47.900, -122.000, datetime(2026, 3, 1, tzinfo=UTC), "PROPERTY"),
        ("in-box-out-date", 47.611, -122.331, datetime(2025, 1, 1, tzinfo=UTC), "PROPERTY"),
        ("in-box-other-offense", 47.609, -122.329, datetime(2026, 3, 1, tzinfo=UTC), "PERSON"),
    ]
    for incident_id, lat, lon, observed, category in rows:
        session.add(
            CrimeIncident(
                id=incident_id, offense_start_utc=observed, offense_category=category,
                beat="X1", latitude=lat, longitude=lon,
            )
        )
    session.commit()
    return session


def test_incidents_in_bbox_filters_box_and_date(tmp_path):
    session = _seed(tmp_path)
    box = bounding_box_for_points([(47.610, -122.330)], radius_m=500)
    found = incidents_in_bbox(
        session, box=box,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
    )
    ids = {incident.id for incident in found}
    assert "in-box-in-date" in ids
    assert "in-box-other-offense" in ids
    assert "out-of-box" not in ids
    assert "in-box-out-date" not in ids


def test_incidents_in_bbox_applies_offense_filter(tmp_path):
    session = _seed(tmp_path)
    box = bounding_box_for_points([(47.610, -122.330)], radius_m=500)
    found = incidents_in_bbox(
        session, box=box,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category="PERSON",
    )
    assert {incident.id for incident in found} == {"in-box-other-offense"}
