from __future__ import annotations

from datetime import datetime
from hashlib import sha256

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models import ImportBatch, StagingLocationObservation, StopVisit
from app.parsers.base import SourceParser, UnsupportedFormatError
from app.parsers.commute_scenario import CommuteScenarioParser
from app.parsers.csv_points import CsvPointsParser
from app.parsers.geojson_points import GeoJsonPointsParser
from app.parsers.google_timeline import GoogleTimelineParser
from app.parsers.gpx_points import GpxPointsParser
from app.parsers.recurring_places import RecurringPlacesParser
from app.schemas import DirectPlaceImportResult, ParseResult
from app.services.direct_places_service import persist_direct_place_import

PARSERS: list[SourceParser] = [
    GoogleTimelineParser(),
    CsvPointsParser(),
    GeoJsonPointsParser(),
    GpxPointsParser(),
]

DIRECT_PLACE_PARSERS: list[SourceParser] = [
    CommuteScenarioParser(),
    RecurringPlacesParser(),
]


def create_import_batch(
    session: Session,
    payload: bytes,
    filename: str,
    user_id_hash: str,
) -> dict[str, object]:
    direct_result = parse_direct_place_upload(payload, filename)
    if direct_result is not None:
        return persist_direct_place_import(session, direct_result, payload, filename, user_id_hash)
    result = parse_upload(payload, filename)
    batch = persist_point_import(session, result, payload, filename, user_id_hash)
    return {
        "id": batch.id,
        "status": batch.status,
        "source_type": batch.source_type,
        "detected_schema": batch.detected_schema,
        "observation_count": len(result.observations),
        "source_stop_count": len(result.source_stops),
    }


def persist_point_import(
    session: Session,
    result: ParseResult,
    payload: bytes,
    filename: str,
    user_id_hash: str,
) -> ImportBatch:
    times = _time_bounds(result)
    batch = ImportBatch(
        user_id_hash=user_id_hash,
        source_type=result.source_type,
        original_filename=filename,
        file_hash_sha256=sha256(payload).hexdigest(),
        parser_version=result.parser_version,
        detected_schema=result.detected_schema,
        min_time_utc=times[0],
        max_time_utc=times[1],
        status="parsed",
        privacy_mode="tableau_safe",
    )
    session.add(batch)
    session.flush()
    rows = []
    for observation in result.observations:
        rows.append(
            StagingLocationObservation(
                import_id=batch.id,
                user_id_hash=user_id_hash,
                source_record_type=observation.source_record_type,
                source_record_hash=observation.source_record_hash,
                observed_at_utc=observation.observed_at_utc,
                start_time_utc=observation.start_time_utc,
                end_time_utc=observation.end_time_utc,
                latitude=observation.latitude,
                longitude=observation.longitude,
                accuracy_m=observation.accuracy_m,
                activity_type=observation.activity_type,
                confidence_score=observation.confidence_score,
            )
        )
    for source_stop in result.source_stops:
        rows.append(
            StagingLocationObservation(
                import_id=batch.id,
                user_id_hash=user_id_hash,
                source_record_type=source_stop.source_record_type,
                source_record_hash=source_stop.source_record_hash,
                start_time_utc=source_stop.start_time_utc,
                end_time_utc=source_stop.end_time_utc,
                latitude=source_stop.latitude,
                longitude=source_stop.longitude,
                accuracy_m=source_stop.accuracy_m,
                activity_type=source_stop.activity_type,
                confidence_score=source_stop.confidence_score,
                display_label=source_stop.display_label,
            )
        )
    session.add_all(rows)
    session.commit()
    return batch


def parse_direct_place_upload(
    payload: bytes,
    filename: str,
) -> DirectPlaceImportResult | None:
    for parser in DIRECT_PLACE_PARSERS:
        if parser.can_parse(payload, filename):
            return parser.parse_bytes(payload, filename)
    return None


def parse_upload(payload: bytes, filename: str) -> ParseResult:
    for parser in PARSERS:
        if parser.can_parse(payload, filename):
            return parser.parse_bytes(payload, filename)
    raise UnsupportedFormatError(
        "Unsupported upload format. Supported MVP formats are Google Timeline JSON, CSV, "
        "GeoJSON, and GPX."
    )


def get_import_summary(
    session: Session,
    import_id: str,
    user_id_hash: str,
) -> dict[str, object] | None:
    batch = session.get(ImportBatch, import_id)
    if batch is None or batch.user_id_hash != user_id_hash:
        return None
    staging_count = _scalar_count(
        session,
        select(StagingLocationObservation).where(StagingLocationObservation.import_id == import_id),
    )
    source_stop_count = _scalar_count(
        session,
        select(StagingLocationObservation).where(
            StagingLocationObservation.import_id == import_id,
            StagingLocationObservation.source_record_type == "placeVisit",
        ),
    )
    stop_visit_count = _scalar_count(
        session,
        select(StopVisit).where(StopVisit.import_id == import_id),
    )
    return {
        "id": batch.id,
        "status": batch.status,
        "source_type": batch.source_type,
        "detected_schema": batch.detected_schema,
        "staging_count": staging_count,
        "source_stop_count": source_stop_count,
        "stop_visit_count": stop_visit_count,
        "min_time_utc": batch.min_time_utc,
        "max_time_utc": batch.max_time_utc,
    }


def _time_bounds(result: ParseResult) -> tuple[datetime | None, datetime | None]:
    values: list[datetime] = []
    for observation in result.observations:
        values.extend(
            value
            for value in (
                observation.observed_at_utc,
                observation.start_time_utc,
                observation.end_time_utc,
            )
            if value is not None
        )
    for source_stop in result.source_stops:
        values.extend([source_stop.start_time_utc, source_stop.end_time_utc])
    if not values:
        return None, None
    return min(values), max(values)


def _scalar_count(session: Session, statement: Select[tuple[object]]) -> int:
    return session.scalar(select(func.count()).select_from(statement.subquery())) or 0
