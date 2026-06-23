# Live Route Alternatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first provider-neutral live route alternatives slice so users can enter a route request, receive mock Seattle route alternatives, compare reported incident context, and export route comparison data for Tableau.

**Architecture:** Add route-specific schemas, persistence models, services, and exports instead of forcing route data into place clusters. The first provider is a deterministic local mock provider using a Seattle fixture; the service boundary is designed so OpenTripPlanner can replace or augment it later. Route context summaries reuse shared distance helpers but live in route-specific functions and tables.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic, pytest, Ruff, SQLite/Postgres-compatible migrations.

---

## File Structure

- Create `app/data/seattle_route_places.py`: local Seattle place fixture for Stage 1 place resolution.
- Create `app/routing/__init__.py`: routing package marker.
- Create `app/routing/schemas.py`: provider-neutral route request, location, alternative, segment, and context Pydantic models.
- Create `app/routing/place_resolver.py`: exact/alias lookup against the local fixture.
- Create `app/routing/mock_provider.py`: deterministic provider that returns Seattle sample alternatives.
- Create `app/routing/context.py`: pure route context summary function.
- Create `app/services/route_service.py`: persistence and route comparison orchestration.
- Create `app/exports/routes.py`: Tableau-ready CSV builders for route alternatives, segments, and context.
- Create `app/services/route_export_service.py`: SQLAlchemy-to-export adapter.
- Create `app/api/routes_routes.py`: route alternatives and comparison API.
- Modify `app/models.py`: add `RouteRequest`, `RouteAlternative`, `RouteSegment`, and `RouteContextSummary`.
- Modify `app/schemas.py`: add route data models only if shared outside `app/routing` is needed; prefer `app/routing/schemas.py`.
- Modify `app/api/routes_exports.py`: add route CSV export endpoints.
- Modify `app/main.py`: include route API router.
- Create `alembic/versions/0002_route_alternatives.py`: route persistence migration.
- Add tests in `tests/test_route_place_resolver.py`, `tests/test_mock_routing_provider.py`, `tests/test_route_alternatives_api.py`, `tests/test_route_context.py`, and `tests/test_route_tableau_exports.py`.
- Update `README.md`: document route alternatives API and Tableau route exports.

---

## Task 1: Routing Schemas, Place Fixture, Resolver, And Mock Provider

**Files:**
- Create: `app/data/seattle_route_places.py`
- Create: `app/routing/__init__.py`
- Create: `app/routing/schemas.py`
- Create: `app/routing/place_resolver.py`
- Create: `app/routing/mock_provider.py`
- Test: `tests/test_route_place_resolver.py`
- Test: `tests/test_mock_routing_provider.py`

- [ ] **Step 1: Write the failing place resolver test**

Create `tests/test_route_place_resolver.py`:

```python
from app.routing.place_resolver import UnknownRoutePlaceError, resolve_route_place


def test_resolve_route_place_supports_aliases_and_display_coordinates():
    place = resolve_route_place("Capitol Hill")

    assert place.label == "Capitol Hill"
    assert place.location_type == "neighborhood"
    assert round(place.latitude, 3) == 47.623
    assert round(place.longitude, 3) == -122.321
    assert place.display_latitude is not None
    assert place.display_longitude is not None


def test_resolve_route_place_rejects_unknown_places():
    try:
        resolve_route_place("Not A Seattle Place")
    except UnknownRoutePlaceError as exc:
        assert "Unknown route place" in str(exc)
    else:
        raise AssertionError("Expected UnknownRoutePlaceError")
```

- [ ] **Step 2: Run the resolver test and verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_place_resolver.py -q`

Expected: FAIL because `app.routing.place_resolver` does not exist.

- [ ] **Step 3: Implement schemas, fixture, and resolver**

Create `app/routing/__init__.py`:

```python
"""Route alternatives and routing provider utilities."""
```

Create `app/routing/schemas.py` with these models:

```python
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas import new_id


class RouteLocation(BaseModel):
    label: str
    latitude: float
    longitude: float
    display_latitude: float | None = None
    display_longitude: float | None = None
    location_type: str = "unknown"
    source: str = "local_fixture"


class RouteRequestCreate(BaseModel):
    origin_label: str
    destination_label: str
    mode: str = "transit"
    departure_date: date | None = None
    departure_time: str | None = None
    time_window: str | None = None
    preferences: list[str] = Field(default_factory=list)
    privacy_level: str = "generalized"
    provider: str = "mock"
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[int] = Field(default_factory=lambda: [250, 500])


class RouteSegmentData(BaseModel):
    id: str = Field(default_factory=new_id)
    route_alternative_id: str | None = None
    sequence: int
    segment_type: str
    mode: str
    start_label: str
    start_latitude: float
    start_longitude: float
    end_label: str
    end_latitude: float
    end_longitude: float
    distance_m: float | None = None
    duration_minutes: float | None = None
    geometry: str | None = None


class RouteAlternativeData(BaseModel):
    id: str = Field(default_factory=new_id)
    route_request_id: str | None = None
    provider_route_id: str
    route_label: str
    rank: int
    duration_minutes: float | None = None
    distance_m: float | None = None
    transfer_count: int = 0
    walking_distance_m: float | None = None
    mode_mix: str
    summary_geometry: str | None = None
    provider: str = "mock"
    provider_metadata_json: str | None = None
    segments: list[RouteSegmentData] = Field(default_factory=list)


class RouteContextSummaryData(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id_hash: str
    route_alternative_id: str
    route_segment_id: str | None = None
    context_label: str
    context_type: str
    radius_m: int
    analysis_start_date: date
    analysis_end_date: date
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    incident_count: int
    nearest_incident_m: float | None = None
    incidents_per_route: float | None = None


class RouteRequestData(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id_hash: str
    origin: RouteLocation
    destination: RouteLocation
    mode: str
    departure_date: date | None = None
    departure_time: str | None = None
    time_window: str | None = None
    preferences: list[str] = Field(default_factory=list)
    privacy_level: str = "generalized"
    provider: str = "mock"
    status: str = "ready"
    created_at: datetime | None = None
```

Create `app/data/seattle_route_places.py` with `SEATTLE_ROUTE_PLACES`, including at minimum:

```python
SEATTLE_ROUTE_PLACES = {
    "capitol hill": {
        "label": "Capitol Hill",
        "aliases": ["cap hill", "capitol hill station"],
        "latitude": 47.623,
        "longitude": -122.321,
        "display_latitude": 47.623,
        "display_longitude": -122.321,
        "location_type": "neighborhood",
    },
    "downtown seattle": {
        "label": "Downtown Seattle",
        "aliases": ["downtown", "central business district"],
        "latitude": 47.609,
        "longitude": -122.335,
        "display_latitude": 47.609,
        "display_longitude": -122.335,
        "location_type": "neighborhood",
    },
    "westlake station": {
        "label": "Westlake Station",
        "aliases": ["westlake"],
        "latitude": 47.6116,
        "longitude": -122.3372,
        "display_latitude": 47.612,
        "display_longitude": -122.337,
        "location_type": "transit_stop",
    },
    "rainier valley": {
        "label": "Rainier Valley",
        "aliases": ["columbia city", "rainier"],
        "latitude": 47.559,
        "longitude": -122.287,
        "display_latitude": 47.559,
        "display_longitude": -122.287,
        "location_type": "neighborhood",
    },
    "ballard": {
        "label": "Ballard",
        "aliases": [],
        "latitude": 47.668,
        "longitude": -122.386,
        "display_latitude": 47.668,
        "display_longitude": -122.386,
        "location_type": "neighborhood",
    },
    "university district": {
        "label": "University District",
        "aliases": ["u district", "udistrict"],
        "latitude": 47.661,
        "longitude": -122.313,
        "display_latitude": 47.661,
        "display_longitude": -122.313,
        "location_type": "neighborhood",
    },
}
```

Create `app/routing/place_resolver.py` using a normalized alias index:

```python
from __future__ import annotations

from app.data.seattle_route_places import SEATTLE_ROUTE_PLACES
from app.routing.schemas import RouteLocation


class UnknownRoutePlaceError(ValueError):
    pass


def resolve_route_place(label: str) -> RouteLocation:
    key = _normalize(label)
    record = _place_index().get(key)
    if record is None:
        raise UnknownRoutePlaceError(f"Unknown route place: {label}")
    return RouteLocation(
        label=record["label"],
        latitude=record["latitude"],
        longitude=record["longitude"],
        display_latitude=record.get("display_latitude"),
        display_longitude=record.get("display_longitude"),
        location_type=record.get("location_type", "unknown"),
        source="local_fixture",
    )


def _place_index() -> dict[str, dict[str, object]]:
    index: dict[str, dict[str, object]] = {}
    for key, record in SEATTLE_ROUTE_PLACES.items():
        index[_normalize(key)] = record
        index[_normalize(str(record["label"]))] = record
        for alias in record.get("aliases", []):
            index[_normalize(str(alias))] = record
    return index


def _normalize(value: str) -> str:
    return " ".join(value.strip().lower().split())
```

- [ ] **Step 4: Run resolver test and verify it passes**

Run: `.venv/bin/python -m pytest tests/test_route_place_resolver.py -q`

Expected: PASS.

- [ ] **Step 5: Write the failing mock provider test**

Create `tests/test_mock_routing_provider.py`:

```python
from app.routing.mock_provider import MockRoutingProvider
from app.routing.place_resolver import resolve_route_place
from app.routing.schemas import RouteRequestData


def test_mock_provider_returns_ranked_route_alternatives_with_segments():
    request = RouteRequestData(
        user_id_hash="user-hash",
        origin=resolve_route_place("Capitol Hill"),
        destination=resolve_route_place("Downtown Seattle"),
        mode="transit",
        time_window="weekday_morning",
    )

    alternatives = MockRoutingProvider().get_routes(request)

    assert len(alternatives) >= 2
    assert alternatives[0].rank == 1
    assert alternatives[0].provider == "mock"
    assert alternatives[0].route_label
    assert alternatives[0].duration_minutes is not None
    assert alternatives[0].segments
    assert alternatives[0].segments[0].sequence == 1
    assert alternatives[0].segments[0].start_label == "Capitol Hill"
```

- [ ] **Step 6: Run mock provider test and verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mock_routing_provider.py -q`

Expected: FAIL because `app.routing.mock_provider` does not exist.

- [ ] **Step 7: Implement mock provider**

Create `app/routing/mock_provider.py` with deterministic Capitol Hill to Downtown alternatives and a generic fallback. Use `_segment()` to create `RouteSegmentData` and set line geometry as a simple `lat,lon;lat,lon` string.

- [ ] **Step 8: Run Task 1 tests**

Run: `.venv/bin/python -m pytest tests/test_route_place_resolver.py tests/test_mock_routing_provider.py -q`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add app/data/seattle_route_places.py app/routing tests/test_route_place_resolver.py tests/test_mock_routing_provider.py
git commit -m "feat: add route resolver and mock provider"
```

---

## Task 2: Route Persistence Models And Migration

**Files:**
- Modify: `app/models.py`
- Create: `alembic/versions/0002_route_alternatives.py`
- Test: `tests/test_route_models_migration.py`

- [ ] **Step 1: Write the failing model persistence test**

Create `tests/test_route_models_migration.py`:

```python
from app.models import RouteAlternative, RouteRequest, RouteSegment


def test_route_models_persist_with_relationship_ids(client_session):
    request = RouteRequest(
        user_id_hash="route-user",
        origin_label="Capitol Hill",
        origin_latitude=47.623,
        origin_longitude=-122.321,
        destination_label="Downtown Seattle",
        destination_latitude=47.609,
        destination_longitude=-122.335,
        mode="transit",
        provider="mock",
        privacy_level="generalized",
        status="ready",
    )
    client_session.add(request)
    client_session.flush()

    alternative = RouteAlternative(
        route_request_id=request.id,
        user_id_hash="route-user",
        provider_route_id="mock-1",
        route_label="Transit via Westlake",
        rank=1,
        duration_minutes=18,
        distance_m=2500,
        transfer_count=0,
        walking_distance_m=600,
        mode_mix="walk,transit",
        provider="mock",
    )
    client_session.add(alternative)
    client_session.flush()

    segment = RouteSegment(
        route_alternative_id=alternative.id,
        user_id_hash="route-user",
        sequence=1,
        segment_type="access",
        mode="walk",
        start_label="Capitol Hill",
        start_latitude=47.623,
        start_longitude=-122.321,
        end_label="Capitol Hill Station",
        end_latitude=47.619,
        end_longitude=-122.321,
    )
    client_session.add(segment)
    client_session.commit()

    assert request.id
    assert alternative.route_request_id == request.id
    assert segment.route_alternative_id == alternative.id
```

- [ ] **Step 2: Run the model test and verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_models_migration.py -q`

Expected: FAIL because route models do not exist.

- [ ] **Step 3: Add SQLAlchemy models**

Append `RouteRequest`, `RouteAlternative`, `RouteSegment`, and `RouteContextSummary` to `app/models.py` using the fields from the design spec and the test above. Use `String(36)` primary keys with `default=new_id`, `Text` for JSON strings/geometries, `Float` for metrics, and indexed `user_id_hash` fields.

- [ ] **Step 4: Add Alembic migration**

Create `alembic/versions/0002_route_alternatives.py` with `down_revision = "0001_initial_schema"`. Create tables in this order: `route_requests`, `route_alternatives`, `route_segments`, `route_context_summaries`. Drop them in reverse order.

- [ ] **Step 5: Run model test and migration check**

Run:

```bash
.venv/bin/python -m pytest tests/test_route_models_migration.py -q
MCA_DATABASE_URL=sqlite+pysqlite:///./localagent-output/route-migration.sqlite3 .venv/bin/alembic upgrade head
```

Expected: PASS and migration reaches head.

- [ ] **Step 6: Commit Task 2**

```bash
git add app/models.py alembic/versions/0002_route_alternatives.py tests/test_route_models_migration.py
git commit -m "feat: add route persistence models"
```

---

## Task 3: Route Alternatives Service And API

**Files:**
- Create: `app/services/route_service.py`
- Create: `app/api/routes_routes.py`
- Modify: `app/main.py`
- Test: `tests/test_route_alternatives_api.py`

- [ ] **Step 1: Write the failing API test**

Create `tests/test_route_alternatives_api.py`:

```python
def test_route_alternatives_api_creates_request_and_ranked_routes(client):
    response = client.post(
        "/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "departure_date": "2024-01-15",
            "departure_time": "08:00",
            "time_window": "weekday_morning",
            "preferences": ["fewer_transfers"],
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["request"]["origin"]["label"] == "Capitol Hill"
    assert payload["request"]["destination"]["label"] == "Downtown Seattle"
    assert payload["request"]["provider"] == "mock"
    assert len(payload["alternatives"]) >= 2
    assert payload["alternatives"][0]["rank"] == 1
    assert payload["alternatives"][0]["segments"]

    comparison = client.get(
        f"/routes/requests/{payload['request']['id']}/comparison",
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )
    assert comparison.status_code == 200
    assert comparison.json()["request"]["id"] == payload["request"]["id"]
```

- [ ] **Step 2: Run the API test and verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_alternatives_api.py -q`

Expected: FAIL because route API does not exist.

- [ ] **Step 3: Implement route service**

Create `app/services/route_service.py` with:

- `create_route_alternatives(session, request_payload, user_id_hash) -> dict[str, object]`
- `get_route_comparison(session, request_id, user_id_hash) -> dict[str, object] | None`
- private adapters that convert SQLAlchemy route rows to dictionaries.

The create function should resolve origin/destination using `resolve_route_place()`, create a `RouteRequest`, call `MockRoutingProvider().get_routes()`, persist alternatives and segments, commit, and return the same comparison payload shape.

- [ ] **Step 4: Implement routes router**

Create `app/api/routes_routes.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash
from app.db import get_session
from app.routing.place_resolver import UnknownRoutePlaceError
from app.routing.schemas import RouteRequestCreate
from app.services.route_service import create_route_alternatives, get_route_comparison

router = APIRouter()


@router.post("/routes/alternatives")
def alternatives(
    request: RouteRequestCreate,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return create_route_alternatives(session, request, user_id_hash)
    except UnknownRoutePlaceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/routes/requests/{request_id}/comparison")
def comparison(
    request_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = get_route_comparison(session, request_id, user_id_hash)
    if payload is None:
        raise HTTPException(status_code=404, detail="Route request not found")
    return payload
```

Modify `app/main.py` to include the router.

- [ ] **Step 5: Run API test**

Run: `.venv/bin/python -m pytest tests/test_route_alternatives_api.py -q`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add app/services/route_service.py app/api/routes_routes.py app/main.py tests/test_route_alternatives_api.py
git commit -m "feat: add route alternatives API"
```

---

## Task 4: Route Context Summaries

**Files:**
- Create: `app/routing/context.py`
- Modify: `app/services/route_service.py`
- Test: `tests/test_route_context.py`
- Test: `tests/test_route_alternatives_api.py`

- [ ] **Step 1: Write the failing pure context test**

Create `tests/test_route_context.py`:

```python
from datetime import UTC, date, datetime

from app.routing.context import summarize_route_context
from app.routing.schemas import RouteAlternativeData, RouteSegmentData
from app.schemas import CrimeIncidentData


def test_summarize_route_context_counts_incidents_near_route_segments():
    alternative = RouteAlternativeData(
        id="route-alt-1",
        provider_route_id="mock-1",
        route_label="Transit via Westlake",
        rank=1,
        mode_mix="walk,transit",
        segments=[
            RouteSegmentData(
                id="segment-1",
                route_alternative_id="route-alt-1",
                sequence=1,
                segment_type="transfer",
                mode="walk",
                start_label="Westlake Station",
                start_latitude=47.6116,
                start_longitude=-122.3372,
                end_label="Downtown Seattle",
                end_latitude=47.609,
                end_longitude=-122.335,
            )
        ],
    )
    incidents = [
        CrimeIncidentData(
            offense_start_utc=datetime(2024, 1, 15, 8, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6117,
            longitude=-122.3371,
        )
    ]

    summaries = summarize_route_context(
        user_id_hash="route-user",
        alternatives=[alternative],
        incidents=incidents,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )

    assert len(summaries) == 1
    assert summaries[0].route_alternative_id == "route-alt-1"
    assert summaries[0].context_label == "Westlake Station"
    assert summaries[0].incident_count == 1
```

- [ ] **Step 2: Run context test and verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_context.py -q`

Expected: FAIL because `app.routing.context` does not exist.

- [ ] **Step 3: Implement pure route context summaries**

Create `app/routing/context.py`. It should:

- collect unique context points from segment starts and ends,
- ignore incidents outside the date range or without coordinates,
- group incidents by offense category, subcategory, and NIBRS group,
- emit `RouteContextSummaryData` rows for non-empty groups,
- set `incidents_per_route` to `count / max(len(alternatives), 1)`.

Use `app.normalization.geo.haversine_m` for distances.

- [ ] **Step 4: Extend route service to persist context when analysis dates are provided**

In `create_route_alternatives()`, after segments are persisted, if `analysis_start_date` and
`analysis_end_date` are present, load all `CrimeIncident` rows, call `summarize_route_context()`,
persist `RouteContextSummary` rows, and include `context_summaries` in comparison payloads.

- [ ] **Step 5: Add API assertion for context summaries**

Extend `tests/test_route_alternatives_api.py` with a request that first calls
`/crime/ingest/sample`, then posts `/routes/alternatives` with `analysis_start_date`,
`analysis_end_date`, and `radii_m`. Assert the response includes a `context_summaries` key.

- [ ] **Step 6: Run route context tests**

Run: `.venv/bin/python -m pytest tests/test_route_context.py tests/test_route_alternatives_api.py -q`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add app/routing/context.py app/services/route_service.py tests/test_route_context.py tests/test_route_alternatives_api.py
git commit -m "feat: summarize route incident context"
```

---

## Task 5: Tableau Route Exports And Docs

**Files:**
- Create: `app/exports/routes.py`
- Create: `app/services/route_export_service.py`
- Modify: `app/api/routes_exports.py`
- Modify: `README.md`
- Test: `tests/test_route_tableau_exports.py`

- [ ] **Step 1: Write failing export tests**

Create `tests/test_route_tableau_exports.py`:

```python
def test_route_tableau_exports_include_route_alternatives_segments_and_context(client):
    headers = {"X-Demo-User-Id": "route-export@example.com"}
    client.post("/crime/ingest/sample")
    create_response = client.post(
        "/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
        },
        headers=headers,
    )
    assert create_response.status_code == 200

    alternatives = client.get("/exports/tableau/route-alternatives.csv", headers=headers)
    assert alternatives.status_code == 200
    assert "route_alternative_id" in alternatives.text
    assert "Transit" in alternatives.text

    segments = client.get("/exports/tableau/route-segments.csv", headers=headers)
    assert segments.status_code == 200
    assert "route_segment_id" in segments.text
    assert "start_label" in segments.text

    context = client.get("/exports/tableau/route-context.csv", headers=headers)
    assert context.status_code == 200
    assert "route_alternative_id" in context.text
    assert "incident_count" in context.text
```

- [ ] **Step 2: Run export test and verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_tableau_exports.py -q`

Expected: FAIL because route export endpoints do not exist.

- [ ] **Step 3: Implement route CSV builders**

Create `app/exports/routes.py` with:

- `build_route_alternatives_csv(alternatives) -> str`
- `build_route_segments_csv(segments) -> str`
- `build_route_context_csv(summaries) -> str`

Use `csv.DictWriter` and stable headers named in the architecture spec.

- [ ] **Step 4: Implement export service and endpoints**

Create `app/services/route_export_service.py` to query current user's route rows and call the CSV
builders. Modify `app/api/routes_exports.py` to add:

- `GET /exports/tableau/route-alternatives.csv`
- `GET /exports/tableau/route-segments.csv`
- `GET /exports/tableau/route-context.csv`

- [ ] **Step 5: Update README**

Add a short `Route Alternatives` section documenting:

- `POST /routes/alternatives`,
- `GET /routes/requests/{request_id}/comparison`,
- three Tableau route exports,
- OpenTripPlanner as the planned provider and mock provider as the current Stage 1 source,
- approved safety language: reported incident context, not safe/unsafe route claims.

- [ ] **Step 6: Run export test**

Run: `.venv/bin/python -m pytest tests/test_route_tableau_exports.py -q`

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add app/exports/routes.py app/services/route_export_service.py app/api/routes_exports.py README.md tests/test_route_tableau_exports.py
git commit -m "feat: export route comparisons for tableau"
```

---

## Final Verification

- [ ] Run full tests:

```bash
.venv/bin/python -m pytest tests -q
```

- [ ] Run lint:

```bash
.venv/bin/ruff check .
```

- [ ] Run migration smoke check:

```bash
MCA_DATABASE_URL=sqlite+pysqlite:///./localagent-output/route-final.sqlite3 .venv/bin/alembic upgrade head
```

- [ ] Smoke test API manually if time permits:

```bash
curl -X POST -H "Content-Type: application/json" \
  -H "X-Demo-User-Id: route-demo@example.com" \
  -d '{"origin_label":"Capitol Hill","destination_label":"Downtown Seattle","mode":"transit","analysis_start_date":"2024-01-01","analysis_end_date":"2024-01-31","radii_m":[250]}' \
  http://127.0.0.1:8000/routes/alternatives
```

Expected: JSON response with `request`, `alternatives`, and `context_summaries`.
