from __future__ import annotations

from datetime import UTC, date, datetime, time

from sqlalchemy import delete, func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import CrimeIncident, utc_now
from app.schemas import CrimeIncidentData
from app.services.crime_service import _incident_model


def ingest_crime_incidents(
    session: Session,
    incidents: list[CrimeIncidentData],
) -> dict[str, int]:
    inserted_count = 0
    updated_count = 0
    skipped_count = 0
    seen_keys: set[tuple[str, str]] = set()

    for incident in incidents:
        if not incident.external_incident_id:
            skipped_count += 1
            continue

        key = (incident.source_dataset, incident.external_incident_id)
        if key in seen_keys:
            skipped_count += 1
            continue
        seen_keys.add(key)

        # Update every source-owned mutable field while preserving the local primary key and
        # composite identity. Running UPDATE first gives accurate counters without a read/write
        # race; the insert-conflict fallback repeats it after a concurrent writer wins.
        mutable_values = {
            "report_number": incident.report_number,
            "offense_id": incident.offense_id,
            "offense_start_utc": incident.offense_start_utc,
            "offense_end_utc": incident.offense_end_utc,
            "report_utc": incident.report_utc,
            "offense_category": incident.offense_category,
            "offense_subcategory": incident.offense_subcategory,
            "nibrs_group": incident.nibrs_group,
            "precinct": incident.precinct,
            "sector": incident.sector,
            "beat": incident.beat,
            "mcpp": incident.mcpp,
            "block_address": incident.block_address,
            "latitude": incident.latitude,
            "longitude": incident.longitude,
            "snapshot_at": incident.snapshot_at or utc_now(),
        }
        update_statement = (
            update(CrimeIncident)
            .where(
                CrimeIncident.source_dataset == incident.source_dataset,
                CrimeIncident.external_incident_id == incident.external_incident_id,
            )
            .values(**mutable_values)
        )
        if session.execute(update_statement).rowcount:
            updated_count += 1
            continue

        try:
            with session.begin_nested():
                session.add(_incident_model(incident))
                session.flush()
        except IntegrityError:
            # Another transaction inserted this composite key between our UPDATE and INSERT.
            # Apply the incoming source values to the winning row instead of silently dropping
            # the update. The uniqueness constraint remains the serialization point.
            if not session.execute(update_statement).rowcount:
                raise
            updated_count += 1
            continue

        inserted_count += 1

    session.commit()
    return {
        "inserted_count": inserted_count,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
    }


def purge_incidents_below_floor(
    session: Session, source_dataset: str, floor: date
) -> int:
    """Delete stored incidents for ``source_dataset`` whose observed date is before ``floor``.

    Fetch-side floors only bound *new* fetches; without this, rows ingested under an earlier,
    lower rolling floor accumulate forever and the layer silently outgrows its advertised
    window. Uses the same coalesced observed timestamp and UTC day-start bound as the read path
    (``incident_query_service``), so a purge at ``floor`` removes exactly the rows a read with
    ``analysis_start_date == floor`` would exclude. Rows with no observed timestamp are left
    untouched (``NULL < bound`` is unknown), matching the watermark's treatment. Returns the
    number of rows deleted.
    """
    floor_at = datetime.combine(floor, time.min, tzinfo=UTC)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    result = session.execute(
        delete(CrimeIncident).where(
            CrimeIncident.source_dataset == source_dataset,
            observed < floor_at,
        )
    )
    session.commit()
    return result.rowcount
