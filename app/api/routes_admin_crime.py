from __future__ import annotations

import hmac
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.crime.backfill import backfill_socrata, latest_observed_date
from app.crime.seattle_socrata import SeattleSocrataClient
from app.crime.sources import SOURCE_SPD_CRIME, get_crime_source
from app.db import get_session
from app.services.crime_ingestion_service import (
    ingest_crime_incidents,
    purge_incidents_below_floor,
)

MAX_SOCRATA_LIMIT = 5000
MAX_SOCRATA_OFFSET = 1_000_000

router = APIRouter()


def require_admin_ingest_token(
    x_admin_token: Annotated[str | None, Header()] = None,
) -> None:
    settings = get_settings()
    # Constant-time compare (matches app.sessions) so a configured token can't be probed
    # by response-timing. An unset token fails closed: no request is ever accepted.
    if not settings.admin_ingest_token or not hmac.compare_digest(
        x_admin_token or "", settings.admin_ingest_token
    ):
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
    source: str = SOURCE_SPD_CRIME,
) -> dict[str, int]:
    try:
        crime_source = get_crime_source(source)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown source: {source}") from None
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    settings = get_settings()
    run_floor = crime_source.data_floor(date.today())
    client = SeattleSocrataClient(
        base_url=settings.socrata_base_url,
        dataset_id=getattr(settings, crime_source.dataset_attr),
        app_token=settings.socrata_app_token,
        mapper=crime_source.mapper,
        date_field=crime_source.date_field,
        data_floor=run_floor,
    )
    if mode == "backfill":
        if start_date is None:
            start_date = latest_observed_date(session, source_dataset=source)
        result = backfill_socrata(
            session, client, start_date=start_date, end_date=end_date, page_size=limit
        )
    else:
        incidents = client.fetch_page(
            limit=limit, offset=offset, start_date=start_date, end_date=end_date
        )
        result = ingest_crime_incidents(session, incidents)
    # Enforce a rolling-window source's advertised window on the DB, not just on the fetch:
    # drop any stored rows that have fallen below the current floor as it rolls forward.
    if crime_source.rolling_window:
        result["purged_count"] = purge_incidents_below_floor(session, source, run_floor)
    return result
