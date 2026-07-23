from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import read_upload_within_limit, required_public_user_hash
from app.config import get_settings
from app.db import get_session
from app.parsers.base import UnsupportedFormatError
from app.services.public_upload_service import delete_personal_data, run_personal_upload

router = APIRouter()


@router.post("/uploads")
async def create_upload(
    file: Annotated[UploadFile, File()],
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    settings = get_settings()
    if not settings.public_enable_personal_uploads:
        raise HTTPException(status_code=404, detail="Not found")
    payload = await read_upload_within_limit(file, settings.max_upload_bytes)
    try:
        return run_personal_upload(
            session, payload, file.filename or "upload", user_id_hash, settings
        )
    except UnsupportedFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/uploads")
def delete_uploads(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    if not get_settings().public_enable_personal_uploads:
        raise HTTPException(status_code=404, detail="Not found")
    return delete_personal_data(session, user_id_hash)
