from __future__ import annotations

import json
import threading
import time
from dataclasses import asdict
from datetime import UTC, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.geocoding.providers import GeocodeHit, GeocodeProvider, build_provider
from app.models import GeocodeCache, utc_now

if TYPE_CHECKING:
    from app.config import Settings


def normalize_query(query: str) -> str:
    return " ".join(query.split()).lower()


class RateGate:
    """Process-local politeness gate: ensure at least ``min_interval_s`` between
    upstream calls. ``now``/``sleep`` are injectable for deterministic tests."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self, min_interval_s: float, *, now=time.monotonic, sleep=time.sleep) -> None:
        if min_interval_s <= 0:
            return
        with self._lock:
            remaining = min_interval_s - (now() - self._last)
            if remaining > 0:
                sleep(remaining)
            self._last = now()


_rate_gate = RateGate()


def _read_cache(
    session: Session, provider: str, normalized: str, ttl_days: int
) -> list[GeocodeHit] | None:
    row = session.execute(
        select(GeocodeCache).where(
            GeocodeCache.provider == provider,
            GeocodeCache.query_normalized == normalized,
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    if created < utc_now() - timedelta(days=ttl_days):
        return None
    return [GeocodeHit(**item) for item in json.loads(row.results_json)]


def _write_cache(
    session: Session, provider: str, normalized: str, hits: list[GeocodeHit]
) -> None:
    payload = json.dumps([asdict(hit) for hit in hits])
    session.add(
        GeocodeCache(provider=provider, query_normalized=normalized, results_json=payload)
    )
    try:
        session.commit()
    except IntegrityError:
        # A concurrent request (or a stale row) already holds this key. Roll back
        # the failed insert and update the existing row in place instead.
        session.rollback()
        row = session.execute(
            select(GeocodeCache).where(
                GeocodeCache.provider == provider,
                GeocodeCache.query_normalized == normalized,
            )
        ).scalar_one()
        row.results_json = payload
        row.created_at = utc_now()
        session.commit()


def search_addresses(
    session: Session,
    settings: Settings,
    query: str,
    *,
    provider: GeocodeProvider | None = None,
) -> list[GeocodeHit]:
    normalized = normalize_query(query)
    if not normalized:
        return []
    provider = provider or build_provider(settings)
    cached = _read_cache(
        session, settings.geocoder_provider, normalized, settings.geocoder_cache_ttl_days
    )
    if cached is not None:
        return cached
    _rate_gate.wait(settings.geocoder_min_interval_s)
    hits = provider.search(query.strip())
    _write_cache(session, settings.geocoder_provider, normalized, hits)
    return hits
