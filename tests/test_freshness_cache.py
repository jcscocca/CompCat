from __future__ import annotations

from unittest.mock import patch

from app.services import crime_service
from app.services.crime_service import (
    FRESHNESS_CACHE_TTL_S,
    crime_data_freshness,
    reset_freshness_cache,
)

_FAKE = {
    "incident_count": 7,
    "data_through": "2026-01-01",
    "earliest": "2024-01-01",
    "last_ingested_at": None,
}


def test_freshness_is_cached_within_ttl_then_recomputes_after_expiry():
    reset_freshness_cache()
    clock = {"t": 1000.0}
    now = lambda: clock["t"]  # noqa: E731

    # session is unused in these tests: _compute_freshness is mocked, so None never reaches a DB.
    with patch.object(crime_service, "_compute_freshness", return_value=_FAKE) as spy:
        first = crime_data_freshness(None, now=now)
        clock["t"] = 1000.0 + FRESHNESS_CACHE_TTL_S - 1  # still within the TTL
        second = crime_data_freshness(None, now=now)

        assert first == second == _FAKE
        assert spy.call_count == 1  # served from cache, no second DB aggregate

        clock["t"] = 1000.0 + FRESHNESS_CACHE_TTL_S + 1  # past the TTL
        third = crime_data_freshness(None, now=now)
        assert third == _FAKE
        assert spy.call_count == 2  # recomputed after expiry


def test_reset_freshness_cache_forces_a_recompute():
    reset_freshness_cache()
    with patch.object(crime_service, "_compute_freshness", return_value=_FAKE) as spy:
        crime_data_freshness(None)
        reset_freshness_cache()
        crime_data_freshness(None)
        assert spy.call_count == 2
