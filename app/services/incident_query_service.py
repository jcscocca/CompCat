from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from math import cos, radians

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CrimeIncident
from app.schemas import CrimeIncidentData
from app.services.crime_service import _incident_data

METERS_PER_LATITUDE_DEGREE = 111_320
MIN_LONGITUDE_COSINE = 0.01


@dataclass(frozen=True)
class BoundingBox:
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


def bounding_box_for_points(points: list[tuple[float, float]], radius_m: int) -> BoundingBox:
    if not points:
        raise ValueError("at least one point is required for a bounding box")
    lats = [lat for lat, _ in points]
    lons = [lon for _, lon in points]
    mean_lat = sum(lats) / len(lats)
    lat_pad = radius_m / METERS_PER_LATITUDE_DEGREE
    lon_scale = max(abs(cos(radians(mean_lat))), MIN_LONGITUDE_COSINE)
    lon_pad = radius_m / (METERS_PER_LATITUDE_DEGREE * lon_scale)
    return BoundingBox(
        min_lat=min(lats) - lat_pad,
        max_lat=max(lats) + lat_pad,
        min_lon=min(lons) - lon_pad,
        max_lon=max(lons) + lon_pad,
    )


def incidents_in_bbox(
    session: Session,
    *,
    box: BoundingBox,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
) -> list[CrimeIncidentData]:
    start_at = datetime.combine(analysis_start_date, time.min, tzinfo=UTC)
    end_at = datetime.combine(analysis_end_date, time.max, tzinfo=UTC)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.latitude.is_not(None))
        .where(CrimeIncident.longitude.is_not(None))
        .where(CrimeIncident.latitude >= box.min_lat)
        .where(CrimeIncident.latitude <= box.max_lat)
        .where(CrimeIncident.longitude >= box.min_lon)
        .where(CrimeIncident.longitude <= box.max_lon)
        .where(observed >= start_at)
        .where(observed <= end_at)
    )
    if offense_category is not None:
        stmt = stmt.where(CrimeIncident.offense_category == offense_category)
    if offense_subcategory is not None:
        stmt = stmt.where(CrimeIncident.offense_subcategory == offense_subcategory)
    if nibrs_group is not None:
        stmt = stmt.where(CrimeIncident.nibrs_group == nibrs_group)
    return [_incident_data(row) for row in session.scalars(stmt).all()]
