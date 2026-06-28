# Real Routes — OpenTripPlanner routing between saved Places

**Date:** 2026-06-27
**Branch / worktree:** `jcscocca/claude/real-routes-otp` (`.worktrees/real-routes-otp`)
**Status:** Design — awaiting user review before implementation plan.

## Goal

Make the Routes feature genuinely useful by replacing its two hollow seams:

1. **Inputs** — route between the user's **saved Places** (and/or a **geocoded address**), instead of a closed 6-neighborhood fixture dropdown.
2. **Routing engine** — serve **real** routes from **OpenTripPlanner (OTP) 2.x**, instead of the deterministic mock that only returns a comparable pair for one hardcoded origin/destination.

Validation runs **locally on the developer Mac** (Docker OTP) and is written to **port cleanly to the single-box ThinkPad** deploy that already has the OTP runbook.

## Product invariant (must not break)

Waypoint reports *reported incident context*. Routes MUST NOT score safety or rank routes as safe/dangerous. This work keeps the existing framing: it compares the **reported-incident corridor context** of route alternatives with the existing statistical machinery, and surfaces "nothing to compare" / "routing unavailable" honestly rather than fabricating data. **No silent mock fallback** when OTP is the configured provider.

## Current state (verified)

- `RouteRequestCreate` ([app/routing/schemas.py:25](app/routing/schemas.py)) takes free-text `origin_label` / `destination_label`, bound by **both** the public router ([app/api/routes_public_routes.py:18](app/api/routes_public_routes.py), auth `required_public_user_hash`) and the internal router ([app/api/routes_routes.py:21](app/api/routes_routes.py), auth `current_user_hash`, `include_in_schema=False`). Both call the same `create_route_alternatives` / `get_route_comparison`.
- `create_route_alternatives` resolves both endpoints at [route_service.py:35-36](app/services/route_service.py) via `resolve_route_place(label)` ([place_resolver.py:11](app/routing/place_resolver.py)), which only matches the 6-entry `SEATTLE_ROUTE_PLACES` fixture; unknown → `UnknownRoutePlaceError` → HTTP 400. **Session and `user_id_hash` are already in scope** at that point.
- The OTP provider ([opentripplanner_provider.py](app/routing/opentripplanner_provider.py)) is complete and consumes **only** `origin/destination` lat/lon — so any `RouteLocation` with valid coords works regardless of source. It is exercised only by an inline-dict unit test ([test_opentripplanner_provider.py](tests/test_opentripplanner_provider.py)); it has **never run against a live OTP**.
- Geocoding already exists end to end: `GET /dashboard/geocode?q=` (Nominatim, cached) reached on the frontend via `geocodingProvider.search(q)` ([frontend/src/lib/geocoding.ts:32](frontend/src/lib/geocoding.ts)).
- Saved Places already reach the UI: `MapWorkspace` derives `places: Place[]` from `getDashboardSummary().places` ([MapWorkspace.tsx:120](frontend/src/components/MapWorkspace.tsx)). `PlaceCluster` ([app/models.py:87](app/models.py)) stores precise `centroid_*` (NOT NULL) and generalized `display_*` (nullable, snapped to ~110 m).
- OTP deploy scaffolding exists for the ThinkPad: [scripts/otp_thinkpad_setup.ps1](scripts/otp_thinkpad_setup.ps1), [docs/DEPLOY.md](docs/DEPLOY.md) §Routing, `.env.example`, `docker-compose.yml`.

## Scope

**In scope**
- Backend: structured route endpoints (saved-place id + geocoded coords), user-scoped place resolution, public endpoint hardening, two provider bug-fixes, doc fix.
- Frontend: Place/address picker, new request payload, honest result states.
- OTP: local macOS bring-up + first-contact validation; provider correctness against a live 2.x server; notes to port to the ThinkPad.

**Out of scope (future)**
- Re-display of resolved endpoints in the response header (`RouteComparison.request` widening) beyond what's needed.
- Car routing quality / traffic awareness (OTP street routing only).
- Using `departure_time` / `preferences` in the UI (schema accepts them; UI does not send them yet).
- Removing the 6-fixture label path (kept as a fallback; `mock_provider` still uses it).

---

## Component A — Backend: Place/address-aware route endpoints

### A1. New `RouteEndpoint` model

Insert in [app/routing/schemas.py](app/routing/schemas.py) immediately after `RouteLocation` (after line 22), before `RouteRequestCreate`:

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

(`model_validator` is pydantic v2; the file already imports from `pydantic`.)

### A2. `RouteRequestCreate` — add structured endpoints, keep labels back-compatible

Make labels optional and add the endpoint objects ([schemas.py:25-37](app/routing/schemas.py)). Resolution precedence is decided in the service (endpoint object wins, else label), **not** by a strict either/or validator — this keeps the ~13 existing tests and the demo's fixture labels working.

```python
class RouteRequestCreate(BaseModel):
    origin_label: str | None = None
    destination_label: str | None = None
    origin: RouteEndpoint | None = None
    destination: RouteEndpoint | None = None
    mode: SupportedRouteMode = "transit"
    # ... rest unchanged ...
```

### A3. User-scoped place loader

The resolver must load a place by **id AND `user_id_hash` in a single query** (IDOR: ids are UUIDs but an unscoped `session.get` would leak another user's precise home/work centroid). The existing `_get_user_place` ([manual_place_service.py:178](app/services/manual_place_service.py)) is correctly scoped **but also filters to manual places** (`cluster_method='manual_public_dashboard'`, `label_source='manual'`), so it would silently 404 imported/clustered places that the UI lists.

**Decision:** add a slim, source-agnostic helper next to `list_places` in [app/services/place_service.py](app/services/place_service.py):

```python
def get_place(session: Session, place_id: str, user_id_hash: str) -> PlaceCluster | None:
    return session.scalar(
        select(PlaceCluster).where(
            PlaceCluster.id == place_id,
            PlaceCluster.user_id_hash == user_id_hash,
        )
    )
```

This routes to **any** of the user's saved Places (matching what the UI shows), still strictly user-scoped.

### A4. Additive endpoint resolver in `route_service`

Leave `resolve_route_place(label)` untouched (mock provider depends on it). Add a private helper above `create_route_alternatives`:

```python
def _resolve_endpoint(session, user_id_hash, endpoint, label):
    if endpoint is not None and endpoint.place_id is not None:
        place = get_place(session, endpoint.place_id, user_id_hash)
        if place is None:
            raise UnknownRoutePlaceError(f"Unknown saved place: {endpoint.place_id}")
        return RouteLocation(
            label=endpoint.label or place.display_label or "Saved place",
            latitude=place.centroid_latitude,        # precise — required for accurate routing
            longitude=place.centroid_longitude,
            display_latitude=place.display_latitude,  # generalized — for output
            display_longitude=place.display_longitude,
            location_type=place.inferred_place_type,
            source="saved_place",
        )
    if endpoint is not None and endpoint.latitude is not None:
        return RouteLocation(
            label=endpoint.label or f"{endpoint.latitude:.5f}, {endpoint.longitude:.5f}",
            latitude=endpoint.latitude,
            longitude=endpoint.longitude,
            location_type="unknown",
            source="geocoded",
        )
    if label is not None:
        return resolve_route_place(label)  # 6-fixture fallback (unchanged)
    raise UnknownRoutePlaceError("No origin/destination provided")
```

Replace [route_service.py:35-36](app/services/route_service.py) with:

```python
origin = _resolve_endpoint(session, user_id_hash, request_payload.origin, request_payload.origin_label)
destination = _resolve_endpoint(session, user_id_hash, request_payload.destination, request_payload.destination_label)
```

Everything downstream (the persisted `RouteRequest` at lines 43-56, the provider `RouteRequestData` at 72-86) already reads `origin.label/latitude/longitude/display_*/location_type` — **no further change**. Reusing `UnknownRoutePlaceError` keeps the existing 400 mapping.

### A5. Server-authoritative provider (close the silent-mock vector)

Today `request_payload.provider or settings.routing_provider` ([route_service.py:38](app/services/route_service.py)) lets a client POST `"provider": "mock"` and override a server configured for OTP. The **public** endpoint must ignore the client `provider` field and always use `settings.routing_provider`. Keep the per-request override available only on the **internal** endpoint (tests rely on it). Implement by having the public endpoint clear/forbid `provider` before calling the service (or pass an `allow_provider_override=False` flag).

### A6. Provider hardening (defects on the go-live path)

- **Timeout plumbing:** `get_routing_provider` drops `settings.opentripplanner_timeout_s`, so `MCA_OPENTRIPPLANNER_TIMEOUT_S` is inert ([providers.py:34](app/routing/providers.py)). Add a `timeout_s` param to `get_routing_provider`, pass `settings.opentripplanner_timeout_s` from [route_service.py:39-41](app/services/route_service.py), and update the test double signature at [test_route_alternatives_api.py:462](tests/test_route_alternatives_api.py).
- **`departure_time` query safety:** it's a free-form `str` interpolated raw into the GraphQL string ([opentripplanner_provider.py:67-68](app/routing/opentripplanner_provider.py)). Validate/normalize to `HH:MM[:SS]` (reject otherwise) or switch the `plan` args to GraphQL variables. (UI does not send it yet, so this is hardening, not a blocker.)
- **Doc fix:** `.env.example:36` says "OTP1-style REST /plan API" — correct it to "OTP2 GTFS GraphQL endpoint (…/otp/gtfs/v1)".

### A7. Error mapping — preserve exactly

Keep, in **both** route endpoints:
- `UnknownRoutePlaceError`, `UnsupportedRoutingProviderError` → **400**
- `RoutingProviderError` → **502**
- `detail=str(exc)`

A geocoder outage on a future server-side geocode path should map to **502** (like a provider outage), not 400.

### A8. DB columns unchanged

`RouteRequest.origin_label/destination_label` are **model columns** ([models.py:191,197](app/models.py)) asserted by migration/export tests. Keep them; they store the resolved label. This is distinct from the request-schema field change.

---

## Component B — Frontend: Place/address picker + honest results

No new fetch and no new client function are required — places and the geocoder are already in `MapWorkspace`.

### B1. Types ([frontend/src/types.ts](frontend/src/types.ts))

```ts
export type RouteEndpointInput =
  | { place_id: string }
  | { latitude: number; longitude: number; label: string };
```

`GeocodeResult` (`{label, latitude, longitude, source}`) maps directly to the coords variant.

### B2. API client ([frontend/src/api/client.ts:105-114](frontend/src/api/client.ts))

Change `createRouteAlternatives` payload from `origin_label/destination_label` strings to:

```ts
createRouteAlternatives(payload: {
  origin: RouteEndpointInput;
  destination: RouteEndpointInput;
  mode: string;
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
}): Promise<RouteComparison>   // still POST /routes/alternatives
```

### B3. RoutesTab ([frontend/src/components/RoutesTab.tsx](frontend/src/components/RoutesTab.tsx))

- Delete the hardcoded `const PLACES = [...]` (line 4).
- New props: `places: Place[]` and `geocodeSearch: (q: string, signal?: AbortSignal) => Promise<GeocodeResult[]>`.
- From/To become comboboxes: choose a saved Place (value = `place.id` → send `{place_id}`) **or** type an address → `geocodeSearch` → pick a result (→ send `{latitude, longitude, label}`). Prefer `{place_id}` for saved places (let the backend resolve precise coords); guard out places with null coords.
- `onRun` signature: `(origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string)`.
- Keep all four mode chips. OTP serves `transit`/`walk`/`bike` well; `drive` uses OSM street routing (not traffic-aware) — keep it with no special handling, and avoid copy that implies a real driving ETA.
- Result states made explicit: **comparison** (≥2 alternatives) · **"one option — nothing to compare"** (1) · **"no route found"** (0 itineraries) · **"routing temporarily unavailable"** (502). The map polyline rendering is unchanged and still depends on `summary_geometry`.

### B4. MapWorkspace wiring ([frontend/src/components/MapWorkspace.tsx](frontend/src/components/MapWorkspace.tsx))

- Render (line 443-445): pass `places={places}` (already in scope, line 120) and `geocodeSearch={geocodingProvider.search}` (already imported, line 7).
- `handleRunRoute` (302-320): change params to `RouteEndpointInput` and send `origin`/`destination` objects instead of labels. No new state/effects.

> Note: `geocodingProvider.search` is a closure (no `this`), so passing it bare is safe; bind defensively if refactored.

---

## Component C — OTP bring-up + macOS validation runbook

### C1. Local stand-up (Apple Silicon, native arm64 image)

Prereqs: Docker Desktop running with **Memory raised to ~14–16 GB** for the one-time build (default may OOM an `-Xmx8g` build); ~10 GB free disk.

```bash
mkdir -p ~/otp && cd ~/otp
curl -L -o washington-latest.osm.pbf https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf
curl -L -o gtfs_puget_sound_consolidated.zip https://gtfs.sound.obaweb.org/prod/gtfs_puget_sound_consolidated.zip   # filename MUST contain "gtfs"

# Build graph (one-time, RAM/time heavy). Pin the tag to avoid :latest schema drift.
docker run --rm -e JAVA_TOOL_OPTIONS=-Xmx8g -v ~/otp:/var/opentripplanner \
  docker.io/opentripplanner/opentripplanner:2.7.0 --build --save

# Serve
docker run -d --name otp --restart unless-stopped -p 8090:8080 \
  -e JAVA_TOOL_OPTIONS=-Xmx8g -v ~/otp:/var/opentripplanner \
  docker.io/opentripplanner/opentripplanner:2.7.0 --load --serve
docker logs -f otp   # wait for "Grizzly server running"
```

If the statewide build OOMs/takes too long, clip OSM to a Puget Sound bbox with `osmium extract` and rebuild (note in DEPLOY.md as the Mac fallback).

### C2. Smoke test (proves schema compatibility)

`http://localhost:8090/graphiql`, then the exact field set the provider sends:

```bash
curl http://localhost:8090/otp/gtfs/v1 -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ plan(from:{lat:47.623,lon:-122.321}, to:{lat:47.609,lon:-122.335}, transportModes:[{mode:TRANSIT},{mode:WALK}], numItineraries:3) { itineraries { duration walkDistance legs { mode duration distance transitLeg route { shortName longName } from { name lat lon } to { name lat lon } legGeometry { points } } } } }"}'
```

Expect non-empty `data.plan.itineraries`, **no** top-level `errors`, and at least one **transit** leg (confirms GTFS loaded — a street-only graph silently returns walk-only).

### C3. Point the app & route through it

`.env` (native app on Mac → **localhost**, not `host.docker.internal`):

```
MCA_ROUTING_PROVIDER=opentripplanner
MCA_OPENTRIPPLANNER_BASE_URL=http://localhost:8090/otp/gtfs/v1
```

Restart `make run`, then exercise via the UI (saved Place or address) and via `POST /routes/alternatives`.

### C4. Provider assertions to verify against the live server

- `summary_geometry` decodes to a sane Seattle polyline (lat ~47.6, lon ~-122.3).
- `transfer_count == max(0, transit_legs - 1)`, `≥ 0`.
- segment order: `access` first, transit legs `ride`, last `egress`, middle walk `walk`.
- `duration_minutes == itinerary_seconds / 60`; `distance_m == sum(leg distances)`.
- `docker stop otp` → `POST /routes/alternatives` returns **502** (`RoutingProviderError`).
- Unroutable pair → **200 with zero alternatives** (not an error).

### C5. Port to ThinkPad

The Mac path mirrors the existing `.ps1` exactly except shell syntax and `localhost` vs LAN IP/`host.docker.internal`. Update [docs/DEPLOY.md](docs/DEPLOY.md) and [scripts/otp_thinkpad_setup.ps1](scripts/otp_thinkpad_setup.ps1) to **pin the image tag** (2.7.0) and add the Mac fallback note; otherwise no ThinkPad change is needed.

---

## Privacy decision (please confirm)

Routing **must** use precise `centroid_*` coords (the generalized `display_*` are ~110 m and nullable → would mis-route or crash). The open question is what the **response** echoes. `_request_to_dict` ([route_service.py:308-322](app/services/route_service.py)) currently returns precise `latitude`/`longitude` for the endpoints.

**Recommendation:** route on precise centroids internally; have the **public response surface only generalized `display_*`** for the origin/destination endpoints (label + generalized coords), and keep **Tableau route exports generalized** ([test_route_tableau_exports.py](tests/test_route_tableau_exports.py)). The drawn `summary_geometry` still traces the real corridor (that's the feature), but we don't add a precise machine-readable coordinate echo. This honors `privacy_level="generalized"` and the product's privacy-first posture while keeping the map useful. *Alternative:* echo precise to the owning session only (it's the user's own data). Flagged for your call.

---

## Testing plan

Backend
- New: `RouteEndpoint` validation (exactly-one-of); `_resolve_endpoint` branches (place_id → coords; lat/lon passthrough; label fallback); **place_id owned by another `user_id_hash` → 400** (IDOR guard); `get_place` scoping.
- Migrate request bodies: [test_routes_public_api.py](tests/test_routes_public_api.py) (`_route_body` helper + 4 tests), [test_route_alternatives_api.py](tests/test_route_alternatives_api.py) (13 tests; re-derive the fixture-coupled assertions — `provider_metadata` fixture tag, "Unknown route place" message, 1-vs-≥2 counts; timeout test double at :462), [test_route_tableau_exports.py](tests/test_route_tableau_exports.py).
- Provider: extend [test_opentripplanner_provider.py](tests/test_opentripplanner_provider.py) for timeout plumbing and `departure_time` validation.
- Config/doc: [test_config_routing.py](tests/test_config_routing.py) (defaults + `.env.example`/README/DEPLOY mentions).
- Server-authoritative provider: public endpoint ignores client `provider`; internal still honors it.
- Keep model-column tests green (do not rename DB columns).

Frontend
- `RoutesTab`: lists saved places; address search calls `geocodeSearch`; emits `{place_id}` vs `{latitude,longitude,label}`; the four result states render. Existing `routeGeometry` tests unchanged.

Gate: **`make test-all`** (pytest + ruff + `npm test` + `npm run build`). Plus the live OTP validation checklist (C2–C4), which is manual and not part of `make test-all`.

---

## Milestones (isolates the risky OTP step)

1. **M1 — Backend (no OTP):** A1–A8. Fully testable against the mock provider.
2. **M2 — Frontend (no OTP):** B1–B4. Testable against the mock backend.
3. **M3 — OTP live:** C1–C4; fix first-contact bugs; flip config; validate provider assertions.
4. **M4 — Port:** C5 docs/script pin + ThinkPad confirm.

---

## Open decisions flagged for review

1. **Privacy echo** (above) — generalized-only response vs. precise-to-owner. *Recommend generalized-only.*
2. **Place scope** — route to **any** saved Place (new `get_place`) vs. manual-only (`_get_user_place`). *Recommend any.*
3. **Image pin** — pin OTP to `2.7.0` in runbook/script vs. keep `:latest`. *Recommend pin.*
