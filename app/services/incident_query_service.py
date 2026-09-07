from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crime.sources import SOURCE_SPD_CRIME
from app.models import CrimeIncident
from app.normalization.geo import BoundingBox
from app.normalization.geo import bounding_box_for_points as bounding_box_for_points
from app.schemas import CrimeIncidentData
from app.services.crime_service import _incident_data


def _effective_sources(
    sources: Sequence[str] | None, source_dataset: str
) -> tuple[str, ...]:
    """Resolve the source filter. ``sources`` (a layer's datasets) wins when given;
    otherwise fall back to the single ``source_dataset`` for back-compatible callers."""
    if sources is not None:
        return tuple(sources)
    return (source_dataset,)

def incidents_in_bbox(
    session: Session,
    *,
    box: BoundingBox,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
    source_dataset: str = SOURCE_SPD_CRIME,
    sources: Sequence[str] | None = None,
) -> list[CrimeIncidentData]:
    start_at = datetime.combine(analysis_start_date, time.min, tzinfo=UTC)
    end_at = datetime.combine(analysis_end_date, time.max, tzinfo=UTC)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset.in_(_effective_sources(sources, source_dataset)))
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
