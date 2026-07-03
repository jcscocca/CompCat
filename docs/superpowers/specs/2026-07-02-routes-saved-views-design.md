# Routes saved views (C3 · increment 2) — design

**Date:** 2026-07-02 · **Roadmap item:** Phase 4 · C3 increment 2 (Routes saved views) ·
**Status:** approved design, pre-implementation.

## Problem

Increment 1 (PR #78) shipped durable, shareable `?view=` links for the **Analyze** and
**Compare** tabs: the link encodes *inputs* (generalized ~110 m coordinates + settings),
recomputes on open against current SPD data, and stores nothing server-side. The **Routes**
corridor tab was deferred. This increment extends the same shareable-view pattern to Routes so
a user can share a From→To corridor comparison as a link.

## Key finding (why this is frontend-only)

The Routes backend **already accepts inline coordinates**: `RouteEndpoint`
(`app/routing/schemas.py`) is `place_id` XOR `latitude/longitude/label`, and
`_resolve_endpoint` (`app/services/route_service.py`) resolves coordinate endpoints directly
(`source="geocoded"`). So a shareable Routes view needs **no backend change** — it reuses the
existing `POST /routes/alternatives` endpoint with coordinate endpoints. This increment is
purely frontend + wire-format.

## Scope

**In scope (frontend only):**
- A `tab: "routes"` variant of `SavedView` + its `encodeView`/`decodeView` branch
  (`frontend/src/lib/savedView.ts`).
- A "Copy link to this view" affordance on `RoutesTab`, generalizing both endpoints to ~110 m
  and resolving saved-place endpoints to coordinates (no `place_id` ever enters the link).
- `?view=<routes>` hydration in `MapWorkspace`: seed the Routes tab + settings + endpoints and
  recompute once on open, reusing the existing shared-view/error banners.

**Out of scope (explicitly):**
- Any backend change. `RouteEndpoint`/`_resolve_endpoint`/`create_route_alternatives` are
  untouched; no schema, no migration, no new endpoint.
- **Statelessness.** Unlike inc 1's points path, opening a shared Routes view recomputes via
  the existing endpoint, which persists `RouteRequest`/`RouteAlternative`/`RouteSegment`/
  `RouteContextSummary` rows — under the *opener's* session, identical to them typing the
  route themselves. This deviation from inc 1's stateless promise is accepted (approved during
  brainstorming): the Routes feature is inherently stateful, and a shared-view open is
  functionally normal usage. The privacy protection that carries over is coordinate
  generalization + never embedding `place_id`s.
- Offense-category filtering (`c`): the route request schema has no `offense_category`, so the
  routes view omits it.

## Approach

Chosen: **extend the inc-1 wire format and hydration in place**, adding a routes branch
alongside analyze/compare. Rejected: a separate routes-only encoder (needless duplication —
the base64url(JSON) envelope, version gate, and banner handling are shared).

### 1 · Wire format (`frontend/src/lib/savedView.ts`)

Add a routes variant to the `SavedView` union and the compact JSON schema:

```
{ v: 1, t: "routes",
  o: { y: <lat>, x: <lng>, l: <label> },   // origin  (generalized ~110 m)
  d: { y: <lat>, x: <lng>, l: <label> },   // destination (generalized ~110 m)
  m: "transit" | "walk" | "bike" | "drive",
  r: <radius_m>,                            // single radius (RoutesTab uses radii_m=[radiusM])
  s: <start_date>, e: <end_date>,
  ly: "reported" | "calls" }
```

- `SavedView` gains a discriminated `tab: "routes"` member carrying
  `origin: ViewPoint`, `destination: ViewPoint`, `mode: RouteMode`, plus the shared
  `radiusM`, `startDate`, `endDate`, `layer`. It does NOT carry `points` or `offenseCategory`.
- `encodeView`: serialize the routes branch to the compact keys above.
- `decodeView`: parse the routes branch and validate — both `o` and `d` present with numeric
  `y`/`x`; each coordinate inside `SEATTLE_BBOX` (reuse the frontend constant inc 1 uses);
  `m` one of the four known modes; `l` a string. Any failure → return `null` (never throw),
  which drives the existing "that shared link couldn't be opened" warning banner. Unknown
  `v`/`t` already return `null` in inc 1.

### 2 · Copy-link on RoutesTab (`frontend/src/components/RoutesTab.tsx`)

- Add a "Copy link to this view" button, placed consistently with the Analyze/Compare copy
  buttons, **enabled only when both endpoints are chosen and a `result` exists** (a link that
  can't recompute is useless).
- MapWorkspace passes an `onCopyLink(origin, destination, mode)` callback (keeps encoding
  centralized, mirroring inc 1's `buildShareUrl`). The callback:
  1. Resolves each endpoint to coordinates: a `{ latitude, longitude, label }` endpoint is used
     as-is; a `{ place_id }` endpoint is looked up in `places` and replaced with that place's
     display coordinates + label. **No `place_id` enters the link** (the opener can't resolve
     another account's saved place).
  2. Generalizes both coordinates to 3 decimals (~110 m), matching inc 1's `toFixed(3)`.
  3. Encodes via `encodeView({ tab: "routes", origin, destination, mode, radiusM, startDate,
     endDate, layer })` and copies the full `?view=` URL to the clipboard.
- Copy uses the same clipboard + transient "Copied" affordance as Analyze/Compare.

### 3 · Hydration on open (`frontend/src/components/MapWorkspace.tsx`)

The mount-time `?view=` read already exists. Add the routes branch:
- On a decoded `tab === "routes"` view: set `activeTab = "routes"`, seed the shared `analysis`
  from the view (`startDate`, `endDate`, `radiusM`, `layer`), and pass the decoded endpoints
  into RoutesTab as new optional props `initialOrigin`, `initialDestination`, `initialMode`.
- RoutesTab seeds its endpoint choosers from those props as **coordinate** endpoints (shown
  with their labels via the existing `geo:<lat>,<lng>` keying) and fires **one** `runRoute` on
  mount when they're present — the same recompute-on-open behavior as Analyze/Compare's
  single mount run. Guard against re-running on subsequent renders (run-once ref/flag).
- The existing dismissible "Shared view" banner (`mc-banner`) and the "couldn't be opened"
  warning (`mc-banner mc-banner-warn`) are reused unchanged.

## Data flow

1. **Share:** RoutesTab (current origin/destination/mode + shared analysis) → `onCopyLink` →
   resolve place_ids to coords → generalize → `encodeView` → clipboard URL.
2. **Open:** `MapWorkspace` mount reads `?view=` → `decodeView` → routes branch → seed tab +
   analysis + RoutesTab init props → RoutesTab runs `runRoute(origin, destination, mode)` once
   → existing `/routes/alternatives` call (stateful, coordinate endpoints) → results render.

No change to `useRoutes`, the API client's `createRouteAlternatives`, or any backend module.

## Error handling / edge cases

- **Malformed/oversized/out-of-bbox routes view:** `decodeView` returns `null` →
  warning banner; no run. Covers missing endpoint, non-numeric coords, out-of-Seattle coords,
  unknown mode.
- **Place endpoint with no coordinates available:** if a `{ place_id }` endpoint can't be
  resolved in `places` at copy time (shouldn't happen for a selected place), the copy button
  is inert / no link produced rather than emitting a `place_id`-bearing or partial link.
- **Recompute divergence:** generalizing endpoints to ~110 m may nudge the recomputed route
  slightly versus the sharer's original. Acceptable and consistent with inc 1's
  recompute-on-open model (the link encodes inputs, not frozen results).
- **Copy-link neutrality (product invariant):** all new copy ("Copy link to this view",
  "Shared view", banners) stays neutral — never "safe/unsafe/dangerous/risk". Routes framing
  already describes corridor *reported incident context*, not safety.

## Testing

- `frontend/src/lib/savedView.test.ts`:
  - routes round-trip: `encodeView` → `decodeView` preserves origin/destination/mode/
    radius/dates/layer.
  - reject: endpoint outside `SEATTLE_BBOX`, missing origin or destination, non-numeric
    coords, unknown mode, unknown version → `decodeView` returns `null`.
- `frontend/src/components/RoutesTab.test.tsx`:
  - copy-link with a geocoded endpoint builds a `?view=` decoding back to the same generalized
    coords + mode.
  - copy-link with a **saved-place** endpoint emits generalized coordinates + label and
    **no `place_id`** in the payload.
  - button disabled until both endpoints chosen and a result exists.
  - `initialOrigin`/`initialDestination`/`initialMode` seed the choosers and trigger exactly
    one `runRoute` on mount.
- `frontend/src/components/MapWorkspace.test.tsx`:
  - `?view=<routes>` → routes tab active, shared-view banner, exactly one route run on mount.
  - malformed routes `?view=` → warning banner, no run.

## Verification gate

`make test-all` (pytest + ruff + frontend `npm test` + `npm run build`) from the worktree.
Frontend-only change, but the full gate runs per project convention.

## Roadmap tick

On merge, update the C3 line in `docs/ROADMAP.md`: mark increment 2 (Routes saved views)
shipped, noting the accepted statefulness deviation and that it required no backend change.
