from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.crime.seattle_socrata import load_crime_csv_text
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'fresh.sqlite3'}")
    return TestClient(app)


def test_freshness_reports_count_range_and_last_ingested(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id="c1", offense_start_utc=datetime(2024, 1, 5, tzinfo=UTC),
                offense_category="PROPERTY", latitude=47.6, longitude=-122.3,
            ),
            CrimeIncident(
                id="c2", offense_start_utc=datetime(2026, 6, 20, tzinfo=UTC),
                offense_category="PROPERTY", latitude=47.6, longitude=-122.3,
            ),
            CrimeIncident(
                id="c3", offense_start_utc=datetime(2025, 3, 10, tzinfo=UTC),
                offense_category="PROPERTY", latitude=47.6, longitude=-122.3,
            ),
        ]
    )
    session.commit()
    session.close()

    response = client.get("/dashboard/freshness")
    assert response.status_code == 200
    body = response.json()
    assert body["incident_count"] == 3
    assert body["data_through"] == "2026-06-20"
    assert body["earliest"] == "2024-01-05"
    # snapshot_at defaults to the ingest/insert time, so last_ingested_at is populated.
    assert body["last_ingested_at"] is not None


def test_freshness_empty_dataset_returns_nulls(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.get("/dashboard/freshness")
    assert response.status_code == 200
    assert response.json() == {
        "incident_count": 0,
        "data_through": None,
        "earliest": None,
        "last_ingested_at": None,
    }


def test_freshness_requires_a_public_session(tmp_path):
    client = _client(tmp_path)
    response = client.get("/dashboard/freshness")
    assert response.status_code == 401


def test_mapping_stamps_ingested_at_not_the_old_2024_hardcode():
    # A row with no snapshot_at column must be stamped with the ingest time, not the old
    # hardcoded 2024-01-01 placeholder.
    text = (
        "report_number,offense_id,offense_start_datetime,report_datetime,"
        "crime_against_category,offense_parent_group,offense,beat,longitude,latitude\n"
        "R1,OFF-1,2024-01-03T09:00:00Z,2024-01-03T10:00:00Z,"
        "PROPERTY,LARCENY,THEFT,K1,-122.33,47.61\n"
    )
    incidents = load_crime_csv_text(text)
    assert len(incidents) == 1
    snapshot_at = incidents[0].snapshot_at
    assert snapshot_at is not None
    assert snapshot_at.year >= 2025  # ingested-at (now), not 2024-01-01
