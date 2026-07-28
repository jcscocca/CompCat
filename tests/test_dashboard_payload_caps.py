"""DoS caps on dashboard request payloads.

Every /dashboard/* analysis endpoint fans a request out over radii x date-window: an
unbounded radii_m list or a century-long window turns one cheap POST into a very
expensive scan. These caps keep the blast radius of a single request bounded.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path) -> TestClient:
    client = TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'caps.sqlite3'}"))
    client.post("/sessions")
    return client


def _analyze_body(**overrides) -> dict:
    body = {
        "points": [{"latitude": 47.6094, "longitude": -122.3334, "label": "Home"}],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }
    body.update(overrides)
    return body


def test_analyze_accepts_the_three_product_radii(tmp_path):
    client = _client(tmp_path)
    response = client.post("/dashboard/analyze", json=_analyze_body(radii_m=[250, 500, 1000]))
    assert response.status_code == 200


def test_analyze_rejects_a_fourth_radius(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/analyze", json=_analyze_body(radii_m=[250, 500, 1000, 2000])
    )
    assert response.status_code == 422


def test_analyze_rejects_an_oversized_date_span(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/analyze",
        json=_analyze_body(analysis_start_date="1900-01-01", analysis_end_date="2024-01-31"),
    )
    assert response.status_code == 422
    assert "3000" in response.text


def test_analyze_accepts_a_span_at_the_cap(tmp_path):
    client = _client(tmp_path)
    # 2016-01-01 -> 2024-03-16 is exactly 3000 days.
    response = client.post(
        "/dashboard/analyze",
        json=_analyze_body(analysis_start_date="2016-01-01", analysis_end_date="2024-03-16"),
    )
    assert response.status_code == 200


def test_analyze_rejects_an_inverted_date_range(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/analyze",
        json=_analyze_body(analysis_start_date="2024-02-01", analysis_end_date="2024-01-01"),
    )
    assert response.status_code == 422


def test_compare_rejects_an_oversized_date_span(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/compare",
        json={
            "points": [
                {"latitude": 47.6094, "longitude": -122.3334, "label": "A"},
                {"latitude": 47.6206, "longitude": -122.3206, "label": "B"},
            ],
            "analysis_start_date": "1900-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
        },
    )
    assert response.status_code == 422


def test_incident_points_rejects_an_oversized_date_span(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/incident-points",
        json={
            "bounds": {"west": -122.35, "south": 47.60, "east": -122.32, "north": 47.63},
            "analysis_start_date": "1900-01-01",
            "analysis_end_date": "2024-01-31",
        },
    )
    assert response.status_code == 422
