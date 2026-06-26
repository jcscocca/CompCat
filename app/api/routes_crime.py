from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash
from app.config import get_settings
from app.db import get_session
from app.services.crime_service import ingest_sample_crime, summarize_for_user

router = APIRouter()


class CrimeSummarizeRequest(BaseModel):
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[int] | None = Field(default=None)


@router.post("/internal/crime/ingest/sample", include_in_schema=False)
def ingest_sample(session: Annotated[Session, Depends(get_session)]) -> dict[str, int]:
    return ingest_sample_crime(session)


@router.post("/internal/crime/summarize", include_in_schema=False)
def summarize(
    request: CrimeSummarizeRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, int]:
    settings = get_settings()
    return summarize_for_user(
        session,
        user_id_hash,
        radii_m=request.radii_m or settings.crime_radii_m,
        analysis_start_date=request.analysis_start_date,
        analysis_end_date=request.analysis_end_date,
    )
