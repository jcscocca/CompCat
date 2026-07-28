from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def limited_client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_SESSIONS_PER_HOUR", "3")
    monkeypatch.setenv("MCA_TRUST_PROXY_HEADERS", "false")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl.sqlite3")
    return TestClient(app)


def test_session_creation_capped(limited_client: TestClient) -> None:
    # POST /sessions resumes for free with a valid cookie, so each new-mint
    # attempt must start from a clean cookie jar to actually burn budget.
    for _ in range(3):
        assert limited_client.post("/sessions").status_code == 200
        limited_client.cookies.clear()
    response = limited_client.post("/sessions")
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    detail = response.json()["detail"].lower()
    # invariant-safe copy: about request limits, never place characteristics
    assert "request" in detail or "limit" in detail


def test_spoofed_proxy_header_ignored_without_trust(limited_client: TestClient) -> None:
    # All 4 calls come from the same socket peer; the spoofed header must NOT
    # give each call a fresh bucket. Clear cookies between attempts so each
    # call actually mints (a resumed call is free and wouldn't exercise the cap).
    for i in range(3):
        assert (
            limited_client.post("/sessions", headers={"CF-Connecting-IP": f"8.8.8.{i}"}).status_code
            == 200
        )
        limited_client.cookies.clear()
    assert (
        limited_client.post("/sessions", headers={"CF-Connecting-IP": "8.8.9.9"}).status_code
        == 429
    )


def test_trusted_proxy_header_separates_clients(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_SESSIONS_PER_HOUR", "1")
    monkeypatch.setenv("MCA_TRUST_PROXY_HEADERS", "true")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl2.sqlite3")
    client = TestClient(app)
    assert client.post("/sessions", headers={"CF-Connecting-IP": "8.8.8.1"}).status_code == 200
    client.cookies.clear()
    assert client.post("/sessions", headers={"CF-Connecting-IP": "8.8.8.2"}).status_code == 200
    client.cookies.clear()
    assert client.post("/sessions", headers={"CF-Connecting-IP": "8.8.8.1"}).status_code == 429


def test_trusted_forwarded_for_separates_clients_through_the_middleware(
    tmp_path, monkeypatch
) -> None:
    # The burst tier reads the scope headers directly (BurstLimitMiddleware), not client_ip_from,
    # so the X-Forwarded-For step has to exist in both places or the two tiers key differently.
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "2")
    monkeypatch.setenv("MCA_TRUST_PROXY_HEADERS", "true")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl8.sqlite3")
    client = TestClient(app)
    first = [
        client.get("/input-modes", headers={"X-Forwarded-For": "8.8.8.1, 172.18.0.1"}).status_code
        for _ in range(3)
    ]
    assert first[:2] == [200, 200]
    assert first[2] == 429
    # A different leftmost hop is a different client and gets its own bucket.
    assert (
        client.get("/input-modes", headers={"X-Forwarded-For": "8.8.8.2, 172.18.0.1"}).status_code
        == 200
    )


def test_spoofed_forwarded_for_ignored_without_trust(limited_client: TestClient) -> None:
    # Same socket peer for all four; the spoofed header must not mint fresh buckets.
    for i in range(3):
        assert (
            limited_client.post("/sessions", headers={"X-Forwarded-For": f"8.8.8.{i}"}).status_code
            == 200
        )
        limited_client.cookies.clear()
    assert (
        limited_client.post("/sessions", headers={"X-Forwarded-For": "8.8.9.9"}).status_code == 429
    )


def test_limiter_off_by_default(tmp_path) -> None:
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl3.sqlite3")
    client = TestClient(app)
    for _ in range(25):
        assert client.post("/sessions").status_code == 200


def test_assistant_global_daily_cap(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_ASSISTANT_GLOBAL_PER_DAY", "0")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl4.sqlite3")
    client = TestClient(app)
    client.post("/sessions")
    response = client.post(
        "/assistant/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "dashboard_state": {}},
    )
    assert response.status_code == 429
    detail = response.json()["detail"].lower()
    assert "analyst" in detail and ("limit" in detail or "capacity" in detail)


def test_session_rejection_does_not_burn_global_budget(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_ASSISTANT_PER_HOUR", "0")
    monkeypatch.setenv("MCA_RATE_LIMIT_ASSISTANT_GLOBAL_PER_DAY", "1")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl7.sqlite3")
    client = TestClient(app)
    client.post("/sessions")
    response = client.post(
        "/assistant/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "dashboard_state": {}},
    )
    assert response.status_code == 429
    assert "session" in response.json()["detail"].lower()
    # The global daily budget (limit 1) must be untouched by the per-session rejection.
    from app.ratelimit import get_rate_limiter

    assert get_rate_limiter().try_count_global(limit=1) is True


def test_burst_limit_on_api_routes(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "5")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl5.sqlite3")
    client = TestClient(app)
    statuses = [client.get("/input-modes").status_code for _ in range(7)]
    assert statuses[:5] == [200] * 5
    assert 429 in statuses[5:]


def test_burst_limit_exempts_health(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "1")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl6.sqlite3")
    client = TestClient(app)
    for _ in range(5):
        assert client.get("/health").status_code == 200


def test_burst_limit_exempts_the_data_freshness_probe(tmp_path, monkeypatch) -> None:
    # An external monitor polls /health/data every minute; the /health prefix in
    # _BURST_EXEMPT_PREFIXES must keep covering it.
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "1")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl7.sqlite3")
    client = TestClient(app)
    for _ in range(5):
        assert client.get("/health/data").status_code != 429
