# OpenTripPlanner Provider + Analysis Query Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenTripPlanner routing provider behind the existing interface (mock stays default; no live OTP yet) and replace three full-table `CrimeIncident` loads on the analysis/route paths with SQL bounding-box + date + offense prefilters.

**Architecture:** Part C adds a shared `incident_query_service` (bbox + SQL loader) and rewires three call sites to feed the **unchanged** `exposure.py`/`context.py` filters a narrowed candidate set — identical results, fewer rows. Part B1 adds `OpenTripPlannerProvider` (OTP REST `/plan`, mockable `httpx` transport), a factory branch, config, and config-default-with-request-override selection.

**Tech Stack:** Python, FastAPI, SQLAlchemy, pytest, ruff, httpx.

**Spec:** `docs/superpowers/specs/2026-06-26-routing-provider-and-query-perf-design.md`
**Worktree/branch:** `.worktrees/routing-provider-perf` on `claude/routing-provider-perf`. Run commands from the worktree root.

---

## File Structure

- Create `app/services/incident_query_service.py` — `BoundingBox`, `bounding_box_for_points`, `incidents_in_bbox` (SQL). (C)
- Modify `app/services/analysis_service.py` — `compare_site_options`, `compare_route_request` use the bbox loader. (C)
- Modify `app/services/route_service.py` — route-context load uses the bbox loader; drop the now-dead `_incident_data`. (C)
- Modify `app/config.py` — routing settings. (B1)
- Create `app/routing/opentripplanner_provider.py` — provider + polyline decoder. (B1)
- Modify `app/routing/providers.py` — `RoutingProviderError`, `opentripplanner` factory branch. (B1)
- Modify `app/routing/schemas.py` — `RouteRequestCreate.provider` default `None`. (B1)
- Modify `app/api/routes_routes.py` — map `RoutingProviderError` → 502. (B1)
- Tests: `tests/test_incident_query_service.py`, `tests/test_opentripplanner_provider.py`, additions to `tests/test_mock_routing_provider.py`, edits to `tests/test_route_alternatives_api.py`.

---

## Task 0: Workspace setup

- [ ] **Step 1: Symlink the venv and node_modules, exclude them locally**

```bash
cd .worktrees/routing-provider-perf
ln -sfn "/Users/jscocca/Repos/Crime Commute Safety Tool/.venv" .venv
ln -sfn "/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/node_modules" frontend/node_modules
printf '%s\n' '.venv' 'frontend/node_modules' >> "$(git rev-parse --git-path info/exclude)"
```

- [ ] **Step 2: Confirm the suite is green before changes**

Run: `.venv/bin/python -m pytest tests/test_statistical_comparison_service.py tests/test_route_alternatives_api.py tests/test_mock_routing_provider.py -q`
Expected: PASS.

---

## Task 1: incident_query_service (bbox + SQL loader)

**Files:**
- Create: `app/services/incident_query_service.py`
- Test: `tests/test_incident_query_service.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_incident_query_service.py`:

```python
from __future__ import annotations

from datetime import UTC, date, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.services.incident_query_service import (
    BoundingBox,
    bounding_box_for_points,
    incidents_in_bbox,
)


def test_bounding_box_pads_extent_by_radius():
    box = bounding_box_for_points([(47.61, -122.33)], radius_m=1000)
    assert box.min_lat < 47.61 < box.max_lat
    assert box.min_lon < -122.33 < box.max_lon
    # ~1 km is ~0.009 deg latitude; padding must be in that ballpark, not zero or huge.
    assert 0.005 < (box.max_lat - 47.61) < 0.02


def test_bounding_box_spans_multiple_points():
    box = bounding_box_for_points([(47.60, -122.34), (47.62, -122.30)], radius_m=250)
    assert box.min_lat < 47.60 and box.max_lat > 47.62
    assert box.min_lon < -122.34 and box.max_lon > -122.30


def _seed(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'q.sqlite3'}")
    session = get_sessionmaker()()
    rows = [
        ("in-box-in-date", 47.610, -122.330, datetime(2026, 3, 1, tzinfo=UTC), "PROPERTY"),
        ("out-of-box", 47.900, -122.000, datetime(2026, 3, 1, tzinfo=UTC), "PROPERTY"),
        ("in-box-out-date", 47.611, -122.331, datetime(2025, 1, 1, tzinfo=UTC), "PROPERTY"),
        ("in-box-other-offense", 47.609, -122.329, datetime(2026, 3, 1, tzinfo=UTC), "PERSON"),
    ]
    for incident_id, lat, lon, observed, category in rows:
        session.add(
            CrimeIncident(
                id=incident_id, offense_start_utc=observed, offense_category=category,
                beat="X1", latitude=lat, longitude=lon,
            )
        )
    session.commit()
    return session


def test_incidents_in_bbox_filters_box_and_date(tmp_path):
    session = _seed(tmp_path)
    box = bounding_box_for_points([(47.610, -122.330)], radius_m=500)
    found = incidents_in_bbox(
        session, box=box,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
    )
    ids = {incident.id for incident in found}
    assert "in-box-in-date" in ids
    assert "in-box-other-offense" in ids
    assert "out-of-box" not in ids
    assert "in-box-out-date" not in ids


def test_incidents_in_bbox_applies_offense_filter(tmp_path):
    session = _seed(tmp_path)
    box = bounding_box_for_points([(47.610, -122.330)], radius_m=500)
    found = incidents_in_bbox(
        session, box=box,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category="PERSON",
    )
    assert {incident.id for incident in found} == {"in-box-other-offense"}
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_incident_query_service.py -q`
Expected: FAIL (`ModuleNotFoundError: app.services.incident_query_service`).

- [ ] **Step 3: Implement the module**

Create `app/services/incident_query_service.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from math import cos, radians

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CrimeIncident
from app.schemas import CrimeIncidentData
from app.services.crime_service import _incident_data

METERS_PER_LATITUDE_DEGREE = 111_320
MIN_LONGITUDE_COSINE = 0.01


@dataclass(frozen=True)
class BoundingBox:
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


def bounding_box_for_points(points: list[tuple[float, float]], radius_m: int) -> BoundingBox:
    if not points:
        raise ValueError("at least one point is required for a bounding box")
    lats = [lat for lat, _ in points]
    lons = [lon for _, lon in points]
    mean_lat = sum(lats) / len(lats)
    lat_pad = radius_m / METERS_PER_LATITUDE_DEGREE
    lon_scale = max(abs(cos(radians(mean_lat))), MIN_LONGITUDE_COSINE)
    lon_pad = radius_m / (METERS_PER_LATITUDE_DEGREE * lon_scale)
    return BoundingBox(
        min_lat=min(lats) - lat_pad,
        max_lat=max(lats) + lat_pad,
        min_lon=min(lons) - lon_pad,
        max_lon=max(lons) + lon_pad,
    )


def incidents_in_bbox(
    session: Session,
    *,
    box: BoundingBox,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
) -> list[CrimeIncidentData]:
    start_at = datetime.combine(analysis_start_date, time.min, tzinfo=UTC)
    end_at = datetime.combine(analysis_end_date, time.max, tzinfo=UTC)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.latitude.is_not(None))
        .where(CrimeIncident.longitude.is_not(None))
        .where(CrimeIncident.latitude >= box.min_lat)
        .where(CrimeIncident.latitude <= box.max_lat)
        .where(CrimeIncident.longitude >= box.min_lon)
        .where(CrimeIncident.longitude <= box.max_lon)
        .where(observed >= start_at)
        .where(observed <= end_at)
    )
    if offense_category is not None:
        stmt = stmt.where(CrimeIncident.offense_category == offense_category)
    if offense_subcategory is not None:
        stmt = stmt.where(CrimeIncident.offense_subcategory == offense_subcategory)
    if nibrs_group is not None:
        stmt = stmt.where(CrimeIncident.nibrs_group == nibrs_group)
    return [_incident_data(row) for row in session.scalars(stmt).all()]
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_incident_query_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/incident_query_service.py tests/test_incident_query_service.py
git commit -m "feat: add bounding-box incident query helper"
```

---

## Task 2: Rewire analysis_service to the bbox loader

**Files:**
- Modify: `app/services/analysis_service.py`
- Test: `tests/test_statistical_comparison_service.py` (existing suite is the parity guard) + `tests/test_incident_query_perf.py` (new exclusion proof)

- [ ] **Step 1: Write a failing exclusion test**

Create `tests/test_incident_query_perf.py`:

```python
from __future__ import annotations

from datetime import UTC, date, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.services.analysis_service import compare_site_options


def _app_session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'perf.sqlite3'}")
    return get_sessionmaker()()


def test_compare_site_options_counts_only_in_radius_incidents(tmp_path):
    session = _app_session(tmp_path)
    # One incident ~50 m from site A (counts), one ~30 km away (excluded by bbox).
    session.add_all([
        CrimeIncident(id="near", offense_start_utc=datetime(2026, 3, 1, tzinfo=UTC),
                      offense_category="PROPERTY", beat="X1",
                      latitude=47.6105, longitude=-122.3300),
        CrimeIncident(id="far", offense_start_utc=datetime(2026, 3, 1, tzinfo=UTC),
                      offense_category="PROPERTY", beat="X9",
                      latitude=47.9000, longitude=-122.0000),
    ])
    session.commit()
    payload = compare_site_options(
        session=session, user_id_hash="u",
        options=[
            {"id": "a", "label": "A", "latitude": 47.6100, "longitude": -122.3300, "radius_m": 250},
            {"id": "b", "label": "B", "latitude": 47.6150, "longitude": -122.3300, "radius_m": 250},
        ],
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
    )
    counts = {o["id"]: o["incident_count"] for o in payload["overview"]["options"]}
    assert counts["a"] == 1  # only the near incident
    assert counts["b"] == 0
```

- [ ] **Step 2: Run to verify it passes already OR fails on the import**

Run: `.venv/bin/python -m pytest tests/test_incident_query_perf.py -q`
Expected: PASS (the current full-load implementation already yields these counts). This test pins behavior that Step 3 must preserve.

- [ ] **Step 3: Rewire `compare_site_options`**

In `app/services/analysis_service.py`, add imports near the existing exposure import:

```python
from app.analysis.exposure import parse_route_geometry
from app.services.incident_query_service import bounding_box_for_points, incidents_in_bbox
```

Replace the start of `compare_site_options` (the `incidents = _incident_rows(session)` line and the `radius_m = site_options[0].radius_m` line) so the radius and box are computed before loading:

```python
    radius_m = site_options[0].radius_m
    box = bounding_box_for_points(
        [(option.latitude, option.longitude) for option in site_options], radius_m
    )
    incidents = incidents_in_bbox(
        session,
        box=box,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
    )
```

(Delete the old `incidents = _incident_rows(session)` and the later duplicate `radius_m = site_options[0].radius_m`.)

- [ ] **Step 4: Rewire `compare_route_request`**

Replace `incidents = _incident_rows(session)` in `compare_route_request` with:

```python
    route_points = [
        point
        for alternative in alternatives
        for point in parse_route_geometry(alternative.summary_geometry)
    ]
    if route_points:
        incidents = incidents_in_bbox(
            session,
            box=bounding_box_for_points(route_points, request.radius_m),
            analysis_start_date=route_request.analysis_start_date,
            analysis_end_date=route_request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    else:
        incidents = []
```

- [ ] **Step 5: Run perf + existing comparison suites (parity)**

Run: `.venv/bin/python -m pytest tests/test_incident_query_perf.py tests/test_statistical_comparison_service.py tests/test_statistical_comparison_api.py tests/test_statistical_comparison_exports.py -q`
Expected: PASS (results unchanged; `_incident_rows` no longer used by these two functions — it may remain for now, ruff will flag it only if it becomes entirely unused; it does, so delete it in the next step).

- [ ] **Step 6: Remove the now-unused `_incident_rows`**

Delete the `_incident_rows` function at the bottom of `app/services/analysis_service.py` (the two callers are gone). Keep `_incident_data` (still used by `_incident_rows`? no — confirm with `grep -n "_incident_rows\|_incident_data" app/services/analysis_service.py`; if `_incident_data` is now unused here too, delete it as well).

Run: `.venv/bin/python -m pytest tests/test_statistical_comparison_service.py -q && .venv/bin/python -m ruff check app/services/analysis_service.py`
Expected: PASS + ruff clean.

- [ ] **Step 7: Commit**

```bash
git add app/services/analysis_service.py tests/test_incident_query_perf.py
git commit -m "perf: filter site/route comparison incidents in sql"
```

---

## Task 3: Rewire route_service route-context load

**Files:**
- Modify: `app/services/route_service.py`
- Test: `tests/test_route_alternatives_api.py` (existing context-summary tests are the parity guard)

- [ ] **Step 1: Confirm the context-summary tests pass pre-change**

Run: `.venv/bin/python -m pytest tests/test_route_alternatives_api.py -q`
Expected: PASS.

- [ ] **Step 2: Replace the full-table context load**

In `app/services/route_service.py`, add the import:

```python
from app.services.incident_query_service import bounding_box_for_points, incidents_in_bbox
```

Replace line ~130 (`incidents = [_incident_data(row) for row in session.scalars(select(CrimeIncident)).all()]`) with:

```python
        context_points = [
            coord
            for alternative in route_alternatives
            for segment in alternative.segments
            for coord in (
                (segment.start_latitude, segment.start_longitude),
                (segment.end_latitude, segment.end_longitude),
            )
        ]
        if context_points:
            incidents = incidents_in_bbox(
                session,
                box=bounding_box_for_points(context_points, max(request_payload.radii_m)),
                analysis_start_date=route_request.analysis_start_date,
                analysis_end_date=route_request.analysis_end_date,
            )
        else:
            incidents = []
```

- [ ] **Step 3: Remove now-dead code**

`route_service._incident_data` and its `CrimeIncident` import are now unused here. Confirm and remove:

Run: `grep -rn "route_service import _incident_data\|route_service._incident_data" app tests` (expected: no hits).
Then delete the `_incident_data` function (lines ~402–423) and remove `CrimeIncident` from the `app.models` import (keep `RouteAlternative, RouteContextSummary, RouteRequest, RouteSegment`). Leave `select` (still used for RouteAlternative/RouteSegment queries).

- [ ] **Step 4: Run route + full backend suites**

Run: `.venv/bin/python -m pytest tests/test_route_alternatives_api.py tests/test_route_context.py -q && .venv/bin/python -m ruff check app/services/route_service.py`
Expected: PASS + ruff clean.

- [ ] **Step 5: Commit**

```bash
git add app/services/route_service.py
git commit -m "perf: filter route-context incidents in sql"
```

---

## Task 4: Routing config settings

**Files:**
- Modify: `app/config.py`
- Test: `tests/test_config_routing.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_routing.py`:

```python
from app.config import Settings


def test_routing_defaults_to_mock():
    settings = Settings()
    assert settings.routing_provider == "mock"
    assert settings.opentripplanner_base_url == ""
    assert settings.opentripplanner_timeout_s == 10.0


def test_routing_settings_read_env(monkeypatch):
    monkeypatch.setenv("MCA_ROUTING_PROVIDER", "opentripplanner")
    monkeypatch.setenv("MCA_OPENTRIPPLANNER_BASE_URL", "http://otp:8080/otp/routers/default")
    settings = Settings()
    assert settings.routing_provider == "opentripplanner"
    assert settings.opentripplanner_base_url == "http://otp:8080/otp/routers/default"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_config_routing.py -q`
Expected: FAIL (`AttributeError: routing_provider`).

- [ ] **Step 3: Add the settings**

In `app/config.py`, add to `Settings` (after the geocoder block):

```python
    routing_provider: str = "mock"
    opentripplanner_base_url: str = ""
    opentripplanner_timeout_s: float = 10.0
```

- [ ] **Step 4: Run + commit**

Run: `.venv/bin/python -m pytest tests/test_config_routing.py -q`
Expected: PASS.

```bash
git add app/config.py tests/test_config_routing.py
git commit -m "feat: add routing provider settings"
```

---

## Task 5: OpenTripPlanner provider + polyline decoder

**Files:**
- Modify: `app/routing/providers.py` (add `RoutingProviderError`)
- Create: `app/routing/opentripplanner_provider.py`
- Test: `tests/test_opentripplanner_provider.py`

- [ ] **Step 1: Add `RoutingProviderError`**

In `app/routing/providers.py`, add below `UnsupportedRoutingProviderError`:

```python
class RoutingProviderError(RuntimeError):
    """A routing provider was reachable-in-principle but failed at request time."""
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_opentripplanner_provider.py`:

```python
from __future__ import annotations

import httpx
import pytest

from app.routing.opentripplanner_provider import OpenTripPlannerProvider, _polyline_to_geometry
from app.routing.providers import RoutingProviderError
from app.routing.schemas import RouteLocation, RouteRequestData

_SAMPLE_PLAN = {
    "plan": {
        "itineraries": [
            {
                "duration": 840, "walkDistance": 450.0, "transfers": 0,
                "legs": [
                    {"mode": "WALK", "distance": 250.0, "duration": 240, "transitLeg": False,
                     "from": {"name": "Origin", "lat": 47.6190, "lon": -122.3210},
                     "to": {"name": "Westlake", "lat": 47.6115, "lon": -122.3370},
                     "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC_mqNvxq`@"}},
                    {"mode": "TRAM", "distance": 1650.0, "duration": 420, "transitLeg": True,
                     "from": {"name": "Westlake", "lat": 47.6115, "lon": -122.3370},
                     "to": {"name": "Downtown", "lat": 47.6097, "lon": -122.3331},
                     "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC"}},
                ],
            }
        ]
    }
}


def _provider(handler) -> OpenTripPlannerProvider:
    return OpenTripPlannerProvider(
        "http://otp.example/otp/routers/default",
        transport=httpx.MockTransport(handler),
    )


def _request() -> RouteRequestData:
    return RouteRequestData(
        user_id_hash="u",
        origin=RouteLocation(label="Capitol Hill", latitude=47.6190, longitude=-122.3210),
        destination=RouteLocation(label="Downtown", latitude=47.6097, longitude=-122.3331),
        mode="transit",
    )


def test_decode_polyline_round_trips_known_value():
    geometry = _polyline_to_geometry("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    points = [tuple(round(float(v), 3) for v in p.split(",")) for p in geometry.split(";")]
    assert points == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]


def test_get_routes_maps_itinerary_and_legs():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/plan")
        assert request.url.params["fromPlace"] == "47.619,-122.321"
        assert request.url.params["mode"] == "TRANSIT,WALK"
        return httpx.Response(200, json=_SAMPLE_PLAN)

    alternatives = _provider(handler).get_routes(_request())
    assert len(alternatives) == 1
    alt = alternatives[0]
    assert alt.provider == "opentripplanner"
    assert alt.rank == 1
    assert alt.duration_minutes == 14.0
    assert alt.distance_m == 1900.0
    assert alt.walking_distance_m == 450.0
    assert alt.mode_mix == "walk,tram"
    assert [s.segment_type for s in alt.segments] == ["access", "ride"]
    assert alt.segments[0].mode == "walk"
    assert alt.segments[0].geometry  # decoded "lat,lon;..."


def test_get_routes_wraps_transport_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())


def test_get_routes_wraps_bad_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": True})

    with pytest.raises(RoutingProviderError):
        _provider(handler).get_routes(_request())
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_opentripplanner_provider.py -q`
Expected: FAIL (module does not exist).

- [ ] **Step 4: Implement the provider**

Create `app/routing/opentripplanner_provider.py`:

```python
from __future__ import annotations

import json
from typing import Any

import httpx

from app.routing.providers import RoutingProviderError
from app.routing.schemas import RouteAlternativeData, RouteRequestData, RouteSegmentData

_OTP_MODE_BY_REQUEST_MODE = {
    "transit": "TRANSIT,WALK",
    "walk": "WALK",
    "bike": "BICYCLE",
    "drive": "CAR",
}


class OpenTripPlannerProvider:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._transport = transport

    def get_routes(self, request: RouteRequestData) -> list[RouteAlternativeData]:
        params: dict[str, Any] = {
            "fromPlace": f"{request.origin.latitude},{request.origin.longitude}",
            "toPlace": f"{request.destination.latitude},{request.destination.longitude}",
            "mode": _OTP_MODE_BY_REQUEST_MODE.get(request.mode, "TRANSIT,WALK"),
            "numItineraries": 3,
        }
        if request.departure_date is not None:
            params["date"] = request.departure_date.isoformat()
        if request.departure_time:
            params["time"] = request.departure_time
        try:
            with httpx.Client(timeout=self.timeout_s, transport=self._transport) as client:
                response = client.get(f"{self.base_url}/plan", params=params)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            raise RoutingProviderError(f"OpenTripPlanner request failed: {exc}") from exc
        try:
            itineraries = payload["plan"]["itineraries"]
            return [
                _itinerary_to_alternative(request, index, itinerary)
                for index, itinerary in enumerate(itineraries)
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise RoutingProviderError(
                f"OpenTripPlanner returned an unexpected response shape: {exc}"
            ) from exc


def _itinerary_to_alternative(
    request: RouteRequestData, index: int, itinerary: dict[str, Any]
) -> RouteAlternativeData:
    legs = itinerary.get("legs", [])
    modes: list[str] = []
    for leg in legs:
        mode = str(leg.get("mode", "")).lower()
        if mode and mode not in modes:
            modes.append(mode)
    total_distance = sum(float(leg.get("distance", 0.0)) for leg in legs)
    alternative = RouteAlternativeData(
        route_request_id=request.id,
        provider_route_id=f"otp-{index}",
        route_label=_alternative_label(request, legs),
        rank=index + 1,
        duration_minutes=_seconds_to_minutes(itinerary.get("duration")),
        distance_m=total_distance or None,
        transfer_count=int(itinerary.get("transfers", 0)),
        walking_distance_m=_optional_float(itinerary.get("walkDistance")),
        mode_mix=",".join(modes) or request.mode,
        summary_geometry=_summary_geometry(legs),
        provider="opentripplanner",
        provider_metadata_json=json.dumps({"otp_itinerary_index": index}),
    )
    leg_count = len(legs)
    alternative.segments = [
        _leg_to_segment(
            alternative.id, sequence, leg, is_first=sequence == 1, is_last=sequence == leg_count
        )
        for sequence, leg in enumerate(legs, start=1)
    ]
    return alternative


def _leg_to_segment(
    alternative_id: str, sequence: int, leg: dict[str, Any], *, is_first: bool, is_last: bool
) -> RouteSegmentData:
    if bool(leg.get("transitLeg")):
        segment_type = "ride"
    elif is_first:
        segment_type = "access"
    elif is_last:
        segment_type = "egress"
    else:
        segment_type = "walk"
    start = leg.get("from", {})
    end = leg.get("to", {})
    return RouteSegmentData(
        route_alternative_id=alternative_id,
        sequence=sequence,
        segment_type=segment_type,
        mode=str(leg.get("mode", "")).lower(),
        start_label=str(start.get("name", "")),
        start_latitude=float(start["lat"]),
        start_longitude=float(start["lon"]),
        end_label=str(end.get("name", "")),
        end_latitude=float(end["lat"]),
        end_longitude=float(end["lon"]),
        distance_m=_optional_float(leg.get("distance")),
        duration_minutes=_seconds_to_minutes(leg.get("duration")),
        geometry=_polyline_to_geometry((leg.get("legGeometry") or {}).get("points")),
    )


def _alternative_label(request: RouteRequestData, legs: list[dict[str, Any]]) -> str:
    for leg in legs:
        if leg.get("transitLeg") and leg.get("route"):
            return f"{leg['route']} via OpenTripPlanner"
    return f"{request.mode.capitalize()} route via OpenTripPlanner"


def _summary_geometry(legs: list[dict[str, Any]]) -> str | None:
    parts = [
        decoded
        for leg in legs
        if (decoded := _polyline_to_geometry((leg.get("legGeometry") or {}).get("points")))
    ]
    return ";".join(parts) or None


def _seconds_to_minutes(value: Any) -> float | None:
    if value is None:
        return None
    return float(value) / 60.0


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _polyline_to_geometry(encoded: str | None) -> str | None:
    if not encoded:
        return None
    return ";".join(f"{lat},{lon}" for lat, lon in _decode_polyline(encoded))


def _decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = latitude = longitude = 0
    length = len(encoded)
    while index < length:
        latitude_delta, index = _decode_value(encoded, index)
        longitude_delta, index = _decode_value(encoded, index)
        latitude += latitude_delta
        longitude += longitude_delta
        points.append((latitude / 1e5, longitude / 1e5))
    return points


def _decode_value(encoded: str, index: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = ord(encoded[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break
    delta = ~(result >> 1) if (result & 1) else (result >> 1)
    return delta, index
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_opentripplanner_provider.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routing/providers.py app/routing/opentripplanner_provider.py tests/test_opentripplanner_provider.py
git commit -m "feat: add opentripplanner routing provider"
```

---

## Task 6: Factory branch + provider selection + 502 mapping

**Files:**
- Modify: `app/routing/providers.py`, `app/routing/schemas.py`, `app/services/route_service.py`, `app/api/routes_routes.py`
- Test: `tests/test_mock_routing_provider.py`, `tests/test_route_alternatives_api.py`

- [ ] **Step 1: Write failing factory + selection + 502 tests**

Add to `tests/test_mock_routing_provider.py`:

```python
import pytest

from app.routing.opentripplanner_provider import OpenTripPlannerProvider
from app.routing.providers import UnsupportedRoutingProviderError


def test_factory_builds_opentripplanner_with_base_url():
    provider = get_routing_provider(
        "opentripplanner", opentripplanner_base_url="http://otp.example/otp/routers/default"
    )
    assert isinstance(provider, OpenTripPlannerProvider)


def test_factory_rejects_opentripplanner_without_base_url():
    with pytest.raises(UnsupportedRoutingProviderError):
        get_routing_provider("opentripplanner")
```

Add to `tests/test_route_alternatives_api.py`:

```python
def test_route_alternatives_maps_provider_error_to_502(tmp_path, monkeypatch):
    from app.routing.providers import RoutingProviderError

    class FailingProvider:
        def get_routes(self, request):
            raise RoutingProviderError("otp down")

    monkeypatch.setattr(
        "app.services.route_service.get_routing_provider",
        lambda provider_name, **_kwargs: FailingProvider(),
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    response = client.post(
        "/internal/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle", "mode": "transit"},
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )
    assert response.status_code == 502


def test_route_alternatives_uses_configured_default_provider(tmp_path, monkeypatch):
    from app.config import Settings
    from app.routing.mock_provider import MockRoutingProvider

    captured = {}

    def fake_factory(provider_name, *, opentripplanner_base_url=""):
        captured["provider_name"] = provider_name
        captured["base_url"] = opentripplanner_base_url
        return MockRoutingProvider()

    monkeypatch.setattr("app.services.route_service.get_routing_provider", fake_factory)
    monkeypatch.setattr(
        "app.services.route_service.get_settings",
        lambda: Settings(routing_provider="opentripplanner", opentripplanner_base_url="http://otp"),
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    response = client.post(
        "/internal/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle", "mode": "transit"},
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )
    assert response.status_code == 200
    assert captured["provider_name"] == "opentripplanner"
    assert captured["base_url"] == "http://otp"
    assert response.json()["request"]["provider"] == "opentripplanner"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_mock_routing_provider.py tests/test_route_alternatives_api.py::test_route_alternatives_maps_provider_error_to_502 tests/test_route_alternatives_api.py::test_route_alternatives_uses_configured_default_provider -q`
Expected: FAIL (factory has no `opentripplanner` branch; no kwarg; no 502 mapping).

- [ ] **Step 3: Add the factory branch**

Replace `get_routing_provider` in `app/routing/providers.py`:

```python
def get_routing_provider(
    provider_name: str, *, opentripplanner_base_url: str = ""
) -> RoutingProvider:
    if provider_name == "mock":
        return MockRoutingProvider()
    if provider_name == "opentripplanner":
        if not opentripplanner_base_url:
            raise UnsupportedRoutingProviderError(
                "OpenTripPlanner base URL is not configured."
            )
        from app.routing.opentripplanner_provider import OpenTripPlannerProvider

        return OpenTripPlannerProvider(opentripplanner_base_url)
    raise UnsupportedRoutingProviderError(f"Unsupported routing provider: {provider_name}")
```

(The local import avoids a providers ↔ opentripplanner_provider import cycle.)

- [ ] **Step 4: Default the request provider to None**

In `app/routing/schemas.py`, change `RouteRequestCreate.provider`:

```python
    provider: str | None = None
```

- [ ] **Step 5: Resolve the provider in the service**

In `app/services/route_service.py`, add `from app.config import get_settings`, then in `create_route_alternatives` replace `routing_provider = get_routing_provider(request_payload.provider)` with:

```python
    settings = get_settings()
    provider_name = request_payload.provider or settings.routing_provider
    routing_provider = get_routing_provider(
        provider_name, opentripplanner_base_url=settings.opentripplanner_base_url
    )
```

Then replace the two later uses of `request_payload.provider` (the `RouteRequest(... provider=...)` field and the `RouteRequestData(... provider=...)` field) with `provider=provider_name`.

- [ ] **Step 6: Fix the existing monkeypatch + map 502 in the endpoint**

In `tests/test_route_alternatives_api.py`, update the bad-geometry monkeypatch lambda so it tolerates the new kwarg:

```python
    monkeypatch.setattr(
        "app.services.route_service.get_routing_provider",
        lambda provider_name, **_kwargs: BadGeometryProvider(),
    )
```

In `app/api/routes_routes.py`, import `RoutingProviderError` and add a handler:

```python
from app.routing.providers import RoutingProviderError, UnsupportedRoutingProviderError
```

```python
    try:
        return create_route_alternatives(session, request, user_id_hash)
    except (UnknownRoutePlaceError, UnsupportedRoutingProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RoutingProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
```

- [ ] **Step 7: Run targeted + full route suites**

Run: `.venv/bin/python -m pytest tests/test_mock_routing_provider.py tests/test_route_alternatives_api.py -q`
Expected: PASS (including the existing `provider == "mock"` assertion — a request without a provider resolves to the `"mock"` default).

- [ ] **Step 8: Commit**

```bash
git add app/routing/providers.py app/routing/schemas.py app/services/route_service.py app/api/routes_routes.py tests/test_mock_routing_provider.py tests/test_route_alternatives_api.py
git commit -m "feat: select routing provider from config with request override"
```

---

## Task 7: Full verification gate

- [ ] **Step 1: Run the full gate**

Run: `make test-all`
Expected: pytest, ruff, frontend `npm test`, and `npm run build` all pass.

- [ ] **Step 2: Fix any stragglers, re-run until green.**

- [ ] **Step 3: Status check**

Run: `git status --short --branch`
Expected: only intended source/test files changed; `.venv` and `frontend/node_modules` excluded; `app/static/dashboard/` ignored.

---

## Self-Review

- **Spec coverage:** B1 config (Task 4), provider + decoder (Task 5), factory + selection + 502 (Task 6); C bbox loader (Task 1) + all three call sites (Tasks 2–3); contract/parity/factory/selection tests throughout; gate (Task 7). Covered.
- **Placeholders:** none — every code step shows complete code; the only "grep then act" steps (dead-code removal in Tasks 2/3) include the exact grep and what to delete.
- **Type/name consistency:** `BoundingBox` / `bounding_box_for_points` / `incidents_in_bbox` consistent across Tasks 1–3; `RoutingProviderError` defined in Task 5 (providers.py) and consumed in Tasks 5–6; `get_routing_provider(provider_name, *, opentripplanner_base_url="")` signature consistent in the factory (Task 6), the route_service call (Task 6), and every monkeypatch lambda (`**_kwargs`); `OpenTripPlannerProvider` / `_polyline_to_geometry` names match between Task 5 module and its tests.
