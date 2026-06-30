from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exports.routes import (
    build_route_alternatives_csv,
    build_route_context_csv,
    build_route_segments_csv,
)
from app.models import RouteAlternative, RouteContextSummary, RouteRequest, RouteSegment


def tableau_route_alternatives_csv(session: Session, user_id_hash: str) -> str:
    rows = session.execute(
        select(RouteAlternative, RouteRequest)
        .join(RouteRequest, RouteRequest.id == RouteAlternative.route_request_id)
        .where(RouteAlternative.user_id_hash == user_id_hash)
        .where(RouteRequest.user_id_hash == user_id_hash)
        .order_by(
            RouteRequest.created_at,
            RouteRequest.id,
            RouteAlternative.rank,
            RouteAlternative.id,
        )
    ).all()
    return build_route_alternatives_csv(
        [_alternative_row(alternative, request) for alternative, request in rows]
    )


def tableau_route_segments_csv(session: Session, user_id_hash: str) -> str:
    rows = session.execute(
        select(RouteSegment)
        .join(RouteAlternative, RouteAlternative.id == RouteSegment.route_alternative_id)
        .join(RouteRequest, RouteRequest.id == RouteAlternative.route_request_id)
        .where(RouteSegment.user_id_hash == user_id_hash)
        .where(RouteAlternative.user_id_hash == user_id_hash)
        .where(RouteRequest.user_id_hash == user_id_hash)
        .order_by(
            RouteRequest.created_at,
            RouteRequest.id,
            RouteAlternative.rank,
            RouteAlternative.id,
            RouteSegment.sequence,
            RouteSegment.id,
        )
    ).scalars()
    return build_route_segments_csv([_segment_row(segment) for segment in rows])


def tableau_route_context_csv(session: Session, user_id_hash: str) -> str:
    rows = session.execute(
        select(RouteContextSummary, RouteRequest)
        .join(RouteAlternative, RouteAlternative.id == RouteContextSummary.route_alternative_id)
        .join(RouteRequest, RouteRequest.id == RouteAlternative.route_request_id)
        .where(RouteContextSummary.user_id_hash == user_id_hash)
        .where(RouteAlternative.user_id_hash == user_id_hash)
        .where(RouteRequest.user_id_hash == user_id_hash)
        .order_by(
            RouteRequest.created_at,
            RouteRequest.id,
            RouteAlternative.rank,
            RouteAlternative.id,
            RouteContextSummary.radius_m,
            RouteContextSummary.context_label,
            RouteContextSummary.context_type,
            RouteContextSummary.offense_category,
            RouteContextSummary.offense_subcategory,
            RouteContextSummary.nibrs_group,
            RouteContextSummary.id,
        )
    ).all()
    return build_route_context_csv([_context_row(summary, request) for summary, request in rows])


def _alternative_row(alternative: RouteAlternative, request: RouteRequest) -> dict[str, object]:
    return {
        "user_id_hash": alternative.user_id_hash,
        "route_request_id": alternative.route_request_id,
        "route_alternative_id": alternative.id,
        "provider_route_id": alternative.provider_route_id,
        "route_label": alternative.route_label,
        "rank": alternative.rank,
        "duration_minutes": alternative.duration_minutes,
        "distance_m": alternative.distance_m,
        "transfer_count": alternative.transfer_count,
        "walking_distance_m": alternative.walking_distance_m,
        "mode_mix": alternative.mode_mix,
        "provider": alternative.provider,
        "analysis_start_date": request.analysis_start_date,
        "analysis_end_date": request.analysis_end_date,
        "radii_m": _radii_text(request.radii_m_json),
        "layer": request.layer or "reported",
        "created_at": alternative.created_at,
    }


def _segment_row(segment: RouteSegment) -> dict[str, object]:
    return {
        "user_id_hash": segment.user_id_hash,
        "route_alternative_id": segment.route_alternative_id,
        "route_segment_id": segment.id,
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
        "created_at": segment.created_at,
    }


def _context_row(summary: RouteContextSummary, request: RouteRequest) -> dict[str, object]:
    return {
        "user_id_hash": summary.user_id_hash,
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
        "layer": request.layer or "reported",
        "created_at": summary.created_at,
    }


def _radii_text(radii_m_json: str | None) -> str:
    if not radii_m_json:
        return ""
    radii = json.loads(radii_m_json)
    return ";".join(str(radius) for radius in radii)
