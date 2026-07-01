# Saved Views (C3) — Design

**Date:** 2026-06-30 · **Roadmap item:** Phase 4 · C3 — *lightweight cross-session
persistence to save & revisit an analysis/comparison.* · **Status:** approved design,
pre-implementation.

## Goal

Let a user save an Analyze or Compare view and revisit it later — including days later
or on another device — via a **durable, shareable link**. The link is the artifact; there
is no account and no server-side saved-view record.

## Decisions (settled during brainstorming)

1. **Durable shareable link**, not a session-scoped list. Identity today is a session
   cookie hashed into `user_id_hash` that expires after 24h (`app/sessions.py`,
   `SESSION_MAX_AGE_SECONDS`) and does not cross devices — so a session-keyed list cannot
   deliver "revisit later." A self-contained link can.
2. **Recompute on open (saved *query*, not saved *answer*).** The link encodes inputs;
   opening it re-runs the analysis against current SPD data and shows the current data
   freshness. No stored results, no stale verdicts. (User accepted that recomputed numbers
   can shift between visits.)
3. **Scope: Analyze + Compare** this increment. Routes deferred.
4. **Mechanism: stateless self-encoding URL.** The whole view lives in a URL param; nothing
   new is stored server-side. Chosen over a server-token table because, given (1) no list
   and (2) recompute, a token buys only shorter URLs at the cost of a new public retrieval
   surface + stored location inputs.
5. **Generalized coordinates in the link.** Encode a place's generalized coordinate — its
   `display_latitude/longitude` when present, else the centroid rounded to ~3 decimals
   (≈110 m) — not a precise centroid, so a shared link never leaks a precise location. At
   100–800 m analysis radii the incident context is essentially unchanged.

## Product-invariant checkpoint

Waypoint reports *reported incident context*; it must not score or rank safety. A saved or
shared view is still reported-incident context and nothing more. Share/hydration copy (e.g.
the "Shared view" banner, the "Copy link" affordance) must not imply a place is
safe/unsafe/dangerous. Recompute-on-open (decision 2) reinforces this: a view is a live
query, never a frozen safety judgment. The assistant safety-refusal guard is unaffected —
this feature adds no assistant surface.

## Architecture

### 1. Backend — coordinate-capable analyze/compare (the shared core)

Both `DashboardAnalyzeRequest` and `DashboardCompareRequest`
(`app/api/dashboard_schemas.py`) currently require `place_ids: list[str]` — references to
the creator's `PlaceCluster` rows. A link opened under a different identity cannot resolve
those ids, so the analysis paths must accept inline coordinates.

- **Request schemas:** add optional `points: list[AnalysisPoint]` where
  `AnalysisPoint = {latitude, longitude, label}`. Exactly one of `place_ids` / `points`
  must be supplied (model validator). `points` reuses the existing Seattle-bbox guard;
  bound the count (Analyze ≥1; Compare 2–N, same N as the current place cap).
- **Service:** in `app/services/dashboard_analysis_service.py`, `_selected_clusters` is the
  single resolution seam (`analyze_selected_places`, `compare_selected_places`, and the
  incident/neighborhood paths all funnel through it). Add a sibling that builds the same
  internal cluster-data shape from inline points — synthetic id, provided label,
  `sensitivity_class="normal"` — with no DB lookup. Everything downstream (geometry,
  incident query, neighborhood stats, layer handling) is unchanged.
- **Routes:** `app/api/routes_public_dashboard.py` handlers pass through whichever input is
  present; still gated by `required_public_user_hash`. No new endpoint.

### 2. Link encoding

One URL param, `?view=<base64url(JSON)>`. The JSON is compact and **versioned** for
forward-compat:

```
{ v:1, tab:"analyze"|"compare",
  pts:[{y:<lat>, x:<lng>, l:<label>}],   // generalized coords (decision 5)
  r:<radius_m>,                          // single radius; analyze hydrates to radii_m:[r]
  s:<start_date>, e:<end_date>,
  ly:"reported"|"calls",
  cat:<offense_category|null> }
```

Pure functions `encodeView(state) -> string` and `decodeView(param) -> View | null` live in
a small frontend module with round-trip unit tests. `decodeView` returns `null` on
malformed / oversized / unknown-`v` input (never throws).

### 3. Frontend — copy-link + shared-view hydration

- **Copy link:** a "Copy link to this view" affordance on the Analyze and Compare result
  areas. It reads current state — each selected place's generalized coords + label, plus the
  `AnalysisSettings` (`startDate`, `endDate`, `radiusM`, `offenseCategory`, `layer`) — builds
  the `?view=` URL, copies to clipboard, and shows a toast.
- **Shared-view mode:** on load, `MapWorkspace` detects `?view=`, calls `decodeView`, and if
  valid seeds a **shared-view mode**: ad-hoc points instead of `selectedIds`, the correct
  tab selected, a small dismissible "Shared view" banner, then runs the analysis. The
  payload builders in `useAnalyze` / `useCompare` learn to emit `points` (from the ad-hoc
  points) instead of `place_ids` when in shared-view mode. Result rendering is untouched.
- Shared-view mode is transient and seeded only from the URL; it does not read or mutate the
  viewer's own saved places.
- The viewer can adjust controls (radius, dates, layer); these recompute through the same
  points path and update the URL. This is the only real frontend change; the shared point is
  not persisted as a place.

## Data flow

Create: Analyze/Compare result → "Copy link" → `encodeView(coords+settings)` →
`?view=…` on clipboard.
Open: URL with `?view=…` → `decodeView` → shared-view mode (points + settings, tab) →
`POST /dashboard/analyze|compare` with `points` → recompute against current data → render
with current freshness.

## Error handling

- Malformed / oversized / unknown-version `view=` → `decodeView` returns `null` → clean
  empty workspace + one dismissible "That shared link couldn't be opened" notice. Never a
  crash or half-hydrated state.
- Backend rejects requests with neither or both of `place_ids` / `points`, points outside
  the Seattle bbox, and out-of-range point counts — same error shape as today's validation.

## Testing

- **Backend:** request-validation cases (neither/both inputs, bbox, counts); a points-path
  analyze and compare produce the same result as the equivalent `place_ids` path
  (equivalence test using a seeded place's coords).
- **Frontend:** `encodeView`/`decodeView` round-trip + rejection of malformed input; copy
  link builds a correct URL from state; hydration runs analyze/compare in shared-view mode;
  malformed `view=` degrades gracefully.
- `make test-all` green (pytest + ruff + frontend test + build).

## Non-goals (this increment)

- Routes views.
- Any server-side storage, listing, revocation, or shortener (revisit only if URL length
  proves a real problem).
- Saving a shared point as a place.
- Result snapshots (recompute only).
- Compare covers **site/place options** (`compare_selected_places`), not route-corridor
  compares.
