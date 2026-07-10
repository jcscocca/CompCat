from __future__ import annotations

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
