from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash, required_public_user_hash
from app.db import get_session
from app.services.export_service import tableau_place_summary_csv

router = APIRouter()


@router.get("/exports/tableau/place-summary.csv")
def export_place_summary(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    return _place_summary_response(session, user_id_hash)


@router.get("/internal/exports/tableau/place-summary.csv", include_in_schema=False)
def export_internal_place_summary(
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    return _place_summary_response(session, user_id_hash)


def _place_summary_response(session: Session, user_id_hash: str) -> Response:
    return Response(
        content=tableau_place_summary_csv(session, user_id_hash),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=place-summary.csv"},
    )
