from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Header, HTTPException, UploadFile

from app.services.users import hash_demo_user
from app.sessions import SESSION_COOKIE_NAME, public_user_hash


async def read_upload_within_limit(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload fully into memory, but never more than ``max_bytes + 1``.

    Reads one byte past the limit so an oversize body is detected and rejected (HTTP 413)
    without buffering the whole thing — a memory-exhaustion backstop for the upload paths.
    """
    payload = await file.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise HTTPException(status_code=413, detail="Uploaded file is too large")
    return payload


def current_user_hash(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
    x_demo_user_id: Annotated[str | None, Header()] = None,
) -> str:
    if user_hash := public_user_hash(session_token):
        return user_hash
    return hash_demo_user(x_demo_user_id)


def required_public_user_hash(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> str:
    if user_hash := public_user_hash(session_token):
        return user_hash
    raise HTTPException(status_code=401, detail="Public session required")
