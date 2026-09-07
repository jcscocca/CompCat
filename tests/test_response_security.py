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
    assert "script-src 'self'" in policy
    assert "cloudflareinsights.com" not in policy
    assert "cartocdn.com" not in policy
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


def test_reports_and_future_dashboard_routes_are_private_by_default(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")
    place = client.post("/places", json={
        "display_label": "Private report place",
        "latitude": 47.61,
        "longitude": -122.33,
    }).json()
    created = client.post("/dashboard/reports", json={
        "place_ids": [place["id"]],
        "layer": "arrests",
        "radius_m": 250,
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
    })
    assert created.status_code == 200
    report_id = created.json()["report_id"]
    retrieved = client.get(f"/dashboard/reports/{report_id}")
    assert retrieved.status_code == 200
    assert created.headers["cache-control"] == "no-store"
    assert retrieved.headers["cache-control"] == "no-store"

    @client.app.get("/dashboard/future-private-result")
    def future_result():
        return {"selected_place": "Private report place"}

    assert client.get("/dashboard/future-private-result").headers["cache-control"] == "no-store"


def test_dashboard_private_routes_protect_even_errors(tmp_path) -> None:
    client = _client(tmp_path)
    shared_paths = {
        "/dashboard/beats", "/dashboard/mcpp", "/dashboard/freshness",
        "/dashboard/report-profiles",
    }
    for route in client.app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/dashboard/") or path in shared_paths:
            continue
        path = path.replace("{report_id}", "missing-report")
        for method in route.methods:
            response = client.request(method, path)
            assert response.status_code in {401, 422}, (method, path, response.status_code)
            assert response.headers.get("cache-control") == "no-store", (method, path)


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
