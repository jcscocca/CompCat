from __future__ import annotations

from dataclasses import dataclass
from math import asin, cos, degrees, pi, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000


@dataclass(frozen=True)
class BoundingBox:
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


def circle_bounding_box(latitude: float, longitude: float, radius_m: float) -> BoundingBox:
    """Conservative envelope of the spherical circle used by ``haversine_m``.

    Longitude extrema depend on the circle's latitude, not a group-average latitude.
    A circle crossing a pole or the antimeridian uses all longitudes so ordinary SQL
    range predicates cannot discard its wrapped part. Exact distance remains the final
    membership test. A tiny outward pad covers floating-point rounding at the boundary.
    """
    angular_radius = radius_m / EARTH_RADIUS_M
    lat_radians = radians(latitude)
    rounding_pad = 1e-9  # degrees; less than a millimetre
    min_lat = max(-90.0, degrees(lat_radians - angular_radius) - rounding_pad)
    max_lat = min(90.0, degrees(lat_radians + angular_radius) + rounding_pad)
    if angular_radius >= pi or min_lat <= -90 or max_lat >= 90:
        return BoundingBox(min_lat, max_lat, -180.0, 180.0)
    lon_delta = degrees(asin(min(1.0, sin(angular_radius) / cos(lat_radians)))) + rounding_pad
    min_lon, max_lon = longitude - lon_delta, longitude + lon_delta
    if min_lon < -180 or max_lon > 180:
        min_lon, max_lon = -180.0, 180.0
    return BoundingBox(min_lat, max_lat, min_lon, max_lon)


def bounding_box_for_points(points: list[tuple[float, float]], radius_m: int) -> BoundingBox:
    if not points:
        raise ValueError("at least one point is required for a bounding box")
    boxes = [circle_bounding_box(lat, lon, radius_m) for lat, lon in points]
    return BoundingBox(
        min_lat=min(box.min_lat for box in boxes),
        max_lat=max(box.max_lat for box in boxes),
        min_lon=min(box.min_lon for box in boxes),
        max_lon=max(box.max_lon for box in boxes),
    )


def is_valid_coordinate(latitude: float | None, longitude: float | None) -> bool:
    if latitude is None or longitude is None:
        return False
    return -90 <= latitude <= 90 and -180 <= longitude <= 180


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    rlat1 = radians(lat1)
    rlat2 = radians(lat2)
    a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


def centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    if not points:
        raise ValueError("Cannot compute centroid for empty points")
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def max_distance_from(lat: float, lon: float, points: list[tuple[float, float]]) -> float:
    if not points:
        return 0
    return max(haversine_m(lat, lon, point[0], point[1]) for point in points)


def snap_to_grid(latitude: float, longitude: float, decimals: int = 3) -> tuple[float, float]:
    return round(latitude, decimals), round(longitude, decimals)
