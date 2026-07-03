from __future__ import annotations

import math
from datetime import date

from app.analysis.exposure import (
    _point_to_segment_distance_m,
    analysis_days,
    route_length_km,
)
from app.normalization.geo import haversine_m

SAMPLE_STEP_M = 25.0
IDENTICAL_DIVERGENT_SHARE = 0.02

_SegmentBox = tuple[float, float, float, float, tuple[float, float], tuple[float, float]]


def route_segment_boxes(
    route_points: list[tuple[float, float]],
    radius_m: int,
) -> list[_SegmentBox]:
    # Margins must be conservative (never exclude a segment within radius_m): 110,000
    # understates the ~110,574 m per degree of latitude, and the longitude margin uses
    # the cosine of the segment's largest reachable |latitude|, a lower bound on the
    # cosine at any point within margin_lat of the segment.
    margin_lat = radius_m / 110_000
    boxes: list[_SegmentBox] = []
    for start, end in zip(route_points, route_points[1:], strict=False):
        reachable_abs_lat = min(max(abs(start[0]), abs(end[0])) + margin_lat, 89.0)
        cos_lat = math.cos(math.radians(reachable_abs_lat))
        margin_lon = radius_m / (110_000 * cos_lat)
        boxes.append(
            (
                min(start[0], end[0]) - margin_lat,
                max(start[0], end[0]) + margin_lat,
                min(start[1], end[1]) - margin_lon,
                max(start[1], end[1]) + margin_lon,
                start,
                end,
            )
        )
    return boxes


def within_radius_of_route(
    latitude: float,
    longitude: float,
    route_points: list[tuple[float, float]],
    radius_m: int,
    *,
    segment_boxes: list[_SegmentBox] | None = None,
) -> bool:
    # Exact early-exit form of `point_to_route_distance_m(...) <= radius_m`: the same
    # per-segment distances, but returning on the first hit instead of taking a min over
    # every segment — shared corridor stretches (the common case) exit almost immediately.
    if not route_points:
        return False
    if len(route_points) == 1:
        first = route_points[0]
        return haversine_m(latitude, longitude, first[0], first[1]) <= radius_m
    if segment_boxes is None:
        segment_boxes = route_segment_boxes(route_points, radius_m)
    for min_lat, max_lat, min_lon, max_lon, start, end in segment_boxes:
        if latitude < min_lat or latitude > max_lat:
            continue
        if longitude < min_lon or longitude > max_lon:
            continue
        if _point_to_segment_distance_m(latitude, longitude, start, end) <= radius_m:
            return True
    return False


def densify_polyline(
    points: list[tuple[float, float]],
    step_m: float = SAMPLE_STEP_M,
) -> list[tuple[float, float]]:
    if len(points) < 2:
        return list(points)
    dense: list[tuple[float, float]] = [points[0]]
    for start, end in zip(points, points[1:], strict=False):
        span_m = haversine_m(start[0], start[1], end[0], end[1])
        segment_count = max(1, math.ceil(span_m / step_m))
        for index in range(1, segment_count + 1):
            fraction = index / segment_count
            dense.append(
                (
                    start[0] + (end[0] - start[0]) * fraction,
                    start[1] + (end[1] - start[1]) * fraction,
                )
            )
    return dense


def divergent_spans(
    self_points: list[tuple[float, float]],
    other_points: list[tuple[float, float]],
    radius_m: int,
    step_m: float = SAMPLE_STEP_M,
) -> list[list[tuple[float, float]]]:
    if len(self_points) < 2 or not other_points:
        return []
    samples = densify_polyline(self_points, step_m)
    segment_boxes = route_segment_boxes(other_points, radius_m)
    outside = [
        not within_radius_of_route(
            latitude, longitude, other_points, radius_m, segment_boxes=segment_boxes
        )
        for latitude, longitude in samples
    ]
    spans: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for index in range(len(samples) - 1):
        # A span counts as divergent only when BOTH endpoints clear the radius — the
        # conservative side of the boundary spans next to the shared region.
        if outside[index] and outside[index + 1]:
            if not current:
                current = [samples[index]]
            current.append(samples[index + 1])
        elif current:
            spans.append(current)
            current = []
    if current:
        spans.append(current)
    return spans


def divergent_length_km(
    self_points: list[tuple[float, float]],
    other_points: list[tuple[float, float]],
    radius_m: int,
    step_m: float = SAMPLE_STEP_M,
) -> float:
    total_m = 0.0
    for span in divergent_spans(self_points, other_points, radius_m, step_m):
        for start, end in zip(span, span[1:], strict=False):
            total_m += haversine_m(start[0], start[1], end[0], end[1])
    return total_m / 1000


def divergent_share(
    self_points: list[tuple[float, float]],
    divergent_km: float,
) -> float:
    total_km = route_length_km(self_points)
    if total_km <= 0:
        return 0.0
    return min(1.0, divergent_km / total_km)


def divergent_exposure_square_km_days(
    *,
    length_km: float,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float:
    # No pi*r^2 end-cap term: divergent runs border the shared region, so the caps
    # largely fall inside corridor already covered. Documented in
    # docs/analysis/statistical-route-place-comparison.md.
    radius_km = radius_m / 1000
    return length_km * 2 * radius_km * analysis_days(analysis_start_date, analysis_end_date)
