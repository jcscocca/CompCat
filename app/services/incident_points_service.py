"""Viewport incident points for the map's dot layer.

Coordinates are clamped to the Seattle bounds before querying, which structurally
excludes the arrests unknown-location sentinel (-1.0/-1.0). ``unmappable_citywide_count``
counts rows citywide — not bbox-scoped, since a NULL coordinate can't be bboxed —
matching the same non-spatial filters whose location was redacted at the source;
they exist only in beat-level statistics.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.api.dashboard_schemas import (
    SEATTLE_EAST,
    SEATTLE_NORTH,
    SEATTLE_SOUTH,
    SEATTLE_WEST,
    MapBounds,
)
from app.crime.sources import sources_for_layer
from app.models import CrimeIncident
from app.services.dashboard_analysis_service import validate_date_range

INCIDENT_POINTS_LIMIT = 5000


def _utc_json(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def incident_points(
    session: Session,
    *,
    bounds: MapBounds,
    analysis_start_date: date,
    analysis_end_date: date,
    layer: str,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
    limit: int = INCIDENT_POINTS_LIMIT,
) -> dict[str, Any]:
    # Mirror the sibling endpoints: reversed dates raise ValueError (routes convert
    # to 400) rather than silently returning an empty result.
    validate_date_range(analysis_start_date, analysis_end_date)
    sources = sources_for_layer(layer)
    # Date filter + sort run on this unindexed expression; the known mitigation is a
    # Postgres expression index on coalesce(offense_start_utc, report_utc), deliberately
    # deferred — this slice ships no migrations.
    observed_at = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    start_at = datetime.combine(analysis_start_date, time.min, tzinfo=UTC)
    end_at = datetime.combine(analysis_end_date, time.max, tzinfo=UTC)

    def non_spatial(statement: Select) -> Select:
        statement = (
            statement.where(CrimeIncident.source_dataset.in_(sources))
            .where(observed_at >= start_at)
            .where(observed_at <= end_at)
        )
        if offense_category:
            statement = statement.where(CrimeIncident.offense_category == offense_category)
        if offense_subcategory:
            statement = statement.where(CrimeIncident.offense_subcategory == offense_subcategory)
        if nibrs_group:
            statement = statement.where(CrimeIncident.nibrs_group == nibrs_group)
        return statement

    west = max(bounds.west, SEATTLE_WEST)
    east = min(bounds.east, SEATTLE_EAST)
    south = max(bounds.south, SEATTLE_SOUTH)
    north = min(bounds.north, SEATTLE_NORTH)

    spatial_predicate = and_(
        CrimeIncident.latitude.is_not(None),
        CrimeIncident.longitude.is_not(None),
        CrimeIncident.latitude >= south,
        CrimeIncident.latitude <= north,
        CrimeIncident.longitude >= west,
        CrimeIncident.longitude <= east,
    )

    def spatial(statement: Select) -> Select:
        return statement.where(spatial_predicate)

    total_count, unmappable_citywide_count = session.execute(
        non_spatial(
            select(
                func.count().filter(spatial_predicate),
                func.count().filter(CrimeIncident.latitude.is_(None)),
            ).select_from(CrimeIncident)
        )
    ).one()
    total_count = total_count or 0
    unmappable_citywide_count = unmappable_citywide_count or 0
    rows = session.execute(
        spatial(
            non_spatial(
                select(
                    CrimeIncident.id,
                    CrimeIncident.latitude,
                    CrimeIncident.longitude,
                    CrimeIncident.offense_category,
                    CrimeIncident.offense_subcategory,
                    CrimeIncident.offense_start_utc,
                    CrimeIncident.report_utc,
                    CrimeIncident.block_address,
                    CrimeIncident.source_dataset,
                )
            )
        )
        .order_by(observed_at.desc())
        .limit(limit)
    ).all()

    points = [
        {
            "id": row.id,
            "latitude": row.latitude,
            "longitude": row.longitude,
            "offense_category": row.offense_category,
            "offense_subcategory": row.offense_subcategory,
            "occurred_at": _utc_json(row.offense_start_utc or row.report_utc),
            "block_address": row.block_address,
            "source_dataset": row.source_dataset,
        }
        for row in rows
    ]
    return {
        "points": points,
        "returned_count": len(points),
        "total_count": total_count,
        "unmappable_citywide_count": unmappable_citywide_count,
        "limit": limit,
    }
