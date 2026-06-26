from __future__ import annotations

from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import PlaceCluster, PlaceCrimeSummary
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
    summaries = (
        session.scalars(
            select(PlaceCrimeSummary).where(PlaceCrimeSummary.analysis_run_id == run_id)
        ).all()
        if run_id is not None
        else []
    )
    privacy_counts = Counter(cluster.sensitivity_class for cluster in clusters)
    return {
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
        "analysis": {"available_radii_m": settings.crime_radii_m},
        "exports": {"tableau_place_summary_csv": "/exports/tableau/place-summary.csv"},
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
    }
