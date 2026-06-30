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
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident

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


def test_crime_source_composite_unique_on_migrated_postgres():
    # The migration-built Postgres schema must enforce the COMPOSITE key, not 0001's old
    # single-column unique: an arrest and a report sharing an external id coexist, and a
    # same-source duplicate is rejected. (SQLite proves this via create_all in
    # test_crime_source_uniqueness.py; this is the migrated-schema proof on Postgres.)
    create_app()  # Postgres; schema applied by the CI job's `alembic upgrade head`
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(external_incident_id="pg-coexist-1", source_dataset="seattle_spd_crime"),
            CrimeIncident(
                external_incident_id="pg-coexist-1", source_dataset="seattle_spd_arrests"
            ),
        ]
    )
    session.commit()
    rows = session.scalars(
        select(CrimeIncident).where(CrimeIncident.external_incident_id == "pg-coexist-1")
    ).all()
    assert {r.source_dataset for r in rows} == {"seattle_spd_crime", "seattle_spd_arrests"}

    session.add(
        CrimeIncident(external_incident_id="pg-coexist-1", source_dataset="seattle_spd_crime")
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
    session.close()
