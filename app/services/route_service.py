from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.schemas import RouteComparisonRequest
from app.config import get_settings
from app.models import (
    RouteAlternative,
    RouteContextSummary,
    RouteRequest,
    RouteSegment,
)
from app.routing.context import summarize_route_context
from app.routing.place_resolver import UnknownRoutePlaceError, resolve_route_place
from app.routing.providers import get_routing_provider
from app.routing.schemas import (
    RouteAlternativeData,
    RouteContextSummaryData,
    RouteEndpoint,
    RouteLocation,
    RouteRequestCreate,
    RouteRequestData,
)
from app.services.analysis_service import compare_route_request, latest_route_comparison_payload
from app.services.incident_query_service import bounding_box_for_points, incidents_in_bbox
from app.services.place_service import get_place


def _resolve_endpoint(
    session: Session,
    user_id_hash: str,
    endpoint: "RouteEndpoint | None",
    label: str | None,
) -> RouteLocation:
    if endpoint is not None and endpoint.place_id is not None:
        place = get_place(session, endpoint.place_id, user_id_hash)
        if place is None:
            raise UnknownRoutePlaceError(f"Unknown saved place: {endpoint.place_id}")
        return RouteLocation(
            label=endpoint.label or place.display_label or "Saved place",
            latitude=place.centroid_latitude,
            longitude=place.centroid_longitude,
            display_latitude=place.display_latitude,
            display_longitude=place.display_longitude,
            location_type=place.inferred_place_type,
            source="saved_place",
        )
    if endpoint is not None and endpoint.latitude is not None and endpoint.longitude is not None:
        return RouteLocation(
            label=endpoint.label or f"{endpoint.latitude:.5f}, {endpoint.longitude:.5f}",
            latitude=endpoint.latitude,
            longitude=endpoint.longitude,
            source="geocoded",
        )
    if label is not None:
        return resolve_route_place(label)
    raise UnknownRoutePlaceError("No origin or destination provided")


def create_route_alternatives(
    session: Session,
    request_payload: RouteRequestCreate,
    user_id_hash: str,
) -> dict[str, object]:
    origin = _resolve_endpoint(session, user_id_hash, request_payload.origin, request_payload.origin_label)
    destination = _resolve_endpoint(
        session, user_id_hash, request_payload.destination, request_payload.destination_label
    )
    settings = get_settings()
    provider_name = request_payload.provider or settings.routing_provider
    routing_provider = get_routing_provider(
        provider_name, opentripplanner_base_url=settings.opentripplanner_base_url
    )

    route_request = RouteRequest(
        user_id_hash=user_id_hash,
        origin_label=origin.label,
        origin_latitude=origin.latitude,
        origin_longitude=origin.longitude,
        origin_display_latitude=origin.display_latitude,
        origin_display_longitude=origin.display_longitude,
        origin_location_type=origin.location_type,
        destination_label=destination.label,
        destination_latitude=destination.latitude,
        destination_longitude=destination.longitude,
        destination_display_latitude=destination.display_latitude,
        destination_display_longitude=destination.display_longitude,
        destination_location_type=destination.location_type,
        mode=request_payload.mode,
        departure_date=request_payload.departure_date,
        departure_time=request_payload.departure_time,
        time_window=request_payload.time_window,
        preferences_json=json.dumps(request_payload.preferences),
        privacy_level=request_payload.privacy_level,
        provider=provider_name,
        status="ready",
        analysis_start_date=request_payload.analysis_start_date,
        analysis_end_date=request_payload.analysis_end_date,
        radii_m_json=json.dumps(request_payload.radii_m),
    )
    session.add(route_request)
    session.flush()

    provider_request = RouteRequestData(
        id=route_request.id,
        user_id_hash=user_id_hash,
        origin=origin,
        destination=destination,
        mode=request_payload.mode,
        departure_date=request_payload.departure_date,
        departure_time=request_payload.departure_time,
        time_window=request_payload.time_window,
        preferences=request_payload.preferences,
        privacy_level=request_payload.privacy_level,
        provider=provider_name,
        status=route_request.status,
        created_at=route_request.created_at,
    )

    route_alternatives = routing_provider.get_routes(provider_request)
    for route_data in route_alternatives:
        route_data.route_request_id = route_request.id
        alternative = RouteAlternative(
            id=route_data.id,
            route_request_id=route_request.id,
            user_id_hash=user_id_hash,
            provider_route_id=route_data.provider_route_id,
            route_label=route_data.route_label,
            rank=route_data.rank,
            duration_minutes=route_data.duration_minutes,
            distance_m=route_data.distance_m,
            transfer_count=route_data.transfer_count,
            walking_distance_m=route_data.walking_distance_m,
            mode_mix=route_data.mode_mix,
            summary_geometry=route_data.summary_geometry,
            provider=route_data.provider,
            provider_metadata_json=route_data.provider_metadata_json,
        )
        session.add(alternative)
        session.flush()

        for segment_data in route_data.segments:
            segment_data.route_alternative_id = alternative.id
            session.add(
                RouteSegment(
                    id=segment_data.id,
                    route_alternative_id=alternative.id,
                    user_id_hash=user_id_hash,
                    sequence=segment_data.sequence,
                    segment_type=segment_data.segment_type,
                    mode=segment_data.mode,
                    start_label=segment_data.start_label,
                    start_latitude=segment_data.start_latitude,
                    start_longitude=segment_data.start_longitude,
                    end_label=segment_data.end_label,
                    end_latitude=segment_data.end_latitude,
                    end_longitude=segment_data.end_longitude,
                    distance_m=segment_data.distance_m,
                    duration_minutes=segment_data.duration_minutes,
                    geometry=segment_data.geometry,
                )
            )

    if route_request.analysis_start_date and route_request.analysis_end_date:
        session.flush()
        context_points = [
            coord
            for alternative in route_alternatives
            for segment in alternative.segments
            for coord in (
                (segment.start_latitude, segment.start_longitude),
                (segment.end_latitude, segment.end_longitude),
            )
        ]
        if context_points:
            incidents = incidents_in_bbox(
                session,
                box=bounding_box_for_points(context_points, max(request_payload.radii_m)),
                analysis_start_date=route_request.analysis_start_date,
                analysis_end_date=route_request.analysis_end_date,
            )
        else:
            incidents = []
        summaries = summarize_route_context(
            user_id_hash=user_id_hash,
            alternatives=route_alternatives,
            incidents=incidents,
            radii_m=request_payload.radii_m,
            analysis_start_date=route_request.analysis_start_date,
            analysis_end_date=route_request.analysis_end_date,
        )
        session.add_all([_context_summary_model(summary) for summary in summaries])

    session.commit()

    _create_route_statistical_comparison_if_possible(
        session=session,
        route_request=route_request,
        route_alternatives=route_alternatives,
        request_payload=request_payload,
        user_id_hash=user_id_hash,
    )
    return get_route_comparison(session, route_request.id, user_id_hash) or {}


def get_route_comparison(
    session: Session,
    request_id: str,
    user_id_hash: str,
) -> dict[str, object] | None:
    route_request = session.get(RouteRequest, request_id)
    if route_request is None or route_request.user_id_hash != user_id_hash:
        return None

    alternatives = list(
        session.scalars(
            select(RouteAlternative)
            .where(RouteAlternative.route_request_id == request_id)
            .where(RouteAlternative.user_id_hash == user_id_hash)
            .order_by(RouteAlternative.rank)
        )
    )
    alternative_ids = [alternative.id for alternative in alternatives]
    segments = _segments_by_alternative_id(session, alternative_ids, user_id_hash)
    summaries = _context_summaries(session, alternative_ids, user_id_hash)
    statistical_comparison = latest_route_comparison_payload(session, request_id, user_id_hash)

    payload = {
        "request": _request_to_dict(route_request),
        "alternatives": _sort_alternatives_for_payload(
            [
                _alternative_to_dict(alternative, segments.get(alternative.id, []))
                for alternative in alternatives
            ],
            statistical_comparison,
        ),
        "context_summaries": summaries,
        "statistical_comparison": statistical_comparison,
    }
    return payload


def _create_route_statistical_comparison_if_possible(
    *,
    session: Session,
    route_request: RouteRequest,
    route_alternatives: list[RouteAlternativeData],
    request_payload: RouteRequestCreate,
    user_id_hash: str,
) -> None:
    if (
        route_request.analysis_start_date is None
        or route_request.analysis_end_date is None
        or not request_payload.radii_m
        or len(route_alternatives) < 2
    ):
        return
    try:
        compare_route_request(
            session=session,
            user_id_hash=user_id_hash,
            request=RouteComparisonRequest(
                route_request_id=route_request.id,
                radius_m=request_payload.radii_m[0],
            ),
        )
    except ValueError:
        session.rollback()
        return


def _sort_alternatives_for_payload(
    alternatives: list[dict[str, Any]],
    statistical_comparison: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    recommendation_id = None
    if statistical_comparison:
        recommendation_id = statistical_comparison["overview"].get("recommendation_option_id")
    return sorted(
        alternatives,
        key=lambda alternative: (
            alternative["id"] != recommendation_id if recommendation_id else False,
            alternative.get("duration_minutes") is None,
            alternative.get("duration_minutes") or 0,
            alternative.get("transfer_count") or 0,
            alternative.get("walking_distance_m") or 0,
            alternative.get("rank") or 0,
        ),
    )


def _segments_by_alternative_id(
    session: Session,
    alternative_ids: list[str],
    user_id_hash: str,
) -> dict[str, list[RouteSegment]]:
    if not alternative_ids:
        return {}
    rows = list(
        session.scalars(
            select(RouteSegment)
            .where(RouteSegment.route_alternative_id.in_(alternative_ids))
            .where(RouteSegment.user_id_hash == user_id_hash)
            .order_by(RouteSegment.route_alternative_id, RouteSegment.sequence)
        )
    )
    grouped: dict[str, list[RouteSegment]] = {}
    for row in rows:
        grouped.setdefault(row.route_alternative_id, []).append(row)
    return grouped


def _context_summaries(
    session: Session,
    alternative_ids: list[str],
    user_id_hash: str,
) -> list[dict[str, Any]]:
    if not alternative_ids:
        return []
    rows = session.scalars(
        select(RouteContextSummary)
        .where(RouteContextSummary.route_alternative_id.in_(alternative_ids))
        .where(RouteContextSummary.user_id_hash == user_id_hash)
        .order_by(
            RouteContextSummary.route_alternative_id,
            RouteContextSummary.radius_m,
            RouteContextSummary.context_label,
            RouteContextSummary.context_type,
            RouteContextSummary.offense_category,
            RouteContextSummary.offense_subcategory,
            RouteContextSummary.nibrs_group,
        )
    )
    return [_context_summary_to_dict(row) for row in rows]


def _request_to_dict(route_request: RouteRequest) -> dict[str, Any]:
    return {
        "id": route_request.id,
        "origin": {
            "label": route_request.origin_label,
            "display_latitude": route_request.origin_display_latitude,
            "display_longitude": route_request.origin_display_longitude,
            "location_type": route_request.origin_location_type,
        },
        "destination": {
            "label": route_request.destination_label,
            "display_latitude": route_request.destination_display_latitude,
            "display_longitude": route_request.destination_display_longitude,
            "location_type": route_request.destination_location_type,
        },
        "mode": route_request.mode,
        "departure_date": route_request.departure_date,
        "departure_time": route_request.departure_time,
        "time_window": route_request.time_window,
        "preferences": _json_list(route_request.preferences_json),
        "privacy_level": route_request.privacy_level,
        "provider": route_request.provider,
        "status": route_request.status,
        "analysis_start_date": route_request.analysis_start_date,
        "analysis_end_date": route_request.analysis_end_date,
        "radii_m": _json_list(route_request.radii_m_json),
        "created_at": route_request.created_at,
    }


def _alternative_to_dict(
    alternative: RouteAlternative,
    segments: list[RouteSegment],
) -> dict[str, Any]:
    return {
        "id": alternative.id,
        "route_request_id": alternative.route_request_id,
        "provider_route_id": alternative.provider_route_id,
        "route_label": alternative.route_label,
        "rank": alternative.rank,
        "duration_minutes": alternative.duration_minutes,
        "distance_m": alternative.distance_m,
        "transfer_count": alternative.transfer_count,
        "walking_distance_m": alternative.walking_distance_m,
        "mode_mix": alternative.mode_mix,
        "summary_geometry": alternative.summary_geometry,
        "provider": alternative.provider,
        "provider_metadata": _json_dict(alternative.provider_metadata_json),
        "segments": [_segment_to_dict(segment) for segment in segments],
    }


def _segment_to_dict(segment: RouteSegment) -> dict[str, Any]:
    return {
        "id": segment.id,
        "route_alternative_id": segment.route_alternative_id,
        "sequence": segment.sequence,
        "segment_type": segment.segment_type,
        "mode": segment.mode,
        "start_label": segment.start_label,
        "start_latitude": segment.start_latitude,
        "start_longitude": segment.start_longitude,
        "end_label": segment.end_label,
        "end_latitude": segment.end_latitude,
        "end_longitude": segment.end_longitude,
        "distance_m": segment.distance_m,
        "duration_minutes": segment.duration_minutes,
        "geometry": segment.geometry,
    }


def _context_summary_to_dict(summary: RouteContextSummary) -> dict[str, Any]:
    return {
        "id": summary.id,
        "route_alternative_id": summary.route_alternative_id,
        "route_segment_id": summary.route_segment_id,
        "context_label": summary.context_label,
        "context_type": summary.context_type,
        "radius_m": summary.radius_m,
        "analysis_start_date": summary.analysis_start_date,
        "analysis_end_date": summary.analysis_end_date,
        "offense_category": summary.offense_category,
        "offense_subcategory": summary.offense_subcategory,
        "nibrs_group": summary.nibrs_group,
        "incident_count": summary.incident_count,
        "nearest_incident_m": summary.nearest_incident_m,
        "incidents_per_route": summary.incidents_per_route,
    }


def _context_summary_model(summary: RouteContextSummaryData) -> RouteContextSummary:
    return RouteContextSummary(
        id=summary.id,
        user_id_hash=summary.user_id_hash,
        route_alternative_id=summary.route_alternative_id,
        route_segment_id=summary.route_segment_id,
        context_label=summary.context_label,
        context_type=summary.context_type,
        radius_m=summary.radius_m,
        analysis_start_date=summary.analysis_start_date,
        analysis_end_date=summary.analysis_end_date,
        offense_category=summary.offense_category,
        offense_subcategory=summary.offense_subcategory,
        nibrs_group=summary.nibrs_group,
        incident_count=summary.incident_count,
        nearest_incident_m=float(summary.nearest_incident_m)
        if summary.nearest_incident_m is not None
        else None,
        incidents_per_route=float(summary.incidents_per_route)
        if summary.incidents_per_route is not None
        else None,
    )


def _json_list(value: str | None) -> list[Any]:
    if not value:
        return []
    parsed = json.loads(value)
    if isinstance(parsed, list):
        return parsed
    return []


def _json_dict(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    parsed = json.loads(value)
    if isinstance(parsed, dict):
        return parsed
    return {}
