from __future__ import annotations

import pytest

from app.ratelimit import reset_rate_limiter
from app.services.crime_service import reset_freshness_cache


@pytest.fixture(autouse=True)
def _reset_freshness_cache():
    """crime_data_freshness caches in-process; clear it before each test so a value computed
    against one test's database can't leak into another's (each test uses a fresh DB)."""
    reset_freshness_cache()
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Rate-limit buckets are in-process state; reset per test."""
    reset_rate_limiter()
    yield
