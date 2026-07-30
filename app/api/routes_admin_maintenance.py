from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.routes_admin_crime import require_admin_ingest_token
from app.config import get_settings
from app.db import get_session
from app.services.retention_service import sweep_retention

router = APIRouter()


@router.post(
    "/admin/maintenance/retention-sweep",
    include_in_schema=False,
    dependencies=[Depends(require_admin_ingest_token)],
)
def retention_sweep(session: Annotated[Session, Depends(get_session)]) -> dict[str, int]:
    return sweep_retention(session, get_settings())
