from __future__ import annotations

import json
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AnalysisRun, PlaceCluster, PlaceCrimeSummary
from app.services.analysis_runs import latest_analysis_run_id


def dashboard_summary(
    session: Session,
    user_id_hash: str,
    settings: Settings,
) -> dict[str, object]:
    clusters = session.scalars(
        select(PlaceCluster)
        .where(PlaceCluster.user_id_hash == user_id_hash)
        .order_by(PlaceCluster.visit_count.desc(), PlaceCluster.display_label.asc())
    ).all()
    run_id = latest_analysis_run_id(session, user_id_hash)
    run = session.get(AnalysisRun, run_id) if run_id is not None else None
    summaries = (
        session.scalars(
            select(PlaceCrimeSummary).where(PlaceCrimeSummary.analysis_run_id == run_id)
        ).all()
        if run_id is not None
        else []
    )
    privacy_counts = Counter(cluster.sensitivity_class for cluster in clusters)
    # The layer the persisted totals were computed for (null/legacy rows read as "reported"),
    # so the UI labels counts as reported incidents vs 911 calls rather than guessing.
    summary_layer = (run.layer if run is not None else None) or next(
        (s.layer for s in summaries if s.layer), "reported"
    )
    return {
        "layer": summary_layer,
        "totals": {
            "place_count": len(clusters),
            "visit_count": sum(cluster.visit_count for cluster in clusters),
            "incident_count": sum(summary.incident_count for summary in summaries),
        },
        "privacy": {
            "normal": privacy_counts.get("normal", 0),
            "home_candidate": privacy_counts.get("home_candidate", 0),
            "work_candidate": privacy_counts.get("work_candidate", 0),
            "suppressed": sum(
                count for label, count in privacy_counts.items() if label != "normal"
            ),
        },
        "places": [_place_payload(cluster) for cluster in clusters],
        "crime_summaries": [_summary_payload(summary) for summary in summaries],
        "analysis": {
            "available_radii_m": settings.crime_radii_m,
            # Rows are grouped by observed offense dimensions, so their category columns
            # cannot prove which filters originated the run. Publish the existing AnalysisRun
            # provenance additively; older clients ignore it and newer clients can fail closed.
            "persisted_scope": _analysis_run_payload(run),
        },
        "exports": {
            "tableau_place_summary_csv": "/exports/tableau/place-summary.csv",
            "analysis_csv": "/exports/analysis.csv",
        },
    }


def _place_payload(cluster: PlaceCluster) -> dict[str, object]:
    return {
        "id": cluster.id,
        "display_label": cluster.display_label,
        "latitude": cluster.display_latitude,
        "longitude": cluster.display_longitude,
        "visit_count": cluster.visit_count,
        "total_dwell_minutes": cluster.total_dwell_minutes,
        "median_dwell_minutes": cluster.median_dwell_minutes,
        "inferred_place_type": cluster.inferred_place_type,
        "sensitivity_class": cluster.sensitivity_class,
        "dominant_days": cluster.dominant_days,
        "dominant_hours": cluster.dominant_hours,
    }


def _summary_payload(summary: PlaceCrimeSummary) -> dict[str, object]:
    return {
        "place_cluster_id": summary.place_cluster_id,
        "radius_m": summary.radius_m,
        "analysis_start_date": summary.analysis_start_date,
        "analysis_end_date": summary.analysis_end_date,
        "offense_category": summary.offense_category,
        "offense_subcategory": summary.offense_subcategory,
        "nibrs_group": summary.nibrs_group,
        "incident_count": summary.incident_count,
        "nearest_incident_m": summary.nearest_incident_m,
        "incidents_per_visit": summary.incidents_per_visit,
        "incidents_per_hour_dwell": summary.incidents_per_hour_dwell,
        "analysis_run_id": summary.analysis_run_id,
        "layer": summary.layer,
    }


def _analysis_run_payload(run: AnalysisRun | None) -> dict[str, object] | None:
    if run is None:
        return None
    return {
        "run_id": run.id,
        "place_ids": _string_list(run.place_ids_json),
        "radii_m": _integer_list(run.radii_m_json),
        "analysis_start_date": run.analysis_start_date,
        "analysis_end_date": run.analysis_end_date,
        "offense_category": run.offense_category,
        "offense_subcategory": run.offense_subcategory,
        "nibrs_group": run.nibrs_group,
        "layer": run.layer or "reported",
    }


def _string_list(raw: str | None) -> list[str] | None:
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return None
    return value


def _integer_list(raw: str) -> list[int] | None:
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(value, list) or not all(
        isinstance(item, int) and not isinstance(item, bool) for item in value
    ):
        return None
    return value
