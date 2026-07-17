from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


@pytest.fixture
def app_client_no_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'trends.sqlite3'}")
    return TestClient(app)


@pytest.fixture
def client(app_client_no_session, monkeypatch):
    # "TEST HILL" is a synthetic MCPP (not in the vendored area CSV); pin the validation
    # accessor so the handler treats it as a real neighbourhood key.
    monkeypatch.setattr(
        "app.api.routes_public_dashboard._mcpp_areas", lambda: {"TEST HILL": 3.0}
    )
    app_client_no_session.post("/sessions")
    return app_client_no_session


@pytest.fixture
def client_with_seeds(client):
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="a1", offense_start_utc=datetime(2026, 1, 5, tzinfo=UTC),
            offense_category="PROPERTY", beat="M3", mcpp="TEST HILL",
            latitude=47.60945, longitude=-122.33595,
        )
    )
    session.commit()
    session.close()
    return client


def test_trends_requires_a_public_session(app_client_no_session):
    response = app_client_no_session.get("/dashboard/trends?mcpp=TEST HILL")
    assert response.status_code == 401


def test_trends_unknown_mcpp_is_404(client):
    assert client.get("/dashboard/trends?mcpp=NOWHEREVILLE").status_code == 404


def test_trends_bad_layer_is_400(client):
    assert client.get("/dashboard/trends?mcpp=TEST HILL&layer=nope").status_code == 400


def test_trends_normalizes_mcpp_case(client_with_seeds):
    response = client_with_seeds.get("/dashboard/trends?mcpp=Test Hill")
    assert response.status_code == 200
    assert response.json()["mcpp"] == "TEST HILL"


def test_trends_empty_db_returns_zero_filled_series(client):
    body = client.get("/dashboard/trends?mcpp=TEST HILL").json()
    assert len(body["months"]) == len(body["area_counts"])
    assert set(body["area_counts"]) == {0}
