from __future__ import annotations

import math
from datetime import date

from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData

EARTH_RADIUS_M = 6_371_000


def analysis_days(analysis_start_date: date, analysis_end_date: date) -> int:
    days = (analysis_end_date - analysis_start_date).days + 1
    if days <= 0:
        raise ValueError("analysis_end_date must be on or after analysis_start_date.")
    return days


def place_exposure_square_km_days(
    *,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float:
    radius_km = radius_m / 1000
    return math.pi * radius_km * radius_km * analysis_days(
        analysis_start_date,
        analysis_end_date,
    )


def parse_route_geometry(geometry: str | None) -> list[tuple[float, float]]:
    if not geometry:
        return []
    points: list[tuple[float, float]] = []
    for raw_point in geometry.split(";"):
        latitude_text, longitude_text = raw_point.split(",", 1)
        points.append((float(latitude_text), float(longitude_text)))
    return points


def route_length_km(points: list[tuple[float, float]]) -> float:
    if len(points) < 2:
        return 0.0
    total_m = 0.0
    for start, end in zip(points, points[1:], strict=False):
        total_m += haversine_m(start[0], start[1], end[0], end[1])
    return total_m / 1000


def route_corridor_exposure_square_km_days(
    *,
    geometry: str | None,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float:
    points = _require_route_corridor_points(geometry)
    length_km = route_length_km(points)
    radius_km = radius_m / 1000
    area_square_km = (length_km * 2 * radius_km) + math.pi * radius_km * radius_km
    return area_square_km * analysis_days(analysis_start_date, analysis_end_date)


def point_to_route_distance_m(
    latitude: float,
    longitude: float,
    route_points: list[tuple[float, float]],
) -> float:
    if not route_points:
        return math.inf
    if len(route_points) == 1:
        return haversine_m(latitude, longitude, route_points[0][0], route_points[0][1])
    return min(
        _point_to_segment_distance_m(latitude, longitude, start, end)
        for start, end in zip(route_points, route_points[1:], strict=False)
    )


def _point_to_segment_distance_m(
    latitude: float,
    longitude: float,
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    reference_latitude_rad = math.radians((start[0] + end[0] + latitude) / 3)

    def project(point_latitude: float, point_longitude: float) -> tuple[float, float]:
        x = math.radians(point_longitude) * math.cos(reference_latitude_rad) * EARTH_RADIUS_M
        y = math.radians(point_latitude) * EARTH_RADIUS_M
        return x, y

    point_x, point_y = project(latitude, longitude)
    start_x, start_y = project(start[0], start[1])
    end_x, end_y = project(end[0], end[1])
    segment_dx = end_x - start_x
    segment_dy = end_y - start_y
    segment_length_squared = segment_dx * segment_dx + segment_dy * segment_dy
    if segment_length_squared == 0:
        return haversine_m(latitude, longitude, start[0], start[1])
    position = (
        ((point_x - start_x) * segment_dx) + ((point_y - start_y) * segment_dy)
    ) / segment_length_squared
    clamped = max(0.0, min(1.0, position))
    closest_x = start_x + clamped * segment_dx
    closest_y = start_y + clamped * segment_dy
    return math.hypot(point_x - closest_x, point_y - closest_y)


def count_incidents_in_route_corridor(
    *,
    incidents: list[CrimeIncidentData],
    geometry: str | None,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> list[CrimeIncidentData]:
    route_points = _require_route_corridor_points(geometry)
    return [
        incident
        for incident in incidents
        if _incident_matches_filters(
            incident,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
        )
        and incident.latitude is not None
        and incident.longitude is not None
        and (
            point_to_route_distance_m(incident.latitude, incident.longitude, route_points)
            <= radius_m
        )
    ]


def count_incidents_in_place_buffer(
    *,
    incidents: list[CrimeIncidentData],
    latitude: float,
    longitude: float,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> list[CrimeIncidentData]:
    return [
        incident
        for incident in incidents
        if _incident_matches_filters(
            incident,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
        )
        and incident.latitude is not None
        and incident.longitude is not None
        and haversine_m(latitude, longitude, incident.latitude, incident.longitude) <= radius_m
    ]


def _incident_matches_filters(
    incident: CrimeIncidentData,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> bool:
    observed = incident.offense_start_utc or incident.report_utc
    if observed is None:
        return False
    observed_date = observed.date()
    if not analysis_start_date <= observed_date <= analysis_end_date:
        return False
    return (
        _matches_optional_filter(incident.offense_category, offense_category)
        and _matches_optional_filter(incident.offense_subcategory, offense_subcategory)
        and _matches_optional_filter(incident.nibrs_group, nibrs_group)
    )


def _matches_optional_filter(value: str | None, selected: str | None) -> bool:
    return selected is None or value == selected


def _require_route_corridor_points(geometry: str | None) -> list[tuple[float, float]]:
    points = parse_route_geometry(geometry)
    if len(points) < 2:
        raise ValueError("route geometry requires at least two lat,lon points")
    return points
