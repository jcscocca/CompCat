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
