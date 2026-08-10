from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.api.routes_health as health_module
import app.db as db
from app.config import Settings
from app.main import create_app


def test_health_ok_when_db_reachable(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'h.sqlite3'}")
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "revision": None}


def test_health_exposes_the_configured_build_revision(tmp_path, monkeypatch):
    revision = "d111c3bad64fc6c7765da12986fcf6a2f7e1909e"
    settings = Settings(_env_file=None, build_revision=revision)
    monkeypatch.setattr(health_module, "get_settings", lambda: settings)

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'h-rev.sqlite3'}")
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "revision": revision}


def test_build_revision_rejects_arbitrary_public_text():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, build_revision="production database password")


def test_health_returns_503_when_db_unavailable(tmp_path, monkeypatch):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'h.sqlite3'}")
    client = TestClient(app)

    class _BrokenEngine:
        def connect(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(health_module, "get_engine", lambda: _BrokenEngine())
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["detail"] == "database unavailable"


def test_init_db_skips_create_all_on_postgres(monkeypatch):
    # Production (Postgres) schema is owned by Alembic; init_db must NOT run create_all there.
    saved_engine, saved_sessionmaker = db._engine, db._session_local
    try:
        db.configure_database("postgresql+psycopg://u:p@localhost:5432/x")
        calls: list[int] = []
        monkeypatch.setattr(db.Base.metadata, "create_all", lambda **kwargs: calls.append(1))
        db.init_db()
        assert calls == []
    finally:
        db._engine, db._session_local = saved_engine, saved_sessionmaker
