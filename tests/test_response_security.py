from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'headers.sqlite3'}")
    return TestClient(app)


def test_browser_security_headers_apply_to_every_response(tmp_path) -> None:
    response = _client(tmp_path).get("/health")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["permissions-policy"] == "camera=(), geolocation=(), microphone=()"
    policy = response.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in policy
    assert "object-src 'none'" in policy
    assert "script-src 'self' https://static.cloudflareinsights.com" in policy
    assert "worker-src 'self' blob:" in policy
    assert "script-src 'self' 'unsafe-inline'" not in policy


def test_session_private_responses_are_not_stored(tmp_path) -> None:
    client = _client(tmp_path)

    created = client.post("/sessions")
    places = client.get("/places")
    summary = client.get("/dashboard/summary")

    assert created.headers["cache-control"] == "no-store"
    assert places.headers["cache-control"] == "no-store"
    assert summary.headers["cache-control"] == "no-store"


def test_private_unauthorized_response_is_not_stored(tmp_path) -> None:
    response = _client(tmp_path).get("/places")

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_public_reference_geometry_keeps_its_cache_policy(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")

    beats = client.get("/dashboard/beats")
    mcpp = client.get("/dashboard/mcpp")

    assert beats.headers["cache-control"] == "public, max-age=3600"
    assert mcpp.headers["cache-control"] == "public, max-age=3600"


def test_nonsensitive_health_response_is_not_forced_to_no_store(tmp_path) -> None:
    response = _client(tmp_path).get("/health")

    assert "cache-control" not in response.headers
