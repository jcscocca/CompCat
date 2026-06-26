from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, RouteRequest
from app.services.users import hash_demo_user


def test_site_comparison_api_returns_overview_and_analytical_payload(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"a-{index}",
                offense_start_utc=datetime(
                    2024,
                    1 + (index // 4),
                    10 + (index % 4),
                    tzinfo=UTC,
                ),
                offense_category="PROPERTY",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"b-{index}",
                offense_start_utc=datetime(
                    2024,
                    1 + (index // 14),
                    1 + (index % 14),
                    tzinfo=UTC,
                ),
                offense_category="PROPERTY",
                latitude=47.6205,
                longitude=-122.3493,
            )
            for index in range(28)
        ],
    )
    session.commit()
    session.close()

    response = client.post(
        "/internal/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-02-29",
            "offense_category": "PROPERTY",
            "options": [
                {
                    "id": "site-a",
                    "label": "Site A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "site-b",
                    "label": "Site B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 250,
                },
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["overview"]["label"] == "Overview"
    assert payload["analytical"]["label"] == "Analytical"
    assert payload["overview"]["decision_class"] == "statistically_lower"
    assert "safe" not in payload["overview"]["summary_text"].lower()
    assert payload["overview"]["options"][0]["geometry_metadata"] == {
        "center": {"latitude": 47.6116, "longitude": -122.3372},
        "radius_m": 250,
    }
    assert payload["analytical"]["pairwise_results"][0]["adjusted_p_value"] < 0.05

    lookup = client.get(
        f"/internal/analysis/comparisons/{payload['id']}",
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )
    assert lookup.status_code == 200
    assert lookup.json()["id"] == payload["id"]
    assert lookup.json()["overview"]["options"][1]["geometry_metadata"] == {
        "center": {"latitude": 47.6205, "longitude": -122.3493},
        "radius_m": 250,
    }


def test_statistical_comparison_lookup_is_scoped_to_user(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-15",
            "options": [
                {
                    "id": "a",
                    "label": "A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "b",
                    "label": "B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 250,
                },
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )
    assert response.status_code == 200

    lookup = client.get(
        f"/internal/analysis/comparisons/{response.json()['id']}",
        headers={"X-Demo-User-Id": "other-user@example.com"},
    )

    assert lookup.status_code == 404


def test_route_comparison_api_returns_404_without_analysis_dates(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    user_id = "analysis-user@example.com"
    session = get_sessionmaker()()
    route_request = RouteRequest(
        id="route-without-analysis-dates",
        user_id_hash=hash_demo_user(user_id),
        origin_label="Origin",
        origin_latitude=47.6116,
        origin_longitude=-122.3372,
        destination_label="Destination",
        destination_latitude=47.6205,
        destination_longitude=-122.3493,
        mode="transit",
    )
    session.add(route_request)
    session.commit()
    route_request_id = route_request.id
    session.close()

    response = client.post(
        "/internal/analysis/routes/compare",
        json={
            "route_request_id": route_request_id,
            "radius_m": 250,
        },
        headers={"X-Demo-User-Id": user_id},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Route request not found or not analyzable"


def test_site_comparison_api_returns_400_for_reversed_dates(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-02-01",
            "analysis_end_date": "2024-01-01",
            "options": [
                {
                    "id": "a",
                    "label": "A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "b",
                    "label": "B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 250,
                },
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )

    assert response.status_code == 400
    assert "analysis_end_date" in response.json()["detail"]


def test_site_comparison_api_rejects_duplicate_option_ids(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "options": [
                {
                    "id": "duplicate",
                    "label": "A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "duplicate",
                    "label": "B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 250,
                },
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )

    assert response.status_code == 422
    assert "unique" in str(response.json()["detail"]).lower()


def test_site_comparison_api_rejects_mixed_option_radii(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "options": [
                {
                    "id": "a",
                    "label": "A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "b",
                    "label": "B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 500,
                },
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )

    assert response.status_code == 422
    assert "radius" in str(response.json()["detail"]).lower()
