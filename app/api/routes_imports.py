from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash, read_upload_within_limit
from app.config import get_settings
from app.db import get_session
from app.parsers.base import UnsupportedFormatError
from app.services.import_service import create_import_batch, get_import_summary
from app.services.normalization_service import normalize_import

router = APIRouter()

# NOTE: this is the dev/parser-validation import tier. Unlike the public `/uploads` path
# (app.services.public_upload_service), it deliberately RETAINS raw location points between
# the create and normalize steps so an import can be re-clustered — it does not honor
# MCA_RAW_UPLOAD_RETENTION. That is safe because /internal/* is blocked at the app edge in
# a prod-like environment (see app.ratelimit.BurstLimitMiddleware / Settings.internal_tier_
# accessible); privacy-sensitive deployments must not enable the internal tier. Personal
# uploads with the retention guarantee go through the public /uploads path only.


@router.post("/internal/imports", include_in_schema=False)
async def create_import(
    file: Annotated[UploadFile, File()],
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = await read_upload_within_limit(file, get_settings().max_upload_bytes)
    try:
        return create_import_batch(session, payload, file.filename or "upload", user_id_hash)
    except UnsupportedFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/internal/imports/{import_id}", include_in_schema=False)
def read_import(
    import_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    summary = get_import_summary(session, import_id, user_id_hash)
    if summary is None:
        raise HTTPException(status_code=404, detail="Import not found")
    return summary


@router.post("/internal/imports/{import_id}/normalize", include_in_schema=False)
def normalize(
    import_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, int]:
    try:
        return normalize_import(session, import_id, user_id_hash, get_settings())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
