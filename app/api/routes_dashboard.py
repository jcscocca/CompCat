from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash, required_public_user_hash
from app.config import get_settings
from app.db import get_session
from app.services.dashboard_service import dashboard_summary

router = APIRouter()


@router.get("/dashboard/summary")
def summary(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    return dashboard_summary(session, user_id_hash, get_settings())


@router.get("/internal/dashboard/summary", include_in_schema=False)
def internal_summary(
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    return dashboard_summary(session, user_id_hash, get_settings())
