from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def _client_with_beat_crime(tmp_path) -> tuple[TestClient, str]:
    """
    Create a TestClient with a public session, one place, and several crime
    rows tagged with beat "M3" (the beat the real polygons resolve that downtown
    point to) near that place, dated 2026.
    Returns (client, place_id).
    """
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    # Seed crime incidents near 47.60945, -122.33595 (deep in beat M3), all tagged beat="M3"
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"incident-nb-{i}",
                offense_start_utc=datetime(2026, 1, 10 + i, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.60945 + i * 0.0001,
                longitude=-122.33595,
                beat="M3",
            )
            for i in range(5)
        ]
    )
    session.commit()
    session.close()

    response = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.60945,
            "longitude": -122.33595,
            "visit_count": 12,
        },
    )
    assert response.status_code == 201
    place_id = response.json()["id"]
    return client, place_id


@pytest.fixture()
def neighborhood_client(tmp_path):
    return _client_with_beat_crime(tmp_path)


def test_neighborhood_endpoint_returns_place_block(neighborhood_client):
    client, place_id = neighborhood_client
    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["radius_m"] == 250
    assert body["places"][0]["place_id"] == place_id
    assert "decision" in body["places"][0]


def test_neighborhood_endpoint_requires_public_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    # No /sessions call — no cookie

    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": ["some-place-id"],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert response.status_code == 401
