# Public Dashboard Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public-facing dashboard where users can manually enter generalized places, select places to analyze or compare, and view reported Seattle incident context without using personal location-history uploads.

**Architecture:** Keep the existing FastAPI backend and SQLAlchemy data model, add public-dashboard APIs for anonymous sessions, manual place CRUD, bulk place entry, selected-place analysis, and saved-place comparison. Add a Vite React TypeScript frontend served by the backend in production so the first public release can deploy as one web app. Keep raw upload endpoints available for internal/demo workflows but remove them from the public dashboard experience by default.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, pytest, Ruff, React, TypeScript, Vite, Vitest, Testing Library, plain CSS, Docker.

---

## Product Scope

### In Scope For Public Launch

- Anonymous public session creation using an HttpOnly cookie.
- Manual place entry with label, approximate coordinates, visit count, optional dwell time, typical days/hours, and sensitivity class.
- Bulk place entry from pasted CSV text using the existing recurring-place columns.
- Place list ranked by visit count, supporting selection for analysis and comparison.
- Selected-place analysis by date range, radius, and optional offense filters.
- Saved-place comparison using the existing statistical comparison engine.
- Dashboard UI with entry, selection, results, comparison, caveats, and CSV export.
- Public copy that says "reported incidents" and avoids safety-scoring language.
- Recent Seattle SPD data ingestion path suitable for an operator or scheduled job.
- Production-oriented Docker, CI, and launch verification.

### Out Of Scope For Public Launch

- Personal location-history uploads in the public UI.
- User accounts, passwords, billing, teams, or long-term saved profiles.
- Claims that a place or route is safe, unsafe, dangerous, crime-preventing, or risk-free.
- Full live route planning. Existing route comparison remains demo/prototype unless separately upgraded.

## File Structure

Backend files to create:

- `app/sessions.py`: signed anonymous-session cookie helpers.
- `app/places/schemas.py`: request/response schemas for public place APIs.
- `app/places/__init__.py`: package marker for place-domain API schemas.
- `app/services/manual_place_service.py`: create, update, delete, bulk-create, and select public place records.
- `app/services/dashboard_analysis_service.py`: selected-place summaries and comparisons.
- `app/services/crime_ingestion_service.py`: Socrata page ingestion into `crime_incidents`.
- `app/api/routes_sessions.py`: public session endpoint.
- `app/api/routes_public_places.py`: public place CRUD and bulk entry endpoints.
- `app/api/routes_public_dashboard.py`: selected analysis and comparison endpoints.
- `app/api/routes_admin_crime.py`: operator-only crime ingestion endpoint.
- `tests/test_public_sessions.py`
- `tests/test_public_places_api.py`
- `tests/test_dashboard_analysis_api.py`
- `tests/test_crime_ingestion_service.py`

Backend files to modify:

- `app/config.py`: session secret, public upload visibility, and admin ingestion token settings.
- `app/api/deps.py`: use cookie-backed public session identity before demo header fallback.
- `app/main.py`: include new routers and mount built frontend assets in production.
- `app/input_modes.py`: hide personal timeline upload from public mode by default.
- `README.md`: document the public dashboard path and remove upload-first positioning from launch instructions.
- `Dockerfile`: build frontend assets and install production Python dependencies in the runtime image.
- `Makefile`: add frontend, full test, and production smoke commands.

Frontend files to create:

- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types.ts`
- `frontend/src/components/PlaceForm.tsx`
- `frontend/src/components/BulkPlaceEntry.tsx`
- `frontend/src/components/PlaceTable.tsx`
- `frontend/src/components/AnalysisControls.tsx`
- `frontend/src/components/ResultsSummary.tsx`
- `frontend/src/components/ComparisonPanel.tsx`
- `frontend/src/components/ExportPanel.tsx`
- `frontend/src/components/Notice.tsx`
- `frontend/src/styles.css`
- `frontend/src/App.test.tsx`
- `frontend/src/components/PlaceForm.test.tsx`
- `frontend/src/components/PlaceTable.test.tsx`

CI/deployment files to create:

- `.github/workflows/ci.yml`
- `.dockerignore`

---

## Task 1: Public Session Identity

**Files:**
- Create: `app/sessions.py`
- Create: `app/api/routes_sessions.py`
- Create: `tests/test_public_sessions.py`
- Modify: `app/config.py`
- Modify: `app/api/deps.py`
- Modify: `app/main.py`

- [ ] **Step 1: Write the failing public session tests**

Create `tests/test_public_sessions.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_public_session_endpoint_sets_cookie(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post("/sessions")

    assert response.status_code == 200
    assert response.json()["session_state"] == "created"
    assert "mca_session" in response.cookies


def test_cookie_session_scopes_dashboard_data(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    first = TestClient(app)
    second = TestClient(app)

    first.post("/sessions")
    second.post("/sessions")

    first_response = first.get("/dashboard/summary")
    second_response = second.get("/dashboard/summary")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first.cookies.get("mca_session") != second.cookies.get("mca_session")
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_sessions.py -q
```

Expected: FAIL because `/sessions` and `app.sessions` do not exist.

- [ ] **Step 3: Add session settings**

Modify `app/config.py`:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MCA_", env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite+pysqlite:///./localagent-output/mobility.sqlite3"
    user_hash_salt: str = "local-demo-salt"
    session_secret: str = "local-dashboard-session-secret"
    public_enable_personal_uploads: bool = False
    admin_ingest_token: str | None = None
    minimum_stop_duration_minutes: int = 10
    stop_radius_m: float = 75
    cluster_radius_m: float = 100
    minimum_cluster_visits: int = 3
    minimum_cluster_total_dwell_minutes: int = 60
    crime_radii_m: list[int] = Field(default_factory=lambda: [250, 500, 1000])
    socrata_base_url: str = "https://data.seattle.gov/resource"
    socrata_dataset_id: str = "tazs-3rd5"
    socrata_app_token: str | None = Field(default=None, validation_alias="SOCRATA_APP_TOKEN")
    raw_upload_retention: bool = False
```

- [ ] **Step 4: Implement signed cookie helpers**

Create `app/sessions.py`:

```python
from __future__ import annotations

import base64
import hmac
from hashlib import sha256
from uuid import uuid4

from app.config import get_settings

SESSION_COOKIE_NAME = "mca_session"


def new_session_token() -> str:
    session_id = str(uuid4())
    signature = _sign(session_id)
    return f"{session_id}.{signature}"


def session_id_from_token(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    session_id, signature = token.rsplit(".", 1)
    if not session_id or not signature:
        return None
    expected = _sign(session_id)
    if not hmac.compare_digest(signature, expected):
        return None
    return session_id


def public_user_hash(session_token: str | None) -> str | None:
    session_id = session_id_from_token(session_token)
    if session_id is None:
        return None
    salt = get_settings().user_hash_salt
    return sha256(f"{salt}:public-session:{session_id}".encode()).hexdigest()


def _sign(session_id: str) -> str:
    secret = get_settings().session_secret.encode()
    digest = hmac.new(secret, session_id.encode(), sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")
```

- [ ] **Step 5: Add the session route**

Create `app/api/routes_sessions.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Response

from app.sessions import SESSION_COOKIE_NAME, new_session_token

router = APIRouter()


@router.post("/sessions")
def create_session(response: Response) -> dict[str, str]:
    token = new_session_token()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24,
    )
    return {"session_state": "created"}
```

- [ ] **Step 6: Read cookie identity in dependencies**

Modify `app/api/deps.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Header

from app.services.users import hash_demo_user
from app.sessions import SESSION_COOKIE_NAME, public_user_hash


def current_user_hash(
    x_demo_user_id: Annotated[str | None, Header()] = None,
    mca_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> str:
    cookie_user_hash = public_user_hash(mca_session)
    if cookie_user_hash is not None:
        return cookie_user_hash
    return hash_demo_user(x_demo_user_id)
```

- [ ] **Step 7: Register the session router**

Modify `app/main.py`:

```python
from app.api.routes_sessions import router as sessions_router
```

and include it before dashboard routes:

```python
app.include_router(sessions_router)
```

- [ ] **Step 8: Run the public session tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_sessions.py -q
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/config.py app/sessions.py app/api/deps.py app/api/routes_sessions.py app/main.py tests/test_public_sessions.py
git commit -m "feat: add public dashboard sessions"
```

---

## Task 2: Public Place CRUD API

**Files:**
- Create: `app/places/__init__.py`
- Create: `app/places/schemas.py`
- Create: `app/services/manual_place_service.py`
- Create: `app/api/routes_public_places.py`
- Create: `tests/test_public_places_api.py`
- Modify: `app/main.py`

- [ ] **Step 1: Write failing CRUD tests**

Create `tests/test_public_places_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    return client


def test_create_update_list_and_delete_public_place(tmp_path):
    client = _client(tmp_path)

    create_response = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 12,
            "total_dwell_minutes": 360,
            "median_dwell_minutes": 30,
            "typical_days": "weekday",
            "typical_hours": "8-9",
            "sensitivity_class": "normal",
        },
    )

    assert create_response.status_code == 201
    place_id = create_response.json()["id"]
    assert create_response.json()["display_label"] == "Downtown transfer stop"
    assert create_response.json()["latitude"] == 47.609
    assert create_response.json()["longitude"] == -122.333

    update_response = client.patch(
        f"/places/{place_id}",
        json={"visit_count": 20, "display_label": "Downtown station area"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["visit_count"] == 20
    assert update_response.json()["display_label"] == "Downtown station area"

    list_response = client.get("/places")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1
    assert list_response.json()["places"][0]["id"] == place_id

    delete_response = client.delete(f"/places/{place_id}")
    assert delete_response.status_code == 204
    assert client.get("/places").json()["count"] == 0


def test_public_places_are_scoped_to_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    first = TestClient(app)
    second = TestClient(app)
    first.post("/sessions")
    second.post("/sessions")

    first.post(
        "/places",
        json={
            "display_label": "Library",
            "latitude": 47.621,
            "longitude": -122.321,
            "visit_count": 4,
        },
    )

    assert first.get("/places").json()["count"] == 1
    assert second.get("/places").json()["count"] == 0
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_places_api.py -q
```

Expected: FAIL because `POST /places`, `PATCH /places/{id}`, and `DELETE /places/{id}` do not exist.

- [ ] **Step 3: Add place API schemas**

Create `app/places/__init__.py`:

```python
"""Public place entry domain."""
```

Create `app/places/schemas.py`:

```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SensitivityClass = Literal[
    "normal",
    "home_candidate",
    "work_candidate",
    "health_candidate",
    "religious_candidate",
    "suppress_from_public_export",
]


class ManualPlaceCreate(BaseModel):
    display_label: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    visit_count: int = Field(default=1, ge=1, le=10000)
    total_dwell_minutes: float | None = Field(default=None, ge=0, le=1_000_000)
    median_dwell_minutes: float | None = Field(default=None, ge=0, le=100_000)
    typical_days: str | None = Field(default=None, max_length=120)
    typical_hours: str | None = Field(default=None, max_length=120)
    sensitivity_class: SensitivityClass = "normal"


class ManualPlaceUpdate(BaseModel):
    display_label: str | None = Field(default=None, min_length=1, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    visit_count: int | None = Field(default=None, ge=1, le=10000)
    total_dwell_minutes: float | None = Field(default=None, ge=0, le=1_000_000)
    median_dwell_minutes: float | None = Field(default=None, ge=0, le=100_000)
    typical_days: str | None = Field(default=None, max_length=120)
    typical_hours: str | None = Field(default=None, max_length=120)
    sensitivity_class: SensitivityClass | None = None


class ManualPlaceResponse(BaseModel):
    id: str
    display_label: str
    latitude: float | None
    longitude: float | None
    visit_count: int
    total_dwell_minutes: float | None
    median_dwell_minutes: float | None
    typical_days: str | None
    typical_hours: str | None
    inferred_place_type: str
    sensitivity_class: str
```

- [ ] **Step 4: Implement manual place service**

Create `app/services/manual_place_service.py`:

```python
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PlaceCluster
from app.normalization.geo import snap_to_grid
from app.places.schemas import ManualPlaceCreate, ManualPlaceResponse, ManualPlaceUpdate

MANUAL_CLUSTER_VERSION = "manual-1"
MANUAL_CLUSTER_METHOD = "manual_public_dashboard"


def create_manual_place(
    session: Session,
    user_id_hash: str,
    payload: ManualPlaceCreate,
) -> ManualPlaceResponse:
    display_latitude, display_longitude = snap_to_grid(payload.latitude, payload.longitude)
    place = PlaceCluster(
        user_id_hash=user_id_hash,
        cluster_version=MANUAL_CLUSTER_VERSION,
        cluster_method=MANUAL_CLUSTER_METHOD,
        centroid_latitude=payload.latitude,
        centroid_longitude=payload.longitude,
        display_latitude=display_latitude,
        display_longitude=display_longitude,
        cluster_radius_m=100,
        visit_count=payload.visit_count,
        total_dwell_minutes=payload.total_dwell_minutes,
        median_dwell_minutes=payload.median_dwell_minutes,
        dominant_days=payload.typical_days,
        dominant_hours=payload.typical_hours,
        inferred_place_type="manual_place",
        sensitivity_class=payload.sensitivity_class,
        display_label=payload.display_label.strip(),
        label_source="manual",
    )
    session.add(place)
    session.commit()
    session.refresh(place)
    return _place_response(place)


def update_manual_place(
    session: Session,
    user_id_hash: str,
    place_id: str,
    payload: ManualPlaceUpdate,
) -> ManualPlaceResponse | None:
    place = _get_user_place(session, user_id_hash, place_id)
    if place is None:
        return None
    values = payload.model_dump(exclude_unset=True)
    if "display_label" in values and values["display_label"] is not None:
        place.display_label = values["display_label"].strip()
    if "latitude" in values and values["latitude"] is not None:
        place.centroid_latitude = values["latitude"]
    if "longitude" in values and values["longitude"] is not None:
        place.centroid_longitude = values["longitude"]
    if "latitude" in values or "longitude" in values:
        place.display_latitude, place.display_longitude = snap_to_grid(
            place.centroid_latitude,
            place.centroid_longitude,
        )
    if "visit_count" in values and values["visit_count"] is not None:
        place.visit_count = values["visit_count"]
    if "total_dwell_minutes" in values:
        place.total_dwell_minutes = values["total_dwell_minutes"]
    if "median_dwell_minutes" in values:
        place.median_dwell_minutes = values["median_dwell_minutes"]
    if "typical_days" in values:
        place.dominant_days = values["typical_days"]
    if "typical_hours" in values:
        place.dominant_hours = values["typical_hours"]
    if "sensitivity_class" in values and values["sensitivity_class"] is not None:
        place.sensitivity_class = values["sensitivity_class"]
    session.commit()
    session.refresh(place)
    return _place_response(place)


def delete_manual_place(session: Session, user_id_hash: str, place_id: str) -> bool:
    place = _get_user_place(session, user_id_hash, place_id)
    if place is None:
        return False
    session.delete(place)
    session.commit()
    return True


def _get_user_place(session: Session, user_id_hash: str, place_id: str) -> PlaceCluster | None:
    return session.scalar(
        select(PlaceCluster).where(
            PlaceCluster.id == place_id,
            PlaceCluster.user_id_hash == user_id_hash,
        )
    )


def _place_response(place: PlaceCluster) -> ManualPlaceResponse:
    return ManualPlaceResponse(
        id=place.id,
        display_label=place.display_label or "Entered place",
        latitude=place.display_latitude,
        longitude=place.display_longitude,
        visit_count=place.visit_count,
        total_dwell_minutes=place.total_dwell_minutes,
        median_dwell_minutes=place.median_dwell_minutes,
        typical_days=place.dominant_days,
        typical_hours=place.dominant_hours,
        inferred_place_type=place.inferred_place_type,
        sensitivity_class=place.sensitivity_class,
    )
```

- [ ] **Step 5: Add public place routes**

Create `app/api/routes_public_places.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash
from app.db import get_session
from app.places.schemas import ManualPlaceCreate, ManualPlaceResponse, ManualPlaceUpdate
from app.services.manual_place_service import (
    create_manual_place,
    delete_manual_place,
    update_manual_place,
)

router = APIRouter()


@router.post("/places", response_model=ManualPlaceResponse, status_code=status.HTTP_201_CREATED)
def create_place(
    payload: ManualPlaceCreate,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> ManualPlaceResponse:
    return create_manual_place(session, user_id_hash, payload)


@router.patch("/places/{place_id}", response_model=ManualPlaceResponse)
def update_place(
    place_id: str,
    payload: ManualPlaceUpdate,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> ManualPlaceResponse:
    updated = update_manual_place(session, user_id_hash, place_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Place not found")
    return updated


@router.delete("/places/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(
    place_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    if not delete_manual_place(session, user_id_hash, place_id):
        raise HTTPException(status_code=404, detail="Place not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 6: Register routes**

Modify `app/main.py`:

```python
from app.api.routes_public_places import router as public_places_router
```

Include it before the existing `places_router` or remove duplicate route conflicts by keeping the existing `GET /places` route and adding only `POST`, `PATCH`, and `DELETE` from `routes_public_places.py`:

```python
app.include_router(public_places_router)
```

- [ ] **Step 7: Run CRUD tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_places_api.py -q
```

Expected: PASS.

- [ ] **Step 8: Run existing place-related tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_recurring_places_parser.py tests/test_dashboard_summary.py tests/test_tableau_export.py -q
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/places app/services/manual_place_service.py app/api/routes_public_places.py app/main.py tests/test_public_places_api.py
git commit -m "feat: add public place management api"
```

---

## Task 3: Bulk Place Entry API

**Files:**
- Modify: `app/places/schemas.py`
- Modify: `app/services/manual_place_service.py`
- Modify: `app/api/routes_public_places.py`
- Modify: `tests/test_public_places_api.py`

- [ ] **Step 1: Add failing bulk-entry tests**

Append to `tests/test_public_places_api.py`:

```python
def test_bulk_place_entry_creates_ranked_places(tmp_path):
    client = _client(tmp_path)

    response = client.post(
        "/places/bulk",
        json={
            "csv_text": (
                "display_label,latitude,longitude,visit_count,total_dwell_minutes\n"
                "Downtown transfer stop,47.609,-122.333,12,360\n"
                "Library area,47.621,-122.321,6,420\n"
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["created_count"] == 2
    places = client.get("/places").json()["places"]
    assert [place["display_label"] for place in places] == [
        "Downtown transfer stop",
        "Library area",
    ]


def test_bulk_place_entry_reports_invalid_rows(tmp_path):
    client = _client(tmp_path)

    response = client.post(
        "/places/bulk",
        json={
            "csv_text": (
                "display_label,latitude,longitude,visit_count\n"
                "Missing coordinate,,,-1\n"
                "Good place,47.609,-122.333,3\n"
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["created_count"] == 1
    assert response.json()["skipped_count"] == 1
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_places_api.py::test_bulk_place_entry_creates_ranked_places tests/test_public_places_api.py::test_bulk_place_entry_reports_invalid_rows -q
```

Expected: FAIL because `/places/bulk` does not exist.

- [ ] **Step 3: Add bulk schemas**

Append to `app/places/schemas.py`:

```python
class BulkPlaceCreate(BaseModel):
    csv_text: str = Field(min_length=1, max_length=200_000)


class BulkPlaceCreateResponse(BaseModel):
    created_count: int
    skipped_count: int
    places: list[ManualPlaceResponse]
```

- [ ] **Step 4: Add bulk service**

Append to `app/services/manual_place_service.py`:

```python
import csv
from io import StringIO

from app.normalization.geo import is_valid_coordinate
from app.places.schemas import BulkPlaceCreateResponse


def create_bulk_manual_places(
    session: Session,
    user_id_hash: str,
    csv_text: str,
) -> BulkPlaceCreateResponse:
    reader = csv.DictReader(StringIO(csv_text))
    created: list[ManualPlaceResponse] = []
    skipped_count = 0
    for row in reader:
        try:
            latitude = float(row.get("latitude") or "")
            longitude = float(row.get("longitude") or "")
            if not is_valid_coordinate(latitude, longitude):
                skipped_count += 1
                continue
            payload = ManualPlaceCreate(
                display_label=(row.get("display_label") or "Entered place").strip(),
                latitude=latitude,
                longitude=longitude,
                visit_count=max(1, int(float(row.get("visit_count") or 1))),
                total_dwell_minutes=_optional_float(row.get("total_dwell_minutes")),
                median_dwell_minutes=_optional_float(row.get("median_dwell_minutes")),
                typical_days=_empty_to_none(row.get("typical_days")),
                typical_hours=_empty_to_none(row.get("typical_hours")),
                sensitivity_class=_empty_to_none(row.get("sensitivity_class")) or "normal",
            )
        except (TypeError, ValueError):
            skipped_count += 1
            continue
        created.append(create_manual_place(session, user_id_hash, payload))
    return BulkPlaceCreateResponse(
        created_count=len(created),
        skipped_count=skipped_count,
        places=created,
    )


def _optional_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None
```

- [ ] **Step 5: Add the bulk route**

Append to `app/api/routes_public_places.py`:

```python
from app.places.schemas import BulkPlaceCreate, BulkPlaceCreateResponse
from app.services.manual_place_service import create_bulk_manual_places


@router.post("/places/bulk", response_model=BulkPlaceCreateResponse, status_code=status.HTTP_201_CREATED)
def create_places_bulk(
    payload: BulkPlaceCreate,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> BulkPlaceCreateResponse:
    return create_bulk_manual_places(session, user_id_hash, payload.csv_text)
```

- [ ] **Step 6: Run public place tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_places_api.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/places/schemas.py app/services/manual_place_service.py app/api/routes_public_places.py tests/test_public_places_api.py
git commit -m "feat: add bulk public place entry"
```

---

## Task 4: Selected-Place Analysis And Comparison

**Files:**
- Create: `app/services/dashboard_analysis_service.py`
- Create: `app/api/routes_public_dashboard.py`
- Create: `tests/test_dashboard_analysis_api.py`
- Modify: `app/main.py`

- [ ] **Step 1: Write failing analysis API tests**

Create `tests/test_dashboard_analysis_api.py`:

```python
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def _client_with_places_and_crime(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id="incident-a",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.609,
                longitude=-122.333,
            ),
            CrimeIncident(
                id="incident-b",
                offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.621,
                longitude=-122.321,
            ),
        ]
    )
    session.commit()
    session.close()
    for label, lat, lon, visits in [
        ("Downtown transfer stop", 47.609, -122.333, 12),
        ("Library area", 47.621, -122.321, 6),
    ]:
        client.post(
            "/places",
            json={
                "display_label": label,
                "latitude": lat,
                "longitude": lon,
                "visit_count": visits,
            },
        )
    return client


def test_dashboard_analyze_selected_places(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]
    selected_ids = [place["id"] for place in places]

    response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": selected_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    assert response.json()["summary_count"] == 2
    dashboard = client.get("/dashboard/summary").json()
    assert dashboard["totals"]["incident_count"] == 2


def test_dashboard_compare_selected_places(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]

    response = client.post(
        "/dashboard/compare",
        json={
            "place_ids": [place["id"] for place in places],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    assert response.json()["overview"]["label"] == "Overview"
    assert len(response.json()["overview"]["options"]) == 2
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_dashboard_analysis_api.py -q
```

Expected: FAIL because `/dashboard/analyze` and `/dashboard/compare` do not exist.

- [ ] **Step 3: Implement selected-place analysis service**

Create `app/services/dashboard_analysis_service.py`:

```python
from __future__ import annotations

from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.analysis.schemas import AnalysisSiteOption
from app.models import PlaceCluster, PlaceCrimeSummary
from app.services.analysis_service import compare_site_options
from app.services.crime_service import _cluster_data, _incident_data, _summary_model
from app.crime.summaries import summarize_place_crime
from app.models import CrimeIncident


def analyze_selected_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> dict[str, int]:
    clusters = _selected_clusters(session, user_id_hash, place_ids)
    incidents = [_incident_data(row) for row in session.scalars(select(CrimeIncident)).all()]
    summaries = summarize_place_crime(
        [_cluster_data(cluster) for cluster in clusters],
        incidents,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
    )
    cluster_ids = [cluster.id for cluster in clusters]
    if cluster_ids:
        session.execute(
            delete(PlaceCrimeSummary).where(
                PlaceCrimeSummary.user_id_hash == user_id_hash,
                PlaceCrimeSummary.place_cluster_id.in_(cluster_ids),
            )
        )
    session.add_all([_summary_model(summary) for summary in summaries])
    session.commit()
    return {"summary_count": len(summaries)}


def compare_selected_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> dict[str, object]:
    clusters = _selected_clusters(session, user_id_hash, place_ids)
    options = [
        AnalysisSiteOption(
            id=cluster.id,
            label=cluster.display_label or "Entered place",
            latitude=cluster.centroid_latitude,
            longitude=cluster.centroid_longitude,
            radius_m=radius_m,
        )
        for cluster in clusters
    ]
    return compare_site_options(
        session=session,
        user_id_hash=user_id_hash,
        options=options,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
    )


def _selected_clusters(
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
) -> list[PlaceCluster]:
    if not place_ids:
        raise ValueError("Select at least one place.")
    clusters = list(
        session.scalars(
            select(PlaceCluster)
            .where(PlaceCluster.user_id_hash == user_id_hash)
            .where(PlaceCluster.id.in_(place_ids))
            .order_by(PlaceCluster.visit_count.desc(), PlaceCluster.display_label.asc())
        )
    )
    if len(clusters) != len(set(place_ids)):
        raise ValueError("One or more selected places could not be found.")
    return clusters
```

- [ ] **Step 4: Add dashboard request schemas and routes**

Create `app/api/routes_public_dashboard.py`:

```python
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash
from app.db import get_session
from app.services.dashboard_analysis_service import analyze_selected_places, compare_selected_places

router = APIRouter()


class DashboardAnalyzeRequest(BaseModel):
    place_ids: list[str] = Field(min_length=1)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[int] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class DashboardCompareRequest(BaseModel):
    place_ids: list[str] = Field(min_length=2)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: int = Field(gt=0, le=5000)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


@router.post("/dashboard/analyze")
def analyze_dashboard_places(
    request: DashboardAnalyzeRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, int]:
    try:
        return analyze_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            radii_m=request.radii_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/compare")
def compare_dashboard_places(
    request: DashboardCompareRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return compare_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            radius_m=request.radius_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 5: Register routes**

Modify `app/main.py`:

```python
from app.api.routes_public_dashboard import router as public_dashboard_router
```

Include it after `dashboard_router`:

```python
app.include_router(public_dashboard_router)
```

- [ ] **Step 6: Run dashboard analysis tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_dashboard_analysis_api.py -q
```

Expected: PASS.

- [ ] **Step 7: Run statistical comparison tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_api.py tests/test_statistical_comparison_service.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/services/dashboard_analysis_service.py app/api/routes_public_dashboard.py app/main.py tests/test_dashboard_analysis_api.py
git commit -m "feat: analyze and compare selected dashboard places"
```

---

## Task 5: Public Input Modes And Upload-Free Positioning

**Files:**
- Modify: `app/input_modes.py`
- Modify: `app/api/routes_input_modes.py`
- Modify: `tests/test_input_modes.py`
- Modify: `README.md`

- [ ] **Step 1: Add failing public input mode test**

Modify `tests/test_input_modes.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_input_modes_hide_personal_uploads_by_default(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/input-modes")

    assert response.status_code == 200
    mode_ids = [mode["id"] for mode in response.json()["modes"]]
    assert "manual_places" in mode_ids
    assert "bulk_places" in mode_ids
    assert "public_commute_scenario" in mode_ids
    assert "personal_timeline" not in mode_ids
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
.venv/bin/python -m pytest tests/test_input_modes.py -q
```

Expected: FAIL because `manual_places` and `bulk_places` are not present, and `personal_timeline` is still returned.

- [ ] **Step 3: Update supported input modes**

Modify `app/input_modes.py`:

```python
from __future__ import annotations


def supported_input_modes(include_personal_uploads: bool = False) -> list[dict[str, object]]:
    modes = [
        {
            "id": "manual_places",
            "label": "Enter places manually",
            "privacy_level": "low",
            "description": "Type approximate places, visit frequency, and optional dwell time.",
            "required_columns": [],
            "optional_columns": [],
            "sample_csv": "",
        },
        {
            "id": "bulk_places",
            "label": "Paste a place list",
            "privacy_level": "low",
            "description": "Paste rows with display_label, latitude, longitude, and visit_count.",
            "required_columns": ["display_label", "latitude", "longitude"],
            "optional_columns": [
                "visit_count",
                "total_dwell_minutes",
                "median_dwell_minutes",
                "typical_days",
                "typical_hours",
                "sensitivity_class",
            ],
            "sample_csv": (
                "display_label,latitude,longitude,visit_count,total_dwell_minutes\n"
                "Downtown transfer stop,47.609,-122.333,12,360\n"
            ),
        },
        {
            "id": "public_commute_scenario",
            "label": "Public commute scenario",
            "privacy_level": "very_low",
            "description": "Model a commute using generalized Seattle areas.",
            "required_columns": ["origin_area", "destination_area", "mode"],
            "optional_columns": ["usual_departure_time", "frequency_per_week"],
            "sample_csv": (
                "origin_area,destination_area,mode,usual_departure_time,frequency_per_week\n"
                "Capitol Hill,Downtown Seattle,transit,08:00,4\n"
            ),
        },
    ]
    if include_personal_uploads:
        modes.append(
            {
                "id": "personal_timeline",
                "label": "Personal timeline upload",
                "privacy_level": "high",
                "description": "Google Timeline JSON, raw point CSV, GeoJSON, or GPX.",
                "required_columns": [],
                "optional_columns": [],
                "sample_csv": "",
            }
        )
    return modes
```

- [ ] **Step 4: Wire setting into route**

Modify `app/api/routes_input_modes.py`:

```python
from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.input_modes import supported_input_modes

router = APIRouter()


@router.get("/input-modes")
def input_modes() -> dict[str, object]:
    settings = get_settings()
    return {"modes": supported_input_modes(settings.public_enable_personal_uploads)}
```

- [ ] **Step 5: Run input mode tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_input_modes.py -q
```

Expected: PASS.

- [ ] **Step 6: Update README public launch flow**

Modify `README.md` so the first-run demo flow starts with:

```markdown
## Public Dashboard Flow

The public dashboard is designed for generalized manual entry. Users can enter approximate
places, paste a place list, run selected-place analysis, compare saved places, and export
reported-incident context. Personal timeline uploads remain an internal/demo capability and
are not part of the public launch flow.
```

Keep the existing upload documentation under a later section named:

```markdown
## Internal Upload Demo Flow
```

- [ ] **Step 7: Commit**

```bash
git add app/input_modes.py app/api/routes_input_modes.py tests/test_input_modes.py README.md
git commit -m "docs: reposition dashboard around manual place entry"
```

---

## Task 6: Socrata Crime Data Ingestion Path

**Files:**
- Create: `app/services/crime_ingestion_service.py`
- Create: `app/api/routes_admin_crime.py`
- Create: `tests/test_crime_ingestion_service.py`
- Modify: `app/main.py`
- Modify: `Makefile`

- [ ] **Step 1: Write failing ingestion service test**

Create `tests/test_crime_ingestion_service.py`:

```python
from datetime import UTC, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.schemas import CrimeIncidentData
from app.services.crime_ingestion_service import ingest_crime_incidents


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
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
.venv/bin/python -m pytest tests/test_crime_ingestion_service.py -q
```

Expected: FAIL because `app.services.crime_ingestion_service` does not exist.

- [ ] **Step 3: Implement reusable ingestion service**

Create `app/services/crime_ingestion_service.py`:

```python
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CrimeIncident
from app.schemas import CrimeIncidentData
from app.services.crime_service import _incident_model


def ingest_crime_incidents(
    session: Session,
    incidents: list[CrimeIncidentData],
) -> dict[str, int]:
    inserted_count = 0
    skipped_count = 0
    for incident in incidents:
        if incident.external_incident_id:
            existing = session.scalar(
                select(CrimeIncident).where(
                    CrimeIncident.external_incident_id == incident.external_incident_id
                )
            )
            if existing is not None:
                skipped_count += 1
                continue
        session.add(_incident_model(incident))
        inserted_count += 1
    session.commit()
    return {"inserted_count": inserted_count, "skipped_count": skipped_count}
```

- [ ] **Step 4: Add operator-only admin route**

Create `app/api/routes_admin_crime.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.crime.seattle_socrata import SeattleSocrataClient
from app.db import get_session
from app.services.crime_ingestion_service import ingest_crime_incidents

router = APIRouter()


@router.post("/admin/crime/ingest/socrata")
def ingest_socrata(
    session: Annotated[Session, Depends(get_session)],
    x_admin_token: Annotated[str | None, Header()] = None,
    limit: int = 5000,
    offset: int = 0,
) -> dict[str, int]:
    settings = get_settings()
    if not settings.admin_ingest_token or x_admin_token != settings.admin_ingest_token:
        raise HTTPException(status_code=403, detail="Admin token required")
    client = SeattleSocrataClient(
        base_url=settings.socrata_base_url,
        dataset_id=settings.socrata_dataset_id,
        app_token=settings.socrata_app_token,
    )
    incidents = client.fetch_page(limit=limit, offset=offset)
    return ingest_crime_incidents(session, incidents)
```

- [ ] **Step 5: Register route**

Modify `app/main.py`:

```python
from app.api.routes_admin_crime import router as admin_crime_router
```

Include it after `crime_router`:

```python
app.include_router(admin_crime_router)
```

- [ ] **Step 6: Add Makefile command**

Modify `Makefile`:

```makefile
.PHONY: install test lint run migrate demo ingest-crime

ingest-crime:
	curl -s -X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN" \
		"http://127.0.0.1:8000/admin/crime/ingest/socrata?limit=5000&offset=0"
```

- [ ] **Step 7: Run ingestion tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_crime_ingestion_service.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/services/crime_ingestion_service.py app/api/routes_admin_crime.py app/main.py Makefile tests/test_crime_ingestion_service.py
git commit -m "feat: add operator crime data ingestion"
```

---

## Task 7: Frontend Scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`
- Create: `frontend/src/App.test.tsx`
- Modify: `Makefile`

- [ ] **Step 1: Create frontend package manifest**

Create `frontend/package.json`:

```json
{
  "name": "mobility-context-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "tsc -b && vite build",
    "test": "vitest run --environment jsdom",
    "lint": "tsc -b --pretty false"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "vite": "^7.0.0",
    "typescript": "^5.6.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.468.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vite config**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

Create `frontend/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/sessions": "http://127.0.0.1:8000",
      "/places": "http://127.0.0.1:8000",
      "/dashboard": "http://127.0.0.1:8000",
      "/exports": "http://127.0.0.1:8000",
      "/input-modes": "http://127.0.0.1:8000"
    }
  },
  build: {
    outDir: "../app/static/dashboard",
    emptyOutDir: true
  }
});
```

- [ ] **Step 3: Create initial app shell**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reported Incident Context Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `frontend/src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Seattle reported incident context</p>
          <h1>Compare places you visit</h1>
        </div>
      </header>
      <section className="workspace">
        <p>
          Enter approximate places, run reported-incident analysis, and compare
          locations without uploading personal location history.
        </p>
      </section>
    </main>
  );
}
```

Create `frontend/src/styles.css`:

```css
:root {
  color: #172026;
  background: #f5f7f8;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 120px;
  padding: 24px clamp(16px, 4vw, 48px);
  background: #ffffff;
  border-bottom: 1px solid #d9e1e5;
}

.eyebrow {
  margin: 0 0 8px;
  color: #52616b;
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.75rem);
  letter-spacing: 0;
}

.workspace {
  width: min(1180px, calc(100% - 32px));
  margin: 32px auto;
}
```

- [ ] **Step 4: Add smoke test**

Create `frontend/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("shows the public dashboard positioning", () => {
    render(<App />);
    expect(screen.getByText("Compare places you visit")).toBeInTheDocument();
    expect(
      screen.getByText(/without uploading personal location history/i)
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Add frontend Makefile commands**

Modify `Makefile`:

```makefile
.PHONY: install test lint run migrate demo ingest-crime frontend-install frontend-test frontend-build test-all

frontend-install:
	cd frontend && npm install

frontend-test:
	cd frontend && npm test

frontend-build:
	cd frontend && npm run build

test-all: test lint frontend-test frontend-build
```

- [ ] **Step 6: Install dependencies and run frontend test**

Run:

```bash
cd frontend && npm install && npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend Makefile
git commit -m "feat: scaffold public dashboard frontend"
```

---

## Task 8: Frontend API Client And Types

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Create frontend types**

Create `frontend/src/types.ts`:

```ts
export type Place = {
  id: string;
  display_label: string;
  latitude: number | null;
  longitude: number | null;
  visit_count: number;
  total_dwell_minutes: number | null;
  median_dwell_minutes?: number | null;
  inferred_place_type: string;
  sensitivity_class: string;
};

export type DashboardSummary = {
  totals: {
    place_count: number;
    visit_count: number;
    incident_count: number;
  };
  privacy: {
    normal: number;
    home_candidate: number;
    work_candidate: number;
    suppressed: number;
  };
  places: Place[];
  crime_summaries: Array<{
    place_cluster_id: string;
    radius_m: number;
    analysis_start_date: string;
    analysis_end_date: string;
    offense_category: string | null;
    offense_subcategory: string | null;
    nibrs_group: string | null;
    incident_count: number;
    nearest_incident_m: number | null;
    incidents_per_visit: number | null;
    incidents_per_hour_dwell: number | null;
  }>;
  analysis: {
    available_radii_m: number[];
  };
  exports: {
    tableau_place_summary_csv: string;
  };
};

export type PlaceCreate = {
  display_label: string;
  latitude: number;
  longitude: number;
  visit_count: number;
  total_dwell_minutes?: number | null;
  median_dwell_minutes?: number | null;
  typical_days?: string | null;
  typical_hours?: string | null;
  sensitivity_class?: string;
};
```

- [ ] **Step 2: Add API client**

Create `frontend/src/api/client.ts`:

```ts
import type { DashboardSummary, Place, PlaceCreate } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function createSession(): Promise<{ session_state: string }> {
  return request("/sessions", { method: "POST" });
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return request("/dashboard/summary");
}

export function createPlace(payload: PlaceCreate): Promise<Place> {
  return request("/places", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createBulkPlaces(csvText: string): Promise<{
  created_count: number;
  skipped_count: number;
  places: Place[];
}> {
  return request("/places/bulk", {
    method: "POST",
    body: JSON.stringify({ csv_text: csvText })
  });
}

export function deletePlace(placeId: string): Promise<void> {
  return request(`/places/${placeId}`, { method: "DELETE" });
}

export function analyzePlaces(payload: {
  place_ids: string[];
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
  offense_category?: string | null;
}): Promise<{ summary_count: number }> {
  return request("/dashboard/analyze", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function comparePlaces(payload: {
  place_ids: string[];
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category?: string | null;
}): Promise<Record<string, unknown>> {
  return request("/dashboard/compare", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
```

- [ ] **Step 3: Add API client tests**

Create `frontend/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlace } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("creates places with JSON and cookie credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "place-1", display_label: "Library" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await createPlace({
      display_label: "Library",
      latitude: 47.621,
      longitude: -122.321,
      visit_count: 4
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/places",
      expect.objectContaining({
        credentials: "include",
        method: "POST"
      })
    );
  });
});
```

- [ ] **Step 4: Run frontend tests**

Run:

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api
git commit -m "feat: add dashboard api client"
```

---

## Task 9: Place Entry And Selection UI

**Files:**
- Create: `frontend/src/components/PlaceForm.tsx`
- Create: `frontend/src/components/BulkPlaceEntry.tsx`
- Create: `frontend/src/components/PlaceTable.tsx`
- Create: `frontend/src/components/PlaceForm.test.tsx`
- Create: `frontend/src/components/PlaceTable.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add PlaceForm component**

Create `frontend/src/components/PlaceForm.tsx`:

```tsx
import { Plus } from "lucide-react";
import { FormEvent, useState } from "react";

import type { PlaceCreate } from "../types";

type Props = {
  onSubmit: (place: PlaceCreate) => Promise<void>;
};

export function PlaceForm({ onSubmit }: Props) {
  const [displayLabel, setDisplayLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [visitCount, setVisitCount] = useState("1");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const visits = Number(visitCount);
    if (!displayLabel.trim()) {
      setError("Enter a place label.");
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError("Enter a latitude between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError("Enter a longitude between -180 and 180.");
      return;
    }
    if (!Number.isInteger(visits) || visits < 1) {
      setError("Visit count must be at least 1.");
      return;
    }
    await onSubmit({
      display_label: displayLabel.trim(),
      latitude: lat,
      longitude: lon,
      visit_count: visits,
      sensitivity_class: "normal"
    });
    setDisplayLabel("");
    setLatitude("");
    setLongitude("");
    setVisitCount("1");
  }

  return (
    <form className="panel place-form" onSubmit={handleSubmit}>
      <h2>Add a place</h2>
      <label>
        Label
        <input value={displayLabel} onChange={(event) => setDisplayLabel(event.target.value)} />
      </label>
      <div className="form-grid">
        <label>
          Latitude
          <input value={latitude} onChange={(event) => setLatitude(event.target.value)} />
        </label>
        <label>
          Longitude
          <input value={longitude} onChange={(event) => setLongitude(event.target.value)} />
        </label>
        <label>
          Visits
          <input value={visitCount} onChange={(event) => setVisitCount(event.target.value)} />
        </label>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit">
        <Plus size={18} aria-hidden="true" />
        Add place
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Add PlaceTable component**

Create `frontend/src/components/PlaceTable.tsx`:

```tsx
import { Trash2 } from "lucide-react";

import type { Place } from "../types";

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  onToggle: (placeId: string) => void;
  onDelete: (placeId: string) => void;
};

export function PlaceTable({ places, selectedIds, onToggle, onDelete }: Props) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Places</h2>
        <span>{places.length} entered</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Select</th>
            <th>Place</th>
            <th>Visits</th>
            <th>Approx. coordinates</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          {places.map((place) => (
            <tr key={place.id}>
              <td>
                <input
                  aria-label={`Select ${place.display_label}`}
                  type="checkbox"
                  checked={selectedIds.has(place.id)}
                  onChange={() => onToggle(place.id)}
                />
              </td>
              <td>{place.display_label}</td>
              <td>{place.visit_count}</td>
              <td>
                {place.latitude}, {place.longitude}
              </td>
              <td>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove ${place.display_label}`}
                  onClick={() => onDelete(place.id)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: Add bulk entry component**

Create `frontend/src/components/BulkPlaceEntry.tsx`:

```tsx
import { ClipboardList } from "lucide-react";
import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (csvText: string) => Promise<void>;
};

export function BulkPlaceEntry({ onSubmit }: Props) {
  const [csvText, setCsvText] = useState(
    "display_label,latitude,longitude,visit_count,total_dwell_minutes\n"
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(csvText);
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Paste a place list</h2>
      <textarea
        rows={7}
        value={csvText}
        onChange={(event) => setCsvText(event.target.value)}
      />
      <button type="submit">
        <ClipboardList size={18} aria-hidden="true" />
        Import rows
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Wire components into App**

Modify `frontend/src/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";

import { createBulkPlaces, createPlace, createSession, deletePlace, getDashboardSummary } from "./api/client";
import { BulkPlaceEntry } from "./components/BulkPlaceEntry";
import { PlaceForm } from "./components/PlaceForm";
import { PlaceTable } from "./components/PlaceTable";
import type { DashboardSummary, Place, PlaceCreate } from "./types";

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function refresh() {
    const next = await getDashboardSummary();
    setSummary(next);
  }

  useEffect(() => {
    createSession().then(refresh);
  }, []);

  const places: Place[] = useMemo(() => summary?.places ?? [], [summary]);

  async function handleCreatePlace(place: PlaceCreate) {
    await createPlace(place);
    await refresh();
  }

  async function handleBulk(csvText: string) {
    await createBulkPlaces(csvText);
    await refresh();
  }

  async function handleDelete(placeId: string) {
    await deletePlace(placeId);
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(placeId);
      return next;
    });
    await refresh();
  }

  function handleToggle(placeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
      }
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Seattle reported incident context</p>
          <h1>Compare places you visit</h1>
        </div>
      </header>
      <section className="workspace dashboard-grid">
        <PlaceForm onSubmit={handleCreatePlace} />
        <BulkPlaceEntry onSubmit={handleBulk} />
        <PlaceTable
          places={places}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Add component tests**

Create `frontend/src/components/PlaceForm.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlaceForm } from "./PlaceForm";

describe("PlaceForm", () => {
  it("validates coordinates before submit", () => {
    render(<PlaceForm onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));
    expect(screen.getByText("Enter a place label.")).toBeInTheDocument();
  });
});
```

Create `frontend/src/components/PlaceTable.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlaceTable } from "./PlaceTable";

describe("PlaceTable", () => {
  it("renders places and toggles selection", () => {
    const onToggle = vi.fn();
    render(
      <PlaceTable
        places={[
          {
            id: "p1",
            display_label: "Library",
            latitude: 47.621,
            longitude: -122.321,
            visit_count: 6,
            total_dwell_minutes: null,
            inferred_place_type: "manual_place",
            sensitivity_class: "normal"
          }
        ]}
        selectedIds={new Set()}
        onToggle={onToggle}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText("Select Library"));
    expect(onToggle).toHaveBeenCalledWith("p1");
  });
});
```

- [ ] **Step 6: Add CSS for dashboard controls**

Append to `frontend/src/styles.css`:

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.panel {
  background: #ffffff;
  border: 1px solid #d9e1e5;
  border-radius: 8px;
  padding: 20px;
}

.panel h2 {
  margin: 0 0 16px;
  font-size: 1.1rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.place-form,
.panel:has(table) {
  grid-column: 1 / -1;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

label {
  display: grid;
  gap: 6px;
  color: #33444f;
  font-size: 0.9rem;
  font-weight: 650;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid #b9c7ce;
  border-radius: 6px;
  padding: 10px 12px;
  color: #172026;
  background: #ffffff;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 0;
  border-radius: 6px;
  padding: 0 14px;
  color: #ffffff;
  background: #146c72;
  font-weight: 700;
  cursor: pointer;
}

.icon-button {
  width: 36px;
  min-height: 36px;
  padding: 0;
  color: #33444f;
  background: #edf2f4;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border-top: 1px solid #e4ebef;
  padding: 10px;
  text-align: left;
}

.error {
  color: #9b1c1c;
  font-weight: 700;
}

@media (max-width: 760px) {
  .dashboard-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components frontend/src/styles.css
git commit -m "feat: build place entry dashboard ui"
```

---

## Task 10: Analysis Controls, Results, Comparison, And Export UI

**Files:**
- Create: `frontend/src/components/AnalysisControls.tsx`
- Create: `frontend/src/components/ResultsSummary.tsx`
- Create: `frontend/src/components/ComparisonPanel.tsx`
- Create: `frontend/src/components/ExportPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add analysis controls**

Create `frontend/src/components/AnalysisControls.tsx`:

```tsx
import { BarChart3 } from "lucide-react";
import { FormEvent, useState } from "react";

type Props = {
  selectedCount: number;
  onAnalyze: (request: {
    analysis_start_date: string;
    analysis_end_date: string;
    radii_m: number[];
    offense_category: string | null;
  }) => Promise<void>;
  onCompare: (request: {
    analysis_start_date: string;
    analysis_end_date: string;
    radius_m: number;
    offense_category: string | null;
  }) => Promise<void>;
};

export function AnalysisControls({ selectedCount, onAnalyze, onCompare }: Props) {
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-01-31");
  const [radius, setRadius] = useState("250");
  const [offenseCategory, setOffenseCategory] = useState("PROPERTY");

  async function handleAnalyze(event: FormEvent) {
    event.preventDefault();
    await onAnalyze({
      analysis_start_date: startDate,
      analysis_end_date: endDate,
      radii_m: [Number(radius)],
      offense_category: offenseCategory || null
    });
  }

  async function handleCompare() {
    await onCompare({
      analysis_start_date: startDate,
      analysis_end_date: endDate,
      radius_m: Number(radius),
      offense_category: offenseCategory || null
    });
  }

  return (
    <form className="panel controls" onSubmit={handleAnalyze}>
      <h2>Analyze selected places</h2>
      <div className="form-grid">
        <label>
          Start date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          End date
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label>
          Radius
          <select value={radius} onChange={(event) => setRadius(event.target.value)}>
            <option value="250">250m</option>
            <option value="500">500m</option>
            <option value="1000">1000m</option>
          </select>
        </label>
        <label>
          Category
          <select value={offenseCategory} onChange={(event) => setOffenseCategory(event.target.value)}>
            <option value="">All categories</option>
            <option value="PROPERTY">Property</option>
            <option value="SOCIETY">Society</option>
            <option value="PERSON">Person</option>
          </select>
        </label>
      </div>
      <div className="button-row">
        <button type="submit" disabled={selectedCount < 1}>
          <BarChart3 size={18} aria-hidden="true" />
          Run analysis
        </button>
        <button type="button" disabled={selectedCount < 2} onClick={handleCompare}>
          Compare places
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Add results summary**

Create `frontend/src/components/ResultsSummary.tsx`:

```tsx
import type { DashboardSummary } from "../types";

type Props = {
  summary: DashboardSummary | null;
};

export function ResultsSummary({ summary }: Props) {
  if (!summary) {
    return null;
  }
  return (
    <section className="panel metrics">
      <div>
        <span className="metric-value">{summary.totals.place_count}</span>
        <span className="metric-label">places</span>
      </div>
      <div>
        <span className="metric-value">{summary.totals.visit_count}</span>
        <span className="metric-label">visits entered</span>
      </div>
      <div>
        <span className="metric-value">{summary.totals.incident_count}</span>
        <span className="metric-label">reported incidents in current summaries</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add comparison panel**

Create `frontend/src/components/ComparisonPanel.tsx`:

```tsx
type Props = {
  comparison: Record<string, unknown> | null;
};

export function ComparisonPanel({ comparison }: Props) {
  if (!comparison) {
    return (
      <section className="panel">
        <h2>Comparison</h2>
        <p>Select at least two places to compare reported-incident rates.</p>
      </section>
    );
  }
  const overview = comparison.overview as
    | { summary_text?: string; caveat_text?: string; decision_class?: string }
    | undefined;
  return (
    <section className="panel">
      <h2>Comparison</h2>
      <p>{overview?.summary_text}</p>
      <p className="muted">{overview?.caveat_text}</p>
    </section>
  );
}
```

- [ ] **Step 4: Add export panel**

Create `frontend/src/components/ExportPanel.tsx`:

```tsx
import { Download } from "lucide-react";

type Props = {
  href: string;
};

export function ExportPanel({ href }: Props) {
  return (
    <section className="panel">
      <h2>Export</h2>
      <p>Download the current place summary as a Tableau-ready CSV.</p>
      <a className="button-link" href={href}>
        <Download size={18} aria-hidden="true" />
        Download CSV
      </a>
    </section>
  );
}
```

- [ ] **Step 5: Wire analysis UI into App**

Modify `frontend/src/App.tsx` imports:

```tsx
import { analyzePlaces, comparePlaces, createBulkPlaces, createPlace, createSession, deletePlace, getDashboardSummary } from "./api/client";
import { AnalysisControls } from "./components/AnalysisControls";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { ExportPanel } from "./components/ExportPanel";
import { ResultsSummary } from "./components/ResultsSummary";
```

Add state:

```tsx
const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
```

Add handlers:

```tsx
async function handleAnalyze(request: {
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
  offense_category: string | null;
}) {
  await analyzePlaces({ ...request, place_ids: Array.from(selectedIds) });
  await refresh();
}

async function handleCompare(request: {
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category: string | null;
}) {
  const result = await comparePlaces({ ...request, place_ids: Array.from(selectedIds) });
  setComparison(result);
}
```

Render these components after `PlaceTable`:

```tsx
<ResultsSummary summary={summary} />
<AnalysisControls
  selectedCount={selectedIds.size}
  onAnalyze={handleAnalyze}
  onCompare={handleCompare}
/>
<ComparisonPanel comparison={comparison} />
<ExportPanel href={summary?.exports.tableau_place_summary_csv ?? "/exports/tableau/place-summary.csv"} />
```

- [ ] **Step 6: Add CSS for results and export**

Append to `frontend/src/styles.css`:

```css
.controls,
.metrics {
  grid-column: 1 / -1;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

button:disabled {
  background: #9aabb3;
  cursor: not-allowed;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.metric-value,
.metric-label {
  display: block;
}

.metric-value {
  font-size: 2rem;
  font-weight: 800;
}

.metric-label,
.muted {
  color: #52616b;
}

.button-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border-radius: 6px;
  padding: 0 14px;
  color: #ffffff;
  background: #146c72;
  font-weight: 700;
  text-decoration: none;
}

@media (max-width: 760px) {
  .metrics {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 7: Run frontend tests and build**

Run:

```bash
cd frontend && npm test && npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components frontend/src/styles.css
git commit -m "feat: add dashboard analysis workflow"
```

---

## Task 11: Serve Frontend From FastAPI

**Files:**
- Modify: `app/main.py`
- Create: `tests/test_frontend_static.py`

- [ ] **Step 1: Add failing static frontend test**

Create `tests/test_frontend_static.py`:

```python
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_dashboard_route_serves_static_index_when_built(tmp_path, monkeypatch):
    static_dir = tmp_path / "static" / "dashboard"
    static_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<div id='root'></div>", encoding="utf-8")
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "root" in response.text
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
.venv/bin/python -m pytest tests/test_frontend_static.py -q
```

Expected: FAIL because frontend static mounting is not implemented.

- [ ] **Step 3: Add static dashboard setting**

Modify `app/config.py`:

```python
static_dashboard_dir: str = "app/static/dashboard"
```

- [ ] **Step 4: Mount static frontend**

Modify `app/main.py`:

```python
from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
```

Add this helper:

```python
def mount_dashboard(app: FastAPI) -> None:
    static_dir = Path(get_settings().static_dashboard_dir)
    index_file = static_dir / "index.html"
    if not index_file.exists():
        return
    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="dashboard-assets")

    @app.get("/", include_in_schema=False)
    def dashboard_index() -> FileResponse:
        return FileResponse(index_file)

    @app.get("/dashboard-app/{path:path}", include_in_schema=False)
    def dashboard_fallback(path: str) -> FileResponse:
        return FileResponse(index_file)
```

Call it before returning from `create_app`:

```python
mount_dashboard(app)
return app
```

- [ ] **Step 5: Run static frontend test**

Run:

```bash
.venv/bin/python -m pytest tests/test_frontend_static.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/config.py app/main.py tests/test_frontend_static.py
git commit -m "feat: serve dashboard frontend from api"
```

---

## Task 12: Copy, Accessibility, And Public Trust Pass

**Files:**
- Create: `frontend/src/components/Notice.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `README.md`

- [ ] **Step 1: Add public trust notice component**

Create `frontend/src/components/Notice.tsx`:

```tsx
export function Notice() {
  return (
    <section className="notice" aria-label="Important data note">
      <strong>Reported incident context, not safety advice.</strong>
      <span>
        Results use reported Seattle incident data. Reports can be incomplete, delayed,
        corrected, or geographically generalized.
      </span>
    </section>
  );
}
```

- [ ] **Step 2: Render notice near top of dashboard**

Modify `frontend/src/App.tsx`:

```tsx
import { Notice } from "./components/Notice";
```

Render `<Notice />` immediately inside `.workspace` before forms:

```tsx
<Notice />
```

- [ ] **Step 3: Add notice CSS**

Append to `frontend/src/styles.css`:

```css
.notice {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  border-left: 4px solid #146c72;
  padding: 14px 16px;
  background: #eaf4f3;
  color: #172026;
}
```

- [ ] **Step 4: Run disallowed-language scan**

Run:

```bash
rg -n "safe|unsafe|dangerous|risk-free|prevents crime|crime-preventing" frontend/src app README.md
```

Expected: hits only in caveats or explicit "do not say" documentation, not in UI claims that describe a place or route.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Notice.tsx frontend/src/App.tsx frontend/src/styles.css README.md
git commit -m "feat: add public dashboard trust copy"
```

---

## Task 13: CI And Production Build

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.dockerignore`
- Modify: `Dockerfile`
- Modify: `Makefile`

- [ ] **Step 1: Add Docker ignore file**

Create `.dockerignore`:

```text
.git
.venv
.pytest_cache
.ruff_cache
.superpowers
localagent-output
frontend/node_modules
frontend/dist
app/static/dashboard
*.sqlite3
*.pyc
__pycache__
```

- [ ] **Step 2: Update Dockerfile for frontend build and production deps**

Replace `Dockerfile` with:

```dockerfile
FROM node:22-slim AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir .

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY --from=frontend /app/app/static/dashboard ./app/static/dashboard

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

- [ ] **Step 3: Add CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: python -m pip install --upgrade pip
      - run: python -m pip install -e '.[dev]'
      - run: ruff check .
      - run: pytest tests -q

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm install
        working-directory: frontend
      - run: npm test
        working-directory: frontend
      - run: npm run build
        working-directory: frontend

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build .
```

- [ ] **Step 4: Add production smoke command**

Modify `Makefile`:

```makefile
.PHONY: install test lint run migrate demo ingest-crime frontend-install frontend-test frontend-build test-all docker-build

docker-build:
	docker build .
```

- [ ] **Step 5: Run full local verification**

Run:

```bash
make test
make lint
cd frontend && npm test && npm run build
docker build .
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .dockerignore Dockerfile Makefile
git commit -m "chore: add public dashboard ci and production build"
```

---

## Task 14: End-To-End Launch Smoke

**Files:**
- Create: `tests/test_public_dashboard_flow.py`
- Modify: `README.md`

- [ ] **Step 1: Add backend end-to-end test**

Create `tests/test_public_dashboard_flow.py`:

```python
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_public_dashboard_flow_without_uploads(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id="public-flow-incident",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.609,
            longitude=-122.333,
        )
    )
    session.commit()
    session.close()

    create_response = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 12,
        },
    )
    assert create_response.status_code == 201
    place_id = create_response.json()["id"]

    analyze_response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )
    assert analyze_response.status_code == 200
    assert analyze_response.json()["summary_count"] == 1

    summary = client.get("/dashboard/summary").json()
    assert summary["totals"]["place_count"] == 1
    assert summary["totals"]["incident_count"] == 1

    export_response = client.get("/exports/tableau/place-summary.csv")
    assert export_response.status_code == 200
    assert "Downtown transfer stop" in export_response.text
```

- [ ] **Step 2: Run launch smoke test**

Run:

```bash
.venv/bin/python -m pytest tests/test_public_dashboard_flow.py -q
```

Expected: PASS.

- [ ] **Step 3: Update README launch checklist**

Add this section to `README.md`:

```markdown
## Public Launch Checklist

- Run `make test` and `make lint`.
- Run `cd frontend && npm test && npm run build`.
- Run `docker build .`.
- Set `MCA_DATABASE_URL`, `MCA_USER_HASH_SALT`, `MCA_SESSION_SECRET`, and `MCA_ADMIN_INGEST_TOKEN`.
- Run Alembic migrations before serving traffic.
- Ingest recent Seattle SPD data through the admin Socrata endpoint.
- Confirm the public dashboard does not show personal timeline upload as an entry mode.
- Confirm the dashboard copy describes reported incident context, not personal safety.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
make test
make lint
cd frontend && npm test && npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/test_public_dashboard_flow.py README.md
git commit -m "test: cover public dashboard launch flow"
```

---

## Final Verification

Run the full verification suite:

```bash
make test
make lint
cd frontend && npm test && npm run build
docker build .
```

Expected:

- Backend tests pass.
- Ruff passes.
- Frontend unit tests pass.
- Frontend production build succeeds.
- Docker image builds successfully.

Run a local product smoke:

```bash
make run
```

Open:

```text
http://127.0.0.1:8000/
```

Verify manually:

- The dashboard loads.
- The public entry modes do not include personal timeline upload.
- A user can add a place manually.
- A user can paste a two-row place list.
- The place table ranks rows by visit count.
- A user can select places, run analysis, and compare two places.
- CSV export downloads.
- The UI says reported incident context and does not make safety claims.

## Execution Order

1. Public session identity.
2. Manual place CRUD.
3. Bulk place entry.
4. Selected-place analysis and comparison.
5. Upload-free public input modes.
6. Crime ingestion path.
7. Frontend scaffold.
8. Frontend API client.
9. Place entry and selection UI.
10. Analysis, comparison, and export UI.
11. Serve frontend from FastAPI.
12. Public trust copy.
13. CI and production build.
14. End-to-end launch smoke.

## Scope Review

This plan implements the agreed public dashboard direction: users click a frontend, enter generalized places, rank/select them by visit count, run reported-incident context, compare saved places, and export results. It intentionally excludes personal location-history upload from the public launch experience while preserving existing backend upload capabilities for internal demos. Route planning remains a separate product track because the current provider is mock-only.
