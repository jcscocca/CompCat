import csv
from datetime import UTC, datetime
from io import StringIO

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.services.analysis_runs import latest_analysis_run_id
from app.sessions import public_user_hash


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


def test_export_scopes_to_requested_run(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_hash is not None

    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="run-scope-incident",
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
            "display_label": "Run-scoped stop",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 12,
        },
    )
    assert create_response.status_code == 201
    place_id = create_response.json()["id"]

    # Older run: no category filter, so the PROPERTY incident is counted.
    older_analyze = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )
    assert older_analyze.status_code == 200
    with get_sessionmaker()() as query_session:
        older_run_id = latest_analysis_run_id(query_session, user_hash)
    assert older_run_id is not None

    # Newer run: filtered to a category the incident doesn't have, so it drops out.
    newer_analyze = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PERSON",
        },
    )
    assert newer_analyze.status_code == 200
    with get_sessionmaker()() as query_session:
        newer_run_id = latest_analysis_run_id(query_session, user_hash)
    assert newer_run_id is not None
    assert newer_run_id != older_run_id

    older_response = client.get(f"/exports/tableau/place-summary.csv?run_id={older_run_id}")
    assert older_response.status_code == 200
    assert older_response.headers["content-type"].startswith("text/csv")
    older_rows = list(csv.DictReader(StringIO(older_response.text)))
    assert older_rows[0]["incident_count"] == "1"

    newer_response = client.get(f"/exports/tableau/place-summary.csv?run_id={newer_run_id}")
    assert newer_response.status_code == 200
    newer_rows = list(csv.DictReader(StringIO(newer_response.text)))
    # The PERSON-filtered run has no matching incidents, so no PlaceCrimeSummary row was
    # persisted for it — the export shows the place with a blank incident_count, distinct
    # from the older run's "1", confirming the export is scoped to the requested run.
    assert newer_rows[0]["incident_count"] == ""


def test_export_rejects_foreign_or_unknown_run(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    owner = TestClient(app)
    owner.post("/sessions")

    unknown_response = owner.get("/exports/tableau/place-summary.csv?run_id=not-a-real-run")
    assert unknown_response.status_code == 404

    stranger = TestClient(app)
    stranger.post("/sessions")
    stranger_user_hash = public_user_hash(stranger.cookies.get("mca_session"))
    assert stranger_user_hash is not None

    place_response = stranger.post(
        "/places",
        json={
            "display_label": "Stranger's stop",
            "latitude": 47.612,
            "longitude": -122.335,
            "visit_count": 4,
        },
    )
    assert place_response.status_code == 201
    place_id = place_response.json()["id"]

    stranger_analyze = stranger.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )
    assert stranger_analyze.status_code == 200
    with get_sessionmaker()() as query_session:
        stranger_run_id = latest_analysis_run_id(query_session, stranger_user_hash)
    assert stranger_run_id is not None

    foreign_response = owner.get(f"/exports/tableau/place-summary.csv?run_id={stranger_run_id}")
    assert foreign_response.status_code == 404


def test_export_without_run_id_unchanged(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    response = client.get("/exports/tableau/place-summary.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")


def test_analysis_export_uses_current_detail_fields_and_selected_places(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_hash is not None

    selected = client.post(
        "/places",
        json={
            "display_label": "Selected zero-count place",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 12,
        },
    )
    unselected = client.post(
        "/places",
        json={
            "display_label": "Unselected place",
            "latitude": 47.61,
            "longitude": -122.334,
            "visit_count": 99,
        },
    )
    assert selected.status_code == 201
    assert unselected.status_code == 201

    analyze = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [selected.json()["id"]],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
            "layer": "reported",
        },
    )
    assert analyze.status_code == 200
    with get_sessionmaker()() as query_session:
        run_id = latest_analysis_run_id(query_session, user_hash)
    assert run_id is not None

    response = client.get(f"/exports/analysis.csv?run_id={run_id}")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="compcat-analysis.csv"'
    )
    reader = csv.DictReader(StringIO(response.text))
    rows = list(reader)
    assert {row["place_label"] for row in rows} == {"Selected zero-count place"}
    assert {row["reference_geography_level"] for row in rows} == {
        "mcpp",
        "sector",
        "city",
    }
    assert all(row["target_incident_count"] == "0" for row in rows)
    assert all(row["reference_method"] == "empirical_reference_circles" for row in rows)
    assert all(row["layer"] == "reported" for row in rows)
    assert all(row["analysis_start_date"] == "2024-01-01" for row in rows)
    assert all(row["analysis_end_date"] == "2024-01-31" for row in rows)
    assert all(row["offense_category"] == "PROPERTY" for row in rows)
    assert not any(
        forbidden in column
        for column in (reader.fieldnames or [])
        for forbidden in ("visit", "dwell", "rate_ratio", "adjusted_p")
    )


def test_analysis_export_respects_export_privacy_and_run_ownership(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    owner = TestClient(app)
    owner.post("/sessions")
    owner_hash = public_user_hash(owner.cookies.get("mca_session"))
    assert owner_hash is not None

    included = owner.post(
        "/places",
        json={
            "display_label": "Included place",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 1,
            "sensitivity_class": "normal",
        },
    )
    hidden = owner.post(
        "/places",
        json={
            "display_label": "Hidden place",
            "latitude": 47.61,
            "longitude": -122.334,
            "visit_count": 1,
            "sensitivity_class": "suppress_from_public_export",
        },
    )
    assert included.status_code == 201
    assert hidden.status_code == 201
    analyze = owner.post(
        "/dashboard/analyze",
        json={
            "place_ids": [included.json()["id"], hidden.json()["id"]],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
    )
    assert analyze.status_code == 200
    with get_sessionmaker()() as query_session:
        run_id = latest_analysis_run_id(query_session, owner_hash)
    assert run_id is not None

    response = owner.get(f"/exports/analysis.csv?run_id={run_id}")
    labels = {
        row["place_label"] for row in csv.DictReader(StringIO(response.text))
    }
    assert labels == {"Included place"}

    stranger = TestClient(app)
    stranger.post("/sessions")
    assert stranger.get(f"/exports/analysis.csv?run_id={run_id}").status_code == 404
    assert (
        owner.get("/exports/analysis.csv?run_id=not-a-real-run").status_code == 404
    )
