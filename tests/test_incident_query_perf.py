from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.services.analysis_service import compare_site_options
from app.services.crime_service import _cluster_data, _incidents_near_clusters


def _app_session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'perf.sqlite3'}")
    return get_sessionmaker()()


def test_compare_site_options_counts_only_in_radius_incidents(tmp_path):
    session = _app_session(tmp_path)
    # One incident ~50 m from site A (counts), one ~30 km away (excluded by the bbox).
    session.add_all([
        CrimeIncident(id="near", offense_start_utc=datetime(2026, 3, 1, tzinfo=UTC),
                      offense_category="PROPERTY", beat="X1",
                      latitude=47.6105, longitude=-122.3300),
        CrimeIncident(id="far", offense_start_utc=datetime(2026, 3, 1, tzinfo=UTC),
                      offense_category="PROPERTY", beat="X9",
                      latitude=47.9000, longitude=-122.0000),
    ])
    session.commit()
    payload = compare_site_options(
        session=session, user_id_hash="u",
        options=[
            {"id": "a", "label": "A", "latitude": 47.6100, "longitude": -122.3300, "radius_m": 250},
            {"id": "b", "label": "B", "latitude": 47.6150, "longitude": -122.3300, "radius_m": 250},
        ],
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
    )
    counts = {o["id"]: o["incident_count"] for o in payload["overview"]["options"]}
    assert counts["a"] == 1  # only the near incident
    assert counts["b"] == 0


def test_summarize_loader_pulls_only_bounded_subset_not_whole_table(tmp_path):
    # Regression guard for the summarize_for_user full-table-load fix: the SQL WHERE must
    # exclude out-of-bbox and out-of-date-range rows so they never reach Python. If someone
    # reverts to select(CrimeIncident).all(), this fails (it would load all 355 rows).
    session = _app_session(tmp_path)
    place_lat, place_lon = 47.6100, -122.3300
    near = [
        CrimeIncident(
            id=f"near-{i}",
            offense_start_utc=datetime(2026, 3, 1 + i, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=place_lat + 0.0005,  # ~55 m, inside the 250 m bbox
            longitude=place_lon,
        )
        for i in range(5)
    ]
    far = [  # ~33 km north — outside the bbox
        CrimeIncident(
            id=f"far-{i}",
            offense_start_utc=datetime(2026, 3, 1, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.9000 + i * 0.001,
            longitude=-122.0000,
        )
        for i in range(300)
    ]
    out_of_range = [  # at the place but years before the analysis window
        CrimeIncident(
            id=f"old-{i}",
            offense_start_utc=datetime(2020, 1, 1, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=place_lat,
            longitude=place_lon,
        )
        for i in range(50)
    ]
    session.add_all(near + far + out_of_range)
    session.add(
        PlaceCluster(
            id="p1", user_id_hash="u", cluster_version="t", cluster_method="manual",
            centroid_latitude=place_lat, centroid_longitude=place_lon,
            display_latitude=place_lat, display_longitude=place_lon,
            visit_count=3, inferred_place_type="manual_place",
            sensitivity_class="normal", display_label="P", label_source="test",
        )
    )
    session.commit()

    cluster = _cluster_data(session.scalars(select(PlaceCluster)).one())
    incidents = _incidents_near_clusters(
        session, [cluster], [250], date(2026, 1, 1), date(2026, 6, 30)
    )
    assert len(incidents) == 5
