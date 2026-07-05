# Transparency Layers (Slice 2 of Map & UI Overhaul) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the geography and the data visible: beat outlines (with the analyzed place's beat highlighted), zoom-dependent clustered incident dots with a click card, and an honest disclosure of location-redacted incidents.

**Architecture:** Two new public session-gated endpoints — `GET /dashboard/beats` (slimmed, cached GeoJSON from the bundled 2018 file) and `POST /dashboard/incident-points` (bbox-clamped, filter-aware, capped at 5,000 points + `unmappable_citywide_count`). Frontend adds three MapLibre layer groups to the existing `load`-handler pattern (beats under rings under incident clusters/dots), a debounced+abortable viewport fetch hook mirroring `useAddressSearch`, and a disclosure chip. No DB migrations; no changes to analysis/statistics paths.

**Tech Stack:** FastAPI/SQLAlchemy (existing patterns: `incidents_in_bbox`, `AnalysisPoint` Seattle-bbox validation, `lru_cache` beat helpers), maplibre-gl GeoJSON sources with `cluster: true`, `maplibregl.Popup` (DOM content, XSS-safe).

**Spec:** `docs/superpowers/specs/2026-07-04-map-ui-overhaul-design.md` (Slice 2 section).

**Recorded deviations from the spec (verified against reality):**
1. The bundled `app/data/seattle_police_beats_2018.geojson` features carry ONLY a `beat` property — no precinct/sector (those are attributes of the ArcGIS layer we don't bundle). `/dashboard/beats` therefore slims properties to `{beat}`. Task 10 amends the spec line.
2. Beat labels are rendered as always-on subtle symbol labels at zoom ≥ 12 instead of hover-only labels — simpler, and works on touch. Task 10 records this in the spec.
3. The disclosure chip sits bottom-center (the spec's bottom-left is occupied by the Analyst panel); the tiles-missing fallback notice moves up 40px so both can show.

**Working rules:** every commit leaves `make test-all` green. Colors stay in the current slice-1 palette (graphite `#3A3F46` / slate `#74858E`) — the Civic Clear recolor is Slice 3. One calm neutral for dots/clusters, **no red/amber, no severity gradient, no heatmap** (product invariant).

## File structure

| File | Role |
|---|---|
| `app/services/beat_geometry_service.py` (new) | Slimmed beats FeatureCollection + gzip bytes, cached in-process |
| `app/services/incident_points_service.py` (new) | Bbox-clamped point query, 5,000 cap, total/unmappable counts |
| `app/api/dashboard_schemas.py` (modify) | `MapBounds` + `DashboardIncidentPointsRequest` |
| `app/api/routes_public_dashboard.py` (modify) | `GET /dashboard/beats`, `POST /dashboard/incident-points` |
| `frontend/src/api/client.ts` + `frontend/src/types.ts` (modify) | `getBeatPolygons`, `getIncidentPoints`, payload/response types |
| `frontend/src/lib/useIncidentPoints.ts` (new) | Debounced, abortable viewport fetch → GeoJSON |
| `frontend/src/components/MapCanvas.tsx` (modify) | Beat + incident layer groups, popup, viewport emit, highlight |
| `frontend/src/components/IncidentDisclosure.tsx` (new) | The honesty chip |
| `frontend/src/components/MapLegend.tsx`, `MapWorkspace.tsx`, `mapWorkspace.css` (modify) | Wiring, legend rows, chip/fallback CSS |
| Tests | `tests/test_beats_api.py`, `tests/test_incident_points.py`, `frontend/src/lib/useIncidentPoints.test.ts`, extended `MapCanvas.test.tsx`, `IncidentDisclosure.test.tsx` |

---

### Task 1: Beats GeoJSON service (`beat_geometry_service.py`)

**Files:**
- Create: `app/services/beat_geometry_service.py`
- Test: `tests/test_beats_api.py` (service half; the route half arrives in Task 2)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_beats_api.py
from __future__ import annotations

import gzip
import json

from app.services.beat_geometry_service import beats_geojson_payloads, reset_beats_cache


def test_beats_payload_is_slimmed_and_complete() -> None:
    raw, gzipped = beats_geojson_payloads()
    body = json.loads(raw)
    assert body["type"] == "FeatureCollection"
    # 55 features in the bundled 2018 file; every property dict is exactly {"beat": code}.
    assert len(body["features"]) == 55
    for feature in body["features"]:
        assert set(feature["properties"].keys()) == {"beat"}
        assert isinstance(feature["properties"]["beat"], str)
        assert feature["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    # gzip bytes decompress to the same payload
    assert gzip.decompress(gzipped) == raw


def test_beats_payload_is_cached_in_process() -> None:
    reset_beats_cache()
    first_raw, _ = beats_geojson_payloads()
    second_raw, _ = beats_geojson_payloads()
    assert first_raw is second_raw  # same object — cached, not re-serialized
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_beats_api.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.beat_geometry_service'`

- [ ] **Step 3: Write the implementation**

```python
# app/services/beat_geometry_service.py
"""Slimmed beat-polygon GeoJSON for the map's beat-outline layer.

The bundled 2018 file's features carry only a ``beat`` property (no precinct/sector),
so slimming means dropping nothing but pinning the shape. Cached for the process
lifetime — the file is a build artifact that never changes at runtime.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from app.analysis.beat_baselines import DEFAULT_BEATS_GEOJSON, NON_GEOGRAPHIC_BEATS

_cache: tuple[bytes, bytes] | None = None


def reset_beats_cache() -> None:
    global _cache
    _cache = None


def beats_geojson_payloads(path: Path | None = None) -> tuple[bytes, bytes]:
    """Return (raw_json_bytes, gzip_bytes) of the slimmed FeatureCollection."""
    global _cache
    if _cache is not None and path is None:
        return _cache
    source = json.loads(Path(path or DEFAULT_BEATS_GEOJSON).read_text(encoding="utf-8"))
    features = []
    for feature in source.get("features", []):
        beat = str(feature.get("properties", {}).get("beat", "")).strip()
        if not beat or beat in NON_GEOGRAPHIC_BEATS:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"beat": beat},
                "geometry": feature["geometry"],
            }
        )
    raw = json.dumps({"type": "FeatureCollection", "features": features}).encode("utf-8")
    payloads = (raw, gzip.compress(raw))
    if path is None:
        _cache = payloads
    return payloads
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_beats_api.py -q && .venv/bin/ruff check app/services/beat_geometry_service.py tests/test_beats_api.py`
Expected: PASS (2 tests), ruff clean. (`NON_GEOGRAPHIC_BEATS` is exported at `app/analysis/beat_baselines.py:37`; if the 2018 file contains a `-`/`OOJ` feature the 55 count will differ — adjust the asserted count to the real slimmed count and note it in the commit body.)

- [ ] **Step 5: Commit**

```bash
git add app/services/beat_geometry_service.py tests/test_beats_api.py
git commit -m "feat(beats): slimmed cached beat-polygon GeoJSON payloads"
```

---

### Task 2: `GET /dashboard/beats` route

**Files:**
- Modify: `app/api/routes_public_dashboard.py`
- Test: `tests/test_beats_api.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_beats_api.py`)

```python
from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    return TestClient(app)


def test_beats_endpoint_requires_session(tmp_path) -> None:
    client = _client(tmp_path)
    assert client.get("/dashboard/beats").status_code == 401


def test_beats_endpoint_serves_geojson(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.get("/dashboard/beats")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/geo+json")
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 55
    assert set(body["features"][0]["properties"].keys()) == {"beat"}
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `.venv/bin/python -m pytest tests/test_beats_api.py -q`
Expected: 2 pass (service), 2 FAIL — 404 on `/dashboard/beats`.

- [ ] **Step 3: Add the route**

In `app/api/routes_public_dashboard.py` — add imports (`Request` from fastapi, `Response` from fastapi.responses, `beats_geojson_payloads` from `app.services.beat_geometry_service`), then after the `/dashboard/freshness` route:

```python
@router.get("/dashboard/beats")
def dashboard_beats(
    request: Request,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
) -> Response:
    """SPD beat polygons for the map's outline layer (static bundled data)."""
    raw, gzipped = beats_geojson_payloads()
    headers = {"Cache-Control": "public, max-age=3600"}
    if "gzip" in request.headers.get("accept-encoding", "").lower():
        headers["Content-Encoding"] = "gzip"
        return Response(content=gzipped, media_type="application/geo+json", headers=headers)
    return Response(content=raw, media_type="application/geo+json", headers=headers)
```

(`user_id_hash` is unused by the body — that matches the gating-only pattern; if ruff flags the unused arg, rename to `_user_id_hash`.)

- [ ] **Step 4: Run tests + the tier guard**

Run: `.venv/bin/python -m pytest tests/test_beats_api.py tests/test_internal_surface.py -q`
Expected: all pass (the route is public-in-schema with session gating — exactly the tier the guard expects for `/dashboard/*`).

- [ ] **Step 5: Commit**

```bash
git add app/api/routes_public_dashboard.py tests/test_beats_api.py
git commit -m "feat(beats): session-gated GET /dashboard/beats with gzip negotiation"
```

---

### Task 3: Request models — `MapBounds` + `DashboardIncidentPointsRequest`

**Files:**
- Modify: `app/api/dashboard_schemas.py`
- Test: `tests/test_incident_points.py` (schema half)

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_incident_points.py
from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from app.api.dashboard_schemas import DashboardIncidentPointsRequest, MapBounds


def _payload(**over):
    base = {
        "bounds": {"west": -122.40, "south": 47.55, "east": -122.25, "north": 47.65},
        "analysis_start_date": date(2025, 1, 1),
        "analysis_end_date": date(2025, 10, 31),
    }
    base.update(over)
    return base


def test_valid_request_defaults_to_reported_layer() -> None:
    request = DashboardIncidentPointsRequest(**_payload())
    assert request.layer == "reported"
    assert request.offense_category is None


def test_inverted_bbox_rejected() -> None:
    with pytest.raises(ValidationError, match="empty or inverted"):
        MapBounds(west=-122.25, south=47.55, east=-122.40, north=47.65)


def test_bbox_outside_seattle_rejected() -> None:
    with pytest.raises(ValidationError, match="outside the Seattle area"):
        MapBounds(west=-71.10, south=42.30, east=-71.00, north=42.40)  # Boston


def test_bbox_overlapping_seattle_accepted_and_wider_than_city_ok() -> None:
    bounds = MapBounds(west=-123.0, south=47.0, east=-122.0, north=48.0)
    assert bounds.west == -123.0


def test_unknown_layer_rejected() -> None:
    with pytest.raises(ValidationError, match="layer must be one of"):
        DashboardIncidentPointsRequest(**_payload(layer="everything"))
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_incident_points.py -q`
Expected: FAIL — `ImportError: cannot import name 'DashboardIncidentPointsRequest'`

- [ ] **Step 3: Add the models**

In `app/api/dashboard_schemas.py`, after `AnalysisPoint` (uses the existing `_SEATTLE_*` constants at lines 12-16 and `_validate_layer` at 19-23):

```python
class MapBounds(BaseModel):
    """A map viewport; must intersect the Seattle area the data covers."""

    west: float
    south: float
    east: float
    north: float

    @model_validator(mode="after")
    def must_intersect_seattle(self) -> "MapBounds":
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("bounds are empty or inverted")
        if (
            self.east < _SEATTLE_WEST
            or self.west > _SEATTLE_EAST
            or self.north < _SEATTLE_SOUTH
            or self.south > _SEATTLE_NORTH
        ):
            raise ValueError("bounds are outside the Seattle area")
        return self


class DashboardIncidentPointsRequest(BaseModel):
    bounds: MapBounds
    analysis_start_date: date
    analysis_end_date: date
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def layer_must_be_known(self) -> "DashboardIncidentPointsRequest":
        _validate_layer(self.layer)
        return self
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_incident_points.py -q && .venv/bin/ruff check app/api/dashboard_schemas.py`
Expected: PASS (5 tests), ruff clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard_schemas.py tests/test_incident_points.py
git commit -m "feat(points): MapBounds + incident-points request model with Seattle-intersect validation"
```

---

### Task 4: Incident-points service

**Files:**
- Create: `app/services/incident_points_service.py`
- Test: `tests/test_incident_points.py` (append)

- [ ] **Step 1: Write the failing tests** (append; direct-session pattern from `tests/test_dashboard_analysis_api.py`)

```python
from datetime import UTC, datetime

from app.db import configure_database, get_sessionmaker, init_db
from app.models import CrimeIncident
from app.services.incident_points_service import INCIDENT_POINTS_LIMIT, incident_points


def _session(tmp_path):
    configure_database(f"sqlite+pysqlite:///{tmp_path / 'points.sqlite3'}")
    init_db()
    return get_sessionmaker()()


def _incident(i: int, **over) -> CrimeIncident:
    fields = {
        "id": f"inc-{i}",
        "external_incident_id": f"ext-{i}",
        "offense_start_utc": datetime(2025, 6, 1, 12, 0, tzinfo=UTC),
        "offense_category": "PROPERTY",
        "offense_subcategory": "THEFT",
        "block_address": f"{i}XX BLOCK OF PINE ST",
        "latitude": 47.610,
        "longitude": -122.330,
        "source_dataset": "seattle_spd_crime",
    }
    fields.update(over)
    return CrimeIncident(**fields)


BOUNDS = {"west": -122.40, "south": 47.55, "east": -122.25, "north": 47.65}
DATES = {"analysis_start_date": date(2025, 1, 1), "analysis_end_date": date(2025, 10, 31)}


def test_points_filtered_by_bbox_dates_and_layer(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all(
        [
            _incident(1),  # in bbox, in range, reported → returned
            _incident(2, latitude=47.70, longitude=-122.33),  # north of bbox → out
            _incident(3, offense_start_utc=datetime(2024, 1, 1, tzinfo=UTC)),  # out of range
            _incident(4, source_dataset="seattle_spd_arrests"),  # wrong layer
            _incident(5, latitude=None, longitude=None),  # redacted → unmappable
        ]
    )
    session.commit()
    result = incident_points(session, bounds=MapBounds(**BOUNDS), layer="reported", **DATES)
    assert result["returned_count"] == 1
    assert result["total_count"] == 1
    assert result["unmappable_citywide_count"] == 1
    point = result["points"][0]
    assert point["id"] == "inc-1"
    assert point["latitude"] == 47.610
    assert point["block_address"] == "1XX BLOCK OF PINE ST"
    assert point["occurred_at"].endswith("Z")
    session.close()


def test_arrest_sentinel_never_appears_even_with_huge_bbox(tmp_path) -> None:
    # Arrests with unknown location use -1.0/-1.0; the Seattle clamp excludes them
    # structurally. Pin the behavior so a future bbox change can't regress it.
    session = _session(tmp_path)
    session.add_all(
        [
            _incident(1, source_dataset="seattle_spd_arrests"),
            _incident(2, source_dataset="seattle_spd_arrests", latitude=-1.0, longitude=-1.0),
        ]
    )
    session.commit()
    result = incident_points(
        session,
        bounds=MapBounds(west=-123.0, south=47.0, east=-122.0, north=48.0),
        layer="arrests",
        **DATES,
    )
    assert result["returned_count"] == 1
    assert result["points"][0]["id"] == "inc-1"
    session.close()


def test_cap_returns_most_recent_and_signals_truncation(tmp_path) -> None:
    session = _session(tmp_path)
    session.add_all(
        [
            _incident(i, offense_start_utc=datetime(2025, 6, 1 + i, 12, 0, tzinfo=UTC))
            for i in range(4)
        ]
    )
    session.commit()
    result = incident_points(
        session, bounds=MapBounds(**BOUNDS), layer="reported", limit=2, **DATES
    )
    assert result["returned_count"] == 2
    assert result["total_count"] == 4
    assert result["limit"] == 2
    # Most recent first
    assert [p["id"] for p in result["points"]] == ["inc-3", "inc-2"]
    session.close()


def test_default_limit_is_5000() -> None:
    assert INCIDENT_POINTS_LIMIT == 5000
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_incident_points.py -q`
Expected: schema tests pass; new tests FAIL — `ModuleNotFoundError: app.services.incident_points_service`

- [ ] **Step 3: Write the service**

```python
# app/services/incident_points_service.py
"""Viewport incident points for the map's dot layer.

Coordinates are clamped to the Seattle bounds before querying, which structurally
excludes the arrests unknown-location sentinel (-1.0/-1.0). ``unmappable_citywide_count``
counts rows matching the same non-spatial filters whose location was redacted at
the source (NULL coordinates) — they exist only in beat-level statistics.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dashboard_schemas import MapBounds, _SEATTLE_EAST, _SEATTLE_NORTH, _SEATTLE_SOUTH, _SEATTLE_WEST
from app.crime.sources import sources_for_layer
from app.models import CrimeIncident

INCIDENT_POINTS_LIMIT = 5000


def _utc_json(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat().replace("+00:00", "Z") if value.tzinfo else value.isoformat() + "Z"


def incident_points(
    session: Session,
    *,
    bounds: MapBounds,
    analysis_start_date: date,
    analysis_end_date: date,
    layer: str,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
    limit: int = INCIDENT_POINTS_LIMIT,
) -> dict[str, Any]:
    sources = sources_for_layer(layer)
    observed_at = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    start_at = datetime.combine(analysis_start_date, time.min)
    end_at = datetime.combine(analysis_end_date, time.max)

    def non_spatial(statement):
        statement = (
            statement.where(CrimeIncident.source_dataset.in_(sources))
            .where(observed_at >= start_at)
            .where(observed_at <= end_at)
        )
        if offense_category:
            statement = statement.where(CrimeIncident.offense_category == offense_category)
        if offense_subcategory:
            statement = statement.where(CrimeIncident.offense_subcategory == offense_subcategory)
        if nibrs_group:
            statement = statement.where(CrimeIncident.nibrs_group == nibrs_group)
        return statement

    west = max(bounds.west, _SEATTLE_WEST)
    east = min(bounds.east, _SEATTLE_EAST)
    south = max(bounds.south, _SEATTLE_SOUTH)
    north = min(bounds.north, _SEATTLE_NORTH)

    def spatial(statement):
        return (
            statement.where(CrimeIncident.latitude.is_not(None))
            .where(CrimeIncident.longitude.is_not(None))
            .where(CrimeIncident.latitude >= south)
            .where(CrimeIncident.latitude <= north)
            .where(CrimeIncident.longitude >= west)
            .where(CrimeIncident.longitude <= east)
        )

    total_count = session.scalar(spatial(non_spatial(select(func.count()).select_from(CrimeIncident)))) or 0
    unmappable_citywide_count = (
        session.scalar(
            non_spatial(select(func.count()).select_from(CrimeIncident)).where(
                CrimeIncident.latitude.is_(None)
            )
        )
        or 0
    )
    rows = session.execute(
        spatial(
            non_spatial(
                select(
                    CrimeIncident.id,
                    CrimeIncident.latitude,
                    CrimeIncident.longitude,
                    CrimeIncident.offense_category,
                    CrimeIncident.offense_subcategory,
                    CrimeIncident.offense_start_utc,
                    CrimeIncident.report_utc,
                    CrimeIncident.block_address,
                    CrimeIncident.source_dataset,
                )
            )
        )
        .order_by(observed_at.desc())
        .limit(limit)
    ).all()

    points = [
        {
            "id": row.id,
            "latitude": row.latitude,
            "longitude": row.longitude,
            "offense_category": row.offense_category,
            "offense_subcategory": row.offense_subcategory,
            "occurred_at": _utc_json(row.offense_start_utc or row.report_utc),
            "block_address": row.block_address,
            "source_dataset": row.source_dataset,
        }
        for row in rows
    ]
    return {
        "points": points,
        "returned_count": len(points),
        "total_count": total_count,
        "unmappable_citywide_count": unmappable_citywide_count,
        "limit": limit,
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_incident_points.py -q && .venv/bin/ruff check app/services/incident_points_service.py`
Expected: PASS (9 tests total in the file), ruff clean. Note: ruff may flag the private `_SEATTLE_*` imports (private-member import) — if so, export public aliases `SEATTLE_WEST = _SEATTLE_WEST` etc. from `dashboard_schemas.py` and import those instead; keep one source of truth.

- [ ] **Step 5: Commit**

```bash
git add app/services/incident_points_service.py tests/test_incident_points.py
git commit -m "feat(points): viewport incident-points query with cap + unmappable count"
```

---

### Task 5: `POST /dashboard/incident-points` route

**Files:**
- Modify: `app/api/routes_public_dashboard.py`
- Test: `tests/test_incident_points.py` (append)

- [ ] **Step 1: Write the failing tests** (append)

```python
from fastapi.testclient import TestClient

from app.main import create_app


def _client_with_incidents(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'api.sqlite3'}")
    client = TestClient(app)
    session = get_sessionmaker()()
    session.add_all([_incident(1), _incident(2, latitude=None, longitude=None)])
    session.commit()
    session.close()
    return client


_API_PAYLOAD = {
    "bounds": BOUNDS,
    "analysis_start_date": "2025-01-01",
    "analysis_end_date": "2025-10-31",
    "layer": "reported",
}


def test_incident_points_requires_session(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    assert client.post("/dashboard/incident-points", json=_API_PAYLOAD).status_code == 401


def test_incident_points_endpoint_returns_points_and_counts(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    client.post("/sessions")
    response = client.post("/dashboard/incident-points", json=_API_PAYLOAD)
    assert response.status_code == 200
    body = response.json()
    assert body["returned_count"] == 1
    assert body["unmappable_citywide_count"] == 1
    assert body["limit"] == 5000
    assert body["points"][0]["block_address"] == "1XX BLOCK OF PINE ST"


def test_incident_points_rejects_non_seattle_bbox_as_422(tmp_path) -> None:
    client = _client_with_incidents(tmp_path)
    client.post("/sessions")
    payload = dict(_API_PAYLOAD, bounds={"west": -71.1, "south": 42.3, "east": -71.0, "north": 42.4})
    response = client.post("/dashboard/incident-points", json=payload)
    assert response.status_code == 422
    assert "outside the Seattle area" in response.text
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_incident_points.py -q`
Expected: prior tests pass; new tests FAIL — 404 (route absent).

- [ ] **Step 3: Add the route**

In `app/api/routes_public_dashboard.py` (import `DashboardIncidentPointsRequest` and `incident_points`), after `/dashboard/incidents`:

```python
@router.post("/dashboard/incident-points")
def dashboard_incident_points(
    request: DashboardIncidentPointsRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return incident_points(
            session,
            bounds=request.bounds,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            layer=request.layer,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 4: Run full backend gate**

Run: `.venv/bin/python -m pytest tests -q && .venv/bin/ruff check .`
Expected: all green (including `test_internal_surface.py` — public `/dashboard/*` + session gating is the sanctioned tier).

- [ ] **Step 5: Commit**

```bash
git add app/api/routes_public_dashboard.py tests/test_incident_points.py
git commit -m "feat(points): session-gated POST /dashboard/incident-points"
```

---

### Task 6: Frontend client + types (+ keep existing suites green)

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api/client.ts`
- Modify: `frontend/src/components/MapWorkspace.test.tsx`, `frontend/src/App.test.tsx` (client-mock exports)
- Test: type-level only — the gate is `npm run lint` + the untouched suites staying green

- [ ] **Step 1: Add types** (in `frontend/src/types.ts`, near the incident types)

```ts
export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type IncidentPoint = {
  id: string;
  latitude: number;
  longitude: number;
  offense_category: string | null;
  offense_subcategory: string | null;
  occurred_at: string | null;
  block_address: string | null;
  source_dataset: string;
};

export type IncidentPointsResponse = {
  points: IncidentPoint[];
  returned_count: number;
  total_count: number;
  unmappable_citywide_count: number;
  limit: number;
};

export type BeatFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { beat: string };
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  }>;
};
```

- [ ] **Step 2: Add client functions** (in `frontend/src/api/client.ts`, mirroring `getIncidentDetails` at lines 125-132; note `request` already accepts `options` — thread `signal` through)

```ts
export type IncidentPointsPayload = {
  bounds: MapBounds;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category?: string | null;
  layer?: string;
};

export function getBeatPolygons(): Promise<BeatFeatureCollection> {
  return request<BeatFeatureCollection>("/dashboard/beats");
}

export function getIncidentPoints(
  payload: IncidentPointsPayload,
  signal?: AbortSignal,
): Promise<IncidentPointsResponse> {
  return request<IncidentPointsResponse>("/dashboard/incident-points", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}
```

(Import `MapBounds`, `BeatFeatureCollection`, `IncidentPointsResponse` from `../types`. If `request`'s options type doesn't include `signal`, it's a `RequestInit` spread — check lines 44-64; `signal` is standard `RequestInit`, so it passes through.)

- [ ] **Step 3: Extend the client mocks in the two suites that mock the module wholesale**

In `frontend/src/components/MapWorkspace.test.tsx` (the `vi.mock("../api/client", ...)` block at ~line 18) and `frontend/src/App.test.tsx` (equivalent block), add:

```ts
  getBeatPolygons: vi.fn().mockResolvedValue({ type: "FeatureCollection", features: [] }),
  getIncidentPoints: vi.fn().mockResolvedValue({
    points: [], returned_count: 0, total_count: 0, unmappable_citywide_count: 0, limit: 5000,
  }),
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint && npm test`
Expected: tsc clean; all existing tests pass (MapWorkspace doesn't call the new functions yet — the mocks are forward wiring so Task 9 can't break these suites silently).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/MapWorkspace.test.tsx frontend/src/App.test.tsx
git commit -m "feat(points): client + types for beats and incident points"
```

---

### Task 7: `useIncidentPoints` hook (debounced, abortable, GeoJSON out)

**Files:**
- Create: `frontend/src/lib/useIncidentPoints.ts`
- Test: `frontend/src/lib/useIncidentPoints.test.ts`

- [ ] **Step 1: Write the failing tests** (fake-timer pattern from `useAddressSearch.test.ts`)

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIncidentPoints } from "./useIncidentPoints";
import type { AnalysisSettings, IncidentPointsResponse, MapBounds } from "../types";

const fetchPoints = vi.fn();

vi.mock("../api/client", () => ({
  getIncidentPoints: (...args: unknown[]) => fetchPoints(...args),
}));

const BOUNDS: MapBounds = { west: -122.4, south: 47.55, east: -122.25, north: 47.65 };
const ANALYSIS: AnalysisSettings = {
  startDate: "2025-01-01",
  endDate: "2025-10-31",
  radiusM: 250,
  offenseCategory: null,
  layer: "reported",
};

function response(over: Partial<IncidentPointsResponse> = {}): IncidentPointsResponse {
  return {
    points: [
      {
        id: "inc-1", latitude: 47.61, longitude: -122.33,
        offense_category: "PROPERTY", offense_subcategory: "THEFT",
        occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST",
        source_dataset: "seattle_spd_crime",
      },
    ],
    returned_count: 1, total_count: 1, unmappable_citywide_count: 2, limit: 5000,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchPoints.mockReset().mockResolvedValue(response());
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("useIncidentPoints", () => {
  it("does not fetch until bounds arrive, then fetches after the debounce", async () => {
    const { result, rerender } = renderHook(
      ({ bounds }) => useIncidentPoints({ bounds, analysis: ANALYSIS }),
      { initialProps: { bounds: null as MapBounds | null } },
    );
    expect(fetchPoints).not.toHaveBeenCalled();
    rerender({ bounds: BOUNDS });
    expect(fetchPoints).not.toHaveBeenCalled(); // still inside debounce window
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchPoints).toHaveBeenCalledTimes(1);
    expect(fetchPoints.mock.calls[0][0]).toMatchObject({
      bounds: BOUNDS,
      analysis_start_date: "2025-01-01",
      layer: "reported",
    });
    expect(result.current.geojson.features).toHaveLength(1);
    expect(result.current.geojson.features[0].geometry.coordinates).toEqual([-122.33, 47.61]);
    expect(result.current.unmappableCount).toBe(2);
  });

  it("collapses rapid viewport changes into one trailing fetch", async () => {
    const { rerender } = renderHook(
      ({ bounds }) => useIncidentPoints({ bounds, analysis: ANALYSIS }),
      { initialProps: { bounds: BOUNDS } },
    );
    rerender({ bounds: { ...BOUNDS, north: 47.66 } });
    rerender({ bounds: { ...BOUNDS, north: 47.67 } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchPoints).toHaveBeenCalledTimes(1);
    expect(fetchPoints.mock.calls[0][0].bounds.north).toBe(47.67);
  });

  it("refetches when the layer changes", async () => {
    const { rerender } = renderHook(
      ({ analysis }) => useIncidentPoints({ bounds: BOUNDS, analysis }),
      { initialProps: { analysis: ANALYSIS } },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender({ analysis: { ...ANALYSIS, layer: "arrests" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchPoints).toHaveBeenCalledTimes(2);
    expect(fetchPoints.mock.calls[1][0].layer).toBe("arrests");
  });

  it("ignores results from aborted requests", async () => {
    let rejectFirst: (reason: Error) => void = () => {};
    fetchPoints
      .mockImplementationOnce(
        (_payload, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            rejectFirst = () => reject(new DOMException("aborted", "AbortError"));
            signal?.addEventListener("abort", rejectFirst);
          }),
      )
      .mockResolvedValueOnce(response({ unmappable_citywide_count: 9 }));
    const { result, rerender } = renderHook(
      ({ bounds }) => useIncidentPoints({ bounds, analysis: ANALYSIS }),
      { initialProps: { bounds: BOUNDS } },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender({ bounds: { ...BOUNDS, north: 47.7 } }); // aborts request #1
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.unmappableCount).toBe(9);
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/useIncidentPoints.test.ts`
Expected: FAIL — `Cannot find module './useIncidentPoints'`

- [ ] **Step 3: Write the hook**

```ts
// frontend/src/lib/useIncidentPoints.ts
import { useEffect, useRef, useState } from "react";

import { getIncidentPoints } from "../api/client";
import type { AnalysisSettings, IncidentPoint, IncidentPointsResponse, MapBounds } from "../types";

const DEBOUNCE_MS = 300;

export type IncidentFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      id: string;
      offense_category: string | null;
      offense_subcategory: string | null;
      occurred_at: string | null;
      block_address: string | null;
    };
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
};

const EMPTY: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };

function toGeoJSON(points: IncidentPoint[]): IncidentFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        id: point.id,
        offense_category: point.offense_category,
        offense_subcategory: point.offense_subcategory,
        occurred_at: point.occurred_at,
        block_address: point.block_address,
      },
      geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
    })),
  };
}

export function useIncidentPoints({
  bounds,
  analysis,
}: {
  bounds: MapBounds | null;
  analysis: AnalysisSettings;
}) {
  const [geojson, setGeojson] = useState<IncidentFeatureCollection>(EMPTY);
  const [counts, setCounts] = useState({ returned: 0, total: 0, unmappable: 0, limit: 0 });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { startDate, endDate, offenseCategory, layer } = analysis;

  useEffect(() => {
    if (!bounds) {
      return undefined;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
      getIncidentPoints(
        {
          bounds,
          analysis_start_date: startDate,
          analysis_end_date: endDate,
          offense_category: offenseCategory,
          layer,
        },
        controller.signal,
      )
        .then((response: IncidentPointsResponse) => {
          if (controller.signal.aborted) return;
          setGeojson(toGeoJSON(response.points));
          setCounts({
            returned: response.returned_count,
            total: response.total_count,
            unmappable: response.unmappable_citywide_count,
            limit: response.limit,
          });
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "incident points failed");
        });
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      controller.abort();
    };
  }, [bounds, startDate, endDate, offenseCategory, layer]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    geojson,
    returnedCount: counts.returned,
    totalCount: counts.total,
    unmappableCount: counts.unmappable,
    limit: counts.limit,
    error,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/useIncidentPoints.test.ts && npm run lint`
Expected: PASS (4 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useIncidentPoints.ts frontend/src/lib/useIncidentPoints.test.ts
git commit -m "feat(points): debounced abortable viewport incident-points hook"
```

---

### Task 8: MapCanvas — beat outlines, incident clusters/dots, popup, viewport emit

**Files:**
- Modify: `frontend/src/components/MapCanvas.tsx`
- Modify: `frontend/src/components/MapCanvas.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css` (popup styling)

This is the slice's biggest task. The structure mirrors the existing `RINGS_SOURCE`/`addRingLayers` pattern exactly (`MapCanvas.tsx:94-123`), with new sources fed by `setData` effects. Layer stacking: beats at the bottom, rings above beats, incident clusters/dots on top (call order in the `load` handler: `addBeatLayers` → `addRingLayers` → `addIncidentLayers`).

- [ ] **Step 1: Extend the maplibre mock, then write the failing tests**

In `MapCanvas.test.tsx`, upgrade `MockMap` (keep everything it already has — `static last`, `sources` Map, `fireClick`, load-fires-immediately):

```ts
    // inside the vi.mock("maplibre-gl") factory
    layers: Array<Record<string, unknown>> = [];
    layerHandlers: Record<string, Array<(arg?: unknown) => void>> = {};
    addSource(id: string, options: Record<string, unknown>) {
      this.sources.set(id, { options, setData: vi.fn() });
    }
    addLayer(layer: Record<string, unknown>) {
      this.layers.push(layer);
    }
    setFilter(id: string, filter: unknown) {
      const layer = this.layers.find((entry) => entry.id === id);
      if (layer) layer.filter = filter;
    }
    on(event: string, layerOrCb: unknown, maybeCb?: (arg?: unknown) => void) {
      if (typeof layerOrCb === "string" && maybeCb) {
        (this.layerHandlers[`${event}:${layerOrCb}`] ??= []).push(maybeCb);
        return this;
      }
      const cb = layerOrCb as (arg?: unknown) => void;
      (this.handlers[event] ??= []).push(cb);
      if (event === "load") cb();
      return this;
    }
    fireLayerClick(layerId: string, feature: Record<string, unknown>, lngLat = { lng: -122.33, lat: 47.61 }) {
      for (const cb of this.layerHandlers[`click:${layerId}`] ?? []) {
        cb({ features: [feature], lngLat });
      }
    }
    getBounds() {
      return { getWest: () => -122.4, getSouth: () => 47.55, getEast: () => -122.25, getNorth: () => 47.65 };
    }
    getCanvas() {
      return { style: {} } as HTMLCanvasElement;
    }
    easeTo = vi.fn();
    fireMoveEnd() {
      for (const cb of this.handlers.moveend ?? []) cb();
    }
```

Also add a `MockPopup` class to the factory and export it as `Popup`:

```ts
  class MockPopup {
    static last: MockPopup | null = null;
    content: HTMLElement | null = null;
    constructor() {
      MockPopup.last = this;
    }
    setLngLat() {
      return this;
    }
    setDOMContent(el: HTMLElement) {
      this.content = el;
      return this;
    }
    addTo() {
      document.body.appendChild(this.content!);
      return this;
    }
    remove() {
      this.content?.remove();
    }
  }
  // default export becomes { Map: MockMap, Marker: MockMarker, Popup: MockPopup, addProtocol: vi.fn() }
```

**Important:** the existing `addSource` stored `{ setData }` — the rings assertions read `sources.get("mc-rings")!.setData`; keep that shape (`{ options, setData }` is a superset, existing tests keep passing).

New tests to append (the `renderCanvas` helper gains the new optional props with defaults `beats: null`, `highlightBeats: []`, `incidentPoints: null`, `onViewportChange: noop`):

```tsx
const BEATS_FC = {
  type: "FeatureCollection" as const,
  features: [
    { type: "Feature" as const, properties: { beat: "M3" }, geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  ],
};

const POINTS_FC = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { id: "inc-1", offense_category: "PROPERTY", offense_subcategory: "THEFT", occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST" },
      geometry: { type: "Point" as const, coordinates: [-122.33, 47.61] },
    },
  ],
};

describe("beat + incident layers", () => {
  it("feeds beat polygons into the mc-beats source and highlights analyzed beats", async () => {
    renderCanvas({ beats: BEATS_FC, highlightBeats: ["M3"] });
    await waitFor(() => {
      const source = MockedMap.last!.sources.get("mc-beats");
      expect(source!.setData).toHaveBeenCalledWith(BEATS_FC);
    });
    const highlight = MockedMap.last!.layers.find((l) => l.id === "mc-beat-highlight");
    expect(highlight?.filter).toEqual(["in", ["get", "beat"], ["literal", ["M3"]]]);
  });

  it("creates the incident source clustered and feeds it points", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => {
      const source = MockedMap.last!.sources.get("mc-incidents");
      expect(source!.options).toMatchObject({ cluster: true, clusterMaxZoom: 13 });
      expect(source!.setData).toHaveBeenCalledWith(POINTS_FC);
    });
  });

  it("opens an XSS-safe popup card on dot click", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    MockedMap.last!.fireLayerClick("mc-incident-dot", {
      properties: { id: "inc-1", offense_subcategory: '<img src=x onerror="a">', offense_category: "PROPERTY", occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST" },
    });
    const card = document.body.querySelector(".mc-incident-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('<img src=x onerror="a">'); // rendered as TEXT
    expect(card!.querySelector("img")).toBeNull(); // never parsed as HTML
    expect(card!.textContent).toContain("1XX BLOCK OF PINE ST");
  });

  it("emits viewport bounds on moveend and once after load", async () => {
    const onViewportChange = vi.fn();
    renderCanvas({ onViewportChange });
    await waitFor(() => expect(onViewportChange).toHaveBeenCalled());
    onViewportChange.mockClear();
    MockedMap.last!.fireMoveEnd();
    expect(onViewportChange).toHaveBeenCalledWith({ west: -122.4, south: 47.55, east: -122.25, north: 47.65 });
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/components/MapCanvas.test.tsx`
Expected: existing tests pass; new tests FAIL (no such props/sources).

- [ ] **Step 3: Implement in `MapCanvas.tsx`**

New imports: `IncidentFeatureCollection` from `../lib/useIncidentPoints`, `BeatFeatureCollection`, `MapBounds` from `../types`.

New constants + layer builders (place after `addRingLayers`):

```tsx
const BEATS_SOURCE = "mc-beats";
const INCIDENTS_SOURCE = "mc-incidents";
const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;
const CLUSTER_MAX_ZOOM = 13; // clusters below, individual dots at z14+ (spec: initial threshold)

function addBeatLayers(map: maplibregl.Map): void {
  map.addSource(BEATS_SOURCE, { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "mc-beat-highlight",
    type: "fill",
    source: BEATS_SOURCE,
    filter: ["in", ["get", "beat"], ["literal", []]],
    paint: { "fill-color": "#74858E", "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: "mc-beat-line",
    type: "line",
    source: BEATS_SOURCE,
    paint: { "line-color": "#74858E", "line-width": 1, "line-opacity": 0.5 },
  });
  map.addLayer({
    id: "mc-beat-label",
    type: "symbol",
    source: BEATS_SOURCE,
    minzoom: 12,
    layout: {
      "text-field": ["get", "beat"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
    },
    paint: { "text-color": "#74858E", "text-opacity": 0.75, "text-halo-color": "#FFFFFF", "text-halo-width": 1 },
  });
}

function addIncidentLayers(map: maplibregl.Map): void {
  map.addSource(INCIDENTS_SOURCE, {
    type: "geojson",
    data: EMPTY_FC,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 40,
  });
  // One calm neutral for clusters and dots — never severity colors (product invariant).
  map.addLayer({
    id: "mc-incident-cluster",
    type: "circle",
    source: INCIDENTS_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0.85,
      "circle-radius": ["step", ["get", "point_count"], 12, 25, 16, 100, 22],
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "mc-incident-cluster-count",
    type: "symbol",
    source: INCIDENTS_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
    },
    paint: { "text-color": "#FFFFFF" },
  });
  map.addLayer({
    id: "mc-incident-dot",
    type: "circle",
    source: INCIDENTS_SOURCE,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0.85,
      "circle-radius": 4.5,
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 1,
    },
  });
}

function incidentCardElement(props: Record<string, unknown>): HTMLElement {
  // textContent only — properties come from SPD strings; never parse them as HTML.
  const card = document.createElement("div");
  card.className = "mc-incident-card";
  const title = document.createElement("strong");
  title.textContent = String(props.offense_subcategory ?? props.offense_category ?? "Incident");
  const when = document.createElement("div");
  when.textContent = props.occurred_at ? String(props.occurred_at).slice(0, 10) : "date not recorded";
  const where = document.createElement("div");
  where.textContent = String(props.block_address ?? "");
  card.append(title, when, where);
  return card;
}
```

Props additions (to `Props` and the destructuring):

```tsx
  beats: BeatFeatureCollection | null;
  highlightBeats: string[];
  incidentPoints: IncidentFeatureCollection | null;
  onViewportChange?: (bounds: MapBounds) => void;
```

Inside the component:

```tsx
  const onViewportChangeRef = useRef(onViewportChange);
  // (add onViewportChangeRef.current = onViewportChange to the existing useLayoutEffect)

  // In the init effect's load path, replace `addRingLayers(map);` with:
  //   addBeatLayers(map);
  //   addRingLayers(map);
  //   addIncidentLayers(map);
  // and register (after map construction, next to the existing map.on("click")):
  //   const emitViewport = () => {
  //     const b = map.getBounds();
  //     onViewportChangeRef.current?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
  //   };
  //   map.on("moveend", emitViewport);
  //   map.on("load", emitViewport);
  //   map.on("click", "mc-incident-dot", (event) => {
  //     const feature = event.features?.[0];
  //     if (!feature) return;
  //     new maplibregl.Popup({ offset: 10 })
  //       .setLngLat(event.lngLat)
  //       .setDOMContent(incidentCardElement(feature.properties ?? {}))
  //       .addTo(map);
  //   });
  //   map.on("click", "mc-incident-cluster", (event) => {
  //     const feature = event.features?.[0];
  //     const clusterId = feature?.properties?.cluster_id;
  //     const source = map.getSource(INCIDENTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
  //     if (clusterId === undefined || !source) return;
  //     source.getClusterExpansionZoom(clusterId).then((zoom) => {
  //       map.easeTo({ center: (feature!.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  //     });
  //   });
  //   for (const hoverable of ["mc-incident-dot", "mc-incident-cluster"]) {
  //     map.on("mouseenter", hoverable, () => { map.getCanvas().style.cursor = "pointer"; });
  //     map.on("mouseleave", hoverable, () => { map.getCanvas().style.cursor = ""; });
  //   }

  // New data effects (mirror the rings effect at lines 262-267):
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !beats) return;
    (map.getSource(BEATS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(beats);
  }, [beats, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setFilter("mc-beat-highlight", ["in", ["get", "beat"], ["literal", highlightBeats]]);
  }, [highlightBeats, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource(INCIDENTS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      incidentPoints ?? EMPTY_FC,
    );
  }, [incidentPoints, mapReady]);
```

(`getClusterExpansionZoom` returns a Promise in maplibre-gl v5. If tsc disagrees, check the installed signature in `node_modules/maplibre-gl/dist/maplibre-gl.d.ts` and use the callback form if that's what v5.24 ships.)

CSS (append to `mapWorkspace.css` near `.mc-map-fallback`):

```css
.mc-incident-card{font-family:var(--f-ui);font-size:12.5px;color:#1B1E22;min-width:180px;display:grid;gap:2px;}
.mc-incident-card strong{font-size:13px;}
.maplibregl-popup-content{border-radius:10px;box-shadow:0 10px 26px -12px rgba(0,0,0,.4);padding:10px 12px;}
```

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npm test && npm run lint`
Expected: all pass, including the untouched marker/ring/fallback tests. MapWorkspace.test.tsx mocks `./MapCanvas`, so its suite is unaffected by the new required props until Task 9 wires them (the mock component ignores unknown props).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapCanvas.tsx frontend/src/components/MapCanvas.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(map): beat outlines + clustered incident dots with click card and viewport emit"
```

---

### Task 9: Disclosure chip + MapWorkspace wiring + legend

**Files:**
- Create: `frontend/src/components/IncidentDisclosure.tsx`
- Test: `frontend/src/components/IncidentDisclosure.test.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx`, `frontend/src/components/MapLegend.tsx`, `frontend/src/styles/mapWorkspace.css`, `frontend/src/components/MapWorkspace.test.tsx` (only if the new wiring changes observable behavior)

- [ ] **Step 1: Write the failing chip tests**

```tsx
// frontend/src/components/IncidentDisclosure.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IncidentDisclosure } from "./IncidentDisclosure";

afterEach(cleanup);

describe("IncidentDisclosure", () => {
  it("renders nothing before the first fetch", () => {
    render(<IncidentDisclosure returnedCount={0} totalCount={0} unmappableCount={0} limit={0} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows shown + redacted counts", () => {
    render(<IncidentDisclosure returnedCount={42} totalCount={42} unmappableCount={6} limit={5000} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("42 incidents shown");
    expect(chip).toHaveTextContent("+6 with redacted location — in beat stats only");
  });

  it("discloses truncation when the cap bites", () => {
    render(<IncidentDisclosure returnedCount={5000} totalCount={12340} unmappableCount={0} limit={5000} />);
    expect(screen.getByRole("status")).toHaveTextContent("most recent 5,000 of 12,340 shown");
  });

  it("omits the redaction clause when nothing was redacted", () => {
    render(<IncidentDisclosure returnedCount={10} totalCount={10} unmappableCount={0} limit={5000} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("redacted");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/IncidentDisclosure.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the chip**

```tsx
// frontend/src/components/IncidentDisclosure.tsx
type Props = {
  returnedCount: number;
  totalCount: number;
  unmappableCount: number;
  limit: number;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function IncidentDisclosure({ returnedCount, totalCount, unmappableCount, limit }: Props) {
  if (limit === 0) {
    return null; // nothing fetched yet
  }
  const truncated = totalCount > returnedCount;
  return (
    <div className="mc-disclosure" role="status">
      <strong>
        {truncated
          ? `most recent ${fmt(returnedCount)} of ${fmt(totalCount)} shown`
          : `${fmt(returnedCount)} incidents shown`}
      </strong>
      {unmappableCount > 0 ? (
        <span> · +{fmt(unmappableCount)} with redacted location — in beat stats only</span>
      ) : null}
    </div>
  );
}
```

CSS (append; and change the existing `.mc-map-fallback` rule's `bottom:18px` to `bottom:58px` per deviation #3):

```css
.mc-disclosure{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:34;
  padding:7px 13px;border-radius:9px;background:rgba(255,255,255,0.92);color:#1B1E22;
  font-size:12px;box-shadow:0 8px 20px -10px rgba(0,0,0,.35);white-space:nowrap;}
.mc-disclosure strong{font-weight:600;}
```

- [ ] **Step 4: Wire MapWorkspace**

In `frontend/src/components/MapWorkspace.tsx`:

```tsx
// imports
import { getBeatPolygons } from "../api/client";
import { useIncidentPoints } from "../lib/useIncidentPoints";
import { IncidentDisclosure } from "./IncidentDisclosure";
import type { BeatFeatureCollection, MapBounds } from "../types";

// state (near the analysis state, ~line 46)
const [beats, setBeats] = useState<BeatFeatureCollection | null>(null);
const [viewport, setViewport] = useState<MapBounds | null>(null);

useEffect(() => {
  getBeatPolygons().then(setBeats).catch(() => setBeats(null)); // outline layer is optional chrome
}, []);

const incidentLayer = useIncidentPoints({ bounds: viewport, analysis });

// analyzed-beat highlight from the neighborhood payload (survey C9/B9: neighborhood.places[].beat)
const highlightBeats = useMemo(
  () =>
    (analyze.neighborhood?.places ?? [])
      .map((place) => place.beat)
      .filter((beat): beat is string => Boolean(beat)),
  [analyze.neighborhood],
);
```

Pass to `<MapCanvas ... />` (at ~line 298-308): `beats={beats}`, `highlightBeats={highlightBeats}`, `incidentPoints={incidentLayer.geojson}`, `onViewportChange={setViewport}`.

Render the chip next to `<MapLegend />` (~line 343):

```tsx
<IncidentDisclosure
  returnedCount={incidentLayer.returnedCount}
  totalCount={incidentLayer.totalCount}
  unmappableCount={incidentLayer.unmappableCount}
  limit={incidentLayer.limit}
/>
```

**Check the real name of the neighborhood state**: the survey says `useAnalyze` exposes `neighborhood` (`useAnalyze.ts:38,72-73`) and MapWorkspace instantiates it as `const analyze = useAnalyze(...)` at ~line 95. Read those lines and use the actual accessor; if the hook doesn't expose `neighborhood` publicly, add it to the hook's return object (one line).

In `frontend/src/components/MapLegend.tsx`, add two rows after the existing four (match the `.mc-leg-row` markup exactly — read the file first):

- "Reported incident" — a small `#3A3F46` disc
- "Incident cluster (count)" — a larger `#3A3F46` disc with a white number

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test && npm run lint`
Expected: all pass. If `MapWorkspace.test.tsx` fails because the component now calls `getBeatPolygons`/`getIncidentPoints` on mount — the mocks from Task 6 already resolve them; if a test asserts exact fetch-call counts, update it consciously (state why in the commit body).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/IncidentDisclosure.tsx frontend/src/components/IncidentDisclosure.test.tsx frontend/src/components/MapWorkspace.tsx frontend/src/components/MapLegend.tsx frontend/src/styles/mapWorkspace.css frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(map): disclosure chip, beat/incident wiring, legend entries"
```

---

### Task 10: Full gate + live verification + docs

- [ ] **Step 1: Full verification gate**

Run: `make test-all`
Expected: all green.

- [ ] **Step 2: Live verification** (backend `uvicorn` from this worktree — tiles/basemap assets are symlinked; seed with `make seed-crime`; **set the analyze date range to 2025-01-01 → 2025-10-31** — the seed data ends 2025-10-27, the default 2026 window is legitimately empty)

1. Beat outlines render citywide; zoom to ≥12 → beat code labels appear, subtle.
2. Incident dots: zoomed out → neutral graphite clusters with counts; zoom past 14 → individual dots; click a dot → card with subcategory/date/block address; click a cluster → zooms in.
3. Pan/zoom → network shows debounced POSTs to `/dashboard/incident-points` (one per settle, not per frame); switching the topbar layer toggle refetches.
4. Run an analysis → the analyzed place's beat gets the soft fill highlight; the disclosure chip shows "N incidents shown" and, with the calls layer active (24% redaction), a nonzero "+K with redacted location".
5. Invariant eyeball: everything on the map is one neutral color family; no red/amber anywhere; chip copy says *incidents shown*, never safety language.
6. `GET /dashboard/beats` responds with `Content-Encoding: gzip` when requested with `Accept-Encoding: gzip` (curl -H check) and ~an order smaller than the 428KB raw file.

- [ ] **Step 3: Spec + roadmap updates**

- `docs/superpowers/specs/2026-07-04-map-ui-overhaul-design.md`: amend the Slice 2 bullet — properties slim to `{beat}` only (the 2018 file carries no precinct/sector); beat labels are static-at-zoom≥12 rather than hover-only.
- `docs/ROADMAP.md`: tick the Phase 6 Slice 2 box with a one-line summary of what shipped.

- [ ] **Step 4: Fix anything found, re-run `make test-all`, commit**

```bash
git add -A && git commit -m "feat(map): transparency layers — live-verification fixes + docs"
```

---

## Self-review checklist

- Spec coverage: beats endpoint (T1-2 ✓ gzip+cache+gating), incident-points endpoint (T3-5 ✓ bbox required + Seattle-validated, 5,000 named-constant cap, sentinel excluded structurally + pinned by test, `unmappable_citywide_count`), beat outlines + hover→static labels + analyzed-beat highlight (T8-9 ✓, deviation recorded), clusters→dots at z14 (T8 ✓ `CLUSTER_MAX_ZOOM = 13`), click card (T8 ✓ XSS-safe DOM), layer/date/category-following fetch (T7/T9 ✓ via `analysis`), debounce+abort (T7 ✓), disclosure chip (T9 ✓ incl. truncation honesty beyond spec), no heatmap / one neutral color (T8 ✓), tier guard (T2/T5 ✓), no migrations ✓.
- Placeholder scan: none — every step has full code; the two "check the real name/signature" notes are verification instructions with fallbacks, not gaps.
- Type consistency: `MapBounds` (py + ts same field names), `IncidentFeatureCollection` produced by T7 = consumed by T8, `incident_points` service signature = T5 route call, mock `addSource(id, options)` shape = T8 assertions, chip props = T9 wiring.
