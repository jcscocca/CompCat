import json
from datetime import UTC, date, datetime
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.crime.seattle_socrata import (
    SeattleSocrataClient,
    SocrataCursor,
    crime_incident_from_mapping,
)
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.schemas import CrimeIncidentData
from app.services.crime_ingestion_service import ingest_crime_incidents
from app.services.crime_service import ingest_sample_crime


def test_ingest_crime_incidents_upserts_by_external_id(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    incidents = [
        CrimeIncidentData(
            external_incident_id="spd-1",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        ),
        CrimeIncidentData(
            external_incident_id="spd-1",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        ),
    ]

    result = ingest_crime_incidents(session, incidents)

    assert result == {"inserted_count": 1, "updated_count": 0, "skipped_count": 1}
    session.close()


def test_purge_incidents_below_floor_scopes_to_source_and_floor(tmp_path):
    from app.crime.sources import SOURCE_SPD_911
    from app.services.crime_ingestion_service import purge_incidents_below_floor

    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    floor = date(2024, 7, 1)
    session.add_all(
        [
            # call below the floor -> purged
            CrimeIncident(
                id="call-below", source_dataset=SOURCE_SPD_911, external_incident_id="c-below",
                offense_start_utc=datetime(2024, 6, 15, tzinfo=UTC),
            ),
            # offense date null but report date below the floor -> purged (coalesce)
            CrimeIncident(
                id="call-report-below", source_dataset=SOURCE_SPD_911,
                external_incident_id="c-report-below",
                offense_start_utc=None, report_utc=datetime(2024, 5, 1, tzinfo=UTC),
            ),
            # exactly at the floor midnight -> kept (floor is the inclusive lower bound)
            CrimeIncident(
                id="call-at-floor", source_dataset=SOURCE_SPD_911, external_incident_id="c-at",
                offense_start_utc=datetime(2024, 7, 1, 0, 0, tzinfo=UTC),
            ),
            # above the floor -> kept
            CrimeIncident(
                id="call-above", source_dataset=SOURCE_SPD_911, external_incident_id="c-above",
                offense_start_utc=datetime(2024, 8, 1, tzinfo=UTC),
            ),
            # no observed date at all -> kept (can't be dated)
            CrimeIncident(
                id="call-null", source_dataset=SOURCE_SPD_911, external_incident_id="c-null",
                offense_start_utc=None, report_utc=None,
            ),
            # reported-crime row below the floor -> kept (different source, fixed-history layer)
            CrimeIncident(
                id="crime-below", source_dataset="seattle_spd_crime",
                external_incident_id="r-below",
                offense_start_utc=datetime(2024, 1, 1, tzinfo=UTC),
            ),
        ]
    )
    session.commit()

    purged = purge_incidents_below_floor(session, SOURCE_SPD_911, floor)

    assert purged == 2
    remaining = {row.id for row in session.scalars(select(CrimeIncident)).all()}
    assert remaining == {"call-at-floor", "call-above", "call-null", "crime-below"}
    session.close()


def test_current_seattle_socrata_row_maps_to_analysis_fields():
    incident = crime_incident_from_mapping(
        {
            "report_number": "2026-906790",
            "report_date_time": "2026-04-20T08:28:24.000",
            "offense_id": "69762952251",
            "offense_date": "2026-04-17T18:42:00.000",
            "nibrs_group_a_b": "A",
            "nibrs_crime_against_category": "PROPERTY",
            "offense_sub_category": "LARCENY-THEFT",
            "block_address": "7XX BLOCK OF N 47TH ST",
            "latitude": "47.66287425",
            "longitude": "-122.349303056792",
            "beat": "B2",
            "precinct": "North",
            "sector": "B",
            "neighborhood": "FREMONT",
            "reporting_area": "2535",
            "offense_category": "PROPERTY CRIME",
        }
    )

    assert incident.external_incident_id == "69762952251"
    assert incident.offense_start_utc is not None
    assert incident.offense_start_utc.isoformat() == "2026-04-17T18:42:00+00:00"
    assert incident.report_utc is not None
    assert incident.report_utc.isoformat() == "2026-04-20T08:28:24+00:00"
    assert incident.offense_category == "PROPERTY"
    assert incident.offense_subcategory == "LARCENY-THEFT"
    assert incident.nibrs_group == "A"
    assert incident.mcpp == "FREMONT"
    assert incident.latitude == 47.66287425
    assert incident.longitude == -122.349303056792


def test_current_seattle_socrata_row_accepts_redacted_coordinates():
    incident = crime_incident_from_mapping(
        {
            "report_number": "2026-redacted",
            "report_date_time": "2026-04-20T08:28:24.000",
            "offense_id": "redacted-offense",
            "offense_date": "2026-04-17T18:42:00.000",
            "nibrs_crime_against_category": "PROPERTY",
            "offense_sub_category": "LARCENY-THEFT",
            "latitude": "REDACTED",
            "longitude": "REDACTED",
        }
    )

    assert incident.latitude is None
    assert incident.longitude is None
    assert incident.offense_start_utc is not None
    assert incident.offense_category == "PROPERTY"


def test_socrata_client_builds_date_window_query(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps([]).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["token"] = request.headers.get("X-app-token")
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("app.crime.seattle_socrata.urlopen", fake_urlopen)
    client = SeattleSocrataClient(
        base_url="https://data.seattle.gov/resource",
        dataset_id="tazs-3rd5",
        app_token="app-token",
    )

    rows = client.fetch_page(
        limit=100,
        offset=25,
        start_date=date(2026, 4, 1),
        end_date=date(2026, 6, 22),
    )

    query = parse_qs(urlparse(captured["url"]).query)
    assert rows == []
    assert query["$limit"] == ["100"]
    assert query["$offset"] == ["25"]
    assert query["$order"] == ["offense_date DESC"]
    assert query["$where"] == [
        "offense_date between '2026-04-01T00:00:00' and '2026-06-22T23:59:59'"
    ]
    assert captured["token"] == "app-token"
    assert captured["timeout"] == 30


def test_socrata_client_builds_keyset_query(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps(
                [
                    {
                        ":id": "row-1",
                        "report_number": "fallback-report-1",
                        "offense_date": "2026-04-01T00:00:00.000",
                    },
                    {
                        ":id": "row-2",
                        "offense_id": "2",
                        "offense_date": "2026-04-05T00:00:00.000",
                    },
                ]
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        return FakeResponse()

    monkeypatch.setattr("app.crime.seattle_socrata.urlopen", fake_urlopen)
    client = SeattleSocrataClient(
        base_url="https://data.seattle.gov/resource", dataset_id="tazs-3rd5"
    )

    incidents, next_cursor = client.fetch_page_keyset(since_iso="2026-04-01T00:00:00", limit=2)

    query = parse_qs(urlparse(captured["url"]).query)
    assert query["$select"] == ["*, :id"]
    assert query["$order"] == ["offense_date ASC, :id ASC"]
    assert query["$where"] == [
        "offense_date >= '2026-04-01T00:00:00' and :id is not null"
    ]
    assert "$offset" not in query  # keyset, not offset paging
    assert len(incidents) == 2
    assert incidents[0].external_incident_id == "fallback-report-1"
    assert next_cursor == SocrataCursor(
        date_value="2026-04-05T00:00:00.000", id_value="row-2"
    )

    client.fetch_page_keyset(
        since_iso="2026-04-05T00:00:00.000", since_id="row-2", limit=2
    )
    where = parse_qs(urlparse(captured["url"]).query)["$where"]
    assert where == [
        "(offense_date > '2026-04-05T00:00:00.000' or "
        "(offense_date = '2026-04-05T00:00:00.000' and :id > 'row-2')) "
        "and :id is not null"
    ]

    # since_iso below the floor (or None) clamps up to the source's data floor.
    client.fetch_page_keyset(since_iso=None, limit=2)
    where = parse_qs(urlparse(captured["url"]).query)["$where"]
    assert where == ["offense_date >= '2018-01-01T00:00:00' and :id is not null"]


def test_ingest_sample_crime_uses_packaged_fixture(tmp_path, monkeypatch):
    captured = {}

    def fake_load_crime_csv(path):
        captured["path"] = path
        return []

    monkeypatch.setattr("app.services.crime_service.load_crime_csv", fake_load_crime_csv)
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")

    with get_sessionmaker()() as session:
        result = ingest_sample_crime(session)

    assert result == {"inserted_count": 0}
    assert "/app/data/" in str(captured["path"])
    assert captured["path"].name == "sample_crime.csv"


def test_ingest_crime_incidents_skips_missing_external_incident_ids(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    incidents = [
        CrimeIncidentData(
            external_incident_id=None,
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        ),
        CrimeIncidentData(
            external_incident_id=None,
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        ),
        CrimeIncidentData(
            external_incident_id="spd-keep",
            offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
            offense_category="PERSON",
            latitude=47.61,
            longitude=-122.34,
        ),
    ]

    result = ingest_crime_incidents(session, incidents)

    assert result == {"inserted_count": 1, "updated_count": 0, "skipped_count": 2}
    rows = session.scalars(select(CrimeIncident)).all()
    assert [row.external_incident_id for row in rows] == ["spd-keep"]
    session.close()


def test_ingest_crime_incidents_updates_existing_external_incident_ids(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="local-id-is-preserved",
            external_incident_id="spd-existing",
            offense_start_utc=datetime(2024, 1, 9, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.608,
            longitude=-122.332,
        )
    )
    session.commit()

    result = ingest_crime_incidents(
        session,
        [
            CrimeIncidentData(
                external_incident_id="spd-existing",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PERSON",
                block_address="UPDATED BLOCK",
                latitude=47.609,
                longitude=-122.333,
            ),
            CrimeIncidentData(
                external_incident_id="spd-new",
                offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
                offense_category="PERSON",
                latitude=47.61,
                longitude=-122.34,
            ),
        ],
    )

    assert result == {"inserted_count": 1, "updated_count": 1, "skipped_count": 0}
    external_ids = session.scalars(
        select(CrimeIncident.external_incident_id).order_by(CrimeIncident.external_incident_id)
    ).all()
    assert external_ids == ["spd-existing", "spd-new"]
    updated = session.scalar(
        select(CrimeIncident).where(CrimeIncident.external_incident_id == "spd-existing")
    )
    assert updated is not None
    assert updated.id == "local-id-is-preserved"
    assert updated.offense_start_utc == datetime(2024, 1, 10)
    assert updated.offense_category == "PERSON"
    assert updated.block_address == "UPDATED BLOCK"
    session.close()


def test_ingest_crime_incidents_skips_insert_conflicts_without_rolling_back_new_rows(
    tmp_path,
    monkeypatch,
):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    sessionmaker = get_sessionmaker()
    seed_session = sessionmaker()
    seed_session.add(
        CrimeIncident(
            external_incident_id="spd-race",
            offense_start_utc=datetime(2024, 1, 9, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.608,
            longitude=-122.332,
        )
    )
    seed_session.commit()
    seed_session.close()

    session = sessionmaker()
    real_execute = session.execute
    first_update = True

    class _NoMatch:
        rowcount = 0

    def simulate_insert_race(statement, *args, **kwargs):
        nonlocal first_update
        if first_update and statement.is_update:
            first_update = False
            return _NoMatch()
        return real_execute(statement, *args, **kwargs)

    monkeypatch.setattr(session, "execute", simulate_insert_race)
    incidents = [
        CrimeIncidentData(
            external_incident_id="spd-race",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        ),
        CrimeIncidentData(
            external_incident_id="spd-new",
            offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
            offense_category="PERSON",
            latitude=47.61,
            longitude=-122.34,
        ),
    ]

    result = ingest_crime_incidents(session, incidents)

    assert result == {"inserted_count": 1, "updated_count": 1, "skipped_count": 0}
    session.close()

    verify_session = sessionmaker()
    external_ids = verify_session.scalars(
        select(CrimeIncident.external_incident_id).order_by(CrimeIncident.external_incident_id)
    ).all()
    assert external_ids == ["spd-new", "spd-race"]
    verify_session.close()


def test_admin_socrata_ingest_requires_configured_matching_token(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_ADMIN_INGEST_TOKEN", raising=False)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    no_token_response = client.post("/admin/crime/ingest/socrata")

    assert no_token_response.status_code == 403
    assert no_token_response.json()["detail"] == "Admin token required"

    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    mismatch_response = client.post(
        "/admin/crime/ingest/socrata",
        headers={"X-Admin-Token": "wrong-token"},
    )

    assert mismatch_response.status_code == 403
    assert mismatch_response.json()["detail"] == "Admin token required"


def test_admin_socrata_ingest_rejects_negative_limit_without_fetching(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")

    def fail_fetch_page(self, limit: int, offset: int) -> list[CrimeIncidentData]:
        raise AssertionError("fetch_page should not be called for invalid pagination")

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fail_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?limit=-1&offset=0",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 422


def test_admin_socrata_ingest_rejects_negative_offset_without_fetching(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")

    def fail_fetch_page(self, limit: int, offset: int) -> list[CrimeIncidentData]:
        raise AssertionError("fetch_page should not be called for invalid pagination")

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fail_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?limit=25&offset=-1",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 422


def test_admin_socrata_ingest_rejects_huge_offset_without_fetching(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")

    def fail_fetch_page(self, limit: int, offset: int) -> list[CrimeIncidentData]:
        raise AssertionError("fetch_page should not be called for invalid pagination")

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fail_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?limit=25&offset=1000001",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 422


def test_admin_socrata_ingest_checks_token_before_pagination(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")

    def fail_fetch_page(self, limit: int, offset: int) -> list[CrimeIncidentData]:
        raise AssertionError("fetch_page should not be called without admin token")

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fail_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post("/admin/crime/ingest/socrata?limit=-1&offset=1000001")

    assert response.status_code == 403
    assert response.json()["detail"] == "Admin token required"


def test_admin_socrata_ingest_fetches_page_and_returns_ingestion_result(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)
    calls = []

    def fake_fetch_page(
        self,
        limit: int,
        offset: int,
        start_date=None,
        end_date=None,
    ) -> list[CrimeIncidentData]:
        calls.append(
            {
                "base_url": self.base_url,
                "dataset_id": self.dataset_id,
                "app_token": self.app_token,
                "limit": limit,
                "offset": offset,
                "start_date": start_date,
                "end_date": end_date,
            }
        )
        return [
            CrimeIncidentData(
                external_incident_id="spd-2",
                offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
                offense_category="PERSON",
                latitude=47.61,
                longitude=-122.34,
            )
        ]

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fake_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?limit=25&offset=50",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"inserted_count": 1, "updated_count": 0, "skipped_count": 0}
    assert calls == [
        {
            "base_url": "https://data.seattle.gov/resource",
            "dataset_id": "tazs-3rd5",
            "app_token": None,
            "limit": 25,
            "offset": 50,
            "start_date": None,
            "end_date": None,
        }
    ]


def test_admin_socrata_ingest_applies_upstream_corrections(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)

    def fake_fetch_page(self, limit, offset, start_date=None, end_date=None):
        return [
            CrimeIncidentData(
                external_incident_id="spd-corrected",
                offense_start_utc=datetime(2024, 1, 12, tzinfo=UTC),
                offense_category="PERSON",
                block_address="CORRECTED BLOCK",
                latitude=47.62,
                longitude=-122.35,
            )
        ]

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page", fake_fetch_page
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="preserved-local-id",
            source_dataset="seattle_spd_crime",
            external_incident_id="spd-corrected",
            offense_start_utc=datetime(2024, 1, 9, tzinfo=UTC),
            offense_category="PROPERTY",
            block_address="OLD BLOCK",
        )
    )
    session.commit()
    session.close()

    response = TestClient(app).post(
        "/admin/crime/ingest/socrata?limit=25&offset=0",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"inserted_count": 0, "updated_count": 1, "skipped_count": 0}
    session = get_sessionmaker()()
    corrected = session.scalar(
        select(CrimeIncident).where(
            CrimeIncident.external_incident_id == "spd-corrected"
        )
    )
    assert corrected is not None
    assert corrected.id == "preserved-local-id"
    assert corrected.offense_category == "PERSON"
    assert corrected.block_address == "CORRECTED BLOCK"
    session.close()


def test_admin_socrata_ingest_passes_date_window_to_client(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    calls = []

    def fake_fetch_page(
        self,
        limit: int,
        offset: int,
        start_date=None,
        end_date=None,
    ) -> list[CrimeIncidentData]:
        calls.append(
            {
                "limit": limit,
                "offset": offset,
                "start_date": start_date,
                "end_date": end_date,
            }
        )
        return []

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fake_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?limit=100&offset=25&start_date=2026-04-01&end_date=2026-06-22",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert calls == [
        {
            "limit": 100,
            "offset": 25,
            "start_date": date(2026, 4, 1),
            "end_date": date(2026, 6, 22),
        }
    ]


def test_admin_socrata_ingest_rejects_inverted_date_window(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")

    def fail_fetch_page(
        self,
        limit: int,
        offset: int,
        start_date=None,
        end_date=None,
    ) -> list[CrimeIncidentData]:
        raise AssertionError("fetch_page should not be called for inverted date windows")

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page",
        fail_fetch_page,
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?start_date=2026-06-22&end_date=2026-04-01",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "end_date must be on or after start_date"


def test_summarize_for_user_retains_rows_across_two_calls(tmp_path):
    from app.models import PlaceCluster, PlaceCrimeSummary
    from app.services.crime_service import summarize_for_user

    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()

    user_hash = "retention-test-user"
    session.add_all(
        [
            PlaceCluster(
                id="place-a",
                user_id_hash=user_hash,
                cluster_version="test",
                cluster_method="manual",
                centroid_latitude=47.609,
                centroid_longitude=-122.333,
                display_latitude=47.609,
                display_longitude=-122.333,
                visit_count=5,
                inferred_place_type="manual_place",
                sensitivity_class="normal",
                display_label="Place A",
                label_source="test",
            ),
            CrimeIncident(
                id="crime-r1",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.609,
                longitude=-122.333,
            ),
        ]
    )
    session.commit()

    result1 = summarize_for_user(
        session,
        user_hash,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )
    result2 = summarize_for_user(
        session,
        user_hash,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )

    assert result1["summary_count"] >= 1
    assert result2["summary_count"] >= 1

    rows = session.query(PlaceCrimeSummary).filter_by(user_id_hash=user_hash).all()
    # Both runs retained — at least two rows
    assert len(rows) >= 2
    # All rows have analysis_run_id set
    assert all(r.analysis_run_id is not None for r in rows)
    # Rows come from two distinct runs
    run_ids = {r.analysis_run_id for r in rows}
    assert len(run_ids) == 2

    session.close()


def test_socrata_client_windows_on_source_date_field(monkeypatch):
    from app.crime.seattle_socrata import arrest_from_mapping

    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps([]).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        return FakeResponse()

    monkeypatch.setattr("app.crime.seattle_socrata.urlopen", fake_urlopen)
    client = SeattleSocrataClient(
        base_url="https://data.seattle.gov/resource",
        dataset_id="9bjs-7a7w",
        mapper=arrest_from_mapping,
        date_field="arrest_occurred_date_time",
    )
    client.fetch_page(limit=10, offset=0, start_date=date(2026, 4, 1), end_date=date(2026, 6, 22))

    query = parse_qs(urlparse(captured["url"]).query)
    assert "9bjs-7a7w.json" in captured["url"]
    assert query["$order"] == ["arrest_occurred_date_time DESC"]
    assert query["$where"] == [
        "arrest_occurred_date_time between '2026-04-01T00:00:00' "
        "and '2026-06-22T23:59:59'"
    ]


def test_ingest_crime_incidents_keys_dedup_by_source(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    incidents = [
        CrimeIncidentData(
            external_incident_id="shared-99",
            source_dataset="seattle_spd_crime",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            latitude=47.609,
            longitude=-122.333,
        ),
        CrimeIncidentData(
            external_incident_id="shared-99",
            source_dataset="seattle_spd_arrests",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            latitude=47.609,
            longitude=-122.333,
        ),
        CrimeIncidentData(
            external_incident_id="shared-99",
            source_dataset="seattle_spd_arrests",  # in-run duplicate of the arrest row
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            latitude=47.609,
            longitude=-122.333,
        ),
    ]
    result = ingest_crime_incidents(session, incidents)
    assert result == {"inserted_count": 2, "updated_count": 0, "skipped_count": 1}
    rows = session.scalars(
        select(CrimeIncident).where(CrimeIncident.external_incident_id == "shared-99")
    ).all()
    assert {r.source_dataset for r in rows} == {"seattle_spd_crime", "seattle_spd_arrests"}
    session.close()


def test_admin_socrata_ingest_source_arrests_uses_registry(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    calls = []

    def fake_fetch_page(self, limit, offset, start_date=None, end_date=None):
        calls.append(
            {
                "dataset_id": self.dataset_id,
                "date_field": self.date_field,
                "cursor_id_field": self.cursor_id_field,
            }
        )
        return [
            CrimeIncidentData(
                external_incident_id="arr-1",
                source_dataset="seattle_spd_arrests",
                offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
                latitude=47.61,
                longitude=-122.34,
            )
        ]

    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page", fake_fetch_page
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?source=seattle_spd_arrests&limit=10&offset=0",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"inserted_count": 1, "updated_count": 0, "skipped_count": 0}
    assert calls == [
        {
            "dataset_id": "9bjs-7a7w",
            "date_field": "arrest_occurred_date_time",
            "cursor_id_field": ":id",
        }
    ]


def test_admin_socrata_ingest_rejects_unknown_source(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    response = client.post(
        "/admin/crime/ingest/socrata?source=not-a-source",
        headers={"X-Admin-Token": "secret-token"},
    )
    assert response.status_code == 422
    assert "Unknown source" in response.json()["detail"]


def test_admin_socrata_backfill_scopes_watermark_to_source(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    captured = {}

    def fake_latest_observed_date(session, source_dataset="seattle_spd_crime"):
        captured["source_dataset"] = source_dataset
        return None

    def fake_keyset(self, *, since_iso=None, since_id=None, end_date=None, limit=5000):
        return [], None

    monkeypatch.setattr(
        "app.api.routes_admin_crime.latest_observed_date", fake_latest_observed_date
    )
    monkeypatch.setattr(
        "app.api.routes_admin_crime.SeattleSocrataClient.fetch_page_keyset", fake_keyset
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/admin/crime/ingest/socrata?source=seattle_spd_arrests&mode=backfill",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    assert captured["source_dataset"] == "seattle_spd_arrests"
