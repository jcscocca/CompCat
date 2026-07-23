from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime

# In-process rate limiting for the public demo posture (single-host by design —
# see docs/superpowers/specs/2026-07-10-demo-on-demand-design.md). All enforcement
# is gated by MCA_RATE_LIMIT_ENABLED at the call sites; this module is pure state.

_MAX_TRACKED_KEYS = 10_000


class RateLimiterState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # (family, key) -> [tokens, updated_at]
        self._buckets: dict[tuple[str, str], list[float]] = {}
        self._global_day_key: str = ""
        self._global_count: int = 0

    def try_take(
        self,
        family: str,
        key: str,
        *,
        capacity: int,
        per_seconds: float,
        now: float | None = None,
    ) -> float:
        """Take one token; return 0.0 on success, else seconds until a token refills."""
        if capacity <= 0:
            # Zero capacity = the tier is fully closed; nothing ever refills.
            return per_seconds
        now = time.monotonic() if now is None else now
        refill_per_second = capacity / per_seconds
        with self._lock:
            if len(self._buckets) > _MAX_TRACKED_KEYS:
                # Lazy prune: drop entries that have fully refilled (idle callers).
                self._buckets = {
                    k: v
                    for k, v in self._buckets.items()
                    if v[0] + (now - v[1]) * refill_per_second < capacity
                }
            tokens, updated_at = self._buckets.get((family, key), [float(capacity), now])
            tokens = min(float(capacity), tokens + (now - updated_at) * refill_per_second)
            if tokens >= 1.0:
                self._buckets[(family, key)] = [tokens - 1.0, now]
                return 0.0
            self._buckets[(family, key)] = [tokens, now]
            return (1.0 - tokens) / refill_per_second

    def try_count_global(self, *, limit: int, day_key: str | None = None) -> bool:
        """Count one global event against a per-UTC-day cap."""
        day_key = day_key or datetime.now(UTC).strftime("%Y-%m-%d")
        with self._lock:
            if day_key != self._global_day_key:
                self._global_day_key = day_key
                self._global_count = 0
            if self._global_count >= limit:
                return False
            self._global_count += 1
            return True


_state = RateLimiterState()


def get_rate_limiter() -> RateLimiterState:
    return _state


def reset_rate_limiter() -> None:
    """Test hook: fresh state so one test's exhaustion can't leak into another."""
    global _state
    _state = RateLimiterState()


def client_ip_from(request, *, trust_proxy_headers: bool) -> str:
    if trust_proxy_headers:
        header = request.headers.get("cf-connecting-ip")
        if header:
            return header
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"


# Paths exempt from the burst tier: static assets, the SPA shell, health, and docs.
# /internal and /admin are deliberately NOT exempt — they are unauthenticated (internal)
# or single-token (admin) mutating surfaces, so a per-IP burst cap is a cheap brute-force /
# DoS backstop when rate limiting is on.
_BURST_EXEMPT_PREFIXES = (
    "/health",
    "/tiles",
    "/assets",
    "/basemaps-assets",
    "/fonts",
    "/dashboard-app",
    "/docs",
    "/openapi.json",
)


async def _send_json(send, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BurstLimitMiddleware:
    """Pure ASGI middleware (BaseHTTPMiddleware would buffer the assistant's SSE
    stream). Applies a per-IP token bucket to public API routes."""

    def __init__(self, app, *, get_settings_fn) -> None:
        self.app = app
        self._get_settings = get_settings_fn

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        settings = self._get_settings()
        path = scope.get("path", "")
        # Internal-tier edge gate (independent of rate_limit_enabled): the /internal/* surface
        # is unauthenticated and must not be reachable in a prod-like deployment unless
        # explicitly opted in via MCA_INTERNAL_TIER_ENABLED.
        if path.startswith("/internal") and not settings.internal_tier_accessible:
            await _send_json(send, 403, {"detail": "Internal endpoint not accessible"})
            return
        if (
            not settings.rate_limit_enabled
            or path == "/"
            or path.startswith(_BURST_EXEMPT_PREFIXES)
        ):
            await self.app(scope, receive, send)
            return
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
        ip = "unknown"
        if settings.trust_proxy_headers and headers.get("cf-connecting-ip"):
            ip = headers["cf-connecting-ip"]
        elif scope.get("client"):
            ip = scope["client"][0]
        wait = get_rate_limiter().try_take(
            "burst",
            ip,
            capacity=settings.rate_limit_burst_per_minute,
            per_seconds=60.0,
        )
        if wait > 0:
            body = json.dumps({"detail": "Request limit reached — please retry shortly."}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 429,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"retry-after", str(max(1, int(wait))).encode()),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
