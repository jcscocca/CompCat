"""Viewport incident locations for the map's dot layer.

Coordinates are clamped to the Seattle bounds before querying, which structurally
excludes the arrests unknown-location sentinel (-1.0/-1.0). ``unmappable_citywide_count``
counts rows citywide — not bbox-scoped, since a NULL coordinate can't be bboxed —
matching the same non-spatial filters whose location was redacted at the source;
they exist only in beat-level statistics.

The public coordinates are reported at block level, so many records can legitimately share
the exact same latitude/longitude. Returning those rows individually makes them draw
on top of one another and visually hides their multiplicity. This service therefore returns
one map feature per coordinate pair with ``record_count``. The payload cap applies to those
block locations, ordered by their latest matching record, rather than to raw rows.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.dashboard_schemas import (
    SEATTLE_EAST,
    SEATTLE_NORTH,
    SEATTLE_SOUTH,
    SEATTLE_WEST,
    MapBounds,
)
from app.crime.sources import LAYERS, sources_for_layer
from app.models import CrimeIncident
from app.services.dashboard_analysis_service import validate_date_range
from app.time_contract import seattle_wall_clock_json

INCIDENT_POINTS_LIMIT = 5000


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

    def common_non_spatial(statement: Select) -> Select:
        statement = (
            statement.where(observed_at >= start_at)
            .where(observed_at <= end_at)
        )
        if offense_category:
            statement = statement.where(CrimeIncident.offense_category == offense_category)
        if offense_subcategory:
            statement = statement.where(CrimeIncident.offense_subcategory == offense_subcategory)
        if nibrs_group:
            statement = statement.where(CrimeIncident.nibrs_group == nibrs_group)
        return statement

    def non_spatial(statement: Select) -> Select:
        return common_non_spatial(statement).where(
            CrimeIncident.source_dataset.in_(sources)
        )

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
    # SPD uses both null coordinates and (-1, -1) for records whose public location cannot
    # be mapped. The Seattle viewport clamp keeps the sentinel off the map; count it here so
    # the completeness disclosure does not silently treat those rows as located.
    unmappable_predicate = or_(
        CrimeIncident.latitude.is_(None),
        CrimeIncident.longitude.is_(None),
        and_(CrimeIncident.latitude == -1.0, CrimeIncident.longitude == -1.0),
    )

    def spatial(statement: Select) -> Select:
        return statement.where(spatial_predicate)

    # Return the three active-filter totals together so the layer switch communicates their
    # different volumes before the audience changes layers. Conditional aggregates keep this
    # to one count query rather than fetching three point payloads.
    layer_total_columns = [
        func.count()
        .filter(
            and_(
                spatial_predicate,
                CrimeIncident.source_dataset.in_(layer_sources),
            )
        )
        .label(layer_name)
        for layer_name, layer_sources in LAYERS.items()
    ]
    count_row = session.execute(
        common_non_spatial(
            select(
                *layer_total_columns,
                func.count()
                .filter(
                    and_(
                        CrimeIncident.source_dataset.in_(sources),
                        unmappable_predicate,
                    )
                )
                .label("unmappable_citywide_count"),
            ).select_from(CrimeIncident)
        )
    ).one()
    layer_totals = {
        layer_name: int(getattr(count_row, layer_name) or 0)
        for layer_name in LAYERS
    }
    total_count = layer_totals[layer]
    unmappable_citywide_count = int(count_row.unmappable_citywide_count or 0)
    # Aggregate before limiting. Block-level source coordinates often repeat, and raw rows
    # at the same pair become indistinguishable overlapping dots after client-side clustering
    # ends. Maxima below are used only as representative metadata: stacked-location cards do
    # not present them as a single offense/address.
    location_groups = (
        spatial(
            non_spatial(
                select(
                    CrimeIncident.latitude.label("latitude"),
                    CrimeIncident.longitude.label("longitude"),
                    func.count().label("record_count"),
                    func.max(observed_at).label("latest_observed_at"),
                    func.max(CrimeIncident.id).label("incident_id"),
                    func.max(CrimeIncident.offense_category).label("offense_category"),
                    func.max(CrimeIncident.offense_subcategory).label("offense_subcategory"),
                    func.max(CrimeIncident.block_address).label("block_address"),
                    func.max(CrimeIncident.source_dataset).label("source_dataset"),
                )
            )
        )
        .group_by(CrimeIncident.latitude, CrimeIncident.longitude)
        .subquery()
    )
    total_location_count = session.scalar(
        select(func.count()).select_from(location_groups)
    ) or 0
    rows = session.execute(
        select(location_groups)
        .order_by(location_groups.c.latest_observed_at.desc())
        .limit(limit)
    ).all()

    points = []
    for row in rows:
        record_count = int(row.record_count)
        points.append(
            {
                "id": (
                    row.incident_id
                    if record_count == 1
                    else f"location:{row.latitude:.6f},{row.longitude:.6f}"
                ),
                "latitude": row.latitude,
                "longitude": row.longitude,
                "record_count": record_count,
                "offense_category": row.offense_category,
                "offense_subcategory": row.offense_subcategory,
                "occurred_at": seattle_wall_clock_json(row.latest_observed_at),
                "block_address": row.block_address,
                "source_dataset": row.source_dataset,
            }
        )
    represented_count = sum(point["record_count"] for point in points)
    return {
        "points": points,
        # Record counts and plotted-location counts are deliberately separate. One returned
        # point can represent many rows that share a block-level coordinate.
        "returned_count": represented_count,
        "total_count": total_count,
        "returned_location_count": len(points),
        "total_location_count": total_location_count,
        "layer_totals": layer_totals,
        "unmappable_citywide_count": unmappable_citywide_count,
        "limit": limit,
    }
