"""Security and privacy response headers applied at the ASGI edge."""

from __future__ import annotations

from collections.abc import Iterable

CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "form-action 'self'",
        # Keep browser execution first-party. Cloudflare may inject its optional Web
        # Analytics tag at the edge, so excluding that origin here is also a deploy-safe
        # backstop when the dashboard toggle is changed independently of the app release.
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
    )
)

_SECURITY_HEADERS = (
    (b"content-security-policy", CONTENT_SECURITY_POLICY.encode()),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), geolocation=(), microphone=()"),
)

# These routes return a session token, user-entered location data, session-owned analysis,
# assistant text, personal uploads, or administrative results. Public reference geometry
# (/dashboard/beats and /dashboard/mcpp), freshness metadata, health probes, and static assets
# deliberately remain cacheable under their existing policies.
_PRIVATE_PREFIXES = (
    "/sessions",
    "/places",
    "/uploads",
    "/assistant",
    "/exports",
    "/internal",
    "/admin",
)
_PRIVATE_DASHBOARD_PREFIXES = (
    "/dashboard/summary",
    "/dashboard/analyze",
    "/dashboard/incidents",
    "/dashboard/incident-points",
    "/dashboard/compare",
    "/dashboard/neighborhood",
    "/dashboard/geocode",
    "/dashboard/trends",
)


def is_private_response_path(path: str) -> bool:
    return _matches_prefix(path, (*_PRIVATE_PREFIXES, *_PRIVATE_DASHBOARD_PREFIXES))


def _matches_prefix(path: str, prefixes: Iterable[str]) -> bool:
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in prefixes)


def _replace_header(
    headers: list[tuple[bytes, bytes]], name: bytes, value: bytes
) -> list[tuple[bytes, bytes]]:
    return [(key, current) for key, current in headers if key.lower() != name] + [(name, value)]


class ResponseSecurityMiddleware:
    """Add browser hardening globally and disable storage of session-private responses.

    This is pure ASGI middleware rather than ``BaseHTTPMiddleware`` so it does not buffer the
    assistant's server-sent-event stream.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        private_response = is_private_response_path(scope.get("path", ""))

        async def send_with_security(message) -> None:
            if message["type"] == "http.response.start":
                secured = dict(message)
                headers = list(message.get("headers", []))
                for name, value in _SECURITY_HEADERS:
                    headers = _replace_header(headers, name, value)
                if private_response:
                    headers = _replace_header(headers, b"cache-control", b"no-store")
                secured["headers"] = headers
                message = secured
            await send(message)

        await self.app(scope, receive, send_with_security)
