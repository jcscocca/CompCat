from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import StagingLocationObservation, StopVisit
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
