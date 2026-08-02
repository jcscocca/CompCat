"""Socrata backfill orchestrator: page through the dataset with retry, instead of the
manual one-page-per-admin-call offset loop. Layers paging + retry/backoff + an incremental
watermark overlap over the existing (already-deduping) ingest_crime_incidents.
"""
from __future__ import annotations

import time
from collections.abc import Callable
from datetime import date, timedelta
from urllib.error import HTTPError, URLError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crime.seattle_socrata import SeattleSocrataClient, SocrataCursor
from app.crime.sources import SOURCE_SPD_CRIME
from app.models import CrimeIncident
from app.services.crime_ingestion_service import ingest_crime_incidents

DEFAULT_PAGE_SIZE = 5000
# Backstop so a misbehaving "short page never arrives" loop can't run unbounded; at the
# default page size this covers ~5M rows, well past the SPD dataset.
DEFAULT_MAX_PAGES = 1000
RETRYABLE_HTTP_STATUS = frozenset({429, 500, 502, 503, 504})


def latest_observed_date(
    session: Session, source_dataset: str = SOURCE_SPD_CRIME
) -> date | None:
    """Return the newest observed incident date already stored for this source."""
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    value = session.scalar(
        select(func.max(observed)).where(CrimeIncident.source_dataset == source_dataset)
    )
    if value is None:
        return None
    if hasattr(value, "date"):
        return value.date()
    return date.fromisoformat(str(value)[:10])  # SQLite may return an ISO string


def incremental_start_date(
    watermark: date | None,
    *,
    data_floor: date,
    reconciliation_days: int,
) -> date | None:
    """Resolve a bounded, floor-clamped reconciliation window from a stored watermark.

    The inclusive overlap lets a routine incremental run see source rows published late or
    corrected behind the newest stored date. An empty source still returns ``None`` so the
    source client's ordinary full-window floor applies.
    """
    if watermark is None:
        return None
    return max(data_floor, watermark - timedelta(days=reconciliation_days))


def _fetch_keyset_with_retry(
    client: SeattleSocrataClient,
    *,
    since_iso: str | None,
    since_id: str | None,
    end_date: date | None,
    limit: int,
    attempts: int,
    backoff_s: float,
    sleep: Callable[[float], None],
) -> tuple[list, SocrataCursor | None]:
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            return client.fetch_page_keyset(
                since_iso=since_iso,
                since_id=since_id,
                end_date=end_date,
                limit=limit,
            )
        except HTTPError as exc:
            if exc.code not in RETRYABLE_HTTP_STATUS:
                raise  # 4xx (other than 429) won't get better on retry
            last_exc = exc
        except URLError as exc:  # connection refused, timeout, DNS, ... (HTTPError's base)
            last_exc = exc
        if attempt + 1 < attempts:
            sleep(backoff_s * (2**attempt))  # exponential backoff
    assert last_exc is not None
    raise last_exc


def backfill_socrata(
    session: Session,
    client: SeattleSocrataClient,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    max_pages: int = DEFAULT_MAX_PAGES,
    attempts: int = 3,
    backoff_s: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    """Keyset-page forward through the date window in composite date/Socrata-row-ID order.

    Pairing the timestamp with Socrata's unique ``:id`` lets the walk advance through a full page
    (or many pages) at one instant. It also remains stable under concurrent inserts, unlike
    ``$offset``.
    Each fetch is retried on transient network / 429 / 5xx errors. Returns aggregate inserted,
    updated, and skipped counts plus the number of pages fetched.
    """
    inserted_total = 0
    updated_total = 0
    skipped_total = 0
    pages = 0
    cursor: SocrataCursor | None = None
    initial_since_iso = None if start_date is None else f"{start_date.isoformat()}T00:00:00"
    for _ in range(max_pages):
        incidents, next_cursor = _fetch_keyset_with_retry(
            client,
            since_iso=cursor.date_value if cursor is not None else initial_since_iso,
            since_id=cursor.id_value if cursor is not None else None,
            end_date=end_date,
            limit=page_size,
            attempts=attempts,
            backoff_s=backoff_s,
            sleep=sleep,
        )
        if not incidents:
            break
        result = ingest_crime_incidents(session, incidents)
        inserted_total += result["inserted_count"]
        updated_total += result["updated_count"]
        skipped_total += result["skipped_count"]
        pages += 1
        if next_cursor is None:
            break  # a short page means we've reached the end of the dataset/window
        if next_cursor == cursor:
            # Defensive guard for a malformed/misbehaving source client. A conforming composite
            # cursor always advances because its bound is exclusive.
            break
        cursor = next_cursor
    return {
        "inserted_count": inserted_total,
        "updated_count": updated_total,
        "skipped_count": skipped_total,
        "pages": pages,
    }
