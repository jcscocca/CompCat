from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    CrimeIncident,
    RouteAlternative,
    RouteContextSummary,
    RouteRequest,
    RouteSegment,
)
from app.routing.context import summarize_route_context
from app.routing.mock_provider import MockRoutingProvider
from app.routing.place_resolver import resolve_route_place
from app.routing.schemas import RouteContextSummaryData, RouteRequestCreate, RouteRequestData
from app.schemas import CrimeIncidentData


class UnsupportedRoutingProviderError(ValueError):
    pass


def create_route_alternatives(
    session: Session,
    request_payload: RouteRequestCreate,
    user_id_hash: str,
) -> dict[str, object]:
    if request_payload.provider != "mock":
        raise UnsupportedRoutingProviderError(
            f"Unsupported routing provider: {request_payload.provider}"
        )

    origin = resolve_route_place(request_payload.origin_label)
    destination = resolve_route_place(request_payload.destination_label)

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
        provider=request_payload.provider,
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
        provider=request_payload.provider,
        status=route_request.status,
        created_at=route_request.created_at,
    )

    route_alternatives = MockRoutingProvider().get_routes(provider_request)
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
        incidents = [_incident_data(row) for row in session.scalars(select(CrimeIncident)).all()]
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

    return {
        "request": _request_to_dict(route_request),
        "alternatives": [
            _alternative_to_dict(alternative, segments.get(alternative.id, []))
            for alternative in alternatives
        ],
        "context_summaries": summaries,
    }


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
            "latitude": route_request.origin_latitude,
            "longitude": route_request.origin_longitude,
            "display_latitude": route_request.origin_display_latitude,
            "display_longitude": route_request.origin_display_longitude,
            "location_type": route_request.origin_location_type,
        },
        "destination": {
            "label": route_request.destination_label,
            "latitude": route_request.destination_latitude,
            "longitude": route_request.destination_longitude,
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


def _incident_data(row: CrimeIncident) -> CrimeIncidentData:
    return CrimeIncidentData(
        id=row.id,
        external_incident_id=row.external_incident_id,
        report_number=row.report_number,
        offense_id=row.offense_id,
        offense_start_utc=row.offense_start_utc,
        offense_end_utc=row.offense_end_utc,
        report_utc=row.report_utc,
        offense_category=row.offense_category,
        offense_subcategory=row.offense_subcategory,
        nibrs_group=row.nibrs_group,
        precinct=row.precinct,
        sector=row.sector,
        beat=row.beat,
        mcpp=row.mcpp,
        block_address=row.block_address,
        latitude=row.latitude,
        longitude=row.longitude,
        source_dataset=row.source_dataset,
        snapshot_at=row.snapshot_at,
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
