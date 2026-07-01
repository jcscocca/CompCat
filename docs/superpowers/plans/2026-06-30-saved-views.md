# Saved Views (C3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user copy a durable, shareable link to an Analyze or Compare view and reopen it — on any device — as a recomputed-from-inputs query, storing nothing new server-side.

**Architecture:** One backend capability (analyze/compare/incidents/neighborhood accept inline `points` as an alternative to identity-bound `place_ids`) plus a mostly-frontend feature (a `?view=` self-encoding URL, a "Copy link" affordance, and shared-view hydration that runs the points path). See the spec: `docs/superpowers/specs/2026-06-30-saved-views-design.md`.

**Tech Stack:** FastAPI + Pydantic v2 + SQLAlchemy (backend, pytest); React + TypeScript + Vite (frontend, vitest/jsdom). Verify with `make test-all`.

---

## File Structure

**Backend**
- Modify `app/api/dashboard_schemas.py` — add `AnalysisPoint`; add `points` to `DashboardAnalyzeRequest` / `DashboardCompareRequest`; make `place_ids` optional; add exactly-one-of + Seattle-bbox + count validation.
- Create `app/services/analysis_points.py` — `SEATTLE_BBOX`, `point_within_seattle()`, `point_clusters()` (inline points → synthetic `PlaceClusterData`).
- Modify `app/services/dashboard_analysis_service.py` — `analyze_selected_places`, `compare_selected_places`, `incident_details_for_places` accept `points`; add `_resolve_clusters`; refactor compare to build options from `PlaceClusterData`.
- Modify `app/services/neighborhood_service.py` — `neighborhood_analysis_for_places` accepts `points`.
- Modify `app/api/routes_public_dashboard.py` — pass `points=request.points` to the four service calls.
- Create `tests/test_saved_view_points.py` — validation + place_ids/points equivalence, service + API level.

**Frontend**
- Create `frontend/src/lib/savedView.ts` — `SavedView` type, `encodeView()`, `decodeView()`.
- Create `frontend/src/lib/savedView.test.ts` — round-trip + rejection tests.
- Modify `frontend/src/api/client.ts` — `place_ids` optional, add `points?` to analyze/compare payloads.
- Modify `frontend/src/lib/useAnalyze.ts`, `frontend/src/lib/useCompare.ts` — accept an optional `points` override; build the payload from points when present.
- Modify `frontend/src/components/MapWorkspace.tsx` — read `?view=` on mount, hydrate shared-view state, render a "Shared view" banner and a malformed-link notice, and provide a copy-link builder.
- Modify `frontend/src/components/AnalyzeTab.tsx`, `frontend/src/components/CompareTab.tsx` — add a "Copy link to this view" button.
- Add hook tests alongside the modified hooks; extend `frontend/src/components/MapWorkspace.test.tsx` for hydration.

**Invariant note (carry through all copy):** a shared view is *reported incident context*, never a safety verdict. No "safe/unsafe/dangerous" language in banners, buttons, or toasts.

---

## Task 1: Backend — `AnalysisPoint` schema + `points` on requests + validation

**Files:**
- Modify: `app/api/dashboard_schemas.py`
- Test: `tests/test_saved_view_points.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_saved_view_points.py`:

```python
import pytest
from pydantic import ValidationError

from app.api.dashboard_schemas import DashboardAnalyzeRequest, DashboardCompareRequest

BASE = {"analysis_start_date": "2024-01-01", "analysis_end_date": "2024-01-31"}
PT = {"latitude": 47.61, "longitude": -122.34, "label": "Pike Place"}


def test_analyze_accepts_points_without_place_ids():
    req = DashboardAnalyzeRequest(points=[PT], radii_m=[250], **BASE)
    assert req.place_ids is None
    assert req.points[0].label == "Pike Place"


def test_analyze_rejects_both_place_ids_and_points():
    with pytest.raises(ValidationError):
        DashboardAnalyzeRequest(place_ids=["p1"], points=[PT], radii_m=[250], **BASE)


def test_analyze_rejects_neither_place_ids_nor_points():
    with pytest.raises(ValidationError):
        DashboardAnalyzeRequest(radii_m=[250], **BASE)


def test_points_rejected_outside_seattle_bbox():
    dc = {"latitude": 38.90, "longitude": -77.03, "label": "DC"}
    with pytest.raises(ValidationError):
        DashboardAnalyzeRequest(points=[dc], radii_m=[250], **BASE)


def test_compare_requires_two_points():
    with pytest.raises(ValidationError):
        DashboardCompareRequest(points=[PT], radius_m=250, **BASE)
    ok = DashboardCompareRequest(points=[PT, {**PT, "label": "Second"}], radius_m=250, **BASE)
    assert len(ok.points) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_saved_view_points.py -v`
Expected: FAIL (`DashboardAnalyzeRequest` has no `points`; `TypeError`/`ValidationError` on missing `place_ids`).

- [ ] **Step 3: Implement the schema changes**

In `app/api/dashboard_schemas.py`, add imports at the top (join existing `pydantic` import) and a shared bbox constant, then the point model and validators. Seattle bounds match `app/config.py` `geocoder_viewbox` and `frontend/src/lib/geocoding.ts` `SEATTLE_BBOX`.

```python
from pydantic import BaseModel, Field, field_validator, model_validator

# Seattle-metro bounds (lon W/E, lat S/N) — mirrors config.geocoder_viewbox and
# frontend SEATTLE_BBOX. A shared-view point must resolve inside Seattle.
_SEATTLE_WEST, _SEATTLE_EAST = -122.55, -122.10
_SEATTLE_SOUTH, _SEATTLE_NORTH = 47.43, 47.78
_MAX_POINTS = 10


class AnalysisPoint(BaseModel):
    latitude: float
    longitude: float
    label: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def within_seattle(self) -> "AnalysisPoint":
        if not (_SEATTLE_SOUTH <= self.latitude <= _SEATTLE_NORTH
                and _SEATTLE_WEST <= self.longitude <= _SEATTLE_EAST):
            raise ValueError("point is outside the Seattle area")
        return self
```

Change `DashboardAnalyzeRequest`: make `place_ids` optional, add `points`, add an exactly-one-of validator (min 1 point):

```python
class DashboardAnalyzeRequest(BaseModel):
    place_ids: list[str] | None = Field(default=None, min_length=1)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=1, max_length=_MAX_POINTS)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[DashboardRadiusMeters] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def exactly_one_selection(self) -> "DashboardAnalyzeRequest":
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        return self

    # ... keep existing radii_m uniqueness + layer validators unchanged ...
```

Change `DashboardCompareRequest` the same way, but points/place_ids require **two**:

```python
class DashboardCompareRequest(BaseModel):
    place_ids: list[str] | None = Field(default=None, min_length=2)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=2, max_length=_MAX_POINTS)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: DashboardRadiusMeters
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def exactly_one_selection(self) -> "DashboardCompareRequest":
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        return self

    # ... keep existing layer validator unchanged ...
```

`DashboardIncidentDetailsRequest(DashboardAnalyzeRequest)` inherits `points` automatically — no change.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_saved_view_points.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard_schemas.py tests/test_saved_view_points.py
git commit -m "feat(saved-views): accept inline points on analyze/compare requests"
```

---

## Task 2: Backend — inline points → synthetic clusters resolver

**Files:**
- Create: `app/services/analysis_points.py`
- Test: `tests/test_saved_view_points.py` (append)

- [ ] **Step 1: Write the failing test** (append to `tests/test_saved_view_points.py`)

```python
from app.api.dashboard_schemas import AnalysisPoint
from app.services.analysis_points import point_clusters


def test_point_clusters_map_to_display_coordinates():
    clusters = point_clusters([AnalysisPoint(latitude=47.61, longitude=-122.34, label="Pike")])
    assert len(clusters) == 1
    c = clusters[0]
    assert (c.display_latitude, c.display_longitude) == (47.61, -122.34)
    assert (c.centroid_latitude, c.centroid_longitude) == (47.61, -122.34)
    assert c.display_label == "Pike"
    assert c.cluster_method == "shared_view"
    assert c.visit_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_saved_view_points.py::test_point_clusters_map_to_display_coordinates -v`
Expected: FAIL (`ModuleNotFoundError: app.services.analysis_points`).

- [ ] **Step 3: Implement the resolver**

Create `app/services/analysis_points.py`. `PlaceClusterData` requires `user_id_hash`, `cluster_version`, `cluster_method`, `centroid_*`, `visit_count`; downstream analysis only reads `id`, `display_latitude/longitude`, `display_label`, so the synthetic `user_id_hash` is never used for filtering.

```python
from __future__ import annotations

from collections.abc import Sequence

from app.api.dashboard_schemas import AnalysisPoint
from app.schemas import PlaceClusterData


def point_clusters(points: Sequence[AnalysisPoint]) -> list[PlaceClusterData]:
    """Turn inline shared-view points into synthetic, non-persisted PlaceClusterData
    with display == centroid == the given coordinate. Used when a request supplies
    `points` instead of identity-bound `place_ids`."""
    clusters: list[PlaceClusterData] = []
    for point in points:
        clusters.append(
            PlaceClusterData(
                user_id_hash="",
                cluster_version="shared_view",
                cluster_method="shared_view",
                centroid_latitude=point.latitude,
                centroid_longitude=point.longitude,
                display_latitude=point.latitude,
                display_longitude=point.longitude,
                visit_count=1,
                display_label=point.label,
            )
        )
    return clusters
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_saved_view_points.py::test_point_clusters_map_to_display_coordinates -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/analysis_points.py tests/test_saved_view_points.py
git commit -m "feat(saved-views): synthetic-cluster resolver for inline points"
```

---

## Task 3: Backend — thread points through analyze + incidents

**Files:**
- Modify: `app/services/dashboard_analysis_service.py`
- Test: `tests/test_saved_view_points.py` (append)

- [ ] **Step 1: Write the failing test** (append; a service-level equivalence test)

```python
from datetime import UTC, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.sessions import public_user_hash
from app.services.dashboard_analysis_service import analyze_selected_places
from fastapi.testclient import TestClient


def _seed(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'sv.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    session = get_sessionmaker()()
    session.add(CrimeIncident(
        id="i1", offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
        offense_category="PROPERTY", latitude=47.6094, longitude=-122.3334))
    session.add(PlaceCluster(
        id="place-1", user_id_hash=user_hash, cluster_version="test",
        cluster_method="manual", centroid_latitude=47.6094, centroid_longitude=-122.3334,
        display_latitude=47.6094, display_longitude=-122.3334, visit_count=5,
        display_label="Downtown"))
    session.commit()
    return session, user_hash


def test_analyze_points_matches_place_ids(tmp_path):
    session, user_hash = _seed(tmp_path)
    common = dict(radii_m=[250], analysis_start_date=datetime(2024, 1, 1).date(),
                  analysis_end_date=datetime(2024, 1, 31).date(),
                  offense_category=None, offense_subcategory=None, nibrs_group=None)
    by_ids = analyze_selected_places(session, user_hash, place_ids=["place-1"], **common)
    by_points = analyze_selected_places(
        session, user_hash, place_ids=None,
        points=[AnalysisPoint(latitude=47.6094, longitude=-122.3334, label="Downtown")], **common)
    assert by_ids["summary_count"] == by_points["summary_count"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_saved_view_points.py::test_analyze_points_matches_place_ids -v`
Expected: FAIL (`analyze_selected_places` has no `points` keyword).

- [ ] **Step 3: Implement**

In `app/services/dashboard_analysis_service.py`, add an import and a resolver, and give `analyze_selected_places` + `incident_details_for_places` a `points` parameter. Make `place_ids` optional in both signatures.

Add near the other imports:
```python
from app.api.dashboard_schemas import AnalysisPoint
from app.services.analysis_points import point_clusters
```

Add a private resolver (place it just above `_selected_clusters`):
```python
def _resolve_clusters(
    session: Session,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None,
) -> list[PlaceClusterData]:
    if points is not None:
        return point_clusters(points)
    return [_cluster_data(row) for row in _selected_clusters(session, user_id_hash, place_ids or [])]
```

In `analyze_selected_places`, change the signature to add `points: list[AnalysisPoint] | None = None` and make `place_ids: list[str] | None`, then replace line 39:
```python
    clusters = _resolve_clusters(session, user_id_hash, place_ids, points)
```
(The rest of the function — `_filtered_incidents`, `summarize_place_crime`, `create_analysis_run` — is unchanged. `create_analysis_run` still uses the real `user_id_hash`.)

In `incident_details_for_places`, same signature change, and replace line 143:
```python
    clusters = _resolve_clusters(session, user_id_hash, place_ids, points)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_saved_view_points.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add app/services/dashboard_analysis_service.py tests/test_saved_view_points.py
git commit -m "feat(saved-views): analyze + incidents accept inline points"
```

---

## Task 4: Backend — thread points through compare + neighborhood

**Files:**
- Modify: `app/services/dashboard_analysis_service.py` (compare), `app/services/neighborhood_service.py`
- Test: `tests/test_saved_view_points.py` (append)

- [ ] **Step 1: Write the failing test** (append)

```python
from app.services.dashboard_analysis_service import compare_selected_places


def test_compare_points_matches_place_ids(tmp_path):
    session, user_hash = _seed(tmp_path)
    session.add(PlaceCluster(
        id="place-2", user_id_hash=user_hash, cluster_version="test",
        cluster_method="manual", centroid_latitude=47.6206, centroid_longitude=-122.3206,
        display_latitude=47.6206, display_longitude=-122.3206, visit_count=3,
        display_label="Library"))
    session.commit()
    common = dict(radius_m=250, analysis_start_date=datetime(2024, 1, 1).date(),
                  analysis_end_date=datetime(2024, 1, 31).date(),
                  offense_category=None, offense_subcategory=None, nibrs_group=None)
    by_points = compare_selected_places(
        session, user_hash, place_ids=None,
        points=[AnalysisPoint(latitude=47.6094, longitude=-122.3334, label="Downtown"),
                AnalysisPoint(latitude=47.6206, longitude=-122.3206, label="Library")],
        **common)
    assert "options" in by_points or "overview" in by_points  # compare payload is non-empty
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_saved_view_points.py::test_compare_points_matches_place_ids -v`
Expected: FAIL (`compare_selected_places` has no `points` keyword).

- [ ] **Step 3: Implement**

In `app/services/dashboard_analysis_service.py`, refactor `compare_selected_places` to resolve via `_resolve_clusters` (returns `PlaceClusterData`) and build options from that data. Add `points: list[AnalysisPoint] | None = None`, make `place_ids` optional, and replace the body lines 90–105 with:

```python
    clusters = _resolve_clusters(session, user_id_hash, place_ids, points)
    if len(clusters) < 2:
        raise ValueError("Select at least two places.")
    options: list[AnalysisSiteOption] = []
    for cluster in clusters:
        if cluster.display_latitude is None or cluster.display_longitude is None:
            raise ValueError("Selected places require display coordinates.")
        options.append(
            AnalysisSiteOption(
                id=cluster.id,
                label=cluster.display_label or "Selected place",
                latitude=cluster.display_latitude,
                longitude=cluster.display_longitude,
                radius_m=radius_m,
            )
        )
```
(The `compare_site_options(...)` call below is unchanged.)

In `app/services/neighborhood_service.py`, `neighborhood_analysis_for_places` (line 183): add `points: list[AnalysisPoint] | None = None`, make `place_ids` optional, add the same two imports (`AnalysisPoint`, `point_clusters`), and replace line 200:
```python
    clusters = (
        point_clusters(points)
        if points is not None
        else [_cluster_data(r) for r in _selected_clusters(session, user_id_hash, place_ids or [])]
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_saved_view_points.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add app/services/dashboard_analysis_service.py app/services/neighborhood_service.py tests/test_saved_view_points.py
git commit -m "feat(saved-views): compare + neighborhood accept inline points"
```

---

## Task 5: Backend — route handlers pass points through (API-level equivalence)

**Files:**
- Modify: `app/api/routes_public_dashboard.py`
- Test: `tests/test_saved_view_points.py` (append)

- [ ] **Step 1: Write the failing test** (append; full HTTP round-trip)

```python
def test_analyze_and_compare_via_points_http(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'http.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add(CrimeIncident(
        id="h1", offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
        offense_category="PROPERTY", latitude=47.6094, longitude=-122.3334))
    session.commit()
    pts = [{"latitude": 47.6094, "longitude": -122.3334, "label": "Downtown"},
           {"latitude": 47.6206, "longitude": -122.3206, "label": "Library"}]

    a = client.post("/dashboard/analyze", json={
        "points": pts[:1], "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31", "radii_m": [250], "offense_category": "PROPERTY"})
    assert a.status_code == 200 and a.json()["summary_count"] == 1

    c = client.post("/dashboard/compare", json={
        "points": pts, "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31", "radius_m": 250})
    assert c.status_code == 200

    bad = client.post("/dashboard/analyze", json={
        "place_ids": ["x"], "points": pts[:1], "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31", "radii_m": [250]})
    assert bad.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_saved_view_points.py::test_analyze_and_compare_via_points_http -v`
Expected: FAIL (handlers pass only `place_ids=request.place_ids`; `points` ignored → analyze raises "Select at least one place" → 400, not 200).

- [ ] **Step 3: Implement**

In `app/api/routes_public_dashboard.py`, add `points=request.points,` to each of the four service calls: `analyze_selected_places` (after line 58), `incident_details_for_places` (after line 82), `compare_selected_places` (after line 106), and `neighborhood_analysis_for_places` (after line 129). Also change each `place_ids=request.place_ids,` to pass through `None` correctly — it already does, since `request.place_ids` is now `None` when points are used. Example for analyze:

```python
        return analyze_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            points=request.points,
            radii_m=request.radii_m,
            # ... rest unchanged ...
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_saved_view_points.py -v`
Expected: PASS (all).

- [ ] **Step 5: Run backend gate + commit**

Run: `python -m pytest -q && ruff check .`
Expected: PASS, no lint errors.

```bash
git add app/api/routes_public_dashboard.py tests/test_saved_view_points.py
git commit -m "feat(saved-views): route inline points through the dashboard endpoints"
```

---

## Task 6: Frontend — `savedView` encode/decode module

**Files:**
- Create: `frontend/src/lib/savedView.ts`
- Test: `frontend/src/lib/savedView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/savedView.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { decodeView, encodeView, type SavedView } from "./savedView";

const VIEW: SavedView = {
  tab: "analyze",
  points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
  radiusM: 250,
  startDate: "2024-01-01",
  endDate: "2024-01-31",
  layer: "reported",
  offenseCategory: "",
};

describe("savedView", () => {
  it("round-trips a view through encode/decode", () => {
    expect(decodeView(encodeView(VIEW))).toEqual(VIEW);
  });

  it("returns null for malformed input", () => {
    expect(decodeView("not-base64!!")).toBeNull();
    expect(decodeView("")).toBeNull();
  });

  it("returns null for an unknown version", () => {
    const bad = btoa(JSON.stringify({ v: 99, tab: "analyze" }));
    expect(decodeView(bad)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/lib/savedView.test.ts`
Expected: FAIL (`Cannot find module './savedView'`).

- [ ] **Step 3: Implement**

Create `frontend/src/lib/savedView.ts`. Compact wire form uses short keys (`y/x/l`, `t`, `r`, `s`, `e`, `ly`, `c`) under a version tag; `encodeView`/`decodeView` translate to/from the app-facing `SavedView`.

```ts
import type { LayerKey } from "../types";

export type ViewTab = "analyze" | "compare";

export interface ViewPoint {
  latitude: number;
  longitude: number;
  label: string;
}

export interface SavedView {
  tab: ViewTab;
  points: ViewPoint[];
  radiusM: number;
  startDate: string;
  endDate: string;
  layer: LayerKey;
  offenseCategory: string;
}

const VERSION = 1;
const MAX_ENCODED_LENGTH = 2000;

function toBase64Url(json: string): string {
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const padded = param.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeView(view: SavedView): string {
  const wire = {
    v: VERSION,
    t: view.tab,
    pts: view.points.map((p) => ({ y: p.latitude, x: p.longitude, l: p.label })),
    r: view.radiusM,
    s: view.startDate,
    e: view.endDate,
    ly: view.layer,
    c: view.offenseCategory || null,
  };
  return toBase64Url(JSON.stringify(wire));
}

export function decodeView(param: string): SavedView | null {
  if (!param || param.length > MAX_ENCODED_LENGTH) return null;
  try {
    const wire = JSON.parse(fromBase64Url(param));
    if (wire.v !== VERSION) return null;
    if (wire.t !== "analyze" && wire.t !== "compare") return null;
    if (!Array.isArray(wire.pts) || wire.pts.length === 0) return null;
    const points = wire.pts.map((p: { y: number; x: number; l: string }) => ({
      latitude: p.y, longitude: p.x, label: String(p.l),
    }));
    if (points.some((p: ViewPoint) => typeof p.latitude !== "number" || typeof p.longitude !== "number")) {
      return null;
    }
    return {
      tab: wire.t,
      points,
      radiusM: Number(wire.r),
      startDate: String(wire.s),
      endDate: String(wire.e),
      layer: wire.ly === "calls" ? "calls" : "reported",
      offenseCategory: wire.c ?? "",
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/lib/savedView.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/savedView.ts frontend/src/lib/savedView.test.ts
git commit -m "feat(saved-views): stateless view encode/decode helpers"
```

---

## Task 7: Frontend — API client accepts points

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Make `place_ids` optional and add `points`**

In `frontend/src/api/client.ts`, update the payload types (lines 15–35). Add a shared point type and make both payloads accept either:

```ts
type AnalysisPointPayload = { latitude: number; longitude: number; label: string };

type AnalyzePlacesPayload = {
  place_ids?: string[];
  points?: AnalysisPointPayload[];
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
  layer?: string;
};

type ComparePlacesPayload = {
  place_ids?: string[];
  points?: AnalysisPointPayload[];
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
  layer?: string;
};
```
(`IncidentDetailsPayload = AnalyzePlacesPayload & { limit?: number }` inherits `points` — no change. Function bodies are unchanged; they already `JSON.stringify(payload)`.)

- [ ] **Step 2: Verify the build type-checks**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(saved-views): client payloads accept inline points"
```

---

## Task 8: Frontend — hooks emit points in shared-view mode

**Files:**
- Modify: `frontend/src/lib/useAnalyze.ts`, `frontend/src/lib/useCompare.ts`
- Test: `frontend/src/lib/useCompare.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/useCompare.test.ts`:

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

vi.mock("../api/client", () => ({ comparePlaces: vi.fn().mockResolvedValue({ ok: true }) }));
import { comparePlaces } from "../api/client";

const analysis = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 250, offenseCategory: "", layer: "reported" as const };

afterEach(() => vi.clearAllMocks());

describe("useCompare shared-view points", () => {
  it("sends points (not place_ids) when a points override is provided", async () => {
    const points = [
      { latitude: 47.61, longitude: -122.34, label: "A" },
      { latitude: 47.62, longitude: -122.33, label: "B" },
    ];
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({ points }));
    expect((comparePlaces as ReturnType<typeof vi.fn>).mock.calls[0][0].place_ids).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/lib/useCompare.test.ts`
Expected: FAIL (`useCompare` ignores `points`; asserts `place_ids`).

- [ ] **Step 3: Implement**

In `frontend/src/lib/useCompare.ts`, add `points?` to `CompareDeps`, gate the run on it, and build the payload accordingly:

```ts
interface CompareDeps {
  selectedIds: Set<string>;
  analysis: AnalysisSettings;
  setError: (message: string) => void;
  points?: { latitude: number; longitude: number; label: string }[];
}

export function useCompare({ selectedIds, analysis, setError, points }: CompareDeps): CompareController {
  // ...unchanged state...
  async function runCompare() {
    const usePoints = points && points.length >= 2;
    if (!usePoints && selectedIds.size < 2) return;
    setError("");
    setRunning(true);
    const version = versionRef.current + 1;
    versionRef.current = version;
    try {
      const result = await comparePlaces({
        ...(usePoints ? { points } : { place_ids: Array.from(selectedIds) }),
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radius_m: analysis.radiusM,
        offense_category: analysis.offenseCategory || null,
        layer: analysis.layer,
      });
      if (versionRef.current === version) setComparison(result);
    } catch {
      if (versionRef.current === version) setError("Unable to compare places. Try again.");
    } finally {
      setRunning(false);
    }
  }
  // ...unchanged...
}
```

Apply the same pattern to `frontend/src/lib/useAnalyze.ts`: add `points?` to `AnalyzeDeps`, compute `const usePoints = points && points.length >= 1;`, gate `if (!usePoints && selectedIds.size < 1) return;`, and in the shared `payload` object spread `...(usePoints ? { points } : { place_ids: Array.from(selectedIds) })` in place of the current `place_ids` line. The three calls (`analyzePlaces`, `getIncidentDetails`, `getNeighborhoodAnalysis`) all reuse `payload`, so they inherit it.

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/lib/useCompare.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useAnalyze.ts frontend/src/lib/useCompare.ts frontend/src/lib/useCompare.test.ts
git commit -m "feat(saved-views): analyze/compare hooks emit points in shared-view mode"
```

---

## Task 9: Frontend — MapWorkspace hydration, banner, and copy-link builder

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/components/MapWorkspace.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** (extend the existing suite)

Add to `frontend/src/components/MapWorkspace.test.tsx` (it already `vi.mock("../api/client")`):

```ts
it("hydrates a shared view from ?view= and runs the points path", async () => {
  const view = encodeView({
    tab: "analyze",
    points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
    radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
    layer: "reported", offenseCategory: "",
  });
  window.history.replaceState({}, "", `/?view=${view}`);
  render(<MapWorkspace />);
  expect(await screen.findByText(/shared view/i)).toBeInTheDocument();
  await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
    expect.objectContaining({ points: expect.any(Array) })));
  window.history.replaceState({}, "", "/");
});
```
Import `encodeView` from `../lib/savedView` and ensure `getNeighborhoodAnalysis` is in the existing mock (it is).

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/MapWorkspace.test.tsx`
Expected: FAIL (no "Shared view" text; points path not called).

- [ ] **Step 3: Implement**

In `frontend/src/components/MapWorkspace.tsx`:

1. At the top of the component, decode the URL once:
```tsx
const initialView = useMemo(() => {
  const param = new URLSearchParams(window.location.search).get("view");
  return param ? decodeView(param) : null;
}, []);
const badLink = Boolean(new URLSearchParams(window.location.search).get("view")) && initialView === null;
const [sharedPoints, setSharedPoints] = useState(initialView?.points ?? null);
const [showBadLink, setShowBadLink] = useState(badLink);
```

2. Seed initial tab + analysis from the view:
```tsx
const [activeTab, setActiveTab] = useState<TabKey>(initialView?.tab ?? "places");
const [analysis, setAnalysis] = useState<AnalysisSettings>(() => {
  if (initialView) {
    return { startDate: initialView.startDate, endDate: initialView.endDate,
      radiusM: initialView.radiusM, offenseCategory: initialView.offenseCategory, layer: initialView.layer };
  }
  const window = currentYearAnalysisWindow();
  return { startDate: window.analysis_start_date, endDate: window.analysis_end_date, radiusM: 250, offenseCategory: "", layer: "reported" };
});
```

3. Pass `points: sharedPoints ?? undefined` into `useAnalyze` and `useCompare`.

4. Run the shared view once on mount:
```tsx
useEffect(() => {
  if (!initialView) return;
  if (initialView.tab === "compare") void compare.runCompare();
  else void analyze.runAnalyze();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

5. Add a copy-link builder from current state — shared points when present, else the selected places' generalized coords (`display_latitude/longitude`, falling back to `latitude/longitude`):
```tsx
const buildShareUrl = useCallback((tab: "analyze" | "compare"): string | null => {
  const points = sharedPoints ?? selected.map((p) => ({
    latitude: Number((p.latitude ?? 0).toFixed(3)),
    longitude: Number((p.longitude ?? 0).toFixed(3)),
    label: p.display_label,
  }));
  if (points.length === 0) return null;
  const encoded = encodeView({ tab, points, radiusM: analysis.radiusM,
    startDate: analysis.startDate, endDate: analysis.endDate,
    layer: analysis.layer, offenseCategory: analysis.offenseCategory });
  return `${window.location.origin}/?view=${encoded}`;
}, [sharedPoints, selected, analysis]);
```
(Round to 3 decimals ≈110 m per the spec's generalized-coordinate rule.)

6. Render a dismissible banner when `sharedPoints` is set and a notice when `showBadLink`, above the tab panels:
```tsx
{sharedPoints && <div className="mc-banner">Shared view · reported incident context. <button onClick={() => setSharedPoints(null)}>Exit</button></div>}
{showBadLink && <div className="mc-banner mc-banner-warn">That shared link couldn't be opened. <button onClick={() => setShowBadLink(false)}>Dismiss</button></div>}
```

7. Pass `buildShareUrl` to `AnalyzeTab` and `CompareTab` as an `onCopyLink` prop (wired in Task 10).

Add imports: `useMemo, useEffect, useCallback` from react (some already present) and `import { decodeView, encodeView } from "../lib/savedView";`.

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/MapWorkspace.test.tsx`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(saved-views): hydrate ?view= links, shared-view banner, share-url builder"
```

---

## Task 10: Frontend — "Copy link to this view" buttons

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx`, `frontend/src/components/CompareTab.tsx`

- [ ] **Step 1: Add the button to AnalyzeTab**

Give `AnalyzeTab` an `onCopyLink?: () => string | null` prop. Near the results header (after the `mc-querybar` block, ~line 448), add:

```tsx
{onCopyLink && neighborhood && (
  <button type="button" className="mc-link-copy" onClick={async () => {
    const url = onCopyLink();
    if (url) { await navigator.clipboard.writeText(url); }
  }}>Copy link to this view</button>
)}
```

In `MapWorkspace.tsx`, pass `onCopyLink={() => buildShareUrl("analyze")}` to `<AnalyzeTab ... />`.

- [ ] **Step 2: Add the button to CompareTab**

Give `CompareTab` an `onCopyLink?: () => string | null` prop. In the `mc-compare-actions` row (~line 168), add next to the Compare button:

```tsx
{onCopyLink && comparison && (
  <button type="button" className="mc-link-copy" onClick={async () => {
    const url = onCopyLink();
    if (url) { await navigator.clipboard.writeText(url); }
  }}>Copy link</button>
)}
```

In `MapWorkspace.tsx`, pass `onCopyLink={() => buildShareUrl("compare")}` to `<CompareTab ... />`.

- [ ] **Step 3: Verify type-check + existing tests**

Run (from `frontend/`): `npx tsc --noEmit && npx vitest run src/components/AnalyzeTab.test.tsx src/components/MapWorkspace.test.tsx`
Expected: no type errors; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AnalyzeTab.tsx frontend/src/components/CompareTab.tsx frontend/src/components/MapWorkspace.tsx
git commit -m "feat(saved-views): copy-link buttons on Analyze and Compare"
```

---

## Task 11: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run (from repo root): `make test-all`
Expected: pytest green, `ruff check .` clean, frontend `npm test` green, `npm run build` clean.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run `make run`, open the app, select a place, run Analyze, click "Copy link to this view", open the copied URL in a fresh private window (no session), confirm the shared view hydrates and recomputes with a "Shared view" banner. Repeat for Compare. Paste a corrupted `?view=` and confirm the "couldn't be opened" notice with a clean workspace.

- [ ] **Step 3: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(saved-views): verification gate green"
```

---

## Self-Review

**1. Spec coverage.**
- *Durable shareable link / stateless URL* → Tasks 6, 9 (`?view=` encode/decode + hydration). ✓
- *Recompute on open* → Task 9 runs analyze/compare on mount from encoded inputs; no stored results. ✓
- *Analyze + Compare scope* → analyze/incidents/neighborhood (Tasks 3, 4, 8, 9) + compare (Tasks 4, 8, 9). Routes excluded. ✓
- *Coordinate-capable analyze/compare (shared core)* → Tasks 1–5. ✓
- *Generalized coordinates in link* → Task 9 `buildShareUrl` rounds to 3 decimals (≈110 m). ✓
- *Seattle-bbox guard on points* → Task 1 `AnalysisPoint.within_seattle` (bounds mirror config + frontend). ✓
- *Error handling (malformed link → clean workspace + notice)* → Task 6 `decodeView` returns null; Task 9 `showBadLink` notice. ✓
- *Invariant checkpoint (no safety language; live query)* → banner/button copy is neutral ("reported incident context"); recompute-on-open. ✓
- *Non-goals (no storage/list/token, no Routes, no snapshots, no saving shared point as a place)* → nothing in the plan adds these. ✓

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N" — each code step shows real code. ✓

**3. Type consistency.** `points` is `list[AnalysisPoint] | None` across `dashboard_schemas.py`, the four service functions, and `routes_public_dashboard.py`; `_resolve_clusters` returns `PlaceClusterData` (what analyze/incidents/neighborhood already consume, and what the refactored compare now consumes). Frontend `SavedView.points` / `ViewPoint` (`latitude/longitude/label`) matches the client `AnalysisPointPayload` and the hooks' `points` dep; wire keys (`y/x/l`) are confined to `savedView.ts`. ✓
