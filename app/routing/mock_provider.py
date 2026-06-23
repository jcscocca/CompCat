from __future__ import annotations

from app.routing.place_resolver import resolve_route_place
from app.routing.schemas import (
    RouteAlternativeData,
    RouteLocation,
    RouteRequestData,
    RouteSegmentData,
)


class MockRoutingProvider:
    def get_routes(self, request: RouteRequestData) -> list[RouteAlternativeData]:
        if _is_capitol_hill_to_downtown(request.origin, request.destination):
            return _capitol_hill_to_downtown_routes(request)
        return [_generic_route(request)]


def _capitol_hill_to_downtown_routes(request: RouteRequestData) -> list[RouteAlternativeData]:
    westlake = resolve_route_place("Westlake Station")

    light_rail = RouteAlternativeData(
        route_request_id=request.id,
        provider_route_id="mock-capitol-hill-downtown-link",
        route_label="Link light rail via Westlake",
        rank=1,
        duration_minutes=11,
        distance_m=1900,
        transfer_count=0,
        walking_distance_m=350,
        mode_mix="walk,transit",
        summary_geometry=_path_geometry(request.origin, westlake, request.destination),
        provider="mock",
        provider_metadata_json='{"fixture": "capitol_hill_to_downtown"}',
    )
    light_rail.segments = [
        _segment(
            route_alternative_id=light_rail.id,
            sequence=1,
            segment_type="access",
            mode="walk",
            start=request.origin,
            end=request.origin,
            distance_m=250,
            duration_minutes=4,
        ),
        _segment(
            route_alternative_id=light_rail.id,
            sequence=2,
            segment_type="ride",
            mode="light_rail",
            start=request.origin,
            end=westlake,
            distance_m=1650,
            duration_minutes=7,
        ),
        _segment(
            route_alternative_id=light_rail.id,
            sequence=3,
            segment_type="egress",
            mode="walk",
            start=westlake,
            end=request.destination,
            distance_m=200,
            duration_minutes=3,
        ),
    ]

    pine_bus = RouteAlternativeData(
        route_request_id=request.id,
        provider_route_id="mock-capitol-hill-downtown-pine-bus",
        route_label="Pine Street bus to downtown",
        rank=2,
        duration_minutes=18,
        distance_m=2200,
        transfer_count=0,
        walking_distance_m=500,
        mode_mix="walk,bus",
        summary_geometry=_geometry(request.origin, request.destination),
        provider="mock",
        provider_metadata_json='{"fixture": "capitol_hill_to_downtown"}',
    )
    pine_bus.segments = [
        _segment(
            route_alternative_id=pine_bus.id,
            sequence=1,
            segment_type="access",
            mode="walk",
            start=request.origin,
            end=request.origin,
            distance_m=300,
            duration_minutes=5,
        ),
        _segment(
            route_alternative_id=pine_bus.id,
            sequence=2,
            segment_type="ride",
            mode="bus",
            start=request.origin,
            end=request.destination,
            distance_m=1900,
            duration_minutes=13,
        ),
    ]

    return [light_rail, pine_bus]


def _generic_route(request: RouteRequestData) -> RouteAlternativeData:
    alternative = RouteAlternativeData(
        route_request_id=request.id,
        provider_route_id="mock-generic-direct",
        route_label=f"Direct {request.mode} route",
        rank=1,
        duration_minutes=20,
        distance_m=None,
        transfer_count=0,
        walking_distance_m=None,
        mode_mix=request.mode,
        summary_geometry=_geometry(request.origin, request.destination),
        provider="mock",
        provider_metadata_json='{"fixture": "generic"}',
    )
    alternative.segments = [
        _segment(
            route_alternative_id=alternative.id,
            sequence=1,
            segment_type="direct",
            mode=request.mode,
            start=request.origin,
            end=request.destination,
            distance_m=None,
            duration_minutes=20,
        )
    ]
    return alternative


def _segment(
    *,
    route_alternative_id: str,
    sequence: int,
    segment_type: str,
    mode: str,
    start: RouteLocation,
    end: RouteLocation,
    distance_m: float | None,
    duration_minutes: float | None,
) -> RouteSegmentData:
    return RouteSegmentData(
        route_alternative_id=route_alternative_id,
        sequence=sequence,
        segment_type=segment_type,
        mode=mode,
        start_label=start.label,
        start_latitude=start.latitude,
        start_longitude=start.longitude,
        end_label=end.label,
        end_latitude=end.latitude,
        end_longitude=end.longitude,
        distance_m=distance_m,
        duration_minutes=duration_minutes,
        geometry=_geometry(start, end),
    )


def _is_capitol_hill_to_downtown(origin: RouteLocation, destination: RouteLocation) -> bool:
    return origin.label == "Capitol Hill" and destination.label == "Downtown Seattle"


def _geometry(start: RouteLocation, end: RouteLocation) -> str:
    return f"{start.latitude},{start.longitude};{end.latitude},{end.longitude}"


def _path_geometry(*locations: RouteLocation) -> str:
    return ";".join(f"{location.latitude},{location.longitude}" for location in locations)
