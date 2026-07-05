from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from app.api.dashboard_schemas import DashboardIncidentPointsRequest, MapBounds


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
