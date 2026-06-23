from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from app.normalization.geo import haversine_m
from app.routing.schemas import RouteAlternativeData, RouteContextSummaryData
from app.schemas import CrimeIncidentData


@dataclass(frozen=True)
class _ContextPoint:
    route_alternative_id: str
    route_segment_id: str
    label: str
    latitude: float
    longitude: float


def summarize_route_context(
    user_id_hash: str,
    alternatives: list[RouteAlternativeData],
    incidents: list[CrimeIncidentData],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
) -> list[RouteContextSummaryData]:
    context_points = _unique_context_points(alternatives)
    eligible_incidents = [
        incident
        for incident in incidents
        if _incident_in_date_range(incident, analysis_start_date, analysis_end_date)
        and incident.latitude is not None
        and incident.longitude is not None
    ]

    summaries: list[RouteContextSummaryData] = []
    alternatives_count = max(len(alternatives), 1)
    for point in context_points:
        for radius in radii_m:
            grouped: dict[
                tuple[str | None, str | None, str | None],
                list[tuple[CrimeIncidentData, float]],
            ] = defaultdict(list)
            for incident in eligible_incidents:
                distance = haversine_m(
                    point.latitude,
                    point.longitude,
                    incident.latitude,
                    incident.longitude,
                )
                if distance <= radius:
                    key = (
                        incident.offense_category,
                        incident.offense_subcategory,
                        incident.nibrs_group,
                    )
                    grouped[key].append((incident, distance))

            for key, rows in grouped.items():
                count = len(rows)
                summaries.append(
                    RouteContextSummaryData(
                        user_id_hash=user_id_hash,
                        route_alternative_id=point.route_alternative_id,
                        route_segment_id=point.route_segment_id,
                        context_label=point.label,
                        context_type="route_point",
                        radius_m=radius,
                        analysis_start_date=analysis_start_date,
                        analysis_end_date=analysis_end_date,
                        offense_category=key[0],
                        offense_subcategory=key[1],
                        nibrs_group=key[2],
                        incident_count=count,
                        nearest_incident_m=min(distance for _, distance in rows),
                        incidents_per_route=count / alternatives_count,
                    )
                )
    return summaries


def _unique_context_points(alternatives: list[RouteAlternativeData]) -> list[_ContextPoint]:
    points: list[_ContextPoint] = []
    seen: set[tuple[str, float, float]] = set()
    for alternative in alternatives:
        for segment in alternative.segments:
            for label, latitude, longitude in (
                (segment.start_label, segment.start_latitude, segment.start_longitude),
                (segment.end_label, segment.end_latitude, segment.end_longitude),
            ):
                key = (alternative.id, latitude, longitude)
                if key in seen:
                    continue
                seen.add(key)
                points.append(
                    _ContextPoint(
                        route_alternative_id=alternative.id,
                        route_segment_id=segment.id,
                        label=label,
                        latitude=latitude,
                        longitude=longitude,
                    )
                )
    return points


def _incident_in_date_range(
    incident: CrimeIncidentData,
    analysis_start_date: date,
    analysis_end_date: date,
) -> bool:
    observed = incident.offense_start_utc or incident.report_utc
    if observed is None:
        return False
    observed_date = observed.date()
    return analysis_start_date <= observed_date <= analysis_end_date
