"""Interactive API docs are a local/dev affordance.

On a public deployment /docs, /redoc and /openapi.json hand an attacker a complete,
machine-readable map of the surface (and Swagger UI is a live request console against
it). They stay on in local/dev where they earn their keep.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def _prod_like(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCA_ENVIRONMENT", "production")
    monkeypatch.setenv("MCA_USER_HASH_SALT", "prod-salt")
    monkeypatch.setenv("MCA_SESSION_SECRET", "prod-secret")
    monkeypatch.setenv("MCA_GEOCODER_CONTACT_EMAIL", "ops@example.com")


def test_local_serves_the_docs(tmp_path):
    client = TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'l.sqlite3'}"))
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_prod_like_hides_the_docs(tmp_path, monkeypatch: pytest.MonkeyPatch):
    _prod_like(monkeypatch)
    client = TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'p.sqlite3'}"))
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_prod_like_app_still_serves_its_routes(tmp_path, monkeypatch: pytest.MonkeyPatch):
    # Hiding the schema must not unmount anything.
    _prod_like(monkeypatch)
    client = TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'r.sqlite3'}"))
    assert client.get("/health").status_code == 200
    assert client.post("/sessions").status_code == 200
