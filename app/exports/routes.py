from __future__ import annotations

import csv
from collections.abc import Iterable, Mapping
from io import StringIO
from typing import Any

ROUTE_ALTERNATIVE_COLUMNS = [
    "user_id_hash",
    "route_request_id",
    "route_alternative_id",
    "provider_route_id",
    "route_label",
    "rank",
    "duration_minutes",
    "distance_m",
    "transfer_count",
    "walking_distance_m",
    "mode_mix",
    "provider",
    "analysis_start_date",
    "analysis_end_date",
    "radii_m",
    "layer",
    "created_at",
]

ROUTE_SEGMENT_COLUMNS = [
    "user_id_hash",
    "route_alternative_id",
    "route_segment_id",
    "sequence",
    "segment_type",
    "mode",
    "start_label",
    "start_latitude",
    "start_longitude",
    "end_label",
    "end_latitude",
    "end_longitude",
    "distance_m",
    "duration_minutes",
    "created_at",
]

ROUTE_CONTEXT_COLUMNS = [
    "user_id_hash",
    "route_alternative_id",
    "route_segment_id",
    "context_label",
    "context_type",
    "radius_m",
    "analysis_start_date",
    "analysis_end_date",
    "offense_category",
    "offense_subcategory",
    "nibrs_group",
    "incident_count",
    "nearest_incident_m",
    "incidents_per_route",
    "layer",
    "created_at",
]


def build_route_alternatives_csv(alternatives: Iterable[Mapping[str, Any]]) -> str:
    return _build_csv(ROUTE_ALTERNATIVE_COLUMNS, alternatives)


def build_route_segments_csv(segments: Iterable[Mapping[str, Any]]) -> str:
    return _build_csv(ROUTE_SEGMENT_COLUMNS, segments)


def build_route_context_csv(summaries: Iterable[Mapping[str, Any]]) -> str:
    return _build_csv(ROUTE_CONTEXT_COLUMNS, summaries)


def _build_csv(columns: list[str], rows: Iterable[Mapping[str, Any]]) -> str:
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: _csv_value(row.get(column)) for column in columns})
    return output.getvalue()


def _csv_value(value: Any) -> Any:
    if value is None:
        return ""
    return value
