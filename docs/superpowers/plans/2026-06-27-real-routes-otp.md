# Real Routes — OTP routing between saved Places — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Routes feature's mock provider + 6-fixture dropdown with real OpenTripPlanner routing between the user's saved Places and geocoded addresses.

**Architecture:** Backend gains a structured `RouteEndpoint` input (saved-place id *or* coordinates) resolved through a new additive `_resolve_endpoint` in `route_service` (the legacy label/fixture path stays as a back-compat fallback). The frontend `RoutesTab` becomes a Place/address picker driven by data the UI already loads. OTP is brought up locally in Docker and validated end-to-end. Two latent provider defects (dead timeout config, unsanitized `departure_time`) and a privacy leak (precise endpoint coords in the response) are fixed along the way.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, pytest; React + TypeScript + Vite, Vitest + Testing Library; OpenTripPlanner 2.x in Docker.

---

## Working context

- **All work happens in the worktree** `.worktrees/real-routes-otp` (branch `jcscocca/claude/real-routes-otp`).
- Run backend tests with the symlinked venv: `.venv/bin/python -m pytest` (from the worktree root).
- Run frontend tests/build from `frontend/`: `npm test`, `npm run build`.
- The spec this implements: [2026-06-27-real-routes-otp-design.md](../specs/2026-06-27-real-routes-otp-design.md).
- **Decisions locked:** route on precise `centroid_*` but echo only generalized coords (#1); route to *any* of the user's saved Places (#2); pin OTP image to `2.7.0` (#3).

## File structure

**Backend (Milestone 1)**
- `app/routing/schemas.py` — Modify: add `RouteEndpoint`; make `RouteRequestCreate` labels optional + add `origin`/`destination`; add `departure_time` pattern.
- `app/services/place_service.py` — Modify: add `get_place(session, place_id, user_id_hash)`.
- `app/services/route_service.py` — Modify: add `_resolve_endpoint`; rewrite the two resolution lines; thread `opentripplanner_timeout_s`; add `allow_provider_override`; drop precise coords from `_request_to_dict`.
- `app/routing/providers.py` — Modify: `get_routing_provider` accepts + forwards `opentripplanner_timeout_s`.
- `app/api/routes_routes.py` — Modify: internal endpoint passes `allow_provider_override=True`.
- `app/api/routes_public_routes.py` — No change (defaults to server-authoritative).
- `.env.example` — Modify: fix the stale "OTP1-style REST" comment.
- `tests/test_route_endpoints.py` — Create: all new feature behavior (schema validation, place_id/coords/IDOR/back-compat, generalized echo, server-authoritative, departure_time).
- `tests/test_opentripplanner_provider.py` — Modify: add timeout-plumbing test.
- `tests/test_route_alternatives_api.py` — Modify: update one `fake_factory` signature.

**Frontend (Milestone 2)**
- `frontend/src/types.ts` — Modify: add `RouteEndpointInput`.
- `frontend/src/api/client.ts` — Modify: `createRouteAlternatives` payload.
- `frontend/src/components/RoutesTab.tsx` — Rewrite: Place/address picker.
- `frontend/src/components/RoutesTab.test.tsx` — Rewrite: new picker tests.
- `frontend/src/components/MapWorkspace.tsx` — Modify: pass `places` + `geocodeSearch`; new `handleRunRoute`.

**OTP + docs (Milestones 3–4)**
- `docs/DEPLOY.md`, `scripts/otp_thinkpad_setup.ps1` — Modify: pin image to `2.7.0` + macOS note.
- `tests/test_opentripplanner_provider.py` — Modify: add a recorded real-response contract test (M3).

---

# Milestone 1 — Backend (testable against the mock provider, no OTP needed)

## Task 1: `RouteEndpoint` schema + optional labels

**Files:**
- Modify: `app/routing/schemas.py:6` (import), `:25-37` (`RouteRequestCreate`), add `RouteEndpoint` after `:22`.
- Test: `tests/test_route_endpoints.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_route_endpoints.py`:

```python
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.routing.schemas import RouteEndpoint


def _client(tmp_path):
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'm.sqlite3'}"))


def test_route_endpoint_requires_a_source():
    with pytest.raises(ValidationError):
        RouteEndpoint()


def test_route_endpoint_rejects_both_sources():
    with pytest.raises(ValidationError):
        RouteEndpoint(place_id="p1", latitude=47.6, longitude=-122.3)


def test_route_endpoint_requires_both_coordinates():
    with pytest.raises(ValidationError):
        RouteEndpoint(latitude=47.6)


def test_route_endpoint_accepts_place_id():
    assert RouteEndpoint(place_id="p1").place_id == "p1"


def test_route_endpoint_accepts_coordinates():
    endpoint = RouteEndpoint(latitude=47.6, longitude=-122.3, label="Pin")
    assert (endpoint.latitude, endpoint.longitude, endpoint.label) == (47.6, -122.3, "Pin")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q`
Expected: FAIL — `ImportError: cannot import name 'RouteEndpoint'`.

- [ ] **Step 3: Implement the schema**

In `app/routing/schemas.py`, change the pydantic import (line 6):

```python
from pydantic import BaseModel, Field, model_validator
```

Insert after `RouteLocation` (after line 22), before `RouteRequestCreate`:

```python
class RouteEndpoint(BaseModel):
    place_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    label: str | None = None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "RouteEndpoint":
        has_place = self.place_id is not None
        has_coords = self.latitude is not None and self.longitude is not None
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        if has_place and has_coords:
            raise ValueError("provide either place_id or latitude/longitude, not both")
        if not has_place and not has_coords:
            raise ValueError("provide place_id or latitude/longitude")
        return self
```

Change `RouteRequestCreate` (lines 26-27) so labels are optional and add the endpoint objects:

```python
class RouteRequestCreate(BaseModel):
    origin_label: str | None = None
    destination_label: str | None = None
    origin: RouteEndpoint | None = None
    destination: RouteEndpoint | None = None
    mode: SupportedRouteMode = "transit"
    departure_date: date | None = None
    departure_time: str | None = None
    time_window: str | None = None
    preferences: list[str] = Field(default_factory=list)
    privacy_level: SupportedRoutePrivacyLevel = "generalized"
    provider: str | None = None
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[RouteRadiusMeters] = Field(default_factory=lambda: [250, 500], min_length=1)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add app/routing/schemas.py tests/test_route_endpoints.py
git commit -m "feat(routes): add RouteEndpoint input model with optional legacy labels"
```

---

## Task 2: `get_place` + `_resolve_endpoint` + service wiring

**Files:**
- Modify: `app/services/place_service.py` (add `get_place`)
- Modify: `app/services/route_service.py:11-25` (imports), `:30-36` (signature + resolution)
- Test: `tests/test_route_endpoints.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_route_endpoints.py`:

```python
_ANALYSIS = {"analysis_start_date": "2024-01-01", "analysis_end_date": "2024-01-31", "radii_m": [500]}


def _make_place(client, label, lat, lon):
    return client.post(
        "/places", json={"display_label": label, "latitude": lat, "longitude": lon, "visit_count": 1}
    ).json()


def test_route_between_saved_places(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    home = _make_place(client, "Home", 47.623, -122.321)
    office = _make_place(client, "Office", 47.609, -122.335)
    resp = client.post(
        "/routes/alternatives",
        json={"origin": {"place_id": home["id"]}, "destination": {"place_id": office["id"]},
              "mode": "transit", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["alternatives"]) >= 1
    assert body["request"]["origin"]["label"] == "Home"


def test_route_between_geocoded_coordinates(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin": {"latitude": 47.623, "longitude": -122.321, "label": "Cap Hill pin"},
              "destination": {"latitude": 47.609, "longitude": -122.335, "label": "Downtown pin"},
              "mode": "walk", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["request"]["origin"]["label"] == "Cap Hill pin"


def test_route_rejects_another_users_place(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'idor.sqlite3'}")
    owner = TestClient(app)
    owner.post("/sessions")
    place = _make_place(owner, "Home", 47.62, -122.33)
    intruder = TestClient(app)
    intruder.post("/sessions")
    resp = intruder.post(
        "/routes/alternatives",
        json={"origin": {"place_id": place["id"]},
              "destination": {"latitude": 47.61, "longitude": -122.34, "label": "Elsewhere"},
              "mode": "walk", **_ANALYSIS},
    )
    assert resp.status_code == 400
    assert "Unknown saved place" in resp.json()["detail"]


def test_route_still_accepts_legacy_labels(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["alternatives"]) >= 2
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q -k "saved_places or geocoded or another_users or legacy_labels"`
Expected: FAIL — the new `origin`/`destination` objects aren't resolved yet (422 or 400), and `place_id` is ignored.

- [ ] **Step 3a: Add `get_place` to `app/services/place_service.py`**

Append (the `select`, `Session`, `PlaceCluster` imports already exist at the top):

```python
def get_place(session: Session, place_id: str, user_id_hash: str) -> PlaceCluster | None:
    return session.scalar(
        select(PlaceCluster).where(
            PlaceCluster.id == place_id,
            PlaceCluster.user_id_hash == user_id_hash,
        )
    )
```

- [ ] **Step 3b: Wire resolution into `app/services/route_service.py`**

Update imports — line 18:

```python
from app.routing.place_resolver import UnknownRoutePlaceError, resolve_route_place
```

Add `RouteLocation` to the schemas import block (lines 20-25):

```python
from app.routing.schemas import (
    RouteAlternativeData,
    RouteContextSummaryData,
    RouteLocation,
    RouteRequestCreate,
    RouteRequestData,
)
```

Add a new import (after line 27):

```python
from app.services.place_service import get_place
```

Insert the resolver helper immediately above `create_route_alternatives` (before line 30):

```python
def _resolve_endpoint(
    session: Session,
    user_id_hash: str,
    endpoint: "RouteEndpoint | None",
    label: str | None,
) -> RouteLocation:
    if endpoint is not None and endpoint.place_id is not None:
        place = get_place(session, endpoint.place_id, user_id_hash)
        if place is None:
            raise UnknownRoutePlaceError(f"Unknown saved place: {endpoint.place_id}")
        return RouteLocation(
            label=endpoint.label or place.display_label or "Saved place",
            latitude=place.centroid_latitude,
            longitude=place.centroid_longitude,
            display_latitude=place.display_latitude,
            display_longitude=place.display_longitude,
            location_type=place.inferred_place_type,
            source="saved_place",
        )
    if endpoint is not None and endpoint.latitude is not None and endpoint.longitude is not None:
        return RouteLocation(
            label=endpoint.label or f"{endpoint.latitude:.5f}, {endpoint.longitude:.5f}",
            latitude=endpoint.latitude,
            longitude=endpoint.longitude,
            source="geocoded",
        )
    if label is not None:
        return resolve_route_place(label)
    raise UnknownRoutePlaceError("No origin or destination provided")
```

Add `RouteEndpoint` to the schemas import as well (so the annotation resolves) — extend the block from above to also import it:

```python
from app.routing.schemas import (
    RouteAlternativeData,
    RouteContextSummaryData,
    RouteEndpoint,
    RouteLocation,
    RouteRequestCreate,
    RouteRequestData,
)
```

Replace lines 35-36 (`origin = resolve_route_place(...)` / `destination = ...`) with:

```python
    origin = _resolve_endpoint(session, user_id_hash, request_payload.origin, request_payload.origin_label)
    destination = _resolve_endpoint(
        session, user_id_hash, request_payload.destination, request_payload.destination_label
    )
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q`
Expected: PASS (all). Then run the existing route tests to confirm back-compat:
Run: `.venv/bin/python -m pytest tests/test_routes_public_api.py tests/test_route_alternatives_api.py -q`
Expected: PASS (label paths unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/services/place_service.py app/services/route_service.py tests/test_route_endpoints.py
git commit -m "feat(routes): resolve route endpoints from saved places and coordinates"
```

---

## Task 3: Generalized-only coordinate echo in the response

**Files:**
- Modify: `app/services/route_service.py:305-323` (`_request_to_dict`)
- Test: `tests/test_route_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_route_endpoints.py`:

```python
def test_response_omits_precise_endpoint_coordinates(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    home = _make_place(client, "Home", 47.623, -122.321)
    office = _make_place(client, "Office", 47.609, -122.335)
    resp = client.post(
        "/routes/alternatives",
        json={"origin": {"place_id": home["id"]}, "destination": {"place_id": office["id"]},
              "mode": "transit", **_ANALYSIS},
    )
    origin = resp.json()["request"]["origin"]
    assert "latitude" not in origin and "longitude" not in origin
    assert "display_latitude" in origin
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py::test_response_omits_precise_endpoint_coordinates -q`
Expected: FAIL — `"latitude"` is still present.

- [ ] **Step 3: Drop precise coords from `_request_to_dict`**

Replace the `"origin"` and `"destination"` dicts (lines 308-323) with:

```python
        "origin": {
            "label": route_request.origin_label,
            "display_latitude": route_request.origin_display_latitude,
            "display_longitude": route_request.origin_display_longitude,
            "location_type": route_request.origin_location_type,
        },
        "destination": {
            "label": route_request.destination_label,
            "display_latitude": route_request.destination_display_latitude,
            "display_longitude": route_request.destination_display_longitude,
            "location_type": route_request.destination_location_type,
        },
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q && .venv/bin/python -m pytest tests/test_routes_public_api.py tests/test_route_alternatives_api.py tests/test_route_tableau_exports.py -q`
Expected: PASS (no existing test asserts on response `latitude`).

- [ ] **Step 5: Commit**

```bash
git add app/services/route_service.py tests/test_route_endpoints.py
git commit -m "fix(routes): stop echoing precise endpoint coordinates in route responses"
```

---

## Task 4: Server-authoritative provider on the public endpoint

**Files:**
- Modify: `app/services/route_service.py:30-41` (signature + provider selection)
- Modify: `app/api/routes_routes.py:28` (internal passes override)
- Test: `tests/test_route_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_route_endpoints.py`:

```python
def test_public_route_ignores_client_provider_override(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    # Server default is mock. If the client's "otp" override were honored it would 400.
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", "provider": "otp", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["request"]["provider"] == "mock"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py::test_public_route_ignores_client_provider_override -q`
Expected: FAIL with 400 ("Unsupported routing provider: otp").

- [ ] **Step 3: Gate the override in the service**

Change the `create_route_alternatives` signature (lines 30-34) and provider selection (lines 37-41):

```python
def create_route_alternatives(
    session: Session,
    request_payload: RouteRequestCreate,
    user_id_hash: str,
    *,
    allow_provider_override: bool = False,
) -> dict[str, object]:
    origin = _resolve_endpoint(session, user_id_hash, request_payload.origin, request_payload.origin_label)
    destination = _resolve_endpoint(
        session, user_id_hash, request_payload.destination, request_payload.destination_label
    )
    settings = get_settings()
    requested_provider = request_payload.provider if allow_provider_override else None
    provider_name = requested_provider or settings.routing_provider
    routing_provider = get_routing_provider(
        provider_name, opentripplanner_base_url=settings.opentripplanner_base_url
    )
```

In `app/api/routes_routes.py`, change line 28 to keep the internal tier override-capable:

```python
        return create_route_alternatives(
            session, request, user_id_hash, allow_provider_override=True
        )
```

(`app/api/routes_public_routes.py` is left calling `create_route_alternatives(session, request, user_id_hash)` — default `allow_provider_override=False`.)

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q && .venv/bin/python -m pytest tests/test_route_alternatives_api.py -q`
Expected: PASS — public ignores override; the internal `rejects_unsupported_provider` and `uses_configured_default_provider` tests still pass (internal still honors override).

- [ ] **Step 5: Commit**

```bash
git add app/services/route_service.py app/api/routes_routes.py tests/test_route_endpoints.py
git commit -m "fix(routes): make public routing provider server-authoritative"
```

---

## Task 5: Plumb the OTP request timeout

**Files:**
- Modify: `app/routing/providers.py:22-34`
- Modify: `app/services/route_service.py:39-41` (pass timeout)
- Modify: `tests/test_route_alternatives_api.py:462` (fake factory signature)
- Test: `tests/test_opentripplanner_provider.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_opentripplanner_provider.py`:

```python
def test_get_routing_provider_passes_timeout():
    from app.routing.providers import get_routing_provider

    provider = get_routing_provider(
        "opentripplanner", opentripplanner_base_url="http://otp", opentripplanner_timeout_s=3.5
    )
    assert provider.timeout_s == 3.5
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_opentripplanner_provider.py::test_get_routing_provider_passes_timeout -q`
Expected: FAIL — `get_routing_provider` has no `opentripplanner_timeout_s` parameter.

- [ ] **Step 3: Thread the timeout through**

In `app/routing/providers.py`, replace `get_routing_provider` (lines 22-35):

```python
def get_routing_provider(
    provider_name: str,
    *,
    opentripplanner_base_url: str = "",
    opentripplanner_timeout_s: float = 10.0,
) -> RoutingProvider:
    if provider_name == "mock":
        return MockRoutingProvider()
    if provider_name == "opentripplanner":
        if not opentripplanner_base_url:
            raise UnsupportedRoutingProviderError(
                "OpenTripPlanner base URL is not configured."
            )
        from app.routing.opentripplanner_provider import OpenTripPlannerProvider

        return OpenTripPlannerProvider(opentripplanner_base_url, timeout_s=opentripplanner_timeout_s)
    raise UnsupportedRoutingProviderError(f"Unsupported routing provider: {provider_name}")
```

In `app/services/route_service.py`, pass the configured timeout (the `get_routing_provider(...)` call inside `create_route_alternatives`):

```python
    routing_provider = get_routing_provider(
        provider_name,
        opentripplanner_base_url=settings.opentripplanner_base_url,
        opentripplanner_timeout_s=settings.opentripplanner_timeout_s,
    )
```

In `tests/test_route_alternatives_api.py`, update the `fake_factory` signature (line 462) so it accepts the new keyword:

```python
    def fake_factory(provider_name, *, opentripplanner_base_url="", opentripplanner_timeout_s=10.0):
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_opentripplanner_provider.py tests/test_route_alternatives_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routing/providers.py app/services/route_service.py tests/test_opentripplanner_provider.py tests/test_route_alternatives_api.py
git commit -m "fix(routes): honor MCA_OPENTRIPPLANNER_TIMEOUT_S in live requests"
```

---

## Task 6: Validate `departure_time` format

**Files:**
- Modify: `app/routing/schemas.py:30` (`departure_time`)
- Test: `tests/test_route_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_route_endpoints.py`:

```python
def test_invalid_departure_time_is_rejected(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", "departure_time": "8 oclock", **_ANALYSIS},
    )
    assert resp.status_code == 422


def test_valid_departure_time_is_accepted(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    resp = client.post(
        "/routes/alternatives",
        json={"origin_label": "Capitol Hill", "destination_label": "Downtown Seattle",
              "mode": "transit", "departure_time": "08:00", **_ANALYSIS},
    )
    assert resp.status_code == 200, resp.text
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q -k departure_time`
Expected: FAIL — `"8 oclock"` is currently accepted (200, not 422).

- [ ] **Step 3: Add a pattern to the schema field**

In `app/routing/schemas.py`, replace line 30 in `RouteRequestCreate`:

```python
    departure_time: str | None = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_route_endpoints.py -q -k departure_time && .venv/bin/python -m pytest tests/test_route_alternatives_api.py -q`
Expected: PASS — note `test_route_alternatives_api_creates_request_and_ranked_routes` sends `"08:00"` and still passes.

- [ ] **Step 5: Commit**

```bash
git add app/routing/schemas.py tests/test_route_endpoints.py
git commit -m "fix(routes): validate departure_time format before it reaches OTP"
```

---

## Task 7: Fix the stale `.env.example` routing comment

**Files:**
- Modify: `.env.example:35-36`

- [ ] **Step 1: Edit the comment**

Replace lines 35-36 of `.env.example`:

```
# Set to "opentripplanner" and point MCA_OPENTRIPPLANNER_BASE_URL at a running OTP 2.x
# instance's GTFS GraphQL endpoint (e.g. http://host:8090/otp/gtfs/v1) for live routes.
```

- [ ] **Step 2: Verify docs test still passes**

Run: `.venv/bin/python -m pytest tests/test_config_routing.py -q`
Expected: PASS (`MCA_ROUTING_PROVIDER` / `MCA_OPENTRIPPLANNER_BASE_URL` still present).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: correct the OTP API description in .env.example"
```

---

## Task 8: Milestone 1 gate

- [ ] **Step 1: Run the full backend suite + lint**

Run: `.venv/bin/python -m pytest -q && .venv/bin/ruff check .`
Expected: all pass, ruff clean.

- [ ] **Step 2: Commit (only if lint fixes were needed)**

```bash
git add -A && git commit -m "chore(routes): milestone 1 lint cleanup"
```

---

# Milestone 2 — Frontend (testable against the mock backend, no OTP needed)

## Task 9: Frontend types + API client payload

**Files:**
- Modify: `frontend/src/types.ts` (add `RouteEndpointInput`)
- Modify: `frontend/src/api/client.ts:105-114`

- [ ] **Step 1: Add the type**

In `frontend/src/types.ts`, add after `RouteLine` (line 124):

```ts
export type RouteEndpointInput =
  | { place_id: string }
  | { latitude: number; longitude: number; label: string };
```

- [ ] **Step 2: Update the client**

In `frontend/src/api/client.ts`, add `RouteEndpointInput` to the type import block (lines 1-11), then replace `createRouteAlternatives` (lines 105-114):

```ts
export function createRouteAlternatives(payload: {
  origin: RouteEndpointInput;
  destination: RouteEndpointInput;
  mode: string;
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
}): Promise<RouteComparison> {
  return request("/routes/alternatives", { method: "POST", body: JSON.stringify(payload) });
}
```

- [ ] **Step 3: Verify type-check (will fail until Task 11 — expected here)**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: FAIL only in `RoutesTab.tsx` / `MapWorkspace.tsx` (callers not yet updated). That's fine — Tasks 10-11 fix them. Do **not** commit yet; commit at the end of Task 11.

---

## Task 10: Rewrite `RoutesTab` as a Place/address picker

**Files:**
- Rewrite: `frontend/src/components/RoutesTab.tsx`
- Rewrite: `frontend/src/components/RoutesTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `frontend/src/components/RoutesTab.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutesTab } from "./RoutesTab";
import type { AnalysisSettings, Place, RouteComparison } from "../types";

const analysis: AnalysisSettings = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 500, offenseCategory: "" };

const places: Place[] = [
  { id: "p1", display_label: "Home", latitude: 47.62, longitude: -122.33, visit_count: 1, total_dwell_minutes: null, inferred_place_type: "home", sensitivity_class: "normal" },
  { id: "p2", display_label: "Office", latitude: 47.61, longitude: -122.34, visit_count: 1, total_dwell_minutes: null, inferred_place_type: "work", sensitivity_class: "normal" },
];

const twoAlt: RouteComparison = {
  request: { id: "r1", origin: { label: "Home" }, destination: { label: "Office" }, mode: "transit" },
  alternatives: [
    { id: "a1", route_label: "Link light rail via Westlake", rank: 1, duration_minutes: 14, distance_m: 2100, transfer_count: 0, walking_distance_m: 450, mode_mix: "walk,transit", summary_geometry: "47.61,-122.33;47.60,-122.34" },
    { id: "a2", route_label: "Pine Street bus", rank: 2, duration_minutes: 18, distance_m: 2200, transfer_count: 0, walking_distance_m: 500, mode_mix: "walk,bus", summary_geometry: "47.62,-122.32;47.60,-122.34" },
  ],
  context_summaries: [
    { route_alternative_id: "a1", radius_m: 500, incident_count: 4, nearest_incident_m: 40, offense_category: "PROPERTY", offense_subcategory: "THEFT" },
    { route_alternative_id: "a2", radius_m: 500, incident_count: 9, nearest_incident_m: 12, offense_category: "PROPERTY", offense_subcategory: "BURGLARY" },
  ],
  statistical_comparison: {
    overview: { decision_class: "statistically_lower", recommendation_option_id: "a1", recommendation_label: "Link light rail via Westlake", summary_text: "Link light rail via Westlake has a statistically lower reported-incident rate for the selected corridor.", caveat_text: "This describes reported incidents, not causation or personal outcomes." },
  },
};

const oneAlt: RouteComparison = { ...twoAlt, alternatives: [twoAlt.alternatives[0]], statistical_comparison: null };
const noAlt: RouteComparison = { ...twoAlt, alternatives: [], context_summaries: [], statistical_comparison: null };

afterEach(cleanup);

describe("RoutesTab", () => {
  it("renders the verdict and a block per alternative", () => {
    render(<RoutesTab analysis={analysis} running={false} result={twoAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower reported-incident rate/i)).toBeInTheDocument();
    expect(screen.getByText("Link light rail via Westlake")).toBeInTheDocument();
    expect(screen.getByText("Pine Street bus")).toBeInTheDocument();
  });

  it("omits the verdict for a single route", () => {
    render(<RoutesTab analysis={analysis} running={false} result={oneAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("shows a no-route message when there are zero alternatives", () => {
    render(<RoutesTab analysis={analysis} running={false} result={noAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/no route found/i)).toBeInTheDocument();
  });

  it("lists saved places in the From and To pickers", () => {
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getAllByRole("option", { name: "Home" }).length).toBe(2);
    expect(screen.getAllByRole("option", { name: "Office" }).length).toBe(2);
  });

  it("runs with the selected place endpoints", () => {
    const onRun = vi.fn();
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={onRun} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "place:p1" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "place:p2" } });
    fireEvent.click(screen.getByRole("button", { name: /compare routes/i }));
    expect(onRun).toHaveBeenCalledWith({ place_id: "p1" }, { place_id: "p2" }, "transit");
  });

  it("searches an address and makes it selectable", async () => {
    const geocodeSearch = vi.fn().mockResolvedValue([{ label: "400 Broad St", latitude: 47.62, longitude: -122.35, source: "nominatim" }]);
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "400 Broad" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findByRole("option", { name: /400 Broad St/ });
    expect(geocodeSearch).toHaveBeenCalledWith("400 Broad");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npm test -- RoutesTab`
Expected: FAIL — `RoutesTab` doesn't accept `places`/`geocodeSearch` and still calls `onRun` with strings.

- [ ] **Step 3: Rewrite `frontend/src/components/RoutesTab.tsx`**

Replace the entire file:

```tsx
import { useMemo, useState } from "react";
import type { AnalysisSettings, GeocodeResult, Place, RouteComparison, RouteEndpointInput } from "../types";

const MODES: { value: string; label: string }[] = [
  { value: "transit", label: "Transit" },
  { value: "walk", label: "Walk" },
  { value: "bike", label: "Bike" },
  { value: "drive", label: "Drive" },
];

type EndpointOption = { key: string; label: string; input: RouteEndpointInput };

type Props = {
  analysis: AnalysisSettings;
  running: boolean;
  result?: RouteComparison | null;
  error?: string;
  places: Place[];
  geocodeSearch: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onRun: (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string) => void;
};

function corridorContext(result: RouteComparison, alternativeId: string, radiusM: number) {
  const rows = result.context_summaries.filter(
    (s) => s.route_alternative_id === alternativeId && s.radius_m === radiusM,
  );
  const count = rows.reduce((sum, row) => sum + row.incident_count, 0);
  const nearestValues = rows.map((row) => row.nearest_incident_m).filter((v): v is number => v != null);
  const nearest = nearestValues.length ? Math.min(...nearestValues) : null;
  const types = [...new Set(rows.map((row) => row.offense_subcategory || row.offense_category).filter(Boolean))].slice(0, 3);
  return { count, nearest, types };
}

export function RoutesTab({ analysis, running, result, error, places, geocodeSearch, onRun }: Props) {
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [mode, setMode] = useState("transit");

  const options: EndpointOption[] = useMemo(() => {
    const placeOptions = places.map((p) => ({
      key: `place:${p.id}`,
      label: p.display_label,
      input: { place_id: p.id } as RouteEndpointInput,
    }));
    const geoOptions = geoResults.map((g, i) => ({
      key: `geo:${i}`,
      label: g.label,
      input: { latitude: g.latitude, longitude: g.longitude, label: g.label } as RouteEndpointInput,
    }));
    return [...placeOptions, ...geoOptions];
  }, [places, geoResults]);

  const recommendedId = result?.statistical_comparison?.overview.recommendation_option_id ?? null;
  const originOption = options.find((o) => o.key === originKey) ?? null;
  const destinationOption = options.find((o) => o.key === destinationKey) ?? null;
  const canRun = originOption !== null && destinationOption !== null && !running;

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError("");
    try {
      const results = await geocodeSearch(trimmed);
      setGeoResults(results);
      if (results.length === 0) setSearchError("No matches for that address.");
    } catch {
      setSearchError("Address search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Routes">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="route-address">Find an address</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="route-address"
              className="mc-inp"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 400 Broad St, Seattle"
            />
            <button type="button" className="mc-chip" disabled={searching} onClick={handleSearch}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError ? <p className="mc-inline-error" role="alert">{searchError}</p> : null}
        </div>
        <div className="mc-field">
          <label htmlFor="route-origin">From</label>
          <select id="route-origin" className="mc-inp" value={originKey} onChange={(e) => setOriginKey(e.target.value)}>
            <option value="">Select a place…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label htmlFor="route-destination">To</label>
          <select id="route-destination" className="mc-inp" value={destinationKey} onChange={(e) => setDestinationKey(e.target.value)}>
            <option value="">Select a place…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label id="route-mode-label">Mode</label>
          <div className="mc-chips" role="group" aria-labelledby="route-mode-label">
            {MODES.map((m) => (
              <button key={m.value} type="button" className={`mc-chip${mode === m.value ? " on" : ""}`} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="mc-querybar-run">
          <button
            type="button"
            className="mc-cta"
            disabled={!canRun}
            onClick={() => { if (originOption && destinationOption) onRun(originOption.input, destinationOption.input, mode); }}
          >
            {running ? "Routing…" : "Compare routes"}
          </button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {options.length === 0 ? (
        <p className="mc-empty-list">Save places in the Places tab, or search an address above, to route between them.</p>
      ) : null}

      {result ? (
        result.alternatives.length === 0 ? (
          <p className="mc-empty-list">No route found between these points for this mode.</p>
        ) : (
          <>
            {result.statistical_comparison ? (
              <section className="mc-verdict tone-muted" aria-label="Route comparison verdict">
                <p className="mc-verdict-label">{result.statistical_comparison.overview.summary_text}</p>
                <p className="mc-verdict-sub">{result.statistical_comparison.overview.caveat_text}</p>
              </section>
            ) : (
              <p className="mc-empty-list">One route option — nothing to compare. Reported-incident context for the corridor is below.</p>
            )}

            {result.alternatives.map((alt) => {
              const ctx = corridorContext(result, alt.id, analysis.radiusM);
              return (
                <section key={alt.id} className={`mc-verdict${alt.id === recommendedId ? " tone-ok" : ""}`} aria-label={`Route ${alt.route_label}`}>
                  <div className="mc-verdict-head">
                    <span className="mc-verdict-label">{alt.route_label}</span>
                    {alt.id === recommendedId ? <span className="cnt">recommended</span> : null}
                  </div>
                  <p className="mc-verdict-sub">
                    {alt.duration_minutes != null ? `${Math.round(alt.duration_minutes)} min` : "—"} · {alt.transfer_count} transfer{alt.transfer_count === 1 ? "" : "s"} · {alt.mode_mix}
                    {alt.walking_distance_m != null ? ` · ${Math.round(alt.walking_distance_m)} m walk` : ""}
                  </p>
                  <p className="mc-verdict-sub">
                    Corridor (≤{analysis.radiusM} m): {ctx.count} reported incident{ctx.count === 1 ? "" : "s"}
                    {ctx.nearest != null ? ` · nearest ${Math.round(ctx.nearest)} m` : ""}
                    {ctx.types.length ? ` · ${ctx.types.join(", ")}` : ""}
                  </p>
                </section>
              );
            })}
          </>
        )
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`): `npm test -- RoutesTab`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RoutesTab.tsx frontend/src/components/RoutesTab.test.tsx
git commit -m "feat(routes): rebuild RoutesTab as a saved-place and address picker"
```

---

## Task 11: Wire `MapWorkspace` to the new picker

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx:22` (import), `:302-320` (`handleRunRoute`), `:443-445` (render)

- [ ] **Step 1: Update the import**

Add `RouteEndpointInput` to the type import on line 22 (it already imports many types including `GeocodeResult` and `Place`):

```ts
import type { AnalysisSettings, AssistantDashboardState, DashboardSummary, DrawerState, DraftPin, GeocodeResult, IncidentDetailsResponse, LatLng, NeighborhoodAnalysis, Place, PlaceCreate, RouteComparison, RouteEndpointInput, RouteLine, TabKey } from "../types";
```

- [ ] **Step 2: Rewrite `handleRunRoute` (lines 302-320)**

```tsx
  const handleRunRoute = async (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string) => {
    setRouteRunning(true);
    setRouteError("");
    try {
      const result = await createRouteAlternatives({
        origin,
        destination,
        mode,
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radii_m: [analysis.radiusM],
      });
      setRouteComparison(result);
    } catch (caught) {
      setRouteError(caught instanceof Error ? caught.message : "Unable to compare routes.");
    } finally {
      setRouteRunning(false);
    }
  };
```

- [ ] **Step 3: Pass the new props to `RoutesTab` (lines 443-445)**

```tsx
          {activeTab === "routes" ? (
            <RoutesTab
              analysis={analysis}
              running={routeRunning}
              result={routeComparison}
              error={routeError}
              places={places}
              geocodeSearch={geocodingProvider.search}
              onRun={handleRunRoute}
            />
          ) : null}
```

(`places` is already defined at line 120; `geocodingProvider` is already imported at line 7.)

- [ ] **Step 4: Verify type-check, tests, and build**

Run (from `frontend/`): `npx tsc --noEmit && npm test && npm run build`
Expected: type-check clean, all tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/MapWorkspace.tsx
git commit -m "feat(routes): send structured route endpoints from MapWorkspace"
```

---

# Milestone 3 — OTP live validation (local macOS Docker)

> These tasks are a manual runbook; they prove the already-implemented OTP provider works against a real server and surface first-contact bugs. Keep the mock provider as the dev default; only the local `.env` is flipped.

## Task 12: Stand up OTP locally

- [ ] **Step 1: Raise Docker memory.** Docker Desktop → Settings → Resources → Memory ≥ 14 GB (one-time build needs an 8 GB JVM heap). Confirm Docker is running: `docker version`.

- [ ] **Step 2: Download inputs**

```bash
mkdir -p ~/otp && cd ~/otp
curl -L -o washington-latest.osm.pbf https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf
curl -L -o gtfs_puget_sound_consolidated.zip https://gtfs.sound.obaweb.org/prod/gtfs_puget_sound_consolidated.zip
```
Expected: two files in `~/otp`; the GTFS filename must contain `gtfs`.

- [ ] **Step 3: Build the graph (one-time, ~tens of minutes)**

```bash
docker run --rm -e JAVA_TOOL_OPTIONS=-Xmx8g -v ~/otp:/var/opentripplanner \
  docker.io/opentripplanner/opentripplanner:2.7.0 --build --save
```
Expected: exits 0; `~/otp/graph.obj` is written. If it OOMs, raise Docker memory or `osmium extract` a Puget Sound bbox and rebuild.

- [ ] **Step 4: Serve**

```bash
docker run -d --name otp --restart unless-stopped -p 8090:8080 \
  -e JAVA_TOOL_OPTIONS=-Xmx8g -v ~/otp:/var/opentripplanner \
  docker.io/opentripplanner/opentripplanner:2.7.0 --load --serve
docker logs -f otp
```
Expected: log line `Grizzly server running`. (Ctrl-C stops following logs, not the container.)

## Task 13: Smoke-test the GraphQL endpoint

- [ ] **Step 1: Run the provider's exact query**

```bash
curl http://localhost:8090/otp/gtfs/v1 -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ plan(from:{lat:47.623,lon:-122.321}, to:{lat:47.609,lon:-122.335}, transportModes:[{mode:TRANSIT},{mode:WALK}], numItineraries:3) { itineraries { duration walkDistance legs { mode duration distance transitLeg route { shortName longName } from { name lat lon } to { name lat lon } legGeometry { points } } } } }"}'
```
Expected: JSON with non-empty `data.plan.itineraries`, **no** top-level `errors`, and at least one leg with `"transitLeg": true` (confirms GTFS loaded). If `errors` appear or only walk legs return, fix per the spec's risks (GTFS filename / endpoint path / image tag) before continuing.

- [ ] **Step 2: Save the response** to `~/otp/sample_plan_response.json` (pretty-printed) — it becomes the contract-test fixture in Task 15.

## Task 14: Validate end-to-end through the app

- [ ] **Step 1: Point the app at OTP.** In the worktree's `.env` (create if absent):

```
MCA_ROUTING_PROVIDER=opentripplanner
MCA_OPENTRIPPLANNER_BASE_URL=http://localhost:8090/otp/gtfs/v1
```

- [ ] **Step 2: Run the app** — `make run` (uvicorn on :8000). In a browser session (or via `curl` with a session cookie), POST `/routes/alternatives` with two saved-place ids (Capitol Hill ≈ 47.623,-122.321 → Downtown ≈ 47.609,-122.335 created as places).

- [ ] **Step 3: Verify the provider assertions** (read the JSON response):
  - each `alternatives[].summary_geometry` decodes to a Seattle polyline (lat ≈ 47.6, lon ≈ -122.3);
  - `transfer_count == max(0, transit_legs - 1)` and `>= 0`;
  - `segments[]` order: `access` first, transit `ride`, last `egress`, middle walk `walk`;
  - `duration_minutes ≈ itinerary_seconds / 60`; `distance_m == sum(leg distances)`.
  - `docker stop otp` then POST again → **HTTP 502**; `docker start otp` to restore.
  - an off-graph pair (e.g. `{latitude: 40.0, longitude: -100.0}`) → **HTTP 200 with zero alternatives**.

- [ ] **Step 4: Record results** in the PR description. If any assertion fails, file the fix as an extra task here, fix `app/routing/opentripplanner_provider.py`, and re-run.

## Task 15: Add a recorded real-response contract test

**Files:**
- Create: `tests/fixtures/otp_plan_response.json` (from Task 13 Step 2)
- Modify: `tests/test_opentripplanner_provider.py`

- [ ] **Step 1: Write the failing test**

Save the Task 13 response to `tests/fixtures/otp_plan_response.json`. Append to `tests/test_opentripplanner_provider.py`:

```python
def test_provider_parses_recorded_live_response():
    import json
    from pathlib import Path

    import httpx

    from app.routing.opentripplanner_provider import OpenTripPlannerProvider
    from app.routing.schemas import RouteLocation, RouteRequestData

    payload = json.loads((Path(__file__).parent / "fixtures" / "otp_plan_response.json").read_text())

    def handler(_request):
        return httpx.Response(200, json=payload)

    provider = OpenTripPlannerProvider("http://otp", transport=httpx.MockTransport(handler))
    request = RouteRequestData(
        user_id_hash="u",
        origin=RouteLocation(label="A", latitude=47.623, longitude=-122.321),
        destination=RouteLocation(label="B", latitude=47.609, longitude=-122.335),
        mode="transit",
    )
    alternatives = provider.get_routes(request)
    assert alternatives, "expected at least one itinerary from the recorded response"
    first = alternatives[0]
    assert first.summary_geometry and ";" in first.summary_geometry
    assert first.transfer_count >= 0
    assert first.segments[0].segment_type == "access"
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/python -m pytest tests/test_opentripplanner_provider.py::test_provider_parses_recorded_live_response -q`
Expected: PASS. If it fails, the recorded shape differs from what the provider parses — fix `opentripplanner_provider.py` (this is the bug Task 14 was hunting), re-run until green.

- [ ] **Step 3: Reset the dev default** — remove/blank `MCA_ROUTING_PROVIDER` from `.env` (leave the default `mock` for normal dev) so the suite doesn't depend on a running OTP.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/otp_plan_response.json tests/test_opentripplanner_provider.py
git commit -m "test(routes): pin OTP provider against a recorded live response"
```

---

# Milestone 4 — Port to the ThinkPad

## Task 16: Pin the OTP image and document the macOS path

**Files:**
- Modify: `scripts/otp_thinkpad_setup.ps1:25`
- Modify: `docs/DEPLOY.md:210` (and the build command above it)

- [ ] **Step 1: Pin the image in the script.** In `scripts/otp_thinkpad_setup.ps1`, change line 25:

```powershell
$Image    = "docker.io/opentripplanner/opentripplanner:2.7.0"
```

- [ ] **Step 2: Pin the image in DEPLOY.md.** Replace every `opentripplanner/opentripplanner:latest` in `docs/DEPLOY.md` (the serve command at line 210 and the build snippet) with `opentripplanner/opentripplanner:2.7.0`. Add a short note under the OTP section:

```markdown
> **Local macOS validation:** the same Docker recipe runs natively (arm64). Use `~/otp` as the
> data dir, raise Docker Desktop memory to ≥14 GB for the one-time `--build --save`, and point the
> app at `http://localhost:8090/otp/gtfs/v1` (not `host.docker.internal`). The setup script is
> Windows-only; on macOS run the `docker run … --build --save` and `--load --serve` commands by hand.
```

- [ ] **Step 3: Verify docs test still passes**

Run: `.venv/bin/python -m pytest tests/test_config_routing.py -q`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/otp_thinkpad_setup.ps1 docs/DEPLOY.md
git commit -m "ops: pin OTP image to 2.7.0 and document macOS validation"
```

---

# Final gate

## Task 17: Full verification

- [ ] **Step 1: Run the project gate**

Run: `make test-all`
Expected: pytest + `ruff check .` + frontend `npm test` + `npm run build` all pass.

- [ ] **Step 2: Confirm the live behavior once more** (OTP running, `.env` flipped) per Task 14, then reset to the mock default.

- [ ] **Step 3: Finish the branch** — use superpowers:finishing-a-development-branch to open the PR.

---

## Self-review notes (author)

- **Spec coverage:** A1 RouteEndpoint → Task 1; A2 optional labels → Task 1; A3 get_place + IDOR → Task 2; A4 _resolve_endpoint → Task 2; A5 server-authoritative → Task 4; A6 timeout → Task 5, departure_time → Task 6, .env doc → Task 7; A7 error mapping → preserved (unchanged except new `UnknownRoutePlaceError` reuse, covered by Task 2 IDOR test); A8 DB columns untouched. B1 types → Task 9; B2 client → Task 9; B3 RoutesTab + modes + result states → Task 10; B4 MapWorkspace → Task 11. Privacy echo → Task 3. C1–C4 → Tasks 12-15. C5/pin → Task 16.
- **Placeholder scan:** every code step shows complete code; no TBD/TODO.
- **Type/name consistency:** `_resolve_endpoint(session, user_id_hash, endpoint, label)`, `get_place(session, place_id, user_id_hash)`, `RouteEndpointInput` (`{place_id}` | `{latitude,longitude,label}`), option keys `place:<id>` / `geo:<i>`, and `geocodeSearch` match across backend, frontend, and tests.
