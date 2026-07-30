from __future__ import annotations

import base64
import hmac
import time
from dataclasses import dataclass
from hashlib import sha256
from uuid import uuid4

from app.config import get_settings

SESSION_COOKIE_NAME = "mca_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24


@dataclass(frozen=True)
class SessionClaims:
    session_id: str
    issued_at: int
    expires_at: int


def token_for_session_id(session_id: str, *, issued_at: int | None = None) -> str:
    """Sign ``session_id`` with a fresh expiry window. Re-signing an existing id is how the
    resume path slides the window: the identity (and so the user hash, and so every saved
    place) is derived from the id alone, which is unchanged. issued_at never slides, which
    gives the session its independent absolute-age ceiling."""
    now = int(time.time())
    issued_at = now if issued_at is None else issued_at
    expires_at = now + SESSION_MAX_AGE_SECONDS
    absolute_days = get_settings().session_absolute_max_days
    if absolute_days > 0:
        expires_at = min(expires_at, issued_at + absolute_days * 24 * 60 * 60)
    payload = f"{session_id}:{issued_at}:{expires_at}"
    signature = _sign(payload)
    return f"{payload}.{signature}"


def new_session_token() -> str:
    return token_for_session_id(str(uuid4()))


def session_claims_from_token(token: str | None) -> SessionClaims | None:
    if not token or "." not in token:
        return None
    payload, signature = token.rsplit(".", 1)
    if not payload or not signature:
        return None
    expected = _sign(payload)
    if not hmac.compare_digest(signature, expected):
        return None
    parts = payload.rsplit(":", 2)
    if len(parts) == 3:
        session_id, issued_at_text, expires_at_text = parts
    elif len(parts) == 2:
        # One-deploy compatibility for tokens issued before issued_at was added. Their
        # latest signed expiry can prove only the beginning of the current 24h window, so
        # use that conservative lower bound and write the explicit claim on resume.
        session_id, expires_at_text = parts
        try:
            issued_at_text = str(int(expires_at_text) - SESSION_MAX_AGE_SECONDS)
        except ValueError:
            return None
    else:
        return None
    if not session_id or not issued_at_text or not expires_at_text:
        return None
    try:
        issued_at = int(issued_at_text)
        expires_at = int(expires_at_text)
    except ValueError:
        return None
    now = int(time.time())
    if issued_at > now or expires_at <= now:
        return None
    absolute_days = get_settings().session_absolute_max_days
    if absolute_days > 0 and now >= issued_at + absolute_days * 24 * 60 * 60:
        return None
    return SessionClaims(
        session_id=session_id,
        issued_at=issued_at,
        expires_at=expires_at,
    )


def session_id_from_token(token: str | None) -> str | None:
    claims = session_claims_from_token(token)
    return claims.session_id if claims is not None else None


def public_user_hash(session_token: str | None) -> str | None:
    session_id = session_id_from_token(session_token)
    if session_id is None:
        return None
    salt = get_settings().user_hash_salt
    return sha256(f"{salt}:public-session:{session_id}".encode()).hexdigest()


def _sign(session_id: str) -> str:
    secret = get_settings().session_secret.encode()
    digest = hmac.new(secret, session_id.encode(), sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")
