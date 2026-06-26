from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def _run_summarize(client, headers, radii=None):
    client.post(
        "/crime/summarize",
        headers=headers,
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": radii or [250],
        },
    )


def test_dashboard_summary_scopes_to_latest_run_not_all_runs(tmp_path):
    """Two analyze runs with the same params must not double-count summaries.

    After a second identical run, the dashboard must return the same row count and
    incident total as after the first run — not 2× (which is what a read-all produces).
    """
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

    # First run
    _run_summarize(client, headers, radii=[250])
    first_payload = client.get("/internal/dashboard/summary", headers=headers).json()
    first_count = first_payload["totals"]["incident_count"]
    first_summaries = len(first_payload["crime_summaries"])

    # Second run — same params → same analysis_run_id-tagged rows in DB (doubled total rows)
    _run_summarize(client, headers, radii=[250])
    second_response = client.get("/internal/dashboard/summary", headers=headers)
    second_payload = second_response.json()

    assert second_response.status_code == 200
    second_count = second_payload["totals"]["incident_count"]
    second_summaries = len(second_payload["crime_summaries"])

    # Old read-all behaviour would return 2× rows and 2× incident_count.
    # Latest-run scoping must return exactly the same as after the first run.
    assert second_count == first_count, (
        f"incident_count doubled after second run: {second_count} != {first_count}"
    )
    assert second_summaries == first_summaries, (
        f"crime_summaries doubled after second run: {second_summaries} != {first_summaries}"
    )


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
