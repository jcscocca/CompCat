from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.crime.backfill import backfill_socrata, latest_observed_date
from app.crime.seattle_socrata import SeattleSocrataClient
from app.db import get_session
from app.services.crime_ingestion_service import ingest_crime_incidents

MAX_SOCRATA_LIMIT = 5000
MAX_SOCRATA_OFFSET = 1_000_000

router = APIRouter()


def require_admin_ingest_token(
    x_admin_token: Annotated[str | None, Header()] = None,
) -> None:
    settings = get_settings()
    if not settings.admin_ingest_token or x_admin_token != settings.admin_ingest_token:
        raise HTTPException(status_code=403, detail="Admin token required")


@router.post(
    "/admin/crime/ingest/socrata",
    dependencies=[Depends(require_admin_ingest_token)],
)
def ingest_socrata(
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=MAX_SOCRATA_LIMIT)] = MAX_SOCRATA_LIMIT,
    offset: Annotated[int, Query(ge=0, le=MAX_SOCRATA_OFFSET)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
    mode: Annotated[str, Query(pattern="^(page|backfill)$")] = "page",
) -> dict[str, int]:
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    settings = get_settings()
    client = SeattleSocrataClient(
        base_url=settings.socrata_base_url,
        dataset_id=settings.socrata_dataset_id,
        app_token=settings.socrata_app_token,
    )
    if mode == "backfill":
        # Page through the whole window with retry. With no start_date, resume from the
        # newest stored incident (incremental) instead of re-walking from the 2018 floor.
        if start_date is None:
            start_date = latest_observed_date(session)
        return backfill_socrata(
            session, client, start_date=start_date, end_date=end_date, page_size=limit
        )
    incidents = client.fetch_page(
        limit=limit,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    )
    return ingest_crime_incidents(session, incidents)
