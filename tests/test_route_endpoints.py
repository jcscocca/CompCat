from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.routing.schemas import RouteEndpoint


def _client(tmp_path):
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'm.sqlite3'}"))


def test_route_endpoint_requires_a_source():
    with pytest.raises(ValidationError):
        RouteEndpoint()


def test_route_endpoint_rejects_both_sources():
    with pytest.raises(ValidationError):
        RouteEndpoint(place_id="p1", latitude=47.6, longitude=-122.3)


def test_route_endpoint_requires_both_coordinates():
    with pytest.raises(ValidationError):
        RouteEndpoint(latitude=47.6)


def test_route_endpoint_accepts_place_id():
    assert RouteEndpoint(place_id="p1").place_id == "p1"


def test_route_endpoint_accepts_coordinates():
    endpoint = RouteEndpoint(latitude=47.6, longitude=-122.3, label="Pin")
    assert (endpoint.latitude, endpoint.longitude, endpoint.label) == (47.6, -122.3, "Pin")
