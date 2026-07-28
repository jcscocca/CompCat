from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Request, Response

from app.config import get_settings
from app.ratelimit import client_ip_from, get_rate_limiter
from app.sessions import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    new_session_token,
    session_id_from_token,
    token_for_session_id,
)

router = APIRouter()


@router.post("/sessions")
def create_public_session(
    request: Request,
    response: Response,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> dict[str, str]:
    settings = get_settings()
    resumed_session_id = session_id_from_token(session_token)
    if resumed_session_id is not None:
        # Sliding window: re-sign the same id with a fresh 24h expiry so an actively-used
        # session is not logged out mid-analysis exactly 24h after it started. The identity
        # (and every place saved under it) is derived from the id, which does not change.
        # No rate-limit charge — a resume is not a new session.
        _set_session_cookie(response, token_for_session_id(resumed_session_id), settings)
        return {"session_state": "resumed"}

    if settings.rate_limit_enabled:
        ip = client_ip_from(request, trust_proxy_headers=settings.trust_proxy_headers)
        wait = get_rate_limiter().try_take(
            "sessions",
            ip,
            capacity=settings.rate_limit_sessions_per_hour,
            per_seconds=3600.0,
        )
        if wait > 0:
            raise HTTPException(
                status_code=429,
                detail="Session request limit reached — please retry later.",
                headers={"Retry-After": str(max(1, int(wait)))},
            )
    _set_session_cookie(response, new_session_token(), settings)
    return {"session_state": "created"}


def _set_session_cookie(response: Response, token: str, settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite="lax",
    )
