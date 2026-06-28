import csv
from datetime import UTC, datetime
from io import StringIO

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_public_dashboard_flow_without_uploads(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", raising=False)
    monkeypatch.chdir(tmp_path)

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    session_response = client.post("/sessions")
    assert session_response.status_code == 200
    assert "mca_session" in session_response.cookies

    input_modes = client.get("/input-modes").json()["modes"]
    assert "personal_timeline" not in [mode["id"] for mode in input_modes]

    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="public-flow-incident",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        )
    )
    session.commit()
    session.close()

    create_response = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 12,
        },
    )
    assert create_response.status_code == 201
    place_id = create_response.json()["id"]

    analyze_response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )
    assert analyze_response.status_code == 200
    assert analyze_response.json()["summary_count"] == 1

    summary = client.get("/dashboard/summary").json()
    assert summary["totals"]["place_count"] == 1
    assert summary["totals"]["incident_count"] == 1

    export_response = client.get("/exports/tableau/place-summary.csv")
    assert export_response.status_code == 200
    rows = list(csv.DictReader(StringIO(export_response.text)))
    assert len(rows) == 1
    assert rows[0]["display_label"] == "Downtown transfer stop"
    assert rows[0]["radius_m"] == "250"
    assert rows[0]["analysis_start_date"] == "2024-01-01"
    assert rows[0]["analysis_end_date"] == "2024-01-31"
    assert rows[0]["offense_category"] == "PROPERTY"
    assert rows[0]["incident_count"] == "1"


def test_public_place_summary_export_excludes_sensitive_places(tmp_path):
    # End-to-end guard for the sensitivity control: a place created via the public POST
    # /places with a non-"normal" sensitivity_class (the wire the UI now uses) must be
    # absent from the public Tableau place-summary export.
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    normal = client.post(
        "/places",
        json={
            "display_label": "Public stop",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 5,
            "sensitivity_class": "normal",
        },
    )
    sensitive = client.post(
        "/places",
        json={
            "display_label": "My home",
            "latitude": 47.610,
            "longitude": -122.334,
            "visit_count": 5,
            "sensitivity_class": "home_candidate",
        },
    )
    assert normal.status_code == 201
    assert sensitive.status_code == 201

    analyze = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [normal.json()["id"], sensitive.json()["id"]],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert analyze.status_code == 200

    export_response = client.get("/exports/tableau/place-summary.csv")
    assert export_response.status_code == 200
    labels = [row["display_label"] for row in csv.DictReader(StringIO(export_response.text))]
    assert "Public stop" in labels
    assert "My home" not in labels
