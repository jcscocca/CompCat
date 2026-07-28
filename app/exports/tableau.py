from __future__ import annotations

import csv
from io import StringIO

from app.normalization.geo import snap_to_grid
from app.schemas import PlaceClusterData, PlaceCrimeSummaryData

SENSITIVE_CLASSES = {
    "home_candidate",
    "work_candidate",
    "health_candidate",
    "religious_candidate",
    "suppress_from_public_export",
}

# Spreadsheet apps evaluate a cell starting with one of these as a formula, so a
# user-supplied display_label (or an upstream Socrata offense name) can turn an export
# into code execution on the analyst's machine. A leading apostrophe makes the cell
# literal text. A bare "-" is deliberately NOT included: it would mangle every negative
# number, and numeric cells are written as floats/ints that never reach this escape.
_FORMULA_PREFIXES = ("=", "+", "@", "\t", "\r")


def _escape_formula(value: object) -> object:
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return f"'{value}"
    return value


TABLEAU_COLUMNS = [
    "user_id_hash",
    "place_cluster_id",
    "display_label",
    "latitude",
    "longitude",
    "cluster_radius_m",
    "visit_count",
    "total_dwell_minutes",
    "median_dwell_minutes",
    "inferred_place_type",
    "sensitivity_class",
    "radius_m",
    "analysis_start_date",
    "analysis_end_date",
    "offense_category",
    "offense_subcategory",
    "nibrs_group",
    "incident_count",
    "nearest_incident_m",
    "incidents_per_visit",
    "incidents_per_hour_dwell",
    "layer",
]


def build_place_summary_csv(
    clusters: list[PlaceClusterData],
    summaries: list[PlaceCrimeSummaryData],
    tableau_safe: bool = True,
) -> str:
    summaries_by_cluster: dict[str, list[PlaceCrimeSummaryData]] = {}
    for summary in summaries:
        summaries_by_cluster.setdefault(summary.place_cluster_id, []).append(summary)

    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=TABLEAU_COLUMNS)
    writer.writeheader()
    for cluster in clusters:
        if tableau_safe and cluster.sensitivity_class in SENSITIVE_CLASSES:
            continue
        cluster_summaries = summaries_by_cluster.get(cluster.id) or [None]
        for summary in cluster_summaries:
            row = _row_for_cluster(cluster, summary)
            writer.writerow({key: _escape_formula(value) for key, value in row.items()})
    return output.getvalue()


def _row_for_cluster(
    cluster: PlaceClusterData,
    summary: PlaceCrimeSummaryData | None,
) -> dict[str, object]:
    latitude = cluster.display_latitude
    longitude = cluster.display_longitude
    if latitude is None or longitude is None:
        latitude, longitude = snap_to_grid(cluster.centroid_latitude, cluster.centroid_longitude)
    return {
        "user_id_hash": cluster.user_id_hash,
        "place_cluster_id": cluster.id,
        "display_label": cluster.display_label or "Recurring area",
        "latitude": latitude,
        "longitude": longitude,
        "cluster_radius_m": cluster.cluster_radius_m,
        "visit_count": cluster.visit_count,
        "total_dwell_minutes": cluster.total_dwell_minutes,
        "median_dwell_minutes": cluster.median_dwell_minutes,
        "inferred_place_type": cluster.inferred_place_type,
        "sensitivity_class": cluster.sensitivity_class
        if cluster.sensitivity_class == "normal"
        else "suppressed",
        "radius_m": summary.radius_m if summary else "",
        "analysis_start_date": summary.analysis_start_date if summary else "",
        "analysis_end_date": summary.analysis_end_date if summary else "",
        "offense_category": summary.offense_category if summary else "",
        "offense_subcategory": summary.offense_subcategory if summary else "",
        "nibrs_group": summary.nibrs_group if summary else "",
        "incident_count": summary.incident_count if summary else "",
        "nearest_incident_m": summary.nearest_incident_m if summary else "",
        "incidents_per_visit": summary.incidents_per_visit if summary else "",
        "incidents_per_hour_dwell": summary.incidents_per_hour_dwell if summary else "",
        # Which layer produced the summary, so the export isn't ambiguous between reported
        # incidents and 911 calls; legacy/null rows are reported.
        "layer": (summary.layer or "reported") if summary else "",
    }
