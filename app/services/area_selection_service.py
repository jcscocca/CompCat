"""Stateless polygon selection summaries, records, highlights, and CSV rows."""

from __future__ import annotations

import base64
import csv
import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Iterator
from datetime import UTC, datetime, time
from io import StringIO
from math import floor
from typing import Any

from shapely.geometry import Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.analysis.temporal import local_hour_dow
from app.api.dashboard_schemas import (
    SEATTLE_EAST,
    SEATTLE_NORTH,
    SEATTLE_SOUTH,
    SEATTLE_WEST,
    AreaSelectionRecordsRequest,
    AreaSelectionRequest,
)
from app.crime.sources import sources_for_layer
from app.exports.tableau import escape_formula_cell
from app.models import CrimeIncident
from app.time_contract import seattle_wall_clock_json

AREA_HIGHLIGHT_LIMIT = 5000
AREA_TYPE_LIMIT = 12
MIN_POLYGON_AREA = 1e-10
_SEATTLE_GEOMETRY = box(SEATTLE_WEST, SEATTLE_SOUTH, SEATTLE_EAST, SEATTLE_NORTH)

AREA_EXPORT_COLUMNS = [
    "selection_id",
    "layer",
    "analysis_start_date",
    "analysis_end_date",
    "offense_category_filter",
    "offense_subcategory_filter",
    "nibrs_group_filter",
    "selected_type_filters",
    "selected_hour_filters",
    "selected_day_filters",
    "incident_id",
    "external_incident_id",
    "report_number",
    "occurred_at",
    "reported_at",
    "offense_category",
    "offense_subcategory",
    "nibrs_group",
    "block_address",
    "latitude",
    "longitude",
    "source_dataset",
]


def area_selection_summary(
    session: Session,
    request: AreaSelectionRequest,
) -> dict[str, object]:
    area = _validated_area(request)
    category_counts: Counter[str] = Counter()
    hour_counts = [0] * 24
    dow_counts = [0] * 7
    hour_by_dow = [[0] * 24 for _ in range(7)]
    with_time = 0
    without_time = 0
    record_count = 0
    location_counts: Counter[tuple[float, float]] = Counter()

    for incident in _iter_matching_incidents(session, request, area):
        record_count += 1
        latitude = float(incident.latitude)
        longitude = float(incident.longitude)
        location_counts[(round(longitude, 6), round(latitude, 6))] += 1
        category_counts[_type_label(incident)] += 1
        observed = incident.offense_start_utc
        if observed is None:
            without_time += 1
            continue
        with_time += 1
        hour, dow = local_hour_dow(observed)
        hour_counts[hour] += 1
        dow_counts[dow] += 1
        hour_by_dow[dow][hour] += 1

    return {
        "selection_id": _scope_digest(request),
        "record_count": record_count,
        "location_count": len(location_counts),
        "counting_basis": "records with mappable coordinates inside the selected area",
        "type_mix": _type_mix(category_counts, record_count),
        "temporal": {
            "hour_counts": hour_counts,
            "dow_counts": dow_counts,
            "hour_by_dow": hour_by_dow,
            "total_with_time": with_time,
            "without_time": without_time,
        },
        **_highlight_payload(location_counts),
    }


def area_selection_records(
    session: Session,
    request: AreaSelectionRecordsRequest,
) -> dict[str, object]:
    area = _validated_area(request)
    cursor = _decode_cursor(request.cursor, request) if request.cursor else None
    matches: list[CrimeIncident] = []
    for incident in _iter_matching_incidents(
        session,
        request,
        area,
        cursor=cursor,
        ordered=True,
    ):
        matches.append(incident)
        if len(matches) > request.page_size:
            break

    has_more = len(matches) > request.page_size
    page = matches[: request.page_size]
    next_cursor = _encode_cursor(page[-1], request) if has_more and page else None
    return {
        "selection_id": _scope_digest(request),
        "records": [_record_payload(incident) for incident in page],
        "returned_count": len(page),
        "page_size": request.page_size,
        "next_cursor": next_cursor,
    }


def area_selection_csv_rows(
    session: Session,
    request: AreaSelectionRequest,
) -> Iterator[str]:
    """Yield RFC 4180 CSV rows without materializing a potentially large export."""

    area = _validated_area(request)
    selection_id = _scope_digest(request)
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=AREA_EXPORT_COLUMNS, lineterminator="\r\n")
    writer.writeheader()
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)

    for incident in _iter_matching_incidents(session, request, area, ordered=True):
        payload = _record_payload(incident)
        row = {
            "selection_id": selection_id,
            "layer": request.layer,
            "analysis_start_date": request.analysis_start_date.isoformat(),
            "analysis_end_date": request.analysis_end_date.isoformat(),
            "offense_category_filter": request.offense_category or "",
            "offense_subcategory_filter": request.offense_subcategory or "",
            "nibrs_group_filter": request.nibrs_group or "",
            "selected_type_filters": json.dumps(request.selected_types),
            "selected_hour_filters": json.dumps(request.selected_hours),
            "selected_day_filters": json.dumps(request.selected_days),
            **payload,
        }
        writer.writerow({key: escape_formula_cell(value) for key, value in row.items()})
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)


def _validated_area(request: AreaSelectionRequest) -> BaseGeometry:
    ring = request.geometry.coordinates[0]
    polygon = Polygon(ring)
    if not polygon.is_valid:
        raise ValueError("area selection polygon crosses itself; redraw a simpler shape")
    if polygon.is_empty or polygon.area < MIN_POLYGON_AREA:
        raise ValueError("area selection is too small")
    clipped = polygon.intersection(_SEATTLE_GEOMETRY)
    if clipped.is_empty or clipped.area < MIN_POLYGON_AREA:
        raise ValueError("area selection is outside the Seattle data area")
    return clipped


def _candidate_statement(
    request: AreaSelectionRequest,
    area: BaseGeometry,
    *,
    cursor: tuple[datetime, str] | None = None,
    ordered: bool = False,
):
    observed_at = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    start_at = datetime.combine(request.analysis_start_date, time.min, tzinfo=UTC)
    end_at = datetime.combine(request.analysis_end_date, time.max, tzinfo=UTC)
    west, south, east, north = area.bounds
    statement = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset.in_(sources_for_layer(request.layer)))
        .where(observed_at >= start_at)
        .where(observed_at <= end_at)
        .where(CrimeIncident.latitude >= south)
        .where(CrimeIncident.latitude <= north)
        .where(CrimeIncident.longitude >= west)
        .where(CrimeIncident.longitude <= east)
    )
    if request.offense_category is not None:
        statement = statement.where(CrimeIncident.offense_category == request.offense_category)
    if request.offense_subcategory is not None:
        statement = statement.where(
            CrimeIncident.offense_subcategory == request.offense_subcategory
        )
    if request.nibrs_group is not None:
        statement = statement.where(CrimeIncident.nibrs_group == request.nibrs_group)
    if cursor is not None:
        cursor_time, cursor_id = cursor
        statement = statement.where(
            or_(
                observed_at < cursor_time,
                and_(observed_at == cursor_time, CrimeIncident.id < cursor_id),
            )
        )
    if ordered:
        statement = statement.order_by(observed_at.desc(), CrimeIncident.id.desc())
    return statement


def _iter_matching_incidents(
    session: Session,
    request: AreaSelectionRequest,
    area: BaseGeometry,
    *,
    cursor: tuple[datetime, str] | None = None,
    ordered: bool = False,
) -> Iterator[CrimeIncident]:
    prepared = prep(area)
    selected_types = set(request.selected_types)
    selected_hours = set(request.selected_hours)
    selected_days = set(request.selected_days)
    rows = session.scalars(
        _candidate_statement(request, area, cursor=cursor, ordered=ordered)
    ).yield_per(1000)
    for incident in rows:
        if incident.latitude is None or incident.longitude is None:
            continue
        if not prepared.covers(Point(float(incident.longitude), float(incident.latitude))):
            continue
        if selected_types and _type_label(incident) not in selected_types:
            continue
        if selected_hours or selected_days:
            observed = incident.offense_start_utc
            if observed is None:
                continue
            hour, day = local_hour_dow(observed)
            if selected_hours and hour not in selected_hours:
                continue
            if selected_days and day not in selected_days:
                continue
        yield incident


def _type_label(incident: CrimeIncident) -> str:
    return incident.offense_subcategory or incident.offense_category or "Uncategorized"


def _type_mix(counts: Counter[str], total: int) -> list[dict[str, object]]:
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold()))
    if len(ordered) > AREA_TYPE_LIMIT:
        shown = ordered[: AREA_TYPE_LIMIT - 1]
        shown.append(("Other", sum(count for _, count in ordered[AREA_TYPE_LIMIT - 1 :])))
    else:
        shown = ordered
    return [
        {"label": label, "count": count, "share": count / total if total else 0.0}
        for label, count in shown
    ]


def _highlight_payload(
    location_counts: Counter[tuple[float, float]],
) -> dict[str, object]:
    if len(location_counts) <= AREA_HIGHLIGHT_LIMIT:
        points = [
            {
                "id": f"area:{longitude:.6f},{latitude:.6f}",
                "longitude": longitude,
                "latitude": latitude,
                "record_count": count,
                "location_count": 1,
            }
            for (longitude, latitude), count in location_counts.items()
        ]
        return {
            "highlight_mode": "locations",
            "highlight_points": points,
            "highlight_location_count": len(location_counts),
        }

    west = min(longitude for longitude, _ in location_counts)
    south = min(latitude for _, latitude in location_counts)
    cell_size = 0.0025
    cells: dict[tuple[int, int], list[float]] = {}
    while True:
        grouped: dict[tuple[int, int], list[float]] = defaultdict(lambda: [0, 0, 0, 0])
        for (longitude, latitude), count in location_counts.items():
            key = (floor((longitude - west) / cell_size), floor((latitude - south) / cell_size))
            values = grouped[key]
            values[0] += longitude
            values[1] += latitude
            values[2] += count
            values[3] += 1
        cells = dict(grouped)
        if len(cells) <= AREA_HIGHLIGHT_LIMIT or cell_size >= 0.08:
            break
        cell_size *= 2
    points = [
        {
            "id": f"area-grid:{x},{y}",
            "longitude": values[0] / values[3],
            "latitude": values[1] / values[3],
            "record_count": int(values[2]),
            "location_count": int(values[3]),
        }
        for (x, y), values in cells.items()
    ]
    return {
        "highlight_mode": "grid",
        "highlight_points": points,
        "highlight_location_count": len(location_counts),
    }


def _record_payload(incident: CrimeIncident) -> dict[str, Any]:
    return {
        "incident_id": incident.id,
        "external_incident_id": incident.external_incident_id,
        "report_number": incident.report_number,
        "occurred_at": seattle_wall_clock_json(incident.offense_start_utc),
        "reported_at": seattle_wall_clock_json(incident.report_utc),
        "offense_category": incident.offense_category,
        "offense_subcategory": incident.offense_subcategory,
        "nibrs_group": incident.nibrs_group,
        "block_address": incident.block_address,
        "latitude": incident.latitude,
        "longitude": incident.longitude,
        "source_dataset": incident.source_dataset,
    }


def _scope_digest(request: AreaSelectionRequest) -> str:
    scope = {
        "geometry": request.geometry.model_dump(mode="json"),
        "analysis_start_date": request.analysis_start_date.isoformat(),
        "analysis_end_date": request.analysis_end_date.isoformat(),
        "layer": request.layer,
        "offense_category": request.offense_category,
        "offense_subcategory": request.offense_subcategory,
        "nibrs_group": request.nibrs_group,
        "selected_types": sorted(request.selected_types),
        "selected_hours": sorted(request.selected_hours),
        "selected_days": sorted(request.selected_days),
    }
    encoded = json.dumps(scope, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()[:20]


def _observed_at(incident: CrimeIncident) -> datetime:
    observed = incident.offense_start_utc or incident.report_utc
    if observed is None:  # excluded by the date predicate; defensive for type narrowing
        raise ValueError("selected record has no primary timestamp")
    return observed


def _encode_cursor(incident: CrimeIncident, request: AreaSelectionRequest) -> str:
    payload = {
        "at": _observed_at(incident).isoformat(),
        "id": incident.id,
        "scope": _scope_digest(request),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(
    cursor: str,
    request: AreaSelectionRequest,
) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw)
        timestamp = datetime.fromisoformat(payload["at"])
        incident_id = str(payload["id"])
        scope = str(payload["scope"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("invalid area-selection cursor") from exc
    if scope != _scope_digest(request):
        raise ValueError("area-selection cursor does not match the current selection")
    return timestamp, incident_id
