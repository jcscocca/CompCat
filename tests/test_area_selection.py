from __future__ import annotations

import csv
from datetime import UTC, date, datetime
from io import StringIO

from fastapi.testclient import TestClient

from app.api.dashboard_schemas import AreaSelectionRecordsRequest, AreaSelectionRequest
from app.db import configure_database, get_sessionmaker, init_db
from app.main import create_app
from app.models import CrimeIncident
from app.services.area_selection_service import (
    area_selection_csv_rows,
    area_selection_records,
    area_selection_summary,
)

TRIANGLE = {
    "type": "Polygon",
    "coordinates": [[
        [-122.35, 47.60],
        [-122.31, 47.60],
        [-122.35, 47.64],
        [-122.35, 47.60],
    ]],
}


def _scope(**over):
    payload = {
        "geometry": TRIANGLE,
        "analysis_start_date": date(2025, 1, 1),
        "analysis_end_date": date(2025, 12, 31),
        "layer": "reported",
    }
    payload.update(over)
    return payload


def _session(tmp_path):
    configure_database(f"sqlite+pysqlite:///{tmp_path / 'area.sqlite3'}")
    init_db()
    return get_sessionmaker()()


def _incident(number: int, **over) -> CrimeIncident:
    fields = {
        "id": f"area-{number}",
        "external_incident_id": f"external-{number}",
        "report_number": f"R-{number}",
        "offense_start_utc": datetime(2025, 6, number, 10 + number, tzinfo=UTC),
        "offense_category": "PROPERTY",
        "offense_subcategory": "THEFT",
        "block_address": f"{number}XX BLOCK OF PINE ST",
        "latitude": 47.61,
        "longitude": -122.33,
        "source_dataset": "seattle_spd_crime",
    }
    fields.update(over)
    return CrimeIncident(**fields)


def test_polygon_summary_uses_exact_membership_and_complete_aggregates(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all([
        _incident(1),
        _incident(2, offense_subcategory="BURGLARY"),
        # On the polygon edge: boundary-inclusive membership.
        _incident(3, longitude=-122.35, latitude=47.61),
        # Inside the bounding box but outside the triangle.
        _incident(4, longitude=-122.315, latitude=47.635),
        # Same polygon, wrong layer.
        _incident(5, source_dataset="seattle_spd_arrests"),
        # Included through report time but disclosed as lacking primary/offense time.
        _incident(
            6,
            offense_start_utc=None,
            report_utc=datetime(2025, 7, 7, 9, tzinfo=UTC),
            offense_category=None,
            offense_subcategory=None,
        ),
    ])
    session.commit()

    result = area_selection_summary(session, AreaSelectionRequest(**_scope()))

    assert result["record_count"] == 4
    assert result["location_count"] == 2
    assert result["highlight_mode"] == "locations"
    assert sum(point["record_count"] for point in result["highlight_points"]) == 4
    assert result["temporal"]["total_with_time"] == 3
    assert result["temporal"]["without_time"] == 1
    assert sum(result["temporal"]["hour_counts"]) == 3
    assert result["type_mix"] == [
        {"label": "THEFT", "count": 2, "share": 0.5},
        {"label": "BURGLARY", "count": 1, "share": 0.25},
        {"label": "Uncategorized", "count": 1, "share": 0.25},
    ]
    assert result["type_counts"] == {
        "BURGLARY": 1,
        "THEFT": 2,
        "Uncategorized": 1,
    }
    session.close()


def test_records_use_scope_bound_cursor_pagination(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all([_incident(number) for number in range(1, 5)])
    session.commit()

    first_request = AreaSelectionRecordsRequest(**_scope(page_size=2))
    first = area_selection_records(session, first_request)
    assert [row["incident_id"] for row in first["records"]] == ["area-4", "area-3"]
    assert first["next_cursor"]

    second = area_selection_records(
        session,
        AreaSelectionRecordsRequest(
            **_scope(page_size=2, cursor=first["next_cursor"])
        ),
    )
    assert [row["incident_id"] for row in second["records"]] == ["area-2", "area-1"]
    assert second["next_cursor"] is None
    session.close()


def test_linked_cross_filters_or_within_dimensions_and_and_across_them(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all([
        _incident(1),  # Sunday 11:00, THEFT
        _incident(2, offense_subcategory="BURGLARY"),  # Monday 12:00
        _incident(3),  # Tuesday 13:00, excluded by hour
        _incident(4, offense_subcategory="ASSAULT"),  # excluded by type
    ])
    session.commit()
    filters = {
        "selected_types": ["THEFT", "BURGLARY"],
        "selected_hours": [11, 12, 14],
        "selected_days": [6, 0, 2],
    }

    result = area_selection_summary(
        session,
        AreaSelectionRequest(**_scope(**filters)),
    )
    assert result["record_count"] == 2
    assert [row["label"] for row in result["type_mix"]] == ["BURGLARY", "THEFT"]
    assert result["type_counts"] == {"BURGLARY": 1, "THEFT": 1}
    assert result["temporal"]["hour_counts"][11:13] == [1, 1]

    page = area_selection_records(
        session,
        AreaSelectionRecordsRequest(**_scope(page_size=25, **filters)),
    )
    assert [row["incident_id"] for row in page["records"]] == ["area-2", "area-1"]

    content = "".join(
        area_selection_csv_rows(session, AreaSelectionRequest(**_scope(**filters)))
    )
    rows = list(csv.DictReader(StringIO(content)))
    assert [row["incident_id"] for row in rows] == ["area-2", "area-1"]
    assert rows[0]["selected_type_filters"] == '["THEFT", "BURGLARY"]'
    assert rows[0]["selected_hour_filters"] == "[11, 12, 14]"
    assert rows[0]["selected_day_filters"] == "[6, 0, 2]"
    session.close()


def test_summary_keeps_exact_type_counts_for_buckets_folded_into_other(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all([
        _incident(number, offense_subcategory=f"TYPE_{number:02d}")
        for number in range(1, 14)
    ])
    session.commit()

    result = area_selection_summary(session, AreaSelectionRequest(**_scope()))

    assert len(result["type_mix"]) == 12
    assert result["type_mix"][-1] == {"label": "Other", "count": 2, "share": 2 / 13}
    assert result["type_counts"] == {
        f"TYPE_{number:02d}": 1 for number in range(1, 14)
    }
    session.close()


def test_csv_exports_all_rows_and_neutralizes_spreadsheet_formulas(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all([
        _incident(1, block_address='=HYPERLINK("bad")'),
        _incident(2),
        _incident(3),
    ])
    session.commit()

    content = "".join(area_selection_csv_rows(session, AreaSelectionRequest(**_scope())))
    rows = list(csv.DictReader(StringIO(content)))
    assert len(rows) == 3
    assert rows[-1]["block_address"] == '\'=HYPERLINK("bad")'
    assert {row["selection_id"] for row in rows} == {
        area_selection_summary(session, AreaSelectionRequest(**_scope()))["selection_id"]
    }
    session.close()


def test_public_area_endpoints_require_session_and_stream_export(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'area-api.sqlite3'}"
    app = create_app(database_url)
    client = TestClient(app)
    session = get_sessionmaker()()
    session.add(_incident(1))
    session.commit()
    session.close()
    payload = {
        **_scope(),
        "analysis_start_date": "2025-01-01",
        "analysis_end_date": "2025-12-31",
    }

    assert client.post("/dashboard/area-selection/summary", json=payload).status_code == 401
    client.post("/sessions")
    summary = client.post("/dashboard/area-selection/summary", json=payload)
    assert summary.status_code == 200
    assert summary.json()["record_count"] == 1
    page = client.post(
        "/dashboard/area-selection/records",
        json={**payload, "page_size": 25},
    )
    assert page.status_code == 200
    assert page.json()["records"][0]["incident_id"] == "area-1"
    export = client.post("/exports/area-selection.csv", json=payload)
    assert export.status_code == 200
    assert export.headers["content-disposition"] == (
        'attachment; filename="compcat-area-selection.csv"'
    )
    assert "area-1" in export.text


def test_self_crossing_polygon_is_rejected(tmp_path) -> None:
    session = _session(tmp_path)
    crossing = {
        "type": "Polygon",
        "coordinates": [[
            [-122.35, 47.60],
            [-122.31, 47.64],
            [-122.31, 47.60],
            [-122.35, 47.64],
            [-122.35, 47.60],
        ]],
    }
    request = AreaSelectionRequest(**_scope(geometry=crossing))

    try:
        area_selection_summary(session, request)
    except ValueError as exc:
        assert "crosses itself" in str(exc)
    else:  # pragma: no cover - makes a regression failure explicit
        raise AssertionError("self-crossing polygon was accepted")
    session.close()
