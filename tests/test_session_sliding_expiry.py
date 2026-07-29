"""Resuming a session slides its 24h window forward.

The cookie carried a fixed expiry stamped at creation, so an actively-used session was
logged out exactly 24h after it started — mid-analysis, losing the user's saved places
because the identity hash is derived from the session id. Resume re-signs the SAME id
with a fresh window: sliding expiry, unchanged identity.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import app.sessions as sessions_module
from app.main import create_app
from app.sessions import (
    SESSION_MAX_AGE_SECONDS,
    _sign,
    public_user_hash,
    session_id_from_token,
)


def _client(tmp_path) -> TestClient:
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 's.sqlite3'}"))


def _parts(token: str) -> tuple[str, int, int]:
    payload, _ = token.rsplit(".", 1)
    session_id, issued_at, expires_at = payload.rsplit(":", 2)
    return session_id, int(issued_at), int(expires_at)


def test_resume_slides_the_expiry_without_changing_identity(tmp_path, monkeypatch):
    client = _client(tmp_path)
    created = client.post("/sessions")
    assert created.json()["session_state"] == "created"
    first_token = client.cookies.get("mca_session")
    first_id, first_issued_at, first_expiry = _parts(first_token)
    first_hash = public_user_hash(first_token)

    # Advance the clock inside the token factory so the new expiry is provably later.
    # sessions_module.time IS the time module, so capture the real function before patching.
    real_time = time.time
    monkeypatch.setattr(sessions_module.time, "time", lambda: real_time() + 3600)

    resumed = client.post("/sessions")
    assert resumed.status_code == 200
    assert resumed.json()["session_state"] == "resumed"
    assert "set-cookie" in resumed.headers

    second_token = client.cookies.get("mca_session")
    second_id, second_issued_at, second_expiry = _parts(second_token)

    assert second_expiry > first_expiry
    assert second_issued_at == first_issued_at
    # Identity is untouched: same session id, same derived user hash, same saved data.
    assert second_id == first_id
    assert public_user_hash(second_token) == first_hash
    assert session_id_from_token(second_token) == first_id


def test_resumed_cookie_keeps_the_full_max_age(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resumed = client.post("/sessions")
    assert f"Max-Age={SESSION_MAX_AGE_SECONDS}" in resumed.headers["set-cookie"]


def test_expired_token_creates_a_fresh_identity(tmp_path):
    client = _client(tmp_path)
    created = client.post("/sessions")
    original_hash = public_user_hash(client.cookies.get("mca_session"))

    session_id, issued_at, _ = _parts(client.cookies.get("mca_session"))
    expired_payload = f"{session_id}:{issued_at}:{int(time.time()) - 1}"
    expired = f"{expired_payload}.{_sign(expired_payload)}"
    assert session_id_from_token(expired) is None

    client.cookies.clear()
    client.cookies.set("mca_session", expired)
    response = client.post("/sessions")

    assert response.json()["session_state"] == "created"
    # Read the freshly-minted cookie off the response: the jar still holds the expired one
    # we injected, under a different domain.
    new_hash = public_user_hash(response.cookies.get("mca_session"))
    assert new_hash is not None
    assert new_hash != original_hash
    assert created.status_code == 200


def test_session_past_absolute_ceiling_gets_a_fresh_identity(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_SESSION_ABSOLUTE_MAX_DAYS", "30")
    client = _client(tmp_path)
    client.post("/sessions")
    original_token = client.cookies.get("mca_session")
    original_hash = public_user_hash(original_token)
    session_id, _, _ = _parts(original_token)
    now = int(time.time())
    too_old_issued_at = now - (31 * 24 * 60 * 60)
    payload = f"{session_id}:{too_old_issued_at}:{now + 3600}"
    too_old_token = f"{payload}.{_sign(payload)}"

    assert session_id_from_token(too_old_token) is None
    client.cookies.clear()
    client.cookies.set("mca_session", too_old_token)
    response = client.post("/sessions")

    assert response.status_code == 200
    assert response.json()["session_state"] == "created"
    assert public_user_hash(response.cookies.get("mca_session")) != original_hash


def test_delete_session_clears_the_cookie(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")
    assert client.cookies.get("mca_session")

    response = client.delete("/sessions")

    assert response.status_code == 204
    assert "mca_session=" in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert client.cookies.get("mca_session") is None


def test_resume_does_not_consume_the_session_rate_budget(tmp_path, monkeypatch: pytest.MonkeyPatch):
    # Resumes are not new sessions; they must not exhaust the per-IP creation bucket.
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_SESSIONS_PER_HOUR", "1")
    client = _client(tmp_path)
    assert client.post("/sessions").json()["session_state"] == "created"
    for _ in range(5):
        response = client.post("/sessions")
        assert response.status_code == 200
        assert response.json()["session_state"] == "resumed"
