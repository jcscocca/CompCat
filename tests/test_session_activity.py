from __future__ import annotations

from datetime import UTC, timedelta

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import SessionActivity
from app.sessions import public_user_hash


def test_session_create_and_resume_upsert_activity(tmp_path, monkeypatch) -> None:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'activity.sqlite3'}")
    client = TestClient(app)

    created = client.post("/sessions")
    token = client.cookies.get("mca_session")
    user_hash = public_user_hash(token)
    with get_sessionmaker()() as session:
        first_seen = session.get(SessionActivity, user_hash).last_seen_at

    future = first_seen.replace(tzinfo=UTC) + timedelta(minutes=1)
    monkeypatch.setattr("app.services.session_activity_service.utc_now", lambda: future)
    resumed = client.post("/sessions")

    assert created.json()["session_state"] == "created"
    assert resumed.json()["session_state"] == "resumed"
    with get_sessionmaker()() as session:
        rows = session.query(SessionActivity).all()
        assert len(rows) == 1
        assert rows[0].user_id_hash == user_hash
        assert rows[0].last_seen_at > first_seen
