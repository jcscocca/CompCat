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
from app.normalization.clusters import CLUSTER_METHOD
from app.services.import_service import parse_upload, persist_point_import
from app.services.normalization_service import normalize_import


def run_personal_upload(
    session: Session,
    payload: bytes,
    filename: str,
    user_id_hash: str,
    settings: Settings,
) -> dict[str, object]:
    # parse_upload only matches the four point-data formats; non-point uploads raise
    # UnsupportedFormatError (callers map to HTTP 400).
    result = parse_upload(payload, filename)
    batch = persist_point_import(session, result, payload, filename, user_id_hash)
    normalized = normalize_import(session, batch.id, user_id_hash, settings)
    if not settings.raw_upload_retention:
        session.execute(
            delete(StagingLocationObservation).where(
                StagingLocationObservation.import_id == batch.id
            )
        )
        session.execute(delete(StopVisit).where(StopVisit.import_id == batch.id))
        session.commit()
    return {
        "import_id": batch.id,
        "place_cluster_count": normalized["place_cluster_count"],
        "source_type": result.source_type,
        "retained_raw": settings.raw_upload_retention,
    }


def delete_personal_data(session: Session, user_id_hash: str) -> dict[str, int]:
    cluster_ids = list(
        session.scalars(
            select(PlaceCluster.id).where(
                PlaceCluster.user_id_hash == user_id_hash,
                PlaceCluster.cluster_method == CLUSTER_METHOD,
            )
        )
    )
    summaries = 0
    if cluster_ids:
        summaries = session.execute(
            delete(PlaceCrimeSummary).where(PlaceCrimeSummary.place_cluster_id.in_(cluster_ids))
        ).rowcount
    # Delete children before parents to satisfy foreign keys: StopVisit references both
    # PlaceCluster and ImportBatch; StagingLocationObservation references ImportBatch.
    stops = session.execute(
        delete(StopVisit).where(StopVisit.user_id_hash == user_id_hash)
    ).rowcount
    staging = session.execute(
        delete(StagingLocationObservation).where(
            StagingLocationObservation.user_id_hash == user_id_hash
        )
    ).rowcount
    clusters = session.execute(
        delete(PlaceCluster).where(
            PlaceCluster.user_id_hash == user_id_hash,
            PlaceCluster.cluster_method == CLUSTER_METHOD,
        )
    ).rowcount
    batches = session.execute(
        delete(ImportBatch).where(ImportBatch.user_id_hash == user_id_hash)
    ).rowcount
    session.commit()
    return {
        "import_batches": batches,
        "staging": staging,
        "stop_visits": stops,
        "place_clusters": clusters,
        "place_crime_summaries": summaries,
    }
