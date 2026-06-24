from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import CrimeIncident
from app.schemas import CrimeIncidentData
from app.services.crime_service import _incident_model


def ingest_crime_incidents(
    session: Session,
    incidents: list[CrimeIncidentData],
) -> dict[str, int]:
    inserted_count = 0
    skipped_count = 0
    seen_external_ids: set[str] = set()

    for incident in incidents:
        if not incident.external_incident_id:
            skipped_count += 1
            continue

        if incident.external_incident_id in seen_external_ids:
            skipped_count += 1
            continue

        existing = session.scalar(
            select(CrimeIncident).where(
                CrimeIncident.external_incident_id == incident.external_incident_id
            )
        )
        if existing is not None:
            skipped_count += 1
            continue

        seen_external_ids.add(incident.external_incident_id)

        try:
            with session.begin_nested():
                session.add(_incident_model(incident))
                session.flush()
        except IntegrityError:
            skipped_count += 1
            continue

        inserted_count += 1

    session.commit()
    return {"inserted_count": inserted_count, "skipped_count": skipped_count}
