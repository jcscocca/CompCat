from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_site_comparison_api_returns_overview_and_analytical_payload(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    session = get_sessionmaker()()
    # Spread both sites over six full monthly bins (Site A [2,2,1,1,1,1]=8, Site B
    # [5,5,5,5,4,4]=28) so the phi-noise t correction uses nu=5, not the near-degenerate nu=1 a
    # two-month range would give; the 8-vs-28 contrast still reads statistically lower under the
    # wider t_0.975 quantile.
    a_months = [1, 1, 2, 2, 3, 4, 5, 6]
    b_months = [m for m, n in zip(range(1, 7), (5, 5, 5, 5, 4, 4), strict=True) for _ in range(n)]

    def _incidents(prefix, months, latitude, longitude):
        day_by_month: dict[int, int] = {}
        rows = []
        for index, month in enumerate(months):
            day = day_by_month.get(month, 0) + 1
            day_by_month[month] = day
            rows.append(
                CrimeIncident(
                    id=f"{prefix}-{index}",
                    offense_start_utc=datetime(2024, month, day, tzinfo=UTC),
                    offense_category="PROPERTY",
                    latitude=latitude,
                    longitude=longitude,
                )
            )
        return rows

    session.add_all(
        _incidents("a", a_months, 47.6116, -122.3372)
        + _incidents("b", b_months, 47.6205, -122.3493)
    )
    session.commit()
    session.close()

    response = client.post(
        "/internal/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-06-30",
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
    options_by_id = {option["id"]: option for option in payload["overview"]["options"]}
    assert options_by_id["site-a"]["geometry_metadata"] == {
        "center": {"latitude": 47.6116, "longitude": -122.3372},
        "radius_m": 250,
    }
    assert payload["analytical"]["pairwise_results"][0]["adjusted_p_value"] < 0.05

    lookup = client.get(
        f"/internal/analysis/comparisons/{payload['id']}",
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )
    assert lookup.status_code == 200
    lookup_payload = lookup.json()
    assert lookup_payload["id"] == payload["id"]
    lookup_options_by_id = {
        option["id"]: option for option in lookup_payload["overview"]["options"]
    }
    assert lookup_options_by_id["site-b"]["geometry_metadata"] == {
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
