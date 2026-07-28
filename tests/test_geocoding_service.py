from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.db import get_sessionmaker
from app.geocoding.providers import GeocodeHit, GeocoderUpstreamError
from app.main import create_app
from app.models import GeocodeCache
from app.services.geocoding_service import (
    RateGate,
    normalize_query,
    search_addresses,
)


class FakeProvider:
    def __init__(self, hits, *, error=None):
        self.hits = hits
        self.error = error
        self.calls = 0

    def search(self, query):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return list(self.hits)


def _settings() -> Settings:
    # min_interval 0 keeps tests from sleeping on the rate gate.
    return Settings(geocoder_min_interval_s=0.0)


def _session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'geo.sqlite3'}")
    return get_sessionmaker()()


def test_normalize_query_collapses_whitespace_and_case():
    assert normalize_query("  Pike   PLACE  ") == "pike place"
    assert normalize_query("   ") == ""


def test_blank_query_returns_empty_without_calling_provider(tmp_path):
    session = _session(tmp_path)
    provider = FakeProvider([])
    assert search_addresses(session, _settings(), "   ", provider=provider) == []
    assert provider.calls == 0


def test_cache_miss_calls_provider_and_writes_cache(tmp_path):
    session = _session(tmp_path)
    hit = GeocodeHit(label="Pike Place", latitude=47.6, longitude=-122.3, source="nominatim")
    provider = FakeProvider([hit])

    result = search_addresses(session, _settings(), "Pike Place", provider=provider)

    assert result == [hit]
    assert provider.calls == 1
    rows = session.query(GeocodeCache).all()
    assert len(rows) == 1
    assert rows[0].query_normalized == "pike place"


def test_cache_hit_returns_cached_without_calling_provider(tmp_path):
    session = _session(tmp_path)
    hit = GeocodeHit(label="Pike Place", latitude=47.6, longitude=-122.3, source="nominatim")
    provider = FakeProvider([hit])

    search_addresses(session, _settings(), "Pike Place", provider=provider)
    second = FakeProvider([])  # would return [] if called
    result = search_addresses(session, _settings(), "  pike   place ", provider=second)

    assert result == [hit]
    assert second.calls == 0


def test_stale_cache_refetches(tmp_path):
    session = _session(tmp_path)
    stale = GeocodeCache(
        provider="nominatim",
        query_normalized="pike place",
        results_json="[]",
        created_at=datetime.now(UTC) - timedelta(days=40),
    )
    session.add(stale)
    session.commit()

    hit = GeocodeHit(label="Fresh", latitude=1.0, longitude=2.0, source="nominatim")
    provider = FakeProvider([hit])
    result = search_addresses(session, _settings(), "Pike Place", provider=provider)

    assert result == [hit]
    assert provider.calls == 1
    rows = session.query(GeocodeCache).all()
    assert len(rows) == 1
    assert "Fresh" in rows[0].results_json


def test_provider_error_propagates(tmp_path):
    session = _session(tmp_path)
    provider = FakeProvider([], error=GeocoderUpstreamError("down"))
    try:
        search_addresses(session, _settings(), "Pike Place", provider=provider)
    except GeocoderUpstreamError:
        pass
    else:
        raise AssertionError("expected GeocoderUpstreamError")


def test_rate_gate_waits_only_when_needed():
    sleeps = []
    clock = {"t": 100.0}
    gate = RateGate()

    def now():
        return clock["t"]

    def sleep(seconds):
        sleeps.append(seconds)

    gate.wait(1.0, now=now, sleep=sleep)  # first call: no prior, no wait
    clock["t"] = 100.2
    gate.wait(1.0, now=now, sleep=sleep)  # 0.2s elapsed -> wait ~0.8s

    assert sleeps == [pytest.approx(0.8)]


def test_rate_gate_disabled_when_interval_zero():
    sleeps = []
    gate = RateGate()
    gate.wait(0.0, now=lambda: 0.0, sleep=lambda s: sleeps.append(s))
    assert sleeps == []


def test_rate_gate_releases_the_lock_while_sleeping():
    # The gate used to sleep while holding its mutex, so every concurrent geocode blocked
    # on the lock instead of on its own delay — N callers pinned N threadpool workers for
    # N x interval. The wait must be reserved under the lock and served outside it.
    import threading
    import time as time_module

    gate = RateGate()
    interval = 0.4
    gate.wait(interval)  # prime it, so the next caller has to wait a full interval

    sleeper_done = threading.Event()

    def sleeper():
        gate.wait(interval)
        sleeper_done.set()

    thread = threading.Thread(target=sleeper)
    thread.start()
    time_module.sleep(0.05)  # let the sleeper claim its slot and start waiting

    started = time_module.monotonic()
    acquired = gate._lock.acquire(timeout=interval)
    lock_wait = time_module.monotonic() - started
    if acquired:
        gate._lock.release()

    assert acquired, "gate held its lock for the whole sleep"
    assert lock_wait < interval / 2, f"lock was held for {lock_wait:.3f}s during the sleep"
    thread.join(timeout=interval * 4)
    assert sleeper_done.is_set()


def test_rate_gate_preserves_upstream_cadence_under_concurrency():
    # Releasing the lock must not let concurrent callers stampede upstream: the slot each
    # one claims still has to be at least min_interval after the previous claim.
    import threading
    import time as time_module

    gate = RateGate()
    interval = 0.15
    releases: list[float] = []
    releases_lock = threading.Lock()

    def caller():
        gate.wait(interval)
        with releases_lock:
            releases.append(time_module.monotonic())

    threads = [threading.Thread(target=caller) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=interval * 10)

    assert len(releases) == 4
    ordered = sorted(releases)
    gaps = [b - a for a, b in zip(ordered, ordered[1:], strict=False)]
    # One caller goes straight through (nothing pending); the rest are spaced by the gate.
    assert all(gap >= interval * 0.8 for gap in gaps), gaps
