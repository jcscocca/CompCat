from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.dashboard_schemas import DashboardIncidentPointsRequest, MapBounds
from app.db import configure_database, get_sessionmaker, init_db
from app.main import create_app
from app.models import CrimeIncident
from app.services.incident_points_service import INCIDENT_POINTS_LIMIT, incident_points


def _payload(**over):
    base = {
        "bounds": {"west": -122.40, "south": 47.55, "east": -122.25, "north": 47.65},
        "analysis_start_date": date(2025, 1, 1),
        "analysis_end_date": date(2025, 10, 31),
    }
    base.update(over)
    return base


def test_valid_request_defaults_to_reported_layer() -> None:
    request = DashboardIncidentPointsRequest(**_payload())
    assert request.layer == "reported"
    assert request.offense_category is None


def test_inverted_bbox_rejected() -> None:
    with pytest.raises(ValidationError, match="empty or inverted"):
        MapBounds(west=-122.25, south=47.55, east=-122.40, north=47.65)


def test_bbox_outside_seattle_rejected() -> None:
    with pytest.raises(ValidationError, match="outside the Seattle area"):
        MapBounds(west=-71.10, south=42.30, east=-71.00, north=42.40)  # Boston


def test_bbox_overlapping_seattle_accepted_and_wider_than_city_ok() -> None:
    bounds = MapBounds(west=-123.0, south=47.0, east=-122.0, north=48.0)
    assert bounds.west == -123.0


def test_unknown_layer_rejected() -> None:
    with pytest.raises(ValidationError, match="layer must be one of"):
        DashboardIncidentPointsRequest(**_payload(layer="everything"))


def _session(tmp_path):
    configure_database(f"sqlite+pysqlite:///{tmp_path / 'points.sqlite3'}")
    init_db()
    return get_sessionmaker()()


def _incident(i: int, **over) -> CrimeIncident:
    fields = {
        "id": f"inc-{i}",
        "external_incident_id": f"ext-{i}",
        "offense_start_utc": datetime(2025, 6, 1, 12, 0, tzinfo=UTC),
        "offense_category": "PROPERTY",
        "offense_subcategory": "THEFT",
        "block_address": f"{i}XX BLOCK OF PINE ST",
        "latitude": 47.610,
        "longitude": -122.330,
        "source_dataset": "seattle_spd_crime",
    }
    fields.update(over)
    return CrimeIncident(**fields)


BOUNDS = {"west": -122.40, "south": 47.55, "east": -122.25, "north": 47.65}
DATES = {"analysis_start_date": date(2025, 1, 1), "analysis_end_date": date(2025, 10, 31)}


def test_points_filtered_by_bbox_dates_and_layer(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all(
        [
            _incident(1),  # in bbox, in range, reported → returned
            _incident(2, latitude=47.70, longitude=-122.33),  # north of bbox → out
            _incident(3, offense_start_utc=datetime(2024, 1, 1, tzinfo=UTC)),  # out of range
            _incident(4, source_dataset="seattle_spd_arrests"),  # wrong layer
            _incident(5, latitude=None, longitude=None),  # redacted → unmappable
        ]
    )
    session.commit()
    result = incident_points(session, bounds=MapBounds(**BOUNDS), layer="reported", **DATES)
    assert result["returned_count"] == 1
    assert result["total_count"] == 1
    assert result["unmappable_citywide_count"] == 1
    point = result["points"][0]
    assert point["id"] == "inc-1"
    assert point["latitude"] == 47.610
    assert point["block_address"] == "1XX BLOCK OF PINE ST"
    assert point["occurred_at"].endswith("Z")
    session.close()


def test_arrest_sentinel_never_appears_even_with_huge_bbox(tmp_path) -> None:
    # Arrests with unknown location use -1.0/-1.0; the Seattle clamp excludes them
    # structurally. Pin the behavior so a future bbox change can't regress it.
    session = _session(tmp_path)
    session.add_all(
        [
            _incident(1, source_dataset="seattle_spd_arrests"),
            _incident(2, source_dataset="seattle_spd_arrests", latitude=-1.0, longitude=-1.0),
        ]
    )
    session.commit()
    result = incident_points(
        session,
        bounds=MapBounds(west=-123.0, south=47.0, east=-122.0, north=48.0),
        layer="arrests",
        **DATES,
    )
    assert result["returned_count"] == 1
    assert result["points"][0]["id"] == "inc-1"
    session.close()


def test_cap_returns_most_recent_and_signals_truncation(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all(
        [
            _incident(i, offense_start_utc=datetime(2025, 6, 1 + i, 12, 0, tzinfo=UTC))
            for i in range(4)
        ]
    )
    session.commit()
    result = incident_points(
        session, bounds=MapBounds(**BOUNDS), layer="reported", limit=2, **DATES
    )
    assert result["returned_count"] == 2
    assert result["total_count"] == 4
    assert result["limit"] == 2
    # Most recent first
    assert [p["id"] for p in result["points"]] == ["inc-3", "inc-2"]
    session.close()


def test_reversed_dates_raise_value_error(tmp_path) -> None:
    # AMENDMENT 1: mirror the sibling endpoints — reversed dates must 400 at the route,
    # which means ValueError here, not a silent empty result.
    session = _session(tmp_path)
    with pytest.raises(ValueError, match="analysis_start_date"):
        incident_points(
            session,
            bounds=MapBounds(**BOUNDS),
            layer="reported",
            analysis_start_date=date(2025, 10, 31),
            analysis_end_date=date(2025, 1, 1),
        )
    session.close()


def test_default_limit_is_5000() -> None:
    assert INCIDENT_POINTS_LIMIT == 5000


def _client_with_incidents(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'api.sqlite3'}")
    client = TestClient(app)
    session = get_sessionmaker()()
    session.add_all([_incident(1), _incident(2, latitude=None, longitude=None)])
    session.commit()
    session.close()
    return client


_API_PAYLOAD = {
    "bounds": BOUNDS,
    "analysis_start_date": "2025-01-01",
    "analysis_end_date": "2025-10-31",
    "layer": "reported",
}


def test_incident_points_requires_session(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    assert client.post("/dashboard/incident-points", json=_API_PAYLOAD).status_code == 401


def test_incident_points_endpoint_returns_points_and_counts(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    client.post("/sessions")
    response = client.post("/dashboard/incident-points", json=_API_PAYLOAD)
    assert response.status_code == 200
    body = response.json()
    assert body["returned_count"] == 1
    assert body["unmappable_citywide_count"] == 1
    assert body["limit"] == 5000
    assert body["points"][0]["block_address"] == "1XX BLOCK OF PINE ST"


def test_incident_points_rejects_non_seattle_bbox_as_422(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    client.post("/sessions")
    boston = {"west": -71.1, "south": 42.3, "east": -71.0, "north": 42.4}
    payload = dict(_API_PAYLOAD, bounds=boston)
    response = client.post("/dashboard/incident-points", json=payload)
    assert response.status_code == 422
    assert "outside the Seattle area" in response.text


def test_incident_points_reversed_dates_are_400(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    client.post("/sessions")
    payload = dict(_API_PAYLOAD, analysis_start_date="2025-10-31", analysis_end_date="2025-01-01")
    response = client.post("/dashboard/incident-points", json=payload)
    assert response.status_code == 400
    assert "analysis_start_date" in response.text
