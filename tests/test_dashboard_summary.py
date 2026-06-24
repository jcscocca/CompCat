from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def test_dashboard_summary_returns_places_totals_privacy_and_exports(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "demo@example.com"}

    client.post(
        "/imports",
        headers=headers,
        files={
            "file": (
                "recurring_places.csv",
                (FIXTURES / "recurring_places.csv").read_bytes(),
                "text/csv",
            )
        },
    )
    client.post("/crime/ingest/sample")
    client.post(
        "/crime/summarize",
        headers=headers,
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )

    response = client.get("/internal/dashboard/summary", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["totals"]["place_count"] == 2
    assert payload["privacy"]["normal"] == 2
    assert payload["exports"]["tableau_place_summary_csv"].endswith(
        "/exports/tableau/place-summary.csv"
    )
    assert payload["places"][0]["display_label"]
