from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def test_demo_api_flow_upload_normalize_crime_summarize_and_export(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "demo@example.com"}

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    upload = client.post(
        "/imports",
        headers=headers,
        files={
            "file": (
                "timeline.json",
                (FIXTURES / "google_recurring.json").read_bytes(),
                "application/json",
            )
        },
    )
    assert upload.status_code == 200
    import_id = upload.json()["id"]
    assert upload.json()["status"] == "parsed"
    assert upload.json()["source_stop_count"] == 3

    normalize = client.post(f"/imports/{import_id}/normalize", headers=headers)
    assert normalize.status_code == 200
    assert normalize.json()["stop_visit_count"] == 3
    assert normalize.json()["place_cluster_count"] == 1

    places = client.get("/internal/places", headers=headers)
    assert places.status_code == 200
    assert places.json()["count"] == 1
    assert places.json()["places"][0]["display_label"] == "Recurring Cafe"

    ingest = client.post("/crime/ingest/sample")
    assert ingest.status_code == 200
    assert ingest.json()["inserted_count"] == 3

    summarize = client.post(
        "/crime/summarize",
        headers=headers,
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )
    assert summarize.status_code == 200
    assert summarize.json()["summary_count"] >= 1

    export = client.get("/internal/exports/tableau/place-summary.csv", headers=headers)
    assert export.status_code == 200
    assert "Recurring Cafe" in export.text
    assert "PROPERTY" in export.text
    assert "home_candidate" not in export.text
