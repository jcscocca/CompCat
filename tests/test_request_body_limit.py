from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


def _client(tmp_path) -> TestClient:
    return TestClient(
        create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'body-limit.sqlite3'}")
    )


def test_oversize_json_is_rejected_before_routing(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_MAX_REQUEST_BYTES", "64")
    client = _client(tmp_path)

    response = client.post("/sessions", content=b"x" * 65)

    assert response.status_code == 413
    assert response.json()["detail"] == "Request body is too large"


def test_normal_json_body_passes_the_global_cap(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_MAX_REQUEST_BYTES", "1024")
    client = _client(tmp_path)
    client.post("/sessions")

    response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [],
            "radii_m": [500],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-01-31",
        },
    )

    assert response.status_code != 413


def test_missing_content_length_is_still_capped(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_MAX_REQUEST_BYTES", "64")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'missing.sqlite3'}")
    sent: list[dict] = []
    messages = iter(
        [
            {"type": "http.request", "body": b"x" * 65, "more_body": False},
        ]
    )

    async def receive() -> dict:
        return next(messages)

    async def send(message: dict) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/sessions",
        "raw_path": b"/sessions",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    }

    asyncio.run(app(scope, receive, send))

    start = next(message for message in sent if message["type"] == "http.response.start")
    assert start["status"] == 413


def test_upload_path_gets_large_cap_only_when_feature_is_enabled(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_MAX_REQUEST_BYTES", "64")
    monkeypatch.setenv("MCA_MAX_UPLOAD_BYTES", "1024")
    disabled = _client(tmp_path)
    disabled.post("/sessions")
    payload = b"x" * 65

    disabled_response = disabled.post(
        "/uploads",
        files={"file": ("places.csv", payload, "text/csv")},
    )
    assert disabled_response.status_code == 413

    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    get_settings.cache_clear()
    enabled = _client(tmp_path)
    enabled.post("/sessions")
    enabled_response = enabled.post(
        "/uploads",
        files={"file": ("places.csv", payload, "text/csv")},
    )
    assert enabled_response.status_code != 413
