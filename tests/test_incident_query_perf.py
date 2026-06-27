from __future__ import annotations

from datetime import UTC, date, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.services.analysis_service import compare_site_options


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
