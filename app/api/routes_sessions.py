from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_session
from app.ratelimit import client_ip_from, get_rate_limiter
from app.services.session_activity_service import touch_session_activity
from app.sessions import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    new_session_token,
    public_user_hash,
    session_claims_from_token,
    token_for_session_id,
)

router = APIRouter()


@router.post("/sessions")
def create_public_session(
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_session)],
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> dict[str, str]:
    settings = get_settings()
    claims = session_claims_from_token(session_token)
    if claims is not None:
        # Sliding window: re-sign the same id with a fresh 24h expiry so an actively-used
        # session is not logged out mid-analysis exactly 24h after it started. The identity
        # (and every place saved under it) is derived from the id, which does not change,
        # while issued_at remains fixed to enforce the absolute ceiling.
        resumed_token = token_for_session_id(
            claims.session_id,
            issued_at=claims.issued_at,
        )
        _record_activity(session, resumed_token)
        # No rate-limit charge — a resume is not a new session.
        _set_session_cookie(response, resumed_token, settings)
        return {"session_state": "resumed"}

    if settings.rate_limit_enabled:
        ip = client_ip_from(
            request,
            trust_proxy_headers=settings.trust_proxy_headers,
            trust_x_forwarded_for=settings.trust_x_forwarded_for,
        )
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
    created_token = new_session_token()
    _record_activity(session, created_token)
    _set_session_cookie(response, created_token, settings)
    return {"session_state": "created"}


@router.delete("/sessions", status_code=204)
def delete_public_session(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite="lax",
    )


def _record_activity(session: Session, token: str) -> None:
    user_id_hash = public_user_hash(token)
    if user_id_hash is None:  # signed immediately above; defensive against future token changes
        raise RuntimeError("Failed to derive public session identity")
    touch_session_activity(session, user_id_hash)


def _set_session_cookie(response: Response, token: str, settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.effective_session_cookie_secure,
        samesite="lax",
    )
