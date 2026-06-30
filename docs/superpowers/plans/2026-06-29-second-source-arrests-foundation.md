# Second Data Source — Arrests Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Waypoint's crime-query layer source-aware (default reports-only) and add an SPD Arrest Data (`9bjs-7a7w`) ingest path tagged `source_dataset="seattle_spd_arrests"`, so arrests can be stored without changing any existing user-facing number — closing the silent-blend landmine before any surfacing increment.

**Architecture:** Reuse the shared `crime_incidents` table + its existing `source_dataset` discriminator. A small source registry (`app/crime/sources.py`) maps a source key → (Socrata dataset id attr, row mapper, date field). The Socrata client becomes source-parameterized; dedup/uniqueness becomes composite `(source_dataset, external_incident_id)`; every incident query, the freshness aggregate, and the backfill watermark gain a `source_dataset` filter defaulting to `seattle_spd_crime`. No UI, no analysis surfacing.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, Pydantic, pytest. Dev/test DB is SQLite via `create_all` (schema reflects the ORM directly); Postgres prod runs the Alembic migration. Spec: `docs/superpowers/specs/2026-06-29-second-source-arrests-foundation-design.md`.

**Conventions in this codebase (read before starting):**
- Tests spin up a real SQLite DB: `create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")` then `session = get_sessionmaker()()`.
- `make test-all` = pytest + `ruff check .` + frontend `npm test` + `npm run build`. Run from the worktree.
- Frequent commits (conventional-commit style, e.g. `feat(crime): ...`). End each commit body with the Co-Authored-By trailer used in this repo's history.

---

### Task 1: Arrest row → `CrimeIncidentData` mapper

**Files:**
- Modify: `app/crime/seattle_socrata.py` (add `arrest_from_mapping`, `load_arrest_csv`)
- Test: `tests/test_arrest_mapping.py` (create)

The mapper sets the literal `"seattle_spd_arrests"` (it cannot import the constant from `app/crime/sources.py` — that module imports this one; Task 2 pins the literal == constant). Demographics are dropped *by construction*: `CrimeIncidentData` has no subject/officer fields, so the mapper simply never reads them.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_arrest_mapping.py
from app.crime.seattle_socrata import arrest_from_mapping

_ROW = {
    "arrest_number": "19-001212",
    "arrest_occurred_date_time": "2019-05-21T00:00:00.000",
    "arrest_reported_date_time": "2019-05-21T10:40:34.000",
    "nibrs_description": "All Other Larceny",
    "offense_type": "SMC - 12A.08.060 | THEFT-OTH",
    "beat": "K1",
    "sector": "KING",
    "precinct": "West",
    "neighborhood": "DOWNTOWN COMMERCIAL",
    "block_address": "6XX BLOCK OF 5TH AVE",
    "report_number": "20170000288588",
    "latitude": "47.60405522",
    "longitude": "-122.32951432",
    # demographic / officer columns that MUST NOT be stored:
    "subject_race": "Black or African American",
    "subject_gender": "Male",
    "subject_age_range": "46 - 55",
    "officer_id": "1028",
    "officer_race": "Black or African American",
}


def test_arrest_row_maps_to_incident_fields():
    incident = arrest_from_mapping(_ROW)
    assert incident.external_incident_id == "19-001212"
    assert incident.source_dataset == "seattle_spd_arrests"
    assert incident.offense_start_utc is not None
    assert incident.offense_start_utc.isoformat() == "2019-05-21T00:00:00+00:00"
    assert incident.report_utc is not None
    assert incident.report_utc.isoformat() == "2019-05-21T10:40:34+00:00"
    assert incident.offense_subcategory == "All Other Larceny"  # from nibrs_description
    assert incident.offense_category is None
    assert incident.nibrs_group is None
    assert incident.beat == "K1"
    assert incident.sector == "KING"
    assert incident.precinct == "West"
    assert incident.mcpp == "DOWNTOWN COMMERCIAL"  # from neighborhood
    assert incident.block_address == "6XX BLOCK OF 5TH AVE"
    assert incident.report_number == "20170000288588"
    assert incident.latitude == 47.60405522
    assert incident.longitude == -122.32951432


def test_arrest_mapper_drops_demographics_by_construction():
    incident = arrest_from_mapping(_ROW)
    # CrimeIncidentData has no demographic/officer fields at all; prove nothing leaked in.
    dumped = incident.model_dump()
    for forbidden in ("subject_race", "subject_gender", "subject_age_range", "officer_id", "officer_race"):
        assert forbidden not in dumped


def test_arrest_mapper_accepts_redacted_coordinates():
    incident = arrest_from_mapping({**_ROW, "latitude": "", "longitude": ""})
    assert incident.latitude is None
    assert incident.longitude is None
    assert incident.external_incident_id == "19-001212"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_arrest_mapping.py -q`
Expected: FAIL with `ImportError: cannot import name 'arrest_from_mapping'`.

- [ ] **Step 3: Add `arrest_from_mapping` and `load_arrest_csv`**

In `app/crime/seattle_socrata.py`, after `crime_incident_from_mapping` (around line 109), add:

```python
def arrest_from_mapping(row: dict[str, Any]) -> CrimeIncidentData:
    latitude = _float_or_none(_first(row, "latitude", "lat", "y"))
    longitude = _float_or_none(_first(row, "longitude", "lon", "lng", "x"))
    return CrimeIncidentData(
        external_incident_id=_first(row, "arrest_number"),
        report_number=_first(row, "report_number"),
        offense_id=None,
        offense_start_utc=parse_datetime(
            _first(row, "arrest_occurred_date_time", "arrest_occurred", "arrest_date")
        ),
        offense_end_utc=None,
        report_utc=parse_datetime(_first(row, "arrest_reported_date_time", "arrest_reported")),
        offense_category=None,
        # Best-effort taxonomy: NIBRS offense description goes in offense_subcategory. This
        # column therefore carries source-specific semantics (arrests vs SPD reports); safe
        # because reports-only default means arrests are never queried by category here, and
        # we never filter across sources. A unified crosswalk is a later increment.
        offense_subcategory=_first(row, "nibrs_description"),
        nibrs_group=None,
        precinct=_first(row, "precinct"),
        sector=_first(row, "sector"),
        beat=_first(row, "beat"),
        mcpp=_first(row, "neighborhood", "mcpp"),
        block_address=_first(row, "block_address", "100_block_address"),
        latitude=latitude,
        longitude=longitude,
        source_dataset="seattle_spd_arrests",
        snapshot_at=parse_datetime(_first(row, "snapshot_at")) or utc_now(),
    )


def load_arrest_csv(path: Path) -> list[CrimeIncidentData]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return [arrest_from_mapping(row) for row in reader]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_arrest_mapping.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add app/crime/seattle_socrata.py tests/test_arrest_mapping.py
git commit -m "feat(crime): arrest_from_mapping + load_arrest_csv (drops demographics)"
```

---

### Task 2: Source constants + registry

**Files:**
- Create: `app/crime/sources.py`
- Test: `tests/test_crime_sources.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_crime_sources.py
import pytest

from app.crime.seattle_socrata import arrest_from_mapping, crime_incident_from_mapping
from app.crime.sources import (
    SOURCE_SPD_ARRESTS,
    SOURCE_SPD_CRIME,
    get_crime_source,
)


def test_source_constants_match_stored_tags():
    assert SOURCE_SPD_CRIME == "seattle_spd_crime"
    assert SOURCE_SPD_ARRESTS == "seattle_spd_arrests"
    # The arrest mapper hardcodes the literal; pin it to the constant.
    assert arrest_from_mapping({"arrest_number": "x"}).source_dataset == SOURCE_SPD_ARRESTS


def test_registry_resolves_known_sources():
    crime = get_crime_source(SOURCE_SPD_CRIME)
    assert crime.dataset_attr == "socrata_dataset_id"
    assert crime.mapper is crime_incident_from_mapping
    assert crime.date_field == "offense_date"

    arrests = get_crime_source(SOURCE_SPD_ARRESTS)
    assert arrests.dataset_attr == "socrata_arrests_dataset_id"
    assert arrests.mapper is arrest_from_mapping
    assert arrests.date_field == "arrest_occurred_date_time"


def test_registry_rejects_unknown_source():
    with pytest.raises(ValueError, match="Unknown crime source"):
        get_crime_source("nope")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_crime_sources.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.crime.sources'`.

- [ ] **Step 3: Create `app/crime/sources.py`**

```python
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.crime.seattle_socrata import arrest_from_mapping, crime_incident_from_mapping
from app.schemas import CrimeIncidentData

SOURCE_SPD_CRIME = "seattle_spd_crime"
SOURCE_SPD_ARRESTS = "seattle_spd_arrests"


@dataclass(frozen=True)
class CrimeSource:
    key: str
    dataset_attr: str  # Settings attribute holding this source's Socrata dataset id
    mapper: Callable[[dict[str, Any]], CrimeIncidentData]
    date_field: str  # Socrata column used for $order / $where windowing


CRIME_SOURCES: dict[str, CrimeSource] = {
    SOURCE_SPD_CRIME: CrimeSource(
        key=SOURCE_SPD_CRIME,
        dataset_attr="socrata_dataset_id",
        mapper=crime_incident_from_mapping,
        date_field="offense_date",
    ),
    SOURCE_SPD_ARRESTS: CrimeSource(
        key=SOURCE_SPD_ARRESTS,
        dataset_attr="socrata_arrests_dataset_id",
        mapper=arrest_from_mapping,
        date_field="arrest_occurred_date_time",
    ),
}


def get_crime_source(key: str) -> CrimeSource:
    try:
        return CRIME_SOURCES[key]
    except KeyError:
        raise ValueError(f"Unknown crime source: {key!r}") from None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_crime_sources.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add app/crime/sources.py tests/test_crime_sources.py
git commit -m "feat(crime): source registry + SOURCE_SPD_* constants"
```

---

### Task 3: Composite-unique key `(source_dataset, external_incident_id)` + migration

**Files:**
- Modify: `app/models.py:118-147` (`CrimeIncident`: drop column `unique=True`, add `__table_args__`, index `source_dataset`)
- Create: `alembic/versions/0008_crime_source_composite_unique.py`
- Test: `tests/test_crime_source_uniqueness.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_crime_source_uniqueness.py
from datetime import UTC, datetime

from sqlalchemy import select

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_same_external_id_coexists_across_sources(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="shared-1",
                source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
            CrimeIncident(
                external_incident_id="shared-1",
                source_dataset="seattle_spd_arrests",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
        ]
    )
    session.commit()
    rows = session.scalars(
        select(CrimeIncident).order_by(CrimeIncident.source_dataset)
    ).all()
    assert [r.source_dataset for r in rows] == ["seattle_spd_arrests", "seattle_spd_crime"]
    session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_crime_source_uniqueness.py -q`
Expected: FAIL — `IntegrityError: UNIQUE constraint failed: crime_incidents.external_incident_id`.

- [ ] **Step 3: Change the model**

In `app/models.py`, in `class CrimeIncident`:

Add `__table_args__` immediately under `__tablename__` (mirror `StagingLocationObservation`):

```python
    __tablename__ = "crime_incidents"
    __table_args__ = (
        UniqueConstraint(
            "source_dataset", "external_incident_id", name="uq_crime_source_external_id"
        ),
    )
```

Change line 122 to drop the column-level unique:

```python
    external_incident_id: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Change line 146 to index `source_dataset` (so dev/test `create_all` builds it):

```python
    source_dataset: Mapped[str] = mapped_column(Text, default="seattle_spd_crime", index=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_crime_source_uniqueness.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Scaffold + write the Alembic migration (Postgres)**

Scaffold so the down_revision is set correctly to the current head:

Run: `.venv/bin/alembic revision --rev-id 0008 -m "crime source composite unique"`

Then replace the generated `upgrade()`/`downgrade()` bodies in `alembic/versions/0008_crime_source_composite_unique.py`:

```python
def upgrade() -> None:
    # Old single-column unique was created inline (unique=True) in 0001; on Postgres its
    # auto name is crime_incidents_external_incident_id_key. Replace with the composite.
    op.drop_constraint(
        "crime_incidents_external_incident_id_key", "crime_incidents", type_="unique"
    )
    op.create_unique_constraint(
        "uq_crime_source_external_id",
        "crime_incidents",
        ["source_dataset", "external_incident_id"],
    )
    op.create_index(
        "ix_crime_incidents_source_dataset", "crime_incidents", ["source_dataset"]
    )


def downgrade() -> None:
    op.drop_index("ix_crime_incidents_source_dataset", table_name="crime_incidents")
    op.drop_constraint("uq_crime_source_external_id", "crime_incidents", type_="unique")
    op.create_unique_constraint(
        "crime_incidents_external_incident_id_key",
        "crime_incidents",
        ["external_incident_id"],
    )
```

> No data backfill: `source_dataset` is `nullable=False` (migration 0001 line 85), so every existing row already carries `"seattle_spd_crime"`. If `make migrate` on the Postgres CI lane reports the drop name is wrong, run `\d crime_incidents` against that DB and substitute the actual unique-constraint name.

- [ ] **Step 6: Migration validation (Postgres only — do NOT run on SQLite)**

This migration targets Postgres. Dev/test use SQLite via `create_all`, which reflects the model's composite unique directly (already exercised by Step 4's test), and SQLite **cannot** `ALTER TABLE ... DROP CONSTRAINT` — so do **not** run `alembic upgrade head` against the local SQLite DB; it will fail. The authoritative check is the **Postgres parity lane in CI** (`alembic upgrade head` on Postgres). Confirm that lane is green on the PR. You can still sanity-check the file scaffolds cleanly with `.venv/bin/alembic history | head` (no DB connection needed).

- [ ] **Step 7: Commit**

```bash
git add app/models.py alembic/versions/0008_crime_source_composite_unique.py tests/test_crime_source_uniqueness.py
git commit -m "feat(crime): composite unique (source_dataset, external_incident_id) + index"
```

---

### Task 4: Source-aware dedup in ingest

**Files:**
- Modify: `app/services/crime_ingestion_service.py:12-51` (`ingest_crime_incidents`)
- Modify: `app/services/crime_service.py:91-107` (`ingest_sample_crime` existence check)
- Test: `tests/test_crime_ingestion_service.py` (add cross-source case)

- [ ] **Step 1: Write the failing test** (append to `tests/test_crime_ingestion_service.py`)

```python
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
    assert result == {"inserted_count": 2, "skipped_count": 1}
    rows = session.scalars(
        select(CrimeIncident).where(CrimeIncident.external_incident_id == "shared-99")
    ).all()
    assert {r.source_dataset for r in rows} == {"seattle_spd_crime", "seattle_spd_arrests"}
    session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py::test_ingest_crime_incidents_keys_dedup_by_source -q`
Expected: FAIL — only the crime row inserts (global dedup skips the arrest as a duplicate id), so counts/rows mismatch.

- [ ] **Step 3: Make dedup source-aware**

Replace the body of `ingest_crime_incidents` (`app/services/crime_ingestion_service.py`) so the `seen` set and the existence query are keyed by `(source_dataset, external_incident_id)`:

```python
def ingest_crime_incidents(
    session: Session,
    incidents: list[CrimeIncidentData],
) -> dict[str, int]:
    inserted_count = 0
    skipped_count = 0
    seen_keys: set[tuple[str, str]] = set()

    for incident in incidents:
        if not incident.external_incident_id:
            skipped_count += 1
            continue

        key = (incident.source_dataset, incident.external_incident_id)
        if key in seen_keys:
            skipped_count += 1
            continue

        existing = session.scalar(
            select(CrimeIncident).where(
                CrimeIncident.source_dataset == incident.source_dataset,
                CrimeIncident.external_incident_id == incident.external_incident_id,
            )
        )
        if existing is not None:
            skipped_count += 1
            continue

        seen_keys.add(key)

        try:
            with session.begin_nested():
                session.add(_incident_model(incident))
                session.flush()
        except IntegrityError:
            skipped_count += 1
            continue

        inserted_count += 1

    session.commit()
    return {"inserted_count": inserted_count, "skipped_count": skipped_count}
```

In `app/services/crime_service.py`, in `ingest_sample_crime`, change the existence query (lines ~97-101) to also filter by source:

```python
            existing = session.scalar(
                select(CrimeIncident).where(
                    CrimeIncident.source_dataset == incident.source_dataset,
                    CrimeIncident.external_incident_id == incident.external_incident_id,
                )
            )
```

- [ ] **Step 4: Run the new test and the full ingestion suite (regression)**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py -q`
Expected: PASS (all, including the existing same-source dedup/race tests).

- [ ] **Step 5: Commit**

```bash
git add app/services/crime_ingestion_service.py app/services/crime_service.py tests/test_crime_ingestion_service.py
git commit -m "feat(crime): key incident dedup by (source_dataset, external_incident_id)"
```

---

### Task 5: Source-parameterized Socrata client (mapper + date field)

**Files:**
- Modify: `app/crime/seattle_socrata.py` (`SeattleSocrataClient.__init__`/`fetch_page`, `_date_window_where`)
- Test: `tests/test_crime_ingestion_service.py` (add an arrests-client query test)

Defaults keep the crime behavior byte-for-byte (existing `test_socrata_client_builds_date_window_query` must still pass).

- [ ] **Step 1: Write the failing test** (append to `tests/test_crime_ingestion_service.py`)

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py::test_socrata_client_windows_on_source_date_field -q`
Expected: FAIL — `SeattleSocrataClient.__init__` got an unexpected keyword `mapper`.

- [ ] **Step 3: Parameterize the client**

Add `from collections.abc import Callable` to the imports at the top of `app/crime/seattle_socrata.py`. Then update `SeattleSocrataClient`. Note the `mapper` default is `None`, resolved in the body — a literal default of `crime_incident_from_mapping` would `NameError` because that function is defined *below* the class and defaults evaluate at `def` time:

```python
class SeattleSocrataClient:
    def __init__(
        self,
        base_url: str,
        dataset_id: str,
        app_token: str | None = None,
        *,
        mapper: Callable[[dict[str, Any]], CrimeIncidentData] | None = None,
        date_field: str = "offense_date",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.dataset_id = dataset_id
        self.app_token = app_token
        self.mapper = mapper or crime_incident_from_mapping
        self.date_field = date_field

    def fetch_page(
        self,
        limit: int = 5000,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[CrimeIncidentData]:
        start_date = floor_start_date(start_date)
        query_params = {"$limit": limit, "$offset": offset}
        query_params["$order"] = f"{self.date_field} DESC"
        query_params["$where"] = _date_window_where(start_date, end_date, self.date_field)
        query = urlencode(query_params)
        request = Request(f"{self.base_url}/{self.dataset_id}.json?{query}")
        if self.app_token:
            request.add_header("X-App-Token", self.app_token)
        with urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode("utf-8"))
        return [self.mapper(row) for row in rows]
```

Update `_date_window_where` to take the field:

```python
def _date_window_where(
    start_date: date | None, end_date: date | None, field: str = "offense_date"
) -> str:
    if start_date and end_date:
        return (
            f"{field} between '{start_date.isoformat()}T00:00:00' "
            f"and '{end_date.isoformat()}T23:59:59'"
        )
    if start_date:
        return f"{field} >= '{start_date.isoformat()}T00:00:00'"
    if end_date:
        return f"{field} <= '{end_date.isoformat()}T23:59:59'"
    raise ValueError("At least one date is required.")
```

- [ ] **Step 4: Run the new test + the existing client/date-floor tests (regression)**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py tests/test_seattle_socrata_floor.py -q`
Expected: PASS (including `test_socrata_client_builds_date_window_query`, which still sees `offense_date`).

- [ ] **Step 5: Commit**

```bash
git add app/crime/seattle_socrata.py tests/test_crime_ingestion_service.py
git commit -m "feat(crime): source-parameterize SeattleSocrataClient (mapper + date field)"
```

---

### Task 6: Source-aware incident queries (default reports-only)

**Files:**
- Modify: `app/services/incident_query_service.py:43` (`incidents_in_bbox`)
- Modify: `app/services/dashboard_analysis_service.py:177` (`_filtered_incidents`)
- Modify: `app/services/neighborhood_service.py:80` (`_beat_incidents`)
- Modify: `app/services/crime_service.py:110` (`_incidents_near_clusters`)
- Test: `tests/test_source_aware_queries.py` (create)

Each gains `source_dataset: str = SOURCE_SPD_CRIME` and a `.where(CrimeIncident.source_dataset == source_dataset)`. No caller passes it (callers are all keyword/positional-prefix safe), so behavior is preserved.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_source_aware_queries.py
from datetime import UTC, date, datetime

from app.crime.sources import SOURCE_SPD_ARRESTS, SOURCE_SPD_CRIME
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.schemas import PlaceClusterData
from app.services.crime_service import _incidents_near_clusters
from app.services.dashboard_analysis_service import _filtered_incidents
from app.services.incident_query_service import BoundingBox, incidents_in_bbox
from app.services.neighborhood_service import _beat_incidents

_START = date(2024, 1, 1)
_END = date(2024, 1, 31)


def _seed_two_sources(session):
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="rep-1",
                source_dataset=SOURCE_SPD_CRIME,
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                beat="K1",
                latitude=47.609,
                longitude=-122.333,
            ),
            CrimeIncident(
                external_incident_id="arr-1",
                source_dataset=SOURCE_SPD_ARRESTS,
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                beat="K1",
                latitude=47.609,
                longitude=-122.333,
            ),
        ]
    )
    session.commit()


def _cluster() -> PlaceClusterData:
    return PlaceClusterData(
        id="place-1",
        user_id_hash="u",
        cluster_version="t",
        cluster_method="manual",
        centroid_latitude=47.609,
        centroid_longitude=-122.333,
        display_latitude=47.609,
        display_longitude=-122.333,
        visit_count=3,
    )


def test_incidents_in_bbox_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    box = BoundingBox(min_lat=47.6, max_lat=47.62, min_lon=-122.34, max_lon=-122.32)
    default = incidents_in_bbox(
        session, box=box, analysis_start_date=_START, analysis_end_date=_END
    )
    arrests = incidents_in_bbox(
        session, box=box, analysis_start_date=_START, analysis_end_date=_END,
        source_dataset=SOURCE_SPD_ARRESTS,
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()


def test_filtered_incidents_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    default = _filtered_incidents(
        session, clusters=[_cluster()], radii_m=[500],
        analysis_start_date=_START, analysis_end_date=_END,
        offense_category=None, offense_subcategory=None, nibrs_group=None,
    )
    arrests = _filtered_incidents(
        session, clusters=[_cluster()], radii_m=[500],
        analysis_start_date=_START, analysis_end_date=_END,
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        source_dataset=SOURCE_SPD_ARRESTS,
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()


def test_beat_incidents_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    default = _beat_incidents(session, "K1", _START, _END, None, None, None)
    arrests = _beat_incidents(
        session, "K1", _START, _END, None, None, None, source_dataset=SOURCE_SPD_ARRESTS
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()


def test_incidents_near_clusters_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    default = _incidents_near_clusters(session, [_cluster()], [500], _START, _END)
    arrests = _incidents_near_clusters(
        session, [_cluster()], [500], _START, _END, source_dataset=SOURCE_SPD_ARRESTS
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_source_aware_queries.py -q`
Expected: FAIL — functions got an unexpected `source_dataset` keyword (and defaults currently return both rows).

- [ ] **Step 3: Add the filter to each query**

`app/services/incident_query_service.py` — add the import `from app.crime.sources import SOURCE_SPD_CRIME`, add the param and clause:

```python
def incidents_in_bbox(
    session: Session,
    *,
    box: BoundingBox,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
    source_dataset: str = SOURCE_SPD_CRIME,
) -> list[CrimeIncidentData]:
    ...
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset == source_dataset)
        .where(CrimeIncident.latitude.is_not(None))
        ...
    )
```

`app/services/dashboard_analysis_service.py` — import `SOURCE_SPD_CRIME`, add to `_filtered_incidents`:

```python
def _filtered_incidents(
    session: Session,
    *,
    clusters: list[PlaceClusterData],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    source_dataset: str = SOURCE_SPD_CRIME,
) -> list[CrimeIncidentData]:
    ...
    statement = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset == source_dataset)
        .where(observed_at >= start_at)
        ...
    )
```

`app/services/neighborhood_service.py` — import `SOURCE_SPD_CRIME`, add a trailing keyword param to `_beat_incidents` (the one caller at line 216 passes positional offense args only, so a trailing default is safe):

```python
def _beat_incidents(
    session: Session,
    beat: str,
    start: date,
    end: date,
    offense_category,
    offense_subcategory,
    nibrs_group,
    source_dataset: str = SOURCE_SPD_CRIME,
) -> list[CrimeIncidentData]:
    ...
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset == source_dataset)
        .where(CrimeIncident.beat == beat)
        ...
    )
```

`app/services/crime_service.py` — import `SOURCE_SPD_CRIME` (`from app.crime.sources import SOURCE_SPD_CRIME`), add to `_incidents_near_clusters`:

```python
def _incidents_near_clusters(
    session: Session,
    clusters: list[PlaceClusterData],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    source_dataset: str = SOURCE_SPD_CRIME,
) -> list[CrimeIncidentData]:
    ...
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset == source_dataset)
        .where(CrimeIncident.latitude.is_not(None))
        ...
    )
```

- [ ] **Step 4: Run the new test + the dashboard/neighborhood suites (regression)**

Run: `.venv/bin/python -m pytest tests/test_source_aware_queries.py tests/test_dashboard_analysis_api.py tests/test_neighborhood_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/incident_query_service.py app/services/dashboard_analysis_service.py app/services/neighborhood_service.py app/services/crime_service.py tests/test_source_aware_queries.py
git commit -m "feat(crime): source-aware incident queries (default reports-only)"
```

---

### Task 7: Per-source freshness + source-keyed cache

**Files:**
- Modify: `app/services/crime_service.py:36-88` (`_compute_freshness`, `crime_data_freshness`, cache globals, `reset_freshness_cache`)
- Test: `tests/test_dashboard_freshness.py` (add a per-source case)

- [ ] **Step 1: Write the failing test** (append to `tests/test_dashboard_freshness.py`)

```python
def test_freshness_defaults_to_reports_and_ignores_arrests(tmp_path):
    from datetime import UTC, datetime

    from app.db import get_sessionmaker
    from app.main import create_app
    from app.models import CrimeIncident
    from app.services.crime_service import crime_data_freshness, reset_freshness_cache

    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    reset_freshness_cache()
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="rep-old",
                source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 6, 1, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
            CrimeIncident(
                external_incident_id="arr-new",
                source_dataset="seattle_spd_arrests",
                offense_start_utc=datetime(2025, 12, 31, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
        ]
    )
    session.commit()

    reports = crime_data_freshness(session)
    assert reports["incident_count"] == 1
    assert reports["data_through"] == "2024-06-01"  # arrests' later date excluded

    arrests = crime_data_freshness(session, source_dataset="seattle_spd_arrests")
    assert arrests["incident_count"] == 1
    assert arrests["data_through"] == "2025-12-31"
    session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_dashboard_freshness.py::test_freshness_defaults_to_reports_and_ignores_arrests -q`
Expected: FAIL — default count is 2 (arrests blended) and/or `source_dataset` kwarg unexpected.

- [ ] **Step 3: Scope freshness by source + key the cache**

In `app/services/crime_service.py`, add the import `from app.crime.sources import SOURCE_SPD_CRIME`. Replace the cache globals + functions (lines ~41-88):

```python
_freshness_cache: dict[str, dict[str, object]] = {}
_freshness_expires: dict[str, float] = {}


def reset_freshness_cache() -> None:
    """Drop cached freshness values (tests, or explicit invalidation)."""
    _freshness_cache.clear()
    _freshness_expires.clear()


def _compute_freshness(
    session: Session, source_dataset: str = SOURCE_SPD_CRIME
) -> dict[str, object]:
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    count, data_through, earliest, last_ingested_at = session.execute(
        select(
            func.count(CrimeIncident.id),
            func.max(observed),
            func.min(observed),
            func.max(CrimeIncident.snapshot_at),
        ).where(CrimeIncident.source_dataset == source_dataset)
    ).one()
    return {
        "incident_count": count or 0,
        "data_through": _as_date_str(data_through),
        "earliest": _as_date_str(earliest),
        "last_ingested_at": _as_iso(last_ingested_at),
    }


def crime_data_freshness(
    session: Session,
    *,
    source_dataset: str = SOURCE_SPD_CRIME,
    now: Callable[[], float] = monotonic,
) -> dict[str, object]:
    """Coverage/freshness of one crime source (default: SPD reports). Cached in-process per
    source for ``FRESHNESS_CACHE_TTL_S`` to avoid a full-table aggregate on every dashboard
    load; a race only causes a redundant recompute, so no lock is needed. The returned dict
    is shared across cache hits — treat it as read-only.
    """
    cached = _freshness_cache.get(source_dataset)
    if cached is not None and now() < _freshness_expires.get(source_dataset, 0.0):
        return cached
    value = _compute_freshness(session, source_dataset)
    _freshness_cache[source_dataset] = value
    _freshness_expires[source_dataset] = now() + FRESHNESS_CACHE_TTL_S
    return value
```

(Keep `FRESHNESS_CACHE_TTL_S = 300.0` as-is. The `/dashboard/freshness` endpoint keeps calling `crime_data_freshness(session)` with no source → stays reports-scoped.)

- [ ] **Step 4: Run the new test + the cache tests (regression)**

Run: `.venv/bin/python -m pytest tests/test_dashboard_freshness.py tests/test_freshness_cache.py -q`
Expected: PASS — the existing cache tests still hold (default source key; mocked `_compute_freshness`).

- [ ] **Step 5: Commit**

```bash
git add app/services/crime_service.py tests/test_dashboard_freshness.py
git commit -m "feat(crime): per-source freshness + source-keyed cache (pill stays reports-only)"
```

---

### Task 8: Source-scoped backfill watermark

**Files:**
- Modify: `app/crime/backfill.py:26-35` (`latest_observed_date`)
- Test: `tests/test_crime_backfill.py` (add a per-source case)

- [ ] **Step 1: Write the failing test** (append to `tests/test_crime_backfill.py`)

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_crime_backfill.py::test_latest_observed_date_is_source_scoped -q`
Expected: FAIL — default returns the arrests date (2025) and/or `source_dataset` kwarg unexpected.

- [ ] **Step 3: Scope the watermark**

In `app/crime/backfill.py`, add the import `from app.crime.sources import SOURCE_SPD_CRIME` and update:

```python
def latest_observed_date(
    session: Session, source_dataset: str = SOURCE_SPD_CRIME
) -> date | None:
    """The newest observed incident date already stored for this source — the watermark an
    incremental run starts from so it doesn't re-walk the whole dataset from offset 0."""
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    value = session.scalar(
        select(func.max(observed)).where(CrimeIncident.source_dataset == source_dataset)
    )
    if value is None:
        return None
    if hasattr(value, "date"):
        return value.date()
    return date.fromisoformat(str(value)[:10])  # SQLite may return an ISO string
```

- [ ] **Step 4: Run the new test + the backfill suite (regression)**

Run: `.venv/bin/python -m pytest tests/test_crime_backfill.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/crime/backfill.py tests/test_crime_backfill.py
git commit -m "feat(crime): source-scope the backfill watermark"
```

---

### Task 9: Expose `source_dataset` in the incidents API

**Files:**
- Modify: `app/services/dashboard_analysis_service.py:272-287` (`_incident_detail_rows` row dict)
- Test: `tests/test_dashboard_analysis_api.py` (add an assertion; or create `tests/test_incident_detail_source.py`)

The `/dashboard/incidents` response is a plain dict (no Pydantic model), so this is one additive key.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_incident_detail_source.py
from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.dashboard_analysis_service import _incident_detail_rows


def test_incident_detail_rows_include_source_dataset():

    cluster = PlaceClusterData(
        id="place-1",
        user_id_hash="u",
        cluster_version="t",
        cluster_method="manual",
        centroid_latitude=47.609,
        centroid_longitude=-122.333,
        display_latitude=47.609,
        display_longitude=-122.333,
        visit_count=3,
        display_label="Home",
    )
    incident = CrimeIncidentData(
        id="i1",
        external_incident_id="rep-1",
        source_dataset="seattle_spd_crime",
        latitude=47.609,
        longitude=-122.333,
    )
    rows = _incident_detail_rows([cluster], [incident], radius_m=500)
    assert rows
    assert rows[0]["source_dataset"] == "seattle_spd_crime"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_incident_detail_source.py -q`
Expected: FAIL — `KeyError: 'source_dataset'`.

- [ ] **Step 3: Add the field to the row dict**

In `app/services/dashboard_analysis_service.py`, inside `_incident_detail_rows`, add to the appended dict (next to `"external_incident_id"`):

```python
                    "source_dataset": incident.source_dataset,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_incident_detail_source.py tests/test_dashboard_analysis_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/dashboard_analysis_service.py tests/test_incident_detail_source.py
git commit -m "feat(dashboard): expose source_dataset on incident detail rows"
```

---

### Task 10: Config + admin ingest `source` param + watermark threading

**Files:**
- Modify: `app/config.py:31` (add `socrata_arrests_dataset_id`)
- Modify: `app/api/routes_admin_crime.py` (add `source` param, registry-driven client, source-scoped watermark)
- Test: `tests/test_crime_ingestion_service.py` (add arrests-route cases)

- [ ] **Step 1: Write the failing test** (append to `tests/test_crime_ingestion_service.py`)

```python
def test_admin_socrata_ingest_source_arrests_uses_registry(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    calls = []

    def fake_fetch_page(self, limit, offset, start_date=None, end_date=None):
        calls.append({"dataset_id": self.dataset_id, "date_field": self.date_field})
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
    assert response.json() == {"inserted_count": 1, "skipped_count": 0}
    assert calls == [{"dataset_id": "9bjs-7a7w", "date_field": "arrest_occurred_date_time"}]


def test_admin_socrata_ingest_rejects_unknown_source(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    response = client.post(
        "/admin/crime/ingest/socrata?source=not-a-source",
        headers={"X-Admin-Token": "secret-token"},
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py::test_admin_socrata_ingest_source_arrests_uses_registry -q`
Expected: FAIL — `source` is ignored; the client uses `tazs-3rd5`/`offense_date`.

- [ ] **Step 3: Add the config field**

In `app/config.py`, after line 31 (`socrata_dataset_id`):

```python
    socrata_arrests_dataset_id: str = "9bjs-7a7w"
```

- [ ] **Step 4: Make the admin route source-aware**

Rewrite `app/api/routes_admin_crime.py` `ingest_socrata` to resolve the source from the registry, build the client with that source's dataset id + mapper + date field, validate `source`, and scope the watermark. Add imports:

```python
from app.crime.sources import CRIME_SOURCES, SOURCE_SPD_CRIME, get_crime_source
```

Replace the handler:

```python
@router.post(
    "/admin/crime/ingest/socrata",
    dependencies=[Depends(require_admin_ingest_token)],
)
def ingest_socrata(
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=MAX_SOCRATA_LIMIT)] = MAX_SOCRATA_LIMIT,
    offset: Annotated[int, Query(ge=0, le=MAX_SOCRATA_OFFSET)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
    mode: Annotated[str, Query(pattern="^(page|backfill)$")] = "page",
    source: str = SOURCE_SPD_CRIME,
) -> dict[str, int]:
    if source not in CRIME_SOURCES:
        raise HTTPException(status_code=422, detail=f"Unknown source: {source}")
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    settings = get_settings()
    crime_source = get_crime_source(source)
    client = SeattleSocrataClient(
        base_url=settings.socrata_base_url,
        dataset_id=getattr(settings, crime_source.dataset_attr),
        app_token=settings.socrata_app_token,
        mapper=crime_source.mapper,
        date_field=crime_source.date_field,
    )
    if mode == "backfill":
        if start_date is None:
            start_date = latest_observed_date(session, source_dataset=source)
        return backfill_socrata(
            session, client, start_date=start_date, end_date=end_date, page_size=limit
        )
    incidents = client.fetch_page(
        limit=limit, offset=offset, start_date=start_date, end_date=end_date
    )
    return ingest_crime_incidents(session, incidents)
```

> The default path (`source` omitted → `seattle_spd_crime`) constructs the client with `dataset_id="tazs-3rd5"`, the crime mapper, and `offense_date` — identical to before, so the existing admin-route tests still pass.

- [ ] **Step 5: Run the new tests + the full admin-route suite (regression)**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py -q`
Expected: PASS (including the existing `..._fetches_page_and_returns_ingestion_result`, which still asserts `dataset_id == "tazs-3rd5"`).

- [ ] **Step 6: Commit**

```bash
git add app/config.py app/api/routes_admin_crime.py tests/test_crime_ingestion_service.py
git commit -m "feat(crime): admin ingest source param (registry-driven) + scoped watermark"
```

---

### Task 11: Arrest seed fixture + script + Make target

**Files:**
- Create: `app/data/seed_arrests.csv`
- Create: `scripts/seed_arrests.py`
- Modify: `Makefile` (add `seed-arrests` + `ingest-arrests`, update `.PHONY`)
- Test: `tests/test_seed_arrests.py` (create)

The arrest seed is a modest demo fixture (arrests are not surfaced in this increment, so it need not be the 200-row "substantial" set the crime seed is).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_seed_arrests.py
from importlib import resources

from app.crime.seattle_socrata import load_arrest_csv


def test_packaged_arrest_seed_loads_and_is_tagged():
    incidents = load_arrest_csv(resources.files("app.data").joinpath("seed_arrests.csv"))
    assert len(incidents) >= 8
    assert all(i.source_dataset == "seattle_spd_arrests" for i in incidents)
    assert len({i.external_incident_id for i in incidents}) == len(incidents)  # unique
    assert all(i.offense_subcategory for i in incidents)  # nibrs_description present
    assert all(i.latitude is not None and i.longitude is not None for i in incidents)
    assert len({i.beat for i in incidents}) >= 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_seed_arrests.py -q`
Expected: FAIL — `FileNotFoundError`/resource missing.

- [ ] **Step 3: Create the seed CSV** `app/data/seed_arrests.csv`

```csv
arrest_number,arrest_occurred_date_time,arrest_reported_date_time,nibrs_description,beat,sector,precinct,neighborhood,block_address,report_number,longitude,latitude
SEED-A-0001,2022-01-04T14:05:00,2022-01-04T15:10:00,All Other Larceny,K1,KING,West,DOWNTOWN COMMERCIAL,5XX BLOCK 5TH AVE,20220000000001,-122.332149,47.608604
SEED-A-0002,2022-03-11T22:40:00,2022-03-12T00:15:00,Drug/Narcotic Violations,E1,EDWARD,East,CAPITOL HILL,2XX BLOCK BROADWAY E,20220000000002,-122.320882,47.620492
SEED-A-0003,2022-06-20T09:25:00,2022-06-20T10:00:00,Simple Assault,B2,BOY,North,FREMONT,7XX BLOCK N 47TH ST,20220000000003,-122.349303,47.662874
SEED-A-0004,2023-02-15T18:30:00,2023-02-15T19:05:00,Intimidation,K3,KING,West,CHINATOWN/INTERNATIONAL DISTRICT,6XX BLOCK 5TH AVE S,20230000000004,-122.327000,47.598000
SEED-A-0005,2023-05-02T03:12:00,2023-05-02T04:00:00,Destruction/Damage/Vandalism,D2,DAVID,West,BELLTOWN,20XX BLOCK 2ND AVE,20230000000005,-122.345000,47.613000
SEED-A-0006,2023-09-19T16:48:00,2023-09-19T17:20:00,Burglary/Breaking & Entering,N3,NORA,North,BALLARD,55XX BLOCK 22ND AVE NW,20230000000006,-122.385000,47.668000
SEED-A-0007,2024-01-07T11:00:00,2024-01-07T11:45:00,Theft From Motor Vehicle,G1,GEORGE,East,CENTRAL AREA,1XX BLOCK 23RD AVE,20240000000007,-122.302000,47.610000
SEED-A-0008,2024-04-23T20:05:00,2024-04-23T21:00:00,Weapon Law Violations,M2,MARY,West,SODO,30XX BLOCK 1ST AVE S,20240000000008,-122.334000,47.580000
SEED-A-0009,2024-08-30T07:35:00,2024-08-30T08:10:00,All Other Larceny,U2,UNION,North,UNIVERSITY DISTRICT,43XX BLOCK UNIVERSITY WAY NE,20240000000009,-122.313000,47.659000
SEED-A-0010,2024-11-12T13:20:00,2024-11-12T14:00:00,Drug/Narcotic Violations,W1,WILLIAM,Southwest,WEST SEATTLE,45XX BLOCK CALIFORNIA AVE SW,20240000000010,-122.387000,47.562000
```

- [ ] **Step 4: Create `scripts/seed_arrests.py`** (mirror `scripts/seed_crime.py`)

```python
"""Seed the database with the bundled synthetic arrest dataset (app/data/seed_arrests.csv),
tagged source_dataset="seattle_spd_arrests". Idempotent — re-running skips arrests already
present (dedup is per-source). Demo data; real data comes from the Socrata ingest with
?source=seattle_spd_arrests (see docs/DEPLOY.md).

    make seed-arrests        # or: .venv/bin/python scripts/seed_arrests.py
"""
from __future__ import annotations

from importlib import resources

from app.crime.seattle_socrata import load_arrest_csv
from app.db import configure_database, get_sessionmaker, init_db
from app.services.crime_ingestion_service import ingest_crime_incidents


def main() -> int:
    configure_database()
    init_db()
    path = resources.files("app.data").joinpath("seed_arrests.csv")
    incidents = load_arrest_csv(path)
    with get_sessionmaker()() as session:
        result = ingest_crime_incidents(session, incidents)
    print(f"seeded from seed_arrests.csv: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Update the `Makefile`**

Add `seed-arrests` and `ingest-arrests` to the `.PHONY` line, and add the targets after `seed-crime`/`ingest-crime`:

```makefile
seed-arrests:
	.venv/bin/python scripts/seed_arrests.py

ingest-arrests:
	@if [ -z "$$MCA_ADMIN_INGEST_TOKEN" ]; then \
		echo "MCA_ADMIN_INGEST_TOKEN is required"; \
		exit 1; \
	fi
	curl --fail --show-error -s -X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN" \
		"http://127.0.0.1:8000/admin/crime/ingest/socrata?source=seattle_spd_arrests&mode=backfill&limit=5000"
```

- [ ] **Step 6: Run the seed test + confirm the script runs**

Run: `.venv/bin/python -m pytest tests/test_seed_arrests.py -q && .venv/bin/python scripts/seed_arrests.py`
Expected: test PASS; script prints `seeded from seed_arrests.csv: {'inserted_count': 10, 'skipped_count': 0}` (the script uses the default dev DB; a second run prints all-skipped — idempotent).

- [ ] **Step 7: Commit**

```bash
git add app/data/seed_arrests.csv scripts/seed_arrests.py Makefile tests/test_seed_arrests.py
git commit -m "feat(crime): bundled arrest seed + seed-arrests/ingest-arrests targets"
```

---

### Task 12: Docs + roadmap tick + full gate

**Files:**
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Update the data model doc**

In `docs/architecture/data-model.md`:
- In the Crime table row for `CrimeIncident`, note the uniqueness is now **composite `(source_dataset, external_incident_id)`** and that `source_dataset` is `seattle_spd_crime` or `seattle_spd_arrests`; add a sentence that for arrests, `offense_subcategory` holds the NIBRS offense description (source-specific) and `offense_category`/`nibrs_group` are null.
- In the Migrations table, add a row: `0008_crime_source_composite_unique.py | Drops the single-column unique on external_incident_id, adds composite unique (source_dataset, external_incident_id) + index on source_dataset`.
- Update the "Verified against" commit note to this branch's final commit (fill after the last commit).

- [ ] **Step 2: Update the roadmap (C4 stays unchecked)**

In `docs/ROADMAP.md`, change the C4 bullet to keep `[ ]` and add a foundation sub-note:

```markdown
- [ ] **C4 · Second data source** — integrate another dataset. _Increment 1 shipped (this PR):
  source-aware crime layer (queries/freshness/watermark default reports-only) + SPD Arrest Data
  (`9bjs-7a7w`) ingest tagged `source_dataset="seattle_spd_arrests"`, no UI. Remaining: surface
  arrests as an enforcement-framed lens + taxonomy crosswalk._
```

- [ ] **Step 3: Update DEPLOY.md**

In `docs/DEPLOY.md`, near the crime-ingest instructions, add a short note: arrests load via `make ingest-arrests` (or `POST /admin/crime/ingest/socrata?source=seattle_spd_arrests&mode=backfill`); they are stored but not surfaced in the UI yet; the "Data through" pill remains SPD-reports-scoped.

- [ ] **Step 4: Run the full verification gate**

Run: `make test-all`
Expected: pytest all-pass, `ruff check .` clean, frontend `npm test` pass, `npm run build` succeeds.

`make test-all` is the local gate (tests build the schema via `create_all`, not Alembic). The `0008` migration is Postgres-targeted and validated by the CI Postgres parity lane — do **not** run `alembic upgrade head` against the local SQLite DB.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/data-model.md docs/ROADMAP.md docs/DEPLOY.md
git commit -m "docs(crime): document arrests foundation (data-model, roadmap C4 note, deploy)"
```

---

## Self-Review notes (for the implementer)

- **Backward compatibility is the safety property.** After every task, the *existing* suite must stay green; the new behavior is reached only by passing a non-default `source_dataset`/`source`. If an existing test breaks, the change leaked into the default path — fix that, don't edit the test (except the intentional additive ones noted above).
- **Import direction:** `app/crime/sources.py` imports the mappers from `app/crime/seattle_socrata.py`; the mapper hard-codes the `"seattle_spd_arrests"` literal (Task 1) precisely so `seattle_socrata` never imports `sources` (no cycle). Service modules import only the `SOURCE_*` constants from `sources`.
- **Migration name risk:** the dropped constraint `crime_incidents_external_incident_id_key` is the Postgres auto-name for the old inline `unique=True`. SQLite dev/test never runs the migration (it uses `create_all` off the model). The Postgres CI parity lane is the real check — if it fails on the drop, substitute the actual name.
- **Out of scope (do not add):** any Analyze/Compare/Routes UI, taxonomy crosswalk, arrest category breakdown/temporal, cross-source or both-at-once queries, arrest-native columns, demographic analysis, live prod data load.
