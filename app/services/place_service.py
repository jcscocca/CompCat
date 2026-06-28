from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PlaceCluster
from app.schemas import PlaceClusterData

SENSITIVE_CLASSES = {
    "home_candidate",
    "work_candidate",
    "health_candidate",
    "religious_candidate",
    "suppress_from_public_export",
}


def list_places(
    session: Session,
    user_id_hash: str,
    include_sensitive: bool = False,
) -> list[PlaceClusterData]:
    statement = select(PlaceCluster).where(PlaceCluster.user_id_hash == user_id_hash)
    if not include_sensitive:
        statement = statement.where(PlaceCluster.sensitivity_class.not_in(SENSITIVE_CLASSES))
    rows = session.scalars(statement.order_by(PlaceCluster.visit_count.desc())).all()
    return [_cluster_data(row) for row in rows]


def get_place(session: Session, place_id: str, user_id_hash: str) -> PlaceCluster | None:
    return session.scalar(
        select(PlaceCluster).where(
            PlaceCluster.id == place_id,
            PlaceCluster.user_id_hash == user_id_hash,
        )
    )


def _cluster_data(row: PlaceCluster) -> PlaceClusterData:
    return PlaceClusterData(
        id=row.id,
        user_id_hash=row.user_id_hash,
        cluster_version=row.cluster_version,
        cluster_method=row.cluster_method,
        centroid_latitude=row.centroid_latitude,
        centroid_longitude=row.centroid_longitude,
        display_latitude=row.display_latitude,
        display_longitude=row.display_longitude,
        cluster_radius_m=row.cluster_radius_m,
        visit_count=row.visit_count,
        total_dwell_minutes=row.total_dwell_minutes,
        median_dwell_minutes=row.median_dwell_minutes,
        first_seen_utc=row.first_seen_utc,
        last_seen_utc=row.last_seen_utc,
        dominant_days=row.dominant_days,
        dominant_hours=row.dominant_hours,
        inferred_place_type=row.inferred_place_type,
        sensitivity_class=row.sensitivity_class,
        display_label=row.display_label,
        label_source=row.label_source,
    )
