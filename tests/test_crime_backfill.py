from __future__ import annotations

from datetime import UTC, date, datetime
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.crime.backfill import (
    backfill_socrata,
    incremental_start_date,
    latest_observed_date,
)
from app.crime.seattle_socrata import SocrataCursor
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.schemas import CrimeIncidentData

_NO_SLEEP = lambda _seconds: None  # noqa: E731 — keep retry tests instant


def _incident_at(external_id: str, iso: str) -> CrimeIncidentData:
    return CrimeIncidentData(
        external_incident_id=external_id,
        offense_start_utc=datetime.fromisoformat(iso),
        offense_category="PROPERTY",
        latitude=47.6,
        longitude=-122.3,
    )


def _session(tmp_path, name: str = "bf.sqlite3"):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / name}")
    return get_sessionmaker()()


class _KeysetClient:
    """Fake keyset client over ``(external_id, iso[, source_row_id])`` rows.

    The optional third value mirrors Socrata's unique ``:id``; two-value fixtures default it to
    the external ID for brevity. `inject_after_first` appends a row before the second fetch.
    """

    def __init__(self, rows, *, data_floor=date(2018, 1, 1), inject_after_first=None):
        self.rows = list(rows)
        self.data_floor = data_floor
        self._inject_after_first = inject_after_first
        self.calls: list[tuple[str | None, str | None]] = []

    def fetch_page_keyset(self, *, since_iso=None, since_id=None, end_date=None, limit=5000):
        self.calls.append((since_iso, since_id))
        if len(self.calls) == 2 and self._inject_after_first is not None:
            self.rows.append(self._inject_after_first)
            self._inject_after_first = None
        floor_iso = f"{self.data_floor.isoformat()}T00:00:00"
        lo = since_iso if since_iso and since_iso >= floor_iso else floor_iso
        rows = [row if len(row) == 3 else (*row, row[0]) for row in self.rows]
        window = sorted(
            (
                row
                for row in rows
                if row[1] > lo or (row[1] == lo and (since_id is None or row[2] > since_id))
            ),
            key=lambda row: (row[1], row[2]),
        )
        page = window[:limit]
        incidents = [_incident_at(eid, iso) for eid, iso, _source_row_id in page]
        next_cursor = (
            SocrataCursor(date_value=page[-1][1], id_value=page[-1][2])
            if len(page) == limit
            else None
        )
        return incidents, next_cursor


class _FlakyClient:
    """Raises `error` for the first `fail_times` keyset calls, then returns an empty page."""

    def __init__(self, fail_times: int, error: Exception) -> None:
        self.fail_times = fail_times
        self.error = error
        self.attempts = 0

    def fetch_page_keyset(self, *, since_iso=None, since_id=None, end_date=None, limit=5000):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            raise self.error
        return [], None


def _stored_ids(session):
    return {row.external_incident_id for row in session.scalars(select(CrimeIncident)).all()}


def test_backfill_walks_every_row_via_the_date_cursor(tmp_path):
    session = _session(tmp_path)
    rows = [(f"r{i}", f"2024-01-0{i}T00:00:00") for i in range(1, 6)]  # 5 distinct dates
    client = _KeysetClient(rows)
    result = backfill_socrata(session, client, page_size=2, sleep=_NO_SLEEP)
    assert result["inserted_count"] == 5
    assert _stored_ids(session) == {"r1", "r2", "r3", "r4", "r5"}
    # Cursor advances by the last date and Socrata row ID (first call has no cursor).
    assert client.calls[0] == (None, None)
    assert client.calls[1] == ("2024-01-02T00:00:00", "r2")
    session.close()


def test_backfill_keyset_does_not_skip_a_row_inserted_mid_walk(tmp_path):
    # The whole point of keyset over $offset: a row published while paging (ahead of the cursor)
    # is still fetched when the cursor reaches it, instead of being shifted past a fixed offset.
    session = _session(tmp_path)
    rows = [("r1", "2024-01-01T00:00:00"), ("r2", "2024-01-02T00:00:00"),
            ("r3", "2024-01-05T00:00:00"), ("r4", "2024-01-06T00:00:00")]
    client = _KeysetClient(rows, inject_after_first=("new", "2024-01-04T00:00:00"))
    result = backfill_socrata(session, client, page_size=2, sleep=_NO_SLEEP)
    assert result["inserted_count"] == 5
    assert "new" in _stored_ids(session)  # the mid-walk insert was caught, not skipped
    session.close()


def test_backfill_stops_on_short_page(tmp_path):
    session = _session(tmp_path)
    client = _KeysetClient([("a", "2024-01-01T00:00:00"), ("b", "2024-01-02T00:00:00")])
    result = backfill_socrata(session, client, page_size=5, sleep=_NO_SLEEP)
    assert result["pages"] == 1
    assert result["inserted_count"] == 2
    session.close()


def test_backfill_stops_on_empty_dataset(tmp_path):
    session = _session(tmp_path)
    client = _KeysetClient([])
    result = backfill_socrata(session, client, page_size=2, sleep=_NO_SLEEP)
    assert result == {
        "inserted_count": 0,
        "updated_count": 0,
        "skipped_count": 0,
        "pages": 0,
    }
    session.close()


def test_backfill_reaches_every_row_across_oversized_single_timestamp(tmp_path):
    # A composite cursor must advance by ID when >page_size incidents share one timestamp.
    session = _session(tmp_path)
    same = "2024-01-01T00:00:00"
    client = _KeysetClient([("a", same), ("b", same), ("c", same)])
    result = backfill_socrata(session, client, page_size=2, max_pages=50, sleep=_NO_SLEEP)
    assert result["pages"] == 2
    assert result["inserted_count"] == 3
    assert _stored_ids(session) == {"a", "b", "c"}
    session.close()


def test_backfill_cursor_advances_across_duplicate_domain_ids(tmp_path):
    # Call Data can contain multiple responding-unit rows with the same timestamp and CAD event
    # number. Unique Socrata row IDs must carry the cursor past that duplicate domain key.
    session = _session(tmp_path)
    same = "2024-01-01T00:00:00"
    client = _KeysetClient(
        [
            ("cad-1", same, "source-row-a"),
            ("cad-1", same, "source-row-b"),
            ("cad-2", same, "source-row-c"),
        ]
    )

    result = backfill_socrata(session, client, page_size=2, sleep=_NO_SLEEP)

    assert result == {
        "inserted_count": 2,
        "updated_count": 0,
        "skipped_count": 1,
        "pages": 2,
    }
    assert _stored_ids(session) == {"cad-1", "cad-2"}
    assert client.calls[1] == (same, "source-row-b")
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


def test_incremental_start_date_clamps_overlap_to_source_floor():
    assert incremental_start_date(
        date(2018, 1, 5),
        data_floor=date(2018, 1, 1),
        reconciliation_days=14,
    ) == date(2018, 1, 1)
    assert (
        incremental_start_date(
            None,
            data_floor=date(2018, 1, 1),
            reconciliation_days=14,
        )
        is None
    )


def test_admin_backfill_reconciles_late_row_and_correction_behind_watermark(
    tmp_path, monkeypatch
):
    """A second incremental run must revisit recent source history, not start at max(date)."""
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    snapshots = [
        [
            CrimeIncidentData(
                external_incident_id="older",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                block_address="OLD BLOCK",
            ),
            _incident_at("watermark", "2024-01-20T00:00:00+00:00"),
        ],
        [
            CrimeIncidentData(
                external_incident_id="older",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PERSON",
                block_address="CORRECTED BLOCK",
            ),
            _incident_at("late", "2024-01-12T00:00:00+00:00"),
            _incident_at("watermark", "2024-01-20T00:00:00+00:00"),
        ],
    ]
    since_values: list[str | None] = []

    def fake_keyset(self, *, since_iso=None, since_id=None, end_date=None, limit=5000):
        assert since_id is None
        since_values.append(since_iso)
        snapshot = snapshots.pop(0)
        incidents = [
            incident
            for incident in snapshot
            if since_iso is None
            or incident.offense_start_utc.isoformat() >= since_iso
        ]
        return incidents, None

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page_keyset", fake_keyset
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    request = "/admin/crime/ingest/socrata?mode=backfill"
    headers = {"X-Admin-Token": "secret-token"}

    first = client.post(request, headers=headers)
    second = client.post(request, headers=headers)

    assert first.status_code == 200
    assert first.json() == {
        "inserted_count": 2,
        "updated_count": 0,
        "skipped_count": 0,
        "pages": 1,
    }
    assert second.status_code == 200
    assert second.json() == {
        "inserted_count": 1,
        # Both previously stored rows take the idempotent upsert path; the DB assertions below
        # distinguish the actual source correction from the unchanged watermark row.
        "updated_count": 2,
        "skipped_count": 0,
        "pages": 1,
    }
    assert since_values == [None, "2024-01-06T00:00:00"]

    session = get_sessionmaker()()
    stored = {
        row.external_incident_id: row
        for row in session.scalars(select(CrimeIncident)).all()
    }
    assert set(stored) == {"older", "late", "watermark"}
    assert stored["older"].offense_category == "PERSON"
    assert stored["older"].block_address == "CORRECTED BLOCK"
    session.close()


def test_admin_backfill_keeps_explicit_start_date_exact(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    monkeypatch.setenv("MCA_SOCRATA_RECONCILIATION_DAYS", "365")
    captured: list[str | None] = []

    def fake_keyset(self, *, since_iso=None, since_id=None, end_date=None, limit=5000):
        captured.append(since_iso)
        return [], None

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page_keyset", fake_keyset
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")

    response = TestClient(app).post(
        "/admin/crime/ingest/socrata?mode=backfill&start_date=2024-03-01",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert captured == ["2024-03-01T00:00:00"]


def test_admin_backfill_mode_walks_the_dataset_via_keyset(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)
    dataset = [
        ("p-0", "2024-01-01T00:00:00"),
        ("p-1", "2024-01-02T00:00:00"),
        ("p-2", "2024-01-03T00:00:00"),
    ]

    def fake_keyset(self, *, since_iso=None, since_id=None, end_date=None, limit=5000):
        lo = since_iso or "2018-01-01T00:00:00"
        window = sorted(
            (
                row
                for row in dataset
                if row[1] > lo or (row[1] == lo and (since_id is None or row[0] > since_id))
            ),
            key=lambda row: (row[1], row[0]),
        )
        page = window[:limit]
        incidents = [_incident_at(eid, iso) for eid, iso in page]
        cursor = (
            SocrataCursor(date_value=page[-1][1], id_value=page[-1][0])
            if len(page) == limit
            else None
        )
        return incidents, cursor

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page_keyset", fake_keyset
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?mode=backfill&limit=2",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["inserted_count"] == 3  # every row ingested despite the paged walk
    assert body["pages"] >= 2


def test_admin_calls_ingest_purges_rows_below_the_rolling_floor(tmp_path, monkeypatch):
    # The 911-calls layer advertises a rolling 24-month window; an ingest run must drop stored
    # calls that have fallen below the current floor, not just bound new fetches. A non-rolling
    # source (crime/arrests) is already guarded by test_admin_backfill_mode_* returning no
    # purged_count.
    from sqlalchemy import select

    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)

    def fake_fetch_page(self, limit, offset, start_date=None, end_date=None):
        return []  # nothing new to ingest; we're exercising the purge step

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page", fake_fetch_page
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id="old-call", source_dataset="seattle_spd_911", external_incident_id="old",
                offense_start_utc=datetime(2019, 1, 1, tzinfo=UTC),
            ),
            CrimeIncident(
                id="recent-call", source_dataset="seattle_spd_911", external_incident_id="recent",
                offense_start_utc=datetime(2099, 1, 1, tzinfo=UTC),
            ),
        ]
    )
    session.commit()
    session.close()

    client = TestClient(app)
    response = client.post(
        "/admin/crime/ingest/socrata?mode=page&source=seattle_spd_911",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert response.json()["purged_count"] == 1
    session = get_sessionmaker()()
    remaining = {row.id for row in session.scalars(select(CrimeIncident)).all()}
    assert remaining == {"recent-call"}
    session.close()


def test_latest_observed_date_is_source_scoped(tmp_path):
    from datetime import UTC, date, datetime

    from app.crime.backfill import latest_observed_date
    from app.db import get_sessionmaker
    from app.main import create_app
    from app.models import CrimeIncident

    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="rep-1",
                source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 6, 1, tzinfo=UTC),
            ),
            CrimeIncident(
                external_incident_id="arr-1",
                source_dataset="seattle_spd_arrests",
                offense_start_utc=datetime(2025, 12, 31, tzinfo=UTC),
            ),
        ]
    )
    session.commit()
    assert latest_observed_date(session) == date(2024, 6, 1)
    assert latest_observed_date(session, source_dataset="seattle_spd_arrests") == date(
        2025, 12, 31
    )
    session.close()
