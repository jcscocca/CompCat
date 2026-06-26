from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from app.exports.tableau import build_place_summary_csv
from app.main import create_app
from app.schemas import PlaceClusterData, PlaceCrimeSummaryData

FIXTURES = Path(__file__).parent / "fixtures"


def test_tableau_export_excludes_sensitive_clusters_by_default_and_uses_display_coordinates():
    normal = PlaceClusterData(
        id="normal-cluster",
        user_id_hash="user-hash",
        cluster_version="v1",
        cluster_method="pure_python_radius",
        centroid_latitude=47.609512,
        centroid_longitude=-122.333123,
        display_latitude=47.61,
        display_longitude=-122.333,
        cluster_radius_m=30,
        visit_count=3,
        total_dwell_minutes=90,
        median_dwell_minutes=30,
        display_label="Recurring area",
    )
    sensitive = PlaceClusterData(
        id="home-cluster",
        user_id_hash="user-hash",
        cluster_version="v1",
        cluster_method="pure_python_radius",
        centroid_latitude=47.650123,
        centroid_longitude=-122.350123,
        cluster_radius_m=20,
        visit_count=5,
        total_dwell_minutes=2400,
        median_dwell_minutes=480,
        sensitivity_class="home_candidate",
    )
    summary = PlaceCrimeSummaryData(
        id="summary-1",
        user_id_hash="user-hash",
        place_cluster_id="normal-cluster",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory="THEFT",
        nibrs_group="A",
        incident_count=2,
        nearest_incident_m=12.4,
        incidents_per_visit=0.6667,
        incidents_per_hour_dwell=1.3333,
    )

    csv_text = build_place_summary_csv([normal, sensitive], [summary], tableau_safe=True)

    assert "normal-cluster" in csv_text
    assert "home-cluster" not in csv_text
    assert "47.61" in csv_text
    assert "47.609512" not in csv_text
    assert "PROPERTY" in csv_text


def _data_rows(csv_text: str) -> list[str]:
    """Return non-comment, non-header lines from a CSV response."""
    lines = [r for r in csv_text.strip().splitlines() if r and not r.startswith("#")]
    return lines[1:]  # strip header row


def test_tableau_export_csv_scopes_to_latest_run_not_all_runs(tmp_path):
    """Two identical analyze runs must not double-count rows in the exported CSV.

    After a second run with the same params, the CSV must contain the same number
    of data rows as after the first run, not 2× (which read-all would produce).
    """
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "demo@example.com"}

    client.post(
        "/internal/imports",
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

    summarize_body = {
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }

    # First run
    client.post("/crime/summarize", headers=headers, json=summarize_body)
    first_rows = _data_rows(
        client.get("/internal/exports/tableau/place-summary.csv", headers=headers).text
    )

    # Second run — same params → old read-all would return 2× rows
    client.post("/crime/summarize", headers=headers, json=summarize_body)
    second_rows = _data_rows(
        client.get("/internal/exports/tableau/place-summary.csv", headers=headers).text
    )

    assert len(second_rows) == len(first_rows), (
        f"CSV row count doubled after second run: {len(second_rows)} != {len(first_rows)}"
    )


def test_tableau_export_accepts_direct_input_mode_clusters():
    cluster = PlaceClusterData(
        id="scenario-cluster",
        user_id_hash="user-hash",
        cluster_version="direct-1",
        cluster_method="direct_user_input",
        centroid_latitude=47.609,
        centroid_longitude=-122.333,
        display_latitude=47.609,
        display_longitude=-122.333,
        cluster_radius_m=100,
        visit_count=4,
        total_dwell_minutes=None,
        median_dwell_minutes=None,
        display_label="Downtown Seattle destination area",
    )

    csv_text = build_place_summary_csv([cluster], [], tableau_safe=True)

    assert "Downtown Seattle destination area" in csv_text
    assert "scenario-cluster" in csv_text
