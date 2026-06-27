from __future__ import annotations

import httpx
import pytest

from app.routing.opentripplanner_provider import OpenTripPlannerProvider, _polyline_to_geometry
from app.routing.providers import RoutingProviderError
from app.routing.schemas import RouteLocation, RouteRequestData

_SAMPLE_PLAN = {
    "plan": {
        "itineraries": [
            {
                "duration": 840, "walkDistance": 450.0, "transfers": 0,
                "legs": [
                    {"mode": "WALK", "distance": 250.0, "duration": 240, "transitLeg": False,
                     "from": {"name": "Origin", "lat": 47.6190, "lon": -122.3210},
                     "to": {"name": "Westlake", "lat": 47.6115, "lon": -122.3370},
                     "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC_mqNvxq`@"}},
                    {"mode": "TRAM", "distance": 1650.0, "duration": 420, "transitLeg": True,
                     "from": {"name": "Westlake", "lat": 47.6115, "lon": -122.3370},
                     "to": {"name": "Downtown", "lat": 47.6097, "lon": -122.3331},
                     "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC"}},
                ],
            }
        ]
    }
}


def _provider(handler) -> OpenTripPlannerProvider:
    return OpenTripPlannerProvider(
        "http://otp.example/otp/routers/default",
        transport=httpx.MockTransport(handler),
    )


def _request() -> RouteRequestData:
    return RouteRequestData(
        user_id_hash="u",
        origin=RouteLocation(label="Capitol Hill", latitude=47.6190, longitude=-122.3210),
        destination=RouteLocation(label="Downtown", latitude=47.6097, longitude=-122.3331),
        mode="transit",
    )


def test_decode_polyline_round_trips_known_value():
    geometry = _polyline_to_geometry("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    points = [tuple(round(float(v), 3) for v in p.split(",")) for p in geometry.split(";")]
    assert points == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]


def test_get_routes_maps_itinerary_and_legs():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/plan")
        assert request.url.params["fromPlace"] == "47.619,-122.321"
        assert request.url.params["mode"] == "TRANSIT,WALK"
        return httpx.Response(200, json=_SAMPLE_PLAN)

    alternatives = _provider(handler).get_routes(_request())
    assert len(alternatives) == 1
    alt = alternatives[0]
    assert alt.provider == "opentripplanner"
    assert alt.rank == 1
    assert alt.duration_minutes == 14.0
    assert alt.distance_m == 1900.0
    assert alt.walking_distance_m == 450.0
    assert alt.mode_mix == "walk,tram"
    assert [s.segment_type for s in alt.segments] == ["access", "ride"]
    assert alt.segments[0].mode == "walk"
    assert alt.segments[0].geometry  # decoded "lat,lon;..."


def test_get_routes_wraps_transport_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())


def test_get_routes_wraps_bad_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": True})

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())
