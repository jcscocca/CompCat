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
        json=_analyze_body(analysis_start_date="2010-01-01", analysis_end_date="2024-01-31"),
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
            "analysis_start_date": "2010-01-01",
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
            "analysis_start_date": "2010-01-01",
            "analysis_end_date": "2024-01-31",
        },
    )
    assert response.status_code == 422


def test_analyze_rejects_a_date_past_the_absolute_ceiling(tmp_path):
    # date.max reaches app/analysis/exposure.py's `end + timedelta(days=1)` and raises
    # OverflowError -> 500. The span cap alone does not stop it: 9991-10-16..9999-12-31
    # is inside 3000 days.
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/analyze",
        json=_analyze_body(analysis_start_date="9991-10-16", analysis_end_date="9999-12-31"),
    )
    assert response.status_code == 422


def test_compare_rejects_a_date_past_the_absolute_ceiling(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/compare",
        json={
            "points": [
                {"latitude": 47.6094, "longitude": -122.3334, "label": "A"},
                {"latitude": 47.6206, "longitude": -122.3206, "label": "B"},
            ],
            "analysis_start_date": "9991-10-16",
            "analysis_end_date": "9999-12-31",
            "radius_m": 250,
        },
    )
    assert response.status_code == 422


def test_analyze_rejects_a_date_before_the_dataset_floor(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/analyze",
        json=_analyze_body(analysis_start_date="1900-06-01", analysis_end_date="1900-06-30"),
    )
    assert response.status_code == 422


def test_analyze_accepts_a_near_future_end_date(tmp_path):
    # Today's window is legitimate, and a modest lookahead must not be rejected.
    from datetime import UTC, datetime, timedelta

    today = datetime.now(UTC).date()
    client = _client(tmp_path)
    response = client.post(
        "/dashboard/analyze",
        json=_analyze_body(
            analysis_start_date=today.isoformat(),
            analysis_end_date=(today + timedelta(days=30)).isoformat(),
        ),
    )
    assert response.status_code == 200


def test_analyze_rejects_an_oversized_offense_filter(tmp_path):
    # These strings are persisted verbatim onto AnalysisRun, so an unbounded category is a
    # 1 MB write per request.
    client = _client(tmp_path)
    for field in ("offense_category", "offense_subcategory", "nibrs_group"):
        response = client.post("/dashboard/analyze", json=_analyze_body(**{field: "x" * 81}))
        assert response.status_code == 422, field


def test_analyze_accepts_a_normal_offense_filter(tmp_path):
    client = _client(tmp_path)
    response = client.post("/dashboard/analyze", json=_analyze_body(offense_category="PROPERTY"))
    assert response.status_code == 200
