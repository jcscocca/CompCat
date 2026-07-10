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
