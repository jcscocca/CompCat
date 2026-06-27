from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    ImportBatch,
    PlaceCluster,
    PlaceCrimeSummary,
    StagingLocationObservation,
    StopVisit,
)
from app.normalization.clusters import (
    CLUSTER_METHOD,
    cluster_stop_visits,
    infer_sensitive_locations,
)
from app.normalization.stops import detect_stops_from_observations, source_stop_to_stop_visit
from app.schemas import LocationObservation, PlaceClusterData, SourceStop, StopVisitData


def normalize_import(
    session: Session,
    import_id: str,
    user_id_hash: str,
    settings: Settings,
) -> dict[str, int]:
    batch = session.get(ImportBatch, import_id)
    if batch is None or batch.user_id_hash != user_id_hash:
        raise ValueError("Import not found")
    _delete_existing_normalization(session, import_id, user_id_hash)
    staging_rows = session.scalars(
        select(StagingLocationObservation).where(StagingLocationObservation.import_id == import_id)
    ).all()
    source_stops: list[SourceStop] = []
    observations: list[LocationObservation] = []
    for row in staging_rows:
        if row.source_record_type == "placeVisit" and row.start_time_utc and row.end_time_utc:
            source_stops.append(
                SourceStop(
                    source_type=batch.source_type,
                    source_record_type=row.source_record_type,
                    source_record_hash=row.source_record_hash,
                    start_time_utc=row.start_time_utc,
                    end_time_utc=row.end_time_utc,
                    latitude=row.latitude,
                    longitude=row.longitude,
                    accuracy_m=row.accuracy_m,
                    activity_type=row.activity_type,
                    confidence_score=row.confidence_score,
                    display_label=row.display_label,
                )
            )
        else:
            observations.append(
                LocationObservation(
                    source_type=batch.source_type,
                    source_record_type=row.source_record_type,
                    source_record_hash=row.source_record_hash,
                    observed_at_utc=row.observed_at_utc,
                    start_time_utc=row.start_time_utc,
                    end_time_utc=row.end_time_utc,
                    latitude=row.latitude,
                    longitude=row.longitude,
                    accuracy_m=row.accuracy_m,
                    activity_type=row.activity_type,
                    confidence_score=row.confidence_score,
                )
            )
    stops = [
        source_stop_to_stop_visit(source_stop, import_id=import_id, user_id_hash=user_id_hash)
        for source_stop in source_stops
    ]
    stops.extend(
        detect_stops_from_observations(
            observations,
            import_id=import_id,
            user_id_hash=user_id_hash,
            minimum_stop_duration_minutes=settings.minimum_stop_duration_minutes,
            stop_radius_m=settings.stop_radius_m,
        )
    )
    clusters = cluster_stop_visits(
        stops,
        cluster_radius_m=settings.cluster_radius_m,
        minimum_cluster_visits=settings.minimum_cluster_visits,
        minimum_cluster_total_dwell_minutes=settings.minimum_cluster_total_dwell_minutes,
    )
    infer_sensitive_locations(clusters, stops)
    session.add_all([_stop_model(stop) for stop in stops])
    session.add_all([_cluster_model(cluster) for cluster in clusters])
    batch.status = "normalized"
    session.commit()
    return {"stop_visit_count": len(stops), "place_cluster_count": len(clusters)}


def _delete_existing_normalization(session: Session, import_id: str, user_id_hash: str) -> None:
    cluster_ids = list(
        session.scalars(
            select(PlaceCluster.id).where(
                PlaceCluster.user_id_hash == user_id_hash,
                PlaceCluster.cluster_method == CLUSTER_METHOD,
            )
        )
    )
    if cluster_ids:
        session.execute(
            delete(PlaceCrimeSummary).where(PlaceCrimeSummary.place_cluster_id.in_(cluster_ids))
        )
    session.execute(delete(StopVisit).where(StopVisit.import_id == import_id))
    session.execute(
        delete(PlaceCluster).where(
            PlaceCluster.user_id_hash == user_id_hash,
            PlaceCluster.cluster_method == CLUSTER_METHOD,
        )
    )
    session.flush()


def _stop_model(stop: StopVisitData) -> StopVisit:
    return StopVisit(
        id=stop.id,
        import_id=stop.import_id,
        user_id_hash=stop.user_id_hash,
        place_cluster_id=stop.place_cluster_id,
        start_time_utc=stop.start_time_utc,
        end_time_utc=stop.end_time_utc,
        duration_minutes=stop.duration_minutes,
        local_date=stop.local_date,
        local_day_of_week=stop.local_day_of_week,
        local_hour_start=stop.local_hour_start,
        centroid_latitude=stop.centroid_latitude,
        centroid_longitude=stop.centroid_longitude,
        radius_m=stop.radius_m,
        accuracy_median_m=stop.accuracy_median_m,
        source_basis=stop.source_basis,
        point_count_used=stop.point_count_used,
        confidence_score=stop.confidence_score,
        display_label=stop.display_label,
    )


def _cluster_model(cluster: PlaceClusterData) -> PlaceCluster:
    return PlaceCluster(
        id=cluster.id,
        user_id_hash=cluster.user_id_hash,
        cluster_version=cluster.cluster_version,
        cluster_method=cluster.cluster_method,
        centroid_latitude=cluster.centroid_latitude,
        centroid_longitude=cluster.centroid_longitude,
        display_latitude=cluster.display_latitude,
        display_longitude=cluster.display_longitude,
        cluster_radius_m=cluster.cluster_radius_m,
        visit_count=cluster.visit_count,
        total_dwell_minutes=cluster.total_dwell_minutes,
        median_dwell_minutes=cluster.median_dwell_minutes,
        first_seen_utc=cluster.first_seen_utc,
        last_seen_utc=cluster.last_seen_utc,
        dominant_days=cluster.dominant_days,
        dominant_hours=cluster.dominant_hours,
        inferred_place_type=cluster.inferred_place_type,
        sensitivity_class=cluster.sensitivity_class,
        display_label=cluster.display_label,
        label_source=cluster.label_source,
    )
