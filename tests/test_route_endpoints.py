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


_ANALYSIS = {"analysis_start_date": "2024-01-01", "analysis_end_date": "2024-01-31", "radii_m": [500]}


def _make_place(client, label, lat, lon):
    return client.post(
        "/places", json={"display_label": label, "latitude": lat, "longitude": lon, "visit_count": 1}
    ).json()


def test_route_between_saved_places(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    home = _make_place(client, "Home", 47.623, -122.321)
    office = _make_place(client, "Office", 47.609, -122.335)
    resp = client.post(
        "/routes/alternatives",
        json={"origin": {"place_id": home["id"]}, "destination": {"place_id": office["id"]},
              "mode": "transit", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["alternatives"]) >= 1
    assert body["request"]["origin"]["label"] == "Home"


def test_route_between_geocoded_coordinates(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin": {"latitude": 47.623, "longitude": -122.321, "label": "Cap Hill pin"},
              "destination": {"latitude": 47.609, "longitude": -122.335, "label": "Downtown pin"},
              "mode": "walk", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["request"]["origin"]["label"] == "Cap Hill pin"


def test_route_rejects_another_users_place(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'idor.sqlite3'}")
    owner = TestClient(app)
    owner.post("/sessions")
    place = _make_place(owner, "Home", 47.62, -122.33)
    intruder = TestClient(app)
    intruder.post("/sessions")
    resp = intruder.post(
        "/routes/alternatives",
        json={"origin": {"place_id": place["id"]},
              "destination": {"latitude": 47.61, "longitude": -122.34, "label": "Elsewhere"},
              "mode": "walk", **_ANALYSIS},
    )
    assert resp.status_code == 400
    assert "Unknown saved place" in resp.json()["detail"]


def test_route_still_accepts_legacy_labels(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["alternatives"]) >= 2


def test_public_route_ignores_client_provider_override(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    # Server default is mock. If the client's "otp" override were honored it would 400.
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", "provider": "otp", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["request"]["provider"] == "mock"


def test_invalid_departure_time_is_rejected(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", "departure_time": "8 oclock", **_ANALYSIS},
    )
    assert resp.status_code == 422


def test_valid_departure_time_is_accepted(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", "departure_time": "08:00", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text


def test_response_omits_precise_endpoint_coordinates(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    home = _make_place(client, "Home", 47.623, -122.321)
    office = _make_place(client, "Office", 47.609, -122.335)
    resp = client.post(
        "/routes/alternatives",
        json={"origin": {"place_id": home["id"]}, "destination": {"place_id": office["id"]},
              "mode": "transit", **_ANALYSIS},
    )
    origin = resp.json()["request"]["origin"]
    assert "latitude" not in origin and "longitude" not in origin
    assert "display_latitude" in origin
