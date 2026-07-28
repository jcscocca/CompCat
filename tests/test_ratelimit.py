# tests/test_ratelimit.py
from __future__ import annotations

from app.ratelimit import RateLimiterState, client_ip_from


class FakeRequest:
    def __init__(self, host: str = "1.2.3.4", headers: dict[str, str] | None = None):
        self.headers = headers or {}
        self.client = type("C", (), {"host": host})()


def test_bucket_allows_capacity_then_blocks() -> None:
    state = RateLimiterState()
    # capacity 3 per hour, no refill within the test instant
    for _ in range(3):
        assert state.try_take("sessions", "ip1", capacity=3, per_seconds=3600, now=1000.0) == 0.0
    wait = state.try_take("sessions", "ip1", capacity=3, per_seconds=3600, now=1000.0)
    assert wait > 0


def test_bucket_refills_over_time() -> None:
    state = RateLimiterState()
    for _ in range(3):
        state.try_take("sessions", "ip1", capacity=3, per_seconds=3600, now=1000.0)
    # one token refills after per_seconds/capacity = 1200s
    assert state.try_take("sessions", "ip1", capacity=3, per_seconds=3600, now=2200.5) == 0.0


def test_buckets_are_per_key_and_per_family() -> None:
    state = RateLimiterState()
    assert state.try_take("sessions", "ip1", capacity=1, per_seconds=3600, now=0.0) == 0.0
    assert state.try_take("sessions", "ip2", capacity=1, per_seconds=3600, now=0.0) == 0.0
    assert state.try_take("assistant", "ip1", capacity=1, per_seconds=3600, now=0.0) == 0.0


def test_global_day_counter_blocks_and_rolls_over() -> None:
    state = RateLimiterState()
    assert state.try_count_global(limit=2, day_key="2026-07-10") is True
    assert state.try_count_global(limit=2, day_key="2026-07-10") is True
    assert state.try_count_global(limit=2, day_key="2026-07-10") is False
    assert state.try_count_global(limit=2, day_key="2026-07-11") is True


def test_client_ip_ignores_header_without_trust() -> None:
    req = FakeRequest(host="9.9.9.9", headers={"cf-connecting-ip": "8.8.8.8"})
    assert client_ip_from(req, trust_proxy_headers=False) == "9.9.9.9"


def test_client_ip_uses_header_with_trust() -> None:
    req = FakeRequest(host="127.0.0.1", headers={"cf-connecting-ip": "8.8.8.8"})
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_client_ip_uses_forwarded_for_with_trust() -> None:
    # Caddy sets X-Forwarded-For; without trusting it every visitor shares one bucket.
    req = FakeRequest(host="172.18.0.5", headers={"x-forwarded-for": "8.8.8.8"})
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_client_ip_ignores_forwarded_for_without_trust() -> None:
    # Untrusted, the header is just attacker-supplied text: fall back to the socket peer.
    req = FakeRequest(host="9.9.9.9", headers={"x-forwarded-for": "8.8.8.8"})
    assert client_ip_from(req, trust_proxy_headers=False) == "9.9.9.9"


def test_cf_connecting_ip_wins_over_forwarded_for() -> None:
    # Cloudflare's header is single-valued and set by the edge itself, so it is the stronger
    # signal when both are present (the demo path keeps working unchanged).
    req = FakeRequest(
        host="127.0.0.1",
        headers={"cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1"},
    )
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_forwarded_for_takes_the_leftmost_hop() -> None:
    # "client, proxy1, proxy2" — our Caddy appends the peer it saw, so the original client
    # is first. Taking the last entry would key every request on the proxy.
    req = FakeRequest(
        host="172.18.0.5", headers={"x-forwarded-for": "8.8.8.8, 203.0.113.7, 172.18.0.1"}
    )
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_blank_proxy_headers_fall_back_to_the_socket_peer() -> None:
    req = FakeRequest(host="9.9.9.9", headers={"cf-connecting-ip": "  ", "x-forwarded-for": " , "})
    assert client_ip_from(req, trust_proxy_headers=True) == "9.9.9.9"


def test_token_budget_accumulates_and_rolls_over_at_utc_midnight() -> None:
    state = RateLimiterState()
    assert state.budget_exceeded(limit=100, day_key="2026-07-27") is False
    state.add_tokens(60, day_key="2026-07-27")
    assert state.budget_exceeded(limit=100, day_key="2026-07-27") is False
    state.add_tokens(40, day_key="2026-07-27")
    assert state.budget_exceeded(limit=100, day_key="2026-07-27") is True
    # New UTC day: the counter resets lazily on first touch, exactly like the call counter.
    assert state.budget_exceeded(limit=100, day_key="2026-07-28") is False


def test_token_budget_is_disabled_for_a_non_positive_limit() -> None:
    state = RateLimiterState()
    state.add_tokens(10_000, day_key="2026-07-27")
    assert state.budget_exceeded(limit=0, day_key="2026-07-27") is False
    assert state.budget_exceeded(limit=-1, day_key="2026-07-27") is False


def test_add_tokens_returns_the_day_total_and_ignores_non_positive() -> None:
    state = RateLimiterState()
    assert state.add_tokens(25, day_key="2026-07-27") == 25
    assert state.add_tokens(0, day_key="2026-07-27") == 25
    assert state.add_tokens(-5, day_key="2026-07-27") == 25


def test_token_counter_is_independent_of_the_daily_call_counter() -> None:
    state = RateLimiterState()
    state.add_tokens(500, day_key="2026-07-27")
    assert state.try_count_global(limit=1, day_key="2026-07-27") is True
    assert state.budget_exceeded(limit=400, day_key="2026-07-27") is True
    assert state.try_count_global(limit=1, day_key="2026-07-27") is False
