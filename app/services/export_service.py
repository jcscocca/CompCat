from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exports.tableau import build_place_summary_csv
from app.models import PlaceCluster, PlaceCrimeSummary
from app.schemas import PlaceCrimeSummaryData
from app.services.analysis_runs import latest_analysis_run_id
from app.services.crime_service import _cluster_data


def tableau_place_summary_csv(session: Session, user_id_hash: str) -> str:
    clusters = [
        _cluster_data(row)
        for row in session.scalars(
            select(PlaceCluster).where(PlaceCluster.user_id_hash == user_id_hash)
        ).all()
    ]
    run_id = latest_analysis_run_id(session, user_id_hash)
    summaries = (
        [
            _summary_data(row)
            for row in session.scalars(
                select(PlaceCrimeSummary).where(PlaceCrimeSummary.analysis_run_id == run_id)
            ).all()
        ]
        if run_id is not None
        else []
    )
    return build_place_summary_csv(clusters, summaries, tableau_safe=True)


def _summary_data(row: PlaceCrimeSummary) -> PlaceCrimeSummaryData:
    return PlaceCrimeSummaryData(
        id=row.id,
        user_id_hash=row.user_id_hash,
        place_cluster_id=row.place_cluster_id,
        radius_m=row.radius_m,
        analysis_start_date=row.analysis_start_date,
        analysis_end_date=row.analysis_end_date,
        offense_category=row.offense_category,
        offense_subcategory=row.offense_subcategory,
        nibrs_group=row.nibrs_group,
        incident_count=row.incident_count,
        nearest_incident_m=row.nearest_incident_m,
        incidents_per_visit=row.incidents_per_visit,
        incidents_per_hour_dwell=row.incidents_per_hour_dwell,
    )
