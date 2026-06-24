import json
from datetime import UTC, date, datetime
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.crime.seattle_socrata import SeattleSocrataClient, crime_incident_from_mapping
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

    assert result == {"inserted_count": 1, "skipped_count": 1}
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

    assert result == {"inserted_count": 1, "skipped_count": 2}
    rows = session.scalars(select(CrimeIncident)).all()
    assert [row.external_incident_id for row in rows] == ["spd-keep"]
    session.close()


def test_ingest_crime_incidents_skips_existing_external_incident_ids(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
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
        ],
    )

    assert result == {"inserted_count": 1, "skipped_count": 1}
    external_ids = session.scalars(
        select(CrimeIncident.external_incident_id).order_by(CrimeIncident.external_incident_id)
    ).all()
    assert external_ids == ["spd-existing", "spd-new"]
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
    monkeypatch.setattr(session, "scalar", lambda statement: None)
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

    assert result == {"inserted_count": 1, "skipped_count": 1}
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
    assert response.json() == {"inserted_count": 1, "skipped_count": 0}
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
