import csv
from io import StringIO

from fastapi.testclient import TestClient

from app.main import create_app
from app.sessions import public_user_hash


def test_route_tableau_exports_include_route_alternatives_segments_and_context(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    other_client = TestClient(app)
    client.post("/sessions")
    other_client.post("/sessions")
    user_id_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_id_hash is not None

    ingest = client.post("/crime/ingest/sample")
    assert ingest.status_code == 200

    route_response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
    )
    assert route_response.status_code == 200
    route_payload = route_response.json()
    request_id = route_payload["request"]["id"]
    first_alternative_id = route_payload["alternatives"][0]["id"]

    other_route_response = other_client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Ballard",
            "destination_label": "University District",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
    )
    assert other_route_response.status_code == 200
    other_route_payload = other_route_response.json()
    other_request_id = other_route_payload["request"]["id"]
    other_alternative_id = other_route_payload["alternatives"][0]["id"]

    alternatives = client.get("/exports/tableau/route-alternatives.csv")
    assert alternatives.status_code == 200
    assert alternatives.headers["content-type"].startswith("text/csv")
    assert (
        alternatives.headers["content-disposition"]
        == "attachment; filename=route-alternatives.csv"
    )
    alternative_rows = _csv_rows(alternatives.text)
    assert alternative_rows[0].keys() == {
        "user_id_hash",
        "route_request_id",
        "route_alternative_id",
        "provider_route_id",
        "route_label",
        "rank",
        "duration_minutes",
        "distance_m",
        "transfer_count",
        "walking_distance_m",
        "mode_mix",
        "provider",
        "analysis_start_date",
        "analysis_end_date",
        "radii_m",
        "created_at",
    }
    assert {
        (row["route_request_id"], row["route_label"], row["rank"], row["provider"])
        for row in alternative_rows
    } >= {(request_id, "Link light rail via Westlake", "1", "mock")}
    assert all(row["user_id_hash"] == user_id_hash for row in alternative_rows)
    assert all(row["analysis_start_date"] == "2024-01-01" for row in alternative_rows)
    assert all(row["analysis_end_date"] == "2024-01-31" for row in alternative_rows)
    assert all(row["radii_m"] == "500" for row in alternative_rows)
    assert [row["route_label"] for row in alternative_rows] == [
        "Link light rail via Westlake",
        "Pine Street bus to downtown",
    ]
    assert other_request_id not in {row["route_request_id"] for row in alternative_rows}
    assert other_alternative_id not in {
        row["route_alternative_id"] for row in alternative_rows
    }
    assert "Direct transit route" not in {row["route_label"] for row in alternative_rows}

    segments = client.get("/exports/tableau/route-segments.csv")
    assert segments.status_code == 200
    assert segments.headers["content-type"].startswith("text/csv")
    assert (
        segments.headers["content-disposition"] == "attachment; filename=route-segments.csv"
    )
    segment_rows = _csv_rows(segments.text)
    assert segment_rows[0].keys() == {
        "user_id_hash",
        "route_alternative_id",
        "route_segment_id",
        "sequence",
        "segment_type",
        "mode",
        "start_label",
        "start_latitude",
        "start_longitude",
        "end_label",
        "end_latitude",
        "end_longitude",
        "distance_m",
        "duration_minutes",
        "created_at",
    }
    assert {
        (row["route_alternative_id"], row["sequence"], row["start_label"], row["end_label"])
        for row in segment_rows
    } >= {(first_alternative_id, "2", "Capitol Hill", "Westlake Station")}
    assert all(row["user_id_hash"] == user_id_hash for row in segment_rows)
    assert [
        (row["sequence"], row["segment_type"], row["start_label"], row["end_label"])
        for row in segment_rows
    ] == [
        ("1", "access", "Capitol Hill", "Capitol Hill"),
        ("2", "ride", "Capitol Hill", "Westlake Station"),
        ("3", "egress", "Westlake Station", "Downtown Seattle"),
        ("1", "access", "Capitol Hill", "Capitol Hill"),
        ("2", "ride", "Capitol Hill", "Downtown Seattle"),
    ]
    assert "Ballard" not in {row["start_label"] for row in segment_rows}
    assert "University District" not in {row["end_label"] for row in segment_rows}
    assert other_alternative_id not in {row["route_alternative_id"] for row in segment_rows}

    context = client.get("/exports/tableau/route-context.csv")
    assert context.status_code == 200
    assert context.headers["content-type"].startswith("text/csv")
    assert context.headers["content-disposition"] == "attachment; filename=route-context.csv"
    context_rows = _csv_rows(context.text)
    assert context_rows[0].keys() == {
        "user_id_hash",
        "route_alternative_id",
        "route_segment_id",
        "context_label",
        "context_type",
        "radius_m",
        "analysis_start_date",
        "analysis_end_date",
        "offense_category",
        "offense_subcategory",
        "nibrs_group",
        "incident_count",
        "nearest_incident_m",
        "incidents_per_route",
        "created_at",
    }
    assert {
        (
            row["context_label"],
            row["context_type"],
            row["radius_m"],
            row["analysis_start_date"],
            row["analysis_end_date"],
            row["offense_category"],
            row["offense_subcategory"],
            row["incident_count"],
        )
        for row in context_rows
    } >= {
        (
            "Westlake Station",
            "route_point",
            "500",
            "2024-01-01",
            "2024-01-31",
            "PROPERTY",
            "LARCENY",
            "1",
        )
    }
    assert all(row["user_id_hash"] == user_id_hash for row in context_rows)
    assert context_rows == sorted(
        context_rows,
        key=lambda row: (
            row["route_alternative_id"] != first_alternative_id,
            int(row["radius_m"]),
            row["context_label"],
            row["context_type"],
            row["offense_category"],
            row["offense_subcategory"],
            row["nibrs_group"],
        ),
    )
    assert "Ballard" not in {row["context_label"] for row in context_rows}
    assert "University District" not in {row["context_label"] for row in context_rows}
    assert other_alternative_id not in {row["route_alternative_id"] for row in context_rows}


def _csv_rows(csv_text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(StringIO(csv_text)))
