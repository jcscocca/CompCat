from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path):
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'm.sqlite3'}"))


def _route_body(origin: str, destination: str) -> dict:
    return {
        "origin_label": origin,
        "destination_label": destination,
        "mode": "transit",
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [500],
    }


def test_public_route_alternatives_returns_ranked_comparison(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "Downtown Seattle"))
    assert response.status_code == 200
    body = response.json()
    assert len(body["alternatives"]) >= 2
    assert body["alternatives"][0]["rank"] == 1
    assert body["statistical_comparison"] is not None
    assert "user_id_hash" not in body["request"]


def test_public_route_alternatives_requires_session(tmp_path):
    client = _client(tmp_path)
    response = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "Downtown Seattle"))
    assert response.status_code == 401


def test_public_route_single_alternative_has_no_comparison(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "University District"))
    assert response.status_code == 200
    body = response.json()
    assert len(body["alternatives"]) == 1
    assert body["statistical_comparison"] is None


def test_public_route_comparison_roundtrip(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    created = client.post(
        "/routes/alternatives", json=_route_body("Capitol Hill", "Downtown Seattle")
    ).json()
    request_id = created["request"]["id"]
    fetched = client.get(f"/routes/requests/{request_id}/comparison")
    assert fetched.status_code == 200
    assert fetched.json()["request"]["id"] == request_id
