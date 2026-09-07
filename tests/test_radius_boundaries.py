from __future__ import annotations

from datetime import UTC, date, datetime
from math import asin, atan2, cos, degrees, radians, sin

import pytest
from fastapi.testclient import TestClient

from app.analysis.reference_circles import IncidentGrid
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.normalization.geo import EARTH_RADIUS_M, bounding_box_for_points, haversine_m
from app.services.incident_query_service import incidents_in_bbox


def _destination(lat: float, lon: float, bearing: float, distance: float) -> tuple[float, float]:
    """Generate test points by moving along a great circle, independently of the bbox."""
    lat, lon, bearing = radians(lat), radians(lon), radians(bearing)
    arc = distance / EARTH_RADIUS_M
    end_lat = asin(sin(lat) * cos(arc) + cos(lat) * sin(arc) * cos(bearing))
    end_lon = lon + atan2(sin(bearing) * sin(arc) * cos(lat), cos(arc) - sin(lat) * sin(end_lat))
    return degrees(end_lat), (degrees(end_lon) + 180) % 360 - 180


@pytest.mark.parametrize("radius", [100, 250, 500, 1000])
@pytest.mark.parametrize("center", [(47.61, -122.33), (80.0, 0.0), (89.999, 179.999)])
def test_prefilter_contains_whole_circle_at_every_bearing(center, radius):
    box = bounding_box_for_points([center], radius)
    for bearing in range(0, 360, 5):
        lat, lon = _destination(*center, bearing, radius)
        assert box.min_lat <= lat <= box.max_lat
        assert box.min_lon <= lon <= box.max_lon


def test_multi_place_envelope_uses_each_circles_latitude():
    centers = [(47.5, -122.5), (47.75, -122.25)]
    box = bounding_box_for_points(centers, 1000)
    for center in centers:
        for bearing in range(0, 360, 5):
            lat, lon = _destination(*center, bearing, 999.5)
            assert box.min_lat <= lat <= box.max_lat
            assert box.min_lon <= lon <= box.max_lon


def test_incident_grid_keeps_radius_boundary_across_a_cell_edge():
    # Put the northern edge just beyond a grid line: the old undersized search box
    # selected the previous cell and never evaluated this in-radius point.
    center = (47.608 + 0.000001 - degrees(999.5 / EARTH_RADIUS_M), -122.33)
    inside = _destination(*center, 0, 999.5)
    outside = _destination(*center, 0, 1000.5)
    assert IncidentGrid([inside, outside]).count_within(*center, 1000) == 1


def test_dashboard_and_comparison_queries_agree_at_the_radius_boundary(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'boundary.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    center = (47.61, -122.33)
    with get_sessionmaker()() as session:
        for bearing in (0, 90, 180, 270):
            for distance in (999.5, 1000.5):
                lat, lon = _destination(*center, bearing, distance)
                assert haversine_m(*center, lat, lon) == pytest.approx(distance)
                session.add(CrimeIncident(
                    id=f"{bearing}-{distance}", source_dataset="seattle_spd_crime",
                    offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
                    latitude=lat, longitude=lon,
                ))
        session.commit()
        rows = incidents_in_bbox(
            session, box=bounding_box_for_points([center], 1000),
            analysis_start_date=date(2024, 1, 1), analysis_end_date=date(2024, 1, 31),
        )
        assert sum(haversine_m(*center, row.latitude, row.longitude) <= 1000 for row in rows) == 4

    response = client.post("/dashboard/incidents", json={
        "points": [{"label": "Boundary point", "latitude": center[0], "longitude": center[1]}],
        "radii_m": [1000], "analysis_start_date": "2024-01-01", "analysis_end_date": "2024-01-31",
    })
    assert response.status_code == 200
    assert response.json()["total_count"] == 4
