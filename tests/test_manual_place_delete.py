"""Deleting a manual place that has been analyzed.

A saved-place analyze writes PlaceCrimeSummary rows keyed on place_cluster_id. That FK
has no ON DELETE, so deleting the place afterwards used to raise IntegrityError and
surface as a 500 — the place stayed and the user could not remove it.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster, PlaceCrimeSummary


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'delete.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="incident-a",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        )
    )
    session.commit()
    session.close()
    return client


def test_delete_after_analyze_removes_the_place(tmp_path):
    client = _client(tmp_path)
    created = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.6094,
            "longitude": -122.3334,
            "visit_count": 12,
        },
    )
    assert created.status_code == 201
    place_id = created.json()["id"]

    analyzed = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )
    assert analyzed.status_code == 200

    session = get_sessionmaker()()
    assert session.query(PlaceCrimeSummary).count() > 0
    session.close()

    deleted = client.delete(f"/places/{place_id}")
    assert deleted.status_code == 204

    assert place_id not in [place["id"] for place in client.get("/places").json()["places"]]
    session = get_sessionmaker()()
    assert session.get(PlaceCluster, place_id) is None
    # The orphaned summaries go with the place rather than lingering as dangling rows.
    assert (
        session.query(PlaceCrimeSummary)
        .filter(PlaceCrimeSummary.place_cluster_id == place_id)
        .count()
        == 0
    )
    session.close()


def test_clear_all_after_analyze_removes_places_and_summaries(tmp_path):
    client = _client(tmp_path)
    place_ids = []
    for label, latitude in (("Downtown", 47.6094), ("Nearby", 47.6098)):
        created = client.post(
            "/places",
            json={
                "display_label": label,
                "latitude": latitude,
                "longitude": -122.3334,
                "visit_count": 1,
            },
        )
        assert created.status_code == 201
        place_ids.append(created.json()["id"])
    analyzed = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": place_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )
    assert analyzed.status_code == 200

    deleted = client.delete("/places")

    assert deleted.status_code == 204
    session = get_sessionmaker()()
    assert session.query(PlaceCluster).filter(PlaceCluster.id.in_(place_ids)).count() == 0
    assert (
        session.query(PlaceCrimeSummary)
        .filter(PlaceCrimeSummary.place_cluster_id.in_(place_ids))
        .count()
        == 0
    )
    session.close()
