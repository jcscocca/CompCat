from __future__ import annotations

from datetime import UTC, date, datetime
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient

from app.crime.backfill import backfill_socrata, latest_observed_date
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.schemas import CrimeIncidentData

_NO_SLEEP = lambda _seconds: None  # noqa: E731 — keep retry tests instant


def _incident(external_id: str) -> CrimeIncidentData:
    return CrimeIncidentData(
        external_incident_id=external_id,
        offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
        offense_category="PROPERTY",
        latitude=47.6,
        longitude=-122.3,
    )


def _session(tmp_path, name: str = "bf.sqlite3"):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / name}")
    return get_sessionmaker()()


class _PagingClient:
    """Fake SeattleSocrataClient serving fixed pages keyed by offset / page size."""

    def __init__(self, pages: list[list[CrimeIncidentData]]) -> None:
        self.pages = pages
        self.calls: list[int] = []

    def fetch_page(self, *, limit, offset, start_date=None, end_date=None):
        self.calls.append(offset)
        index = offset // limit
        return self.pages[index] if index < len(self.pages) else []


class _FlakyClient:
    """Raises `error` for the first `fail_times` calls, then returns an empty page."""

    def __init__(self, fail_times: int, error: Exception) -> None:
        self.fail_times = fail_times
        self.error = error
        self.attempts = 0

    def fetch_page(self, *, limit, offset, start_date=None, end_date=None):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            raise self.error
        return []


def test_backfill_loops_until_a_short_page(tmp_path):
    session = _session(tmp_path)
    client = _PagingClient(
        [[_incident("a"), _incident("b")], [_incident("c"), _incident("d")], [_incident("e")]]
    )
    result = backfill_socrata(session, client, page_size=2, sleep=_NO_SLEEP)
    assert result == {"inserted_count": 5, "skipped_count": 0, "pages": 3}
    assert client.calls == [0, 2, 4]
    session.close()


def test_backfill_stops_on_empty_page(tmp_path):
    session = _session(tmp_path)
    client = _PagingClient([[_incident("a"), _incident("b")], []])
    result = backfill_socrata(session, client, page_size=2, sleep=_NO_SLEEP)
    assert result["pages"] == 1
    assert result["inserted_count"] == 2
    assert client.calls == [0, 2]
    session.close()


def test_backfill_retries_transient_errors_then_succeeds(tmp_path):
    session = _session(tmp_path)
    client = _FlakyClient(2, URLError("connection refused"))
    backfill_socrata(session, client, page_size=2, attempts=3, sleep=_NO_SLEEP)
    assert client.attempts == 3  # 2 failures + 1 success
    session.close()


def test_backfill_gives_up_after_attempts(tmp_path):
    session = _session(tmp_path)
    client = _FlakyClient(5, URLError("down"))
    with pytest.raises(URLError):
        backfill_socrata(session, client, page_size=2, attempts=3, sleep=_NO_SLEEP)
    assert client.attempts == 3
    session.close()


def test_backfill_does_not_retry_non_retryable_http_error(tmp_path):
    session = _session(tmp_path)
    client = _FlakyClient(5, HTTPError(url="x", code=400, msg="bad", hdrs=None, fp=None))
    with pytest.raises(HTTPError):
        backfill_socrata(session, client, page_size=2, attempts=3, sleep=_NO_SLEEP)
    assert client.attempts == 1  # 400 is not transient
    session.close()


def test_latest_observed_date_returns_max(tmp_path):
    session = _session(tmp_path)
    session.add_all(
        [
            CrimeIncident(
                id="x1", offense_start_utc=datetime(2024, 1, 5, tzinfo=UTC),
                offense_category="PROPERTY", latitude=47.6, longitude=-122.3,
            ),
            CrimeIncident(
                id="x2", offense_start_utc=datetime(2026, 6, 20, tzinfo=UTC),
                offense_category="PROPERTY", latitude=47.6, longitude=-122.3,
            ),
        ]
    )
    session.commit()
    assert latest_observed_date(session) == date(2026, 6, 20)
    session.close()


def test_latest_observed_date_is_none_when_empty(tmp_path):
    session = _session(tmp_path, name="empty.sqlite3")
    assert latest_observed_date(session) is None
    session.close()


def test_admin_backfill_mode_pages_through_the_dataset(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)
    pages = [[_incident("p-0"), _incident("p-1")], [_incident("p-2")]]

    def fake_fetch_page(self, limit, offset, start_date=None, end_date=None):
        index = offset // limit
        return pages[index] if index < len(pages) else []

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page", fake_fetch_page
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?mode=backfill&limit=2",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"inserted_count": 3, "skipped_count": 0, "pages": 2}
