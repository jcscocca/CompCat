from __future__ import annotations

from fastapi import APIRouter, Response

from app.config import get_settings
from app.sessions import SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, new_session_token

router = APIRouter()


@router.post("/sessions")
def create_public_session(response: Response) -> dict[str, str]:
    settings = get_settings()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=new_session_token(),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite="lax",
    )
    return {"session_state": "created"}
