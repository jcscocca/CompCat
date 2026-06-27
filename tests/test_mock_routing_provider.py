import pytest

from app.routing.mock_provider import MockRoutingProvider
from app.routing.opentripplanner_provider import OpenTripPlannerProvider
from app.routing.place_resolver import resolve_route_place
from app.routing.providers import UnsupportedRoutingProviderError, get_routing_provider
from app.routing.schemas import RouteRequestData


def test_routing_provider_registry_returns_mock_provider():
    provider = get_routing_provider("mock")

    assert isinstance(provider, MockRoutingProvider)


def test_mock_provider_returns_ranked_route_alternatives_with_segments():
    request = RouteRequestData(
        user_id_hash="user-hash",
        origin=resolve_route_place("Capitol Hill"),
        destination=resolve_route_place("Downtown Seattle"),
        mode="transit",
        time_window="weekday_morning",
    )

    alternatives = MockRoutingProvider().get_routes(request)

    assert len(alternatives) >= 2
    assert alternatives[0].rank == 1
    assert alternatives[0].provider == "mock"
    assert alternatives[0].route_label
    assert alternatives[0].duration_minutes is not None
    assert alternatives[0].segments
    assert alternatives[0].segments[0].sequence == 1
    assert alternatives[0].segments[0].start_label == "Capitol Hill"
    for alternative in alternatives:
        _assert_route_ends_at_destination(alternative, request)


def test_mock_provider_returns_generic_fallback_for_other_places():
    request = RouteRequestData(
        user_id_hash="user-hash",
        origin=resolve_route_place("Ballard"),
        destination=resolve_route_place("University District"),
        mode="bike",
    )

    alternatives = MockRoutingProvider().get_routes(request)

    assert len(alternatives) == 1
    assert alternatives[0].provider_route_id == "mock-generic-direct"
    assert alternatives[0].mode_mix == "bike"
    _assert_route_ends_at_destination(alternatives[0], request)


def _assert_route_ends_at_destination(alternative, request):
    last_segment = alternative.segments[-1]
    assert last_segment.end_label == request.destination.label
    assert last_segment.end_latitude == request.destination.latitude
    assert last_segment.end_longitude == request.destination.longitude
    assert _last_geometry_pair(alternative.summary_geometry) == (
        request.destination.latitude,
        request.destination.longitude,
    )


def _last_geometry_pair(geometry: str | None) -> tuple[float, float]:
    assert geometry is not None
    lat, lon = geometry.split(";")[-1].split(",")
    return float(lat), float(lon)


def test_factory_builds_opentripplanner_with_base_url():
    provider = get_routing_provider(
        "opentripplanner", opentripplanner_base_url="http://otp.example/otp/routers/default"
    )
    assert isinstance(provider, OpenTripPlannerProvider)


def test_factory_rejects_opentripplanner_without_base_url():
    with pytest.raises(UnsupportedRoutingProviderError):
        get_routing_provider("opentripplanner")
