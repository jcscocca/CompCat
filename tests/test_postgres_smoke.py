"""Postgres parity smoke — runs ONLY in the CI Postgres lane.

Skipped unless MCA_DATABASE_URL points at Postgres, so the default SQLite lane and local
`make test-all` are unaffected. The CI job runs `alembic upgrade head` first; this proves
the app boots, /health pings the DB, and a session + place round-trips on real Postgres
(not just SQLite).
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

_DB_URL = os.environ.get("MCA_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not _DB_URL.startswith("postgresql"),
    reason="Postgres smoke runs only when MCA_DATABASE_URL points at Postgres.",
)


def test_app_boots_and_round_trips_a_place_on_postgres():
    app = create_app()  # no url -> settings.database_url from MCA_DATABASE_URL (Postgres)
    client = TestClient(app)

    assert client.get("/health").status_code == 200

    assert client.post("/sessions").status_code == 200
    created = client.post(
        "/places",
        json={
            "display_label": "Postgres smoke place",
            "latitude": 47.6062,
            "longitude": -122.3321,
            "visit_count": 3,
        },
    )
    assert created.status_code == 201
    place_id = created.json()["id"]

    listed = client.get("/places")
    assert listed.status_code == 200
    body = listed.json()
    assert body["count"] == 1
    assert any(place["id"] == place_id for place in body["places"])
