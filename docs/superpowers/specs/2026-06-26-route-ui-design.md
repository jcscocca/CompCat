# Route UI + Public Route Endpoints (epic B2)

**Date:** 2026-06-26
**Status:** Approved for implementation
**Related:** roadmap epic **B** (B1 — OTP provider — shipped in PR #20). This is **B2**, the
route UI; tracked in the v2 backlog as the last remaining deferred item.

## Goal

Surface the already-built route engine in the UI: a **Routes** drawer tab that compares
transit/walk/bike/drive alternatives between known Seattle places by the **reported-incident
context along each corridor**, with the route lines drawn on the map — and promote the route
endpoints to the public, session-gated tier.

## Background / current state

- The backend route engine is built and tested, only internal-gated:
  `route_service.create_route_alternatives` (POST `/internal/routes/alternatives`) creates a
  `RouteRequest` from origin/destination labels + mode, runs the routing provider, persists
  `RouteAlternative` + `RouteSegment`, computes per-route-point `RouteContextSummary`, runs a
  statistical corridor comparison (`analysis_service.compare_route_request`), and **returns
  the full comparison payload** (`request`, ranked `alternatives` + `segments`,
  `context_summaries`, `statistical_comparison`). `GET /internal/routes/requests/{id}/comparison`
  re-fetches it.
- **Routing is mock-only.** B1 added the OpenTripPlanner provider, but there is no live OTP
  instance. `place_resolver` knows **6 places** (Capitol Hill, Downtown Seattle, Westlake
  Station, Rainier Valley, Ballard, University District). `mock_provider` returns **2
  alternatives only for Capitol Hill → Downtown Seattle** (Link + Pine St bus) and **1
  generic route** for every other pair. The corridor context + the one real comparison run
  against live SPD crime data, so it's a genuine but place-limited feature that generalizes
  to any origin/destination once `MCA_ROUTING_PROVIDER=opentripplanner` + a base URL are set.
- **No route UI exists** (zero frontend references). The frontend is a map-first React
  workspace: `MapWorkspace.tsx` orchestrates `MapCanvas` (react-leaflet) and a drawer with
  `places` / `analyze` / `compare` / `export` tabs. `MapCanvas` renders `Marker`s + `Circle`s
  but **no polylines** today. `client.ts` calls only the public tier.

## Decisions (approved in brainstorming)

1. **Focused Routes tab + map rendering** (not text-only, not deferred). Input is the 6 known
   places via dropdowns + a travel mode; it generalizes when OTP is live.
2. **New public `/routes` endpoints** wrapping `route_service` (epic-A pattern); the
   `/internal/routes/*` endpoints stay as-is. Session-gated, no feature flag.
3. **Draw every alternative's line on the map**, with the recommended one highlighted and the
   others muted.
4. **Product invariant:** framed as "reported-incident context along each corridor," never
   "safer route"; the verdict reuses the engine's existing invariant-safe caveat copy.

## Architecture

### Backend — public endpoints

New `app/api/routes_public_routes.py` (public tier — in OpenAPI, `required_public_user_hash`,
copying the deps pattern from `routes_public_places.py`):
- `POST /routes/alternatives` (body: existing `RouteRequestCreate`) → `create_route_alternatives(...)`;
  `UnknownRoutePlaceError` / `UnsupportedRoutingProviderError` → 400; `RoutingProviderError`
  → 502 (mirrors `routes_routes.py`).
- `GET /routes/requests/{id}/comparison` → `get_route_comparison(...)`; `None` → 404.

Register in `app/main.py` next to `public_places_router`. Add `/routes*` to the **public**
tier in `CLAUDE.md` and to the `test_internal_surface.py` allowlist (these are intentionally
public + in-schema). `test_public_session_required.py` then exercises them automatically.

### Frontend — types + client

- `frontend/src/types.ts`: `RouteAlternative`, `RouteContextSummary`, `RouteComparison`
  (`request`, `alternatives`, `context_summaries`, `statistical_comparison`) matching the
  payload shape.
- `frontend/src/api/client.ts`: `createRouteAlternatives(payload): Promise<RouteComparison>`
  (POST `/routes/alternatives`). The create response already contains the comparison, so the
  GET is only needed for re-fetch and is optional for v1.

### Frontend — Routes tab

`frontend/src/components/RoutesTab.tsx`:
- **Query bar:** origin `<select>` + destination `<select>` (the 6 known place labels), travel
  mode chips (`transit` / `walk` / `bike` / `drive`), and a Run button. The analysis date
  range + radius come from the workspace's existing `analysis` settings (shared with Analyze).
- **Results:** the **verdict block first** when `statistical_comparison` is present — render
  `overview.summary_text` + `overview.caveat_text` verbatim (already invariant-safe), with the
  recommended alternative's label. When there is a single alternative (`statistical_comparison`
  is `null`), omit the verdict and show a note that one route can't be compared. Then **one
  block per alternative** (recommended first): label, duration, transfers, walking distance,
  mode mix, and the corridor reported-incident context aggregated from `context_summaries`
  (total incident count, nearest, top offense types) at the active radius.
- Surfaced as a new `routes` drawer tab (see below).

### Frontend — MapWorkspace wiring

`frontend/src/components/MapWorkspace.tsx`:
- Extend the `TabKey` union + tab bar with `"routes"`; render `<RoutesTab .../>` when active.
- Hold `routeComparison` state; `handleRunRoute` calls `createRouteAlternatives` with the
  selected origin/destination/mode + the shared analysis settings, stores the result, and
  switches focus to the route lines.
- Derive route polylines from `routeComparison.alternatives[].summary_geometry` and pass them
  to `MapCanvas`.

### Frontend — map rendering

`frontend/src/components/MapCanvas.tsx`: add an optional `routeLines?: RouteLine[]` prop where
`RouteLine = { id: string; points: [number, number][]; recommended: boolean }`. Render a
react-leaflet `<Polyline>` per line — recommended highlighted (accent color, heavier weight),
others muted. A helper parses `"lat,lon;lat,lon"` geometry into `[lat, lon][]`. The map fits
to the combined route bounds when lines are present.

## Data flow

1. User opens the Routes tab, picks origin/destination + mode, clicks Run.
2. `POST /routes/alternatives` → engine produces ranked alternatives + corridor context +
   comparison; the response is the full payload.
3. The tab renders the verdict + per-alternative blocks; `MapCanvas` draws a polyline per
   alternative (recommended highlighted), fit to bounds.

## Error handling / edge cases

- **Unknown place** (shouldn't happen with dropdowns) → 400 surfaced as an inline error.
- **Provider failure** (`RoutingProviderError`, only when OTP is configured) → 502 → inline
  error.
- **No session** → 401 (public tier).
- **Single alternative** → no `statistical_comparison`; the tab shows the single route's
  corridor context with a "one route — nothing to compare" note.
- **Missing/short geometry** → that alternative's polyline is skipped (no crash); its block
  still renders.

## Testing

- **Backend:** public `POST /routes/alternatives` for Capitol Hill → Downtown Seattle returns
  ≥2 ranked alternatives + a `statistical_comparison`, and **401 without a session**;
  `GET /routes/requests/{id}/comparison` round-trips; `test_internal_surface.py` and
  `test_public_session_required.py` stay green (allowlist updated).
- **Frontend:** RoutesTab renders the verdict + alternative blocks for the 2-alternative pair,
  omits the verdict for a single-route pair, and calls `createRouteAlternatives` on Run;
  `MapCanvas` renders one `Polyline` per route line and highlights the recommended one; a
  geometry-parse unit test.
- **Gate:** `make test-all`.

## Out of scope

- Geocoded / arbitrary-address routing (needs a live OTP instance).
- Saving/editing routes, turn-by-turn directions, per-segment incident drilldown.
- A live OTP end-to-end smoke test; any change to the `/internal/routes/*` endpoints.
