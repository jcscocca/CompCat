"""Guard: every public (OpenAPI-visible) endpoint requires a real session.

This locks in the public-beta privacy boundary — the browser-facing API must
reject anonymous requests with HTTP 401 — and fails loudly if a future endpoint
is added to the public surface without the ``required_public_user_hash`` guard.

Internal endpoints (``/internal/...``, ``include_in_schema=False``) are
deliberately out of scope here; their schema-absence is enforced by
``tests/test_internal_surface.py``.
"""
from __future__ import annotations

import re

from fastapi.testclient import TestClient

from app.main import create_app

# Endpoints intentionally reachable WITHOUT a public session, each with a reason.
# Anything else visible in the OpenAPI schema must return 401 without a cookie.
SESSION_EXEMPT: set[tuple[str, str]] = {
    ("POST", "/sessions"),                    # creates the session itself
    ("GET", "/health"),                       # unauthenticated liveness probe
    ("GET", "/input-modes"),                  # static input-mode config, no user data
    ("POST", "/admin/crime/ingest/socrata"),  # admin tier: X-Admin-Token (403 without it)
}


def _request_without_session(client: TestClient, method: str, path: str):
    # Fill any path params with a throwaway value; send an empty body for write
    # methods. The session guard runs before body validation, so a valid body is
    # not needed to observe the 401.
    request_path = re.sub(r"\{[^}]+\}", "x", path)
    kwargs = {"json": {}} if method in {"POST", "PUT", "PATCH"} else {}
    return client.request(method, request_path, **kwargs)


def test_public_endpoints_require_a_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'auth.sqlite3'}")
    client = TestClient(app)  # no /sessions call -> no session cookie

    offenders = []
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            method = method.upper()
            if (method, path) in SESSION_EXEMPT:
                continue
            response = _request_without_session(client, method, path)
            if response.status_code != 401:
                offenders.append((method, path, response.status_code))

    assert not offenders, (
        "Every OpenAPI-visible (public) endpoint must require a session (HTTP 401) "
        "without a cookie, or be listed in SESSION_EXEMPT with a reason. "
        f"Offenders: {offenders}"
    )


def test_session_exempt_list_stays_honest(tmp_path):
    # If an exempt endpoint starts requiring a session (401), remove it from
    # SESSION_EXEMPT rather than silently masking it here.
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'auth.sqlite3'}")
    client = TestClient(app)

    regressed = [
        (method, path)
        for method, path in SESSION_EXEMPT
        if _request_without_session(client, method, path).status_code == 401
    ]

    assert not regressed, (
        "These endpoints are in SESSION_EXEMPT but now return 401 — remove them "
        f"from the exempt set: {regressed}"
    )
