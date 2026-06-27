from __future__ import annotations

import json
from typing import Any

import httpx

from app.routing.providers import RoutingProviderError
from app.routing.schemas import RouteAlternativeData, RouteRequestData, RouteSegmentData

# Request mode -> OTP2 GTFS GraphQL `transportModes` enum values.
_OTP_MODES_BY_REQUEST_MODE = {
    "transit": ["TRANSIT", "WALK"],
    "walk": ["WALK"],
    "bike": ["BICYCLE"],
    "drive": ["CAR"],
}
_DEFAULT_MODES = ["TRANSIT", "WALK"]


class OpenTripPlannerProvider:
    """Queries an OpenTripPlanner 2.x server via its GTFS GraphQL API.

    ``base_url`` is the full GraphQL endpoint (e.g. ``http://host:8080/otp/gtfs/v1``); the
    provider POSTs a ``plan`` query to it. OTP 1.x's REST ``/plan`` API is not supported.
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._transport = transport

    def get_routes(self, request: RouteRequestData) -> list[RouteAlternativeData]:
        query = _build_plan_query(request)
        try:
            with httpx.Client(timeout=self.timeout_s, transport=self._transport) as client:
                response = client.post(self.base_url, json={"query": query})
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            raise RoutingProviderError(f"OpenTripPlanner request failed: {exc}") from exc
        # GraphQL reports query errors with HTTP 200 + an `errors` array.
        errors = payload.get("errors") if isinstance(payload, dict) else None
        if errors:
            raise RoutingProviderError(f"OpenTripPlanner returned GraphQL errors: {errors}")
        try:
            itineraries = payload["data"]["plan"]["itineraries"]
            return [
                _itinerary_to_alternative(request, index, itinerary)
                for index, itinerary in enumerate(itineraries)
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise RoutingProviderError(
                f"OpenTripPlanner returned an unexpected response shape: {exc}"
            ) from exc


def _build_plan_query(request: RouteRequestData) -> str:
    modes = _OTP_MODES_BY_REQUEST_MODE.get(request.mode, _DEFAULT_MODES)
    modes_arg = "[" + ", ".join("{mode: " + mode + "}" for mode in modes) + "]"
    date_arg = f', date: "{request.departure_date.isoformat()}"' if request.departure_date else ""
    time_arg = f', time: "{request.departure_time}"' if request.departure_time else ""
    return (
        "{ plan("
        f"from: {{lat: {request.origin.latitude}, lon: {request.origin.longitude}}}, "
        f"to: {{lat: {request.destination.latitude}, lon: {request.destination.longitude}}}, "
        f"transportModes: {modes_arg}, numItineraries: 3{date_arg}{time_arg}"
        ") { itineraries { duration walkDistance legs { "
        "mode duration distance transitLeg route { shortName longName } "
        "from { name lat lon } to { name lat lon } legGeometry { points } } } } }"
    )


def _itinerary_to_alternative(
    request: RouteRequestData, index: int, itinerary: dict[str, Any]
) -> RouteAlternativeData:
    legs = itinerary.get("legs", [])
    modes: list[str] = []
    for leg in legs:
        mode = str(leg.get("mode", "")).lower()
        if mode and mode not in modes:
            modes.append(mode)
    total_distance = sum(float(leg.get("distance", 0.0)) for leg in legs)
    # OTP2 GraphQL has no itinerary-level transfer count; derive it from transit legs.
    transit_legs = sum(1 for leg in legs if leg.get("transitLeg"))
    alternative = RouteAlternativeData(
        route_request_id=request.id,
        provider_route_id=f"otp-{index}",
        route_label=_alternative_label(request, legs),
        rank=index + 1,
        duration_minutes=_seconds_to_minutes(itinerary.get("duration")),
        distance_m=total_distance or None,
        transfer_count=max(0, transit_legs - 1),
        walking_distance_m=_optional_float(itinerary.get("walkDistance")),
        mode_mix=",".join(modes) or request.mode,
        summary_geometry=_summary_geometry(legs),
        provider="opentripplanner",
        provider_metadata_json=json.dumps({"otp_itinerary_index": index}),
    )
    leg_count = len(legs)
    alternative.segments = [
        _leg_to_segment(
            alternative.id, sequence, leg, is_first=sequence == 1, is_last=sequence == leg_count
        )
        for sequence, leg in enumerate(legs, start=1)
    ]
    return alternative


def _leg_to_segment(
    alternative_id: str, sequence: int, leg: dict[str, Any], *, is_first: bool, is_last: bool
) -> RouteSegmentData:
    if bool(leg.get("transitLeg")):
        segment_type = "ride"
    elif is_first:
        segment_type = "access"
    elif is_last:
        segment_type = "egress"
    else:
        segment_type = "walk"
    start = leg.get("from", {})
    end = leg.get("to", {})
    return RouteSegmentData(
        route_alternative_id=alternative_id,
        sequence=sequence,
        segment_type=segment_type,
        mode=str(leg.get("mode", "")).lower(),
        start_label=str(start.get("name", "")),
        start_latitude=float(start["lat"]),
        start_longitude=float(start["lon"]),
        end_label=str(end.get("name", "")),
        end_latitude=float(end["lat"]),
        end_longitude=float(end["lon"]),
        distance_m=_optional_float(leg.get("distance")),
        duration_minutes=_seconds_to_minutes(leg.get("duration")),
        geometry=_polyline_to_geometry((leg.get("legGeometry") or {}).get("points")),
    )


def _alternative_label(request: RouteRequestData, legs: list[dict[str, Any]]) -> str:
    for leg in legs:
        if leg.get("transitLeg"):
            route = leg.get("route") or {}
            name = route.get("shortName") or route.get("longName")
            if name:
                return f"{name} via OpenTripPlanner"
    return f"{request.mode.capitalize()} route via OpenTripPlanner"


def _summary_geometry(legs: list[dict[str, Any]]) -> str | None:
    parts = [
        decoded
        for leg in legs
        if (decoded := _polyline_to_geometry((leg.get("legGeometry") or {}).get("points")))
    ]
    return ";".join(parts) or None


def _seconds_to_minutes(value: Any) -> float | None:
    if value is None:
        return None
    return float(value) / 60.0


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _polyline_to_geometry(encoded: str | None) -> str | None:
    if not encoded:
        return None
    return ";".join(f"{lat},{lon}" for lat, lon in _decode_polyline(encoded))


def _decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = latitude = longitude = 0
    length = len(encoded)
    while index < length:
        latitude_delta, index = _decode_value(encoded, index)
        longitude_delta, index = _decode_value(encoded, index)
        latitude += latitude_delta
        longitude += longitude_delta
        points.append((latitude / 1e5, longitude / 1e5))
    return points


def _decode_value(encoded: str, index: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = ord(encoded[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break
    delta = ~(result >> 1) if (result & 1) else (result >> 1)
    return delta, index
