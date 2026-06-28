from __future__ import annotations

import json

import httpx
import pytest

from app.routing.opentripplanner_provider import OpenTripPlannerProvider, _polyline_to_geometry
from app.routing.providers import RoutingProviderError
from app.routing.schemas import RouteLocation, RouteRequestData

# Shape of an OTP2 GTFS GraphQL `plan` response (the `data` envelope), trimmed to the fields
# the provider reads. transfer_count is derived from transit legs, so no `transfers` field is
# needed; `route` is an object (shortName/longName), not a string as in the OTP1 REST API.
_SAMPLE_RESPONSE = {
    "data": {
        "plan": {
            "itineraries": [
                {
                    "duration": 840,
                    "walkDistance": 450.0,
                    "legs": [
                        {
                            "mode": "WALK",
                            "distance": 250.0,
                            "duration": 240,
                            "transitLeg": False,
                            "route": None,
                            "from": {"name": "Origin", "lat": 47.6190, "lon": -122.3210},
                            "to": {"name": "Westlake", "lat": 47.6115, "lon": -122.3370},
                            "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC_mqNvxq`@"},
                        },
                        {
                            "mode": "TRAM",
                            "distance": 1650.0,
                            "duration": 420,
                            "transitLeg": True,
                            "route": {"shortName": "1 Line", "longName": "Link Light Rail"},
                            "from": {"name": "Westlake", "lat": 47.6115, "lon": -122.3370},
                            "to": {"name": "Downtown", "lat": 47.6097, "lon": -122.3331},
                            "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC"},
                        },
                    ],
                }
            ]
        }
    }
}


def _provider(handler) -> OpenTripPlannerProvider:
    return OpenTripPlannerProvider(
        "http://otp.example/otp/gtfs/v1",
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


def test_get_routes_posts_graphql_and_maps_itinerary():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "http://otp.example/otp/gtfs/v1"
        captured["query"] = json.loads(request.content)["query"]
        return httpx.Response(200, json=_SAMPLE_RESPONSE)

    alternatives = _provider(handler).get_routes(_request())

    # The GraphQL query carries the plan args: coordinates and transit modes.
    query = captured["query"]
    assert "plan(" in query
    assert "lat: 47.619" in query and "lon: -122.321" in query
    assert "{mode: TRANSIT}" in query and "{mode: WALK}" in query

    assert len(alternatives) == 1
    alt = alternatives[0]
    assert alt.provider == "opentripplanner"
    assert alt.rank == 1
    assert alt.route_label == "1 Line via OpenTripPlanner"
    assert alt.duration_minutes == 14.0
    assert alt.distance_m == 1900.0
    assert alt.walking_distance_m == 450.0
    assert alt.transfer_count == 0  # one transit leg -> zero transfers
    assert alt.mode_mix == "walk,tram"
    assert [s.segment_type for s in alt.segments] == ["access", "ride"]
    assert alt.segments[0].mode == "walk"
    assert alt.segments[0].geometry  # decoded "lat,lon;..."


def test_get_routes_wraps_transport_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())


def test_get_routes_wraps_graphql_errors():
    # GraphQL signals query errors with HTTP 200 + an `errors` array.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errors": [{"message": "bad query"}]})

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())


def test_get_routes_wraps_bad_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"plan": None}})

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())


def test_get_routing_provider_passes_timeout():
    from app.routing.providers import get_routing_provider

    provider = get_routing_provider(
        "opentripplanner", opentripplanner_base_url="http://otp", opentripplanner_timeout_s=3.5
    )
    assert provider.timeout_s == 3.5


def test_provider_parses_recorded_live_response():
    # Contract regression: an actual OTP 2.7 `plan` response captured from a live Puget Sound
    # graph (Capitol Hill -> Downtown) must keep parsing. If a future OTP image changes the
    # GTFS GraphQL schema, re-capture tests/fixtures/otp_plan_response.json and update as needed.
    from pathlib import Path

    payload = json.loads(
        (Path(__file__).parent / "fixtures" / "otp_plan_response.json").read_text()
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    alternatives = _provider(handler).get_routes(_request())

    assert alternatives, "expected at least one itinerary from the recorded response"
    assert any(
        a.mode_mix and "tram" in a.mode_mix.lower() for a in alternatives
    ), "expected a transit (Link light rail) alternative in the recorded response"
    first = alternatives[0]
    assert first.summary_geometry and ";" in first.summary_geometry
    assert first.transfer_count >= 0
    assert first.segments[0].segment_type == "access"
