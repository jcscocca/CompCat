# Address-Search Polish — Design (Phase 4, item H3)

> Status: approved via brainstorming 2026-06-29. **Frontend-only**; branches from `main`
> (independent of C1 / PR #71). Result ranking was dropped (no relevance metadata); a
> **Seattle-results guarantee** was added per the user's request.

## Objective

Upgrade the shared address-search box used by **Places** and **Routes** from a manual, bare
state machine into a polished **type-ahead**: debounced auto-search with stale-request
cancellation, first-class empty/error states with consistent copy, a shared **recent places**
history, and a **client-side Seattle-bbox guard** (defense-in-depth over the backend
region-lock). Plus a **live smoke** reconfirming geocoding works and only surfaces Seattle
results.

## Current context

- `useAddressSearch(search)` (`frontend/src/lib/useAddressSearch.ts`): owns `query` / `results`
  / `status` (`idle|loading|done|error`); `runSearch()` is **manual**. The `search(query,
  signal?)` signature already accepts an `AbortSignal`, but the hook never creates or passes one.
- Provider `createBackendProvider` (`frontend/src/lib/geocoding.ts`) already threads `signal`
  into `fetch` and calls `GET /dashboard/geocode`.
- Consumers: `PlaceSearch.tsx` (form submit → `runSearch`; clickable results list; hand-rolled
  error/empty messages) and `RoutesTab.tsx` (button → `runSearch`; From/To endpoint options).
- `GeocodeResult` = `{ label, latitude, longitude, source }` — **no relevance metadata**, which
  is why ranking is out.
- localStorage pattern to mirror: `drawerStorage.ts` (namespaced `waypoint.*` keys, `try/catch`
  degrade-to-default).
- Backend region-lock (**already correct — do not change**): `app/config.py`
  `geocoder_viewbox="-122.55,47.78,-122.10,47.43"` + `geocoder_bounded=True`, applied in
  `app/geocoding/providers.py` (sends `viewbox` + `bounded=1`); covered by
  `test_geocoding_providers.py` / `test_dashboard_geocode_api.py`.

## Approved decisions

| Decision | Choice |
|---|---|
| Trigger | **Type-ahead**, debounced ~300ms + abort stale; Enter + the existing button = immediate |
| States | First-class **`empty`** status; **shared** empty/error copy across both consumers |
| Recents | Recently **selected places** (label+coords); one **shared** localStorage history; click re-selects instantly; cap 5, deduped, most-recent-first |
| Seattle guarantee | **Client-side bbox filter** at the provider boundary (defense-in-depth) + live smoke |
| Ranking | **Dropped** (no relevance metadata) |
| Architecture | Enhance the **shared hook** + small modules; keep **per-consumer rendering** (no unified component) |
| Layer | **Frontend-only**; no backend geocode change |

## Components

### 1. `useAddressSearch.ts` (enhanced)
- Status enum gains `empty`: `"idle" | "loading" | "done" | "empty" | "error"` (`empty` =
  resolved with 0 results).
- **Debounce + abort:** a `useEffect` on `query` runs the trimmed search ~300ms (`DEBOUNCE_MS`)
  after typing stops, via a fresh `AbortController`; aborts the prior request and ignores
  stale/aborted responses. Blank/whitespace query → reset to `idle`, clear results.
- `runSearch()` kept for **immediate** triggers (Enter/button): cancels the pending debounce
  and runs now.
- **Recent:** loads on mount via `searchHistory`; exposes `recent: GeocodeResult[]` and
  `rememberPlace(result)` (consumers call it inside their existing select handler, so selection
  behavior stays in the consumer).
- Returns `{ query, setQuery, status, results, recent, runSearch, rememberPlace }`.

### 2. `searchHistory.ts` (new — mirrors `drawerStorage.ts`)
- Key `waypoint.search.recent`. `loadRecentPlaces(): GeocodeResult[]` and
  `addRecentPlace(result): GeocodeResult[]` — prepend, dedup by
  `` `${label}|${lat.toFixed(4)},${lng.toFixed(4)}` ``, cap **5**, most-recent-first; `try/catch`
  so private-mode/disabled storage degrades gracefully.

### 3. Seattle guard (`geocoding.ts`)
- `SEATTLE_BBOX = { west: -122.55, north: 47.78, east: -122.10, south: 47.43 }` (mirrors the
  backend `geocoder_viewbox`; comment cross-references `app/config.py` as the source of truth).
- Pure `withinSeattleBbox(result): boolean`; `createBackendProvider.search` returns
  `results.filter(withinSeattleBbox)` before resolving — so a backend config drift (or empty
  viewbox) can't leak global results to the UI. Both exported for tests.

### 4. Consumers (`PlaceSearch.tsx`, `RoutesTab.tsx`)
- Render a **Recent** list when the box is focused **and** the query is empty (click →
  `rememberPlace` + the consumer's existing select path: `onSelectResult` for Places; for Routes,
  the same From/To assignment the result options already provide — exact wiring per the plan once
  `RoutesTab`'s endpoint-option UI is read in full).
- Show the shared empty/error messages driven by `status`; keep Enter + the button (immediate
  `runSearch`). Type-ahead now fills results live.

### 5. Shared copy
- `SEARCH_EMPTY_MSG` / `SEARCH_ERROR_MSG` constants (exported from `useAddressSearch.ts`) so
  both consumers render identical text.

## Error / edge cases
- Blank/whitespace query → `idle`, no network call, results cleared; recent shown on focus.
- Rapid typing → only the last debounced call resolves; earlier ones aborted (no stale flicker).
- Rejected search → real failure surfaces as `error`; an aborted request is **ignored** (no
  state thrash).
- localStorage unavailable → recent degrades to empty/in-memory; never throws.
- All results outside the Seattle bbox → filtered to `[]`, surfaces as `empty`.
- Duplicate selection → dedup keeps a single most-recent entry.

## Testing
**Frontend**
- `useAddressSearch` (fake timers): debounce fires once ~300ms after typing stops; typing again
  before 300ms cancels the prior call; a newer query's result wins over an aborted older one;
  `done` vs `empty` vs `error`; `rememberPlace` updates `recent` and persists; blank resets to
  `idle`.
- `searchHistory`: prepend / cap-5 / dedup / order; localStorage throw → safe fallback.
- `geocoding`: `withinSeattleBbox` true inside / false outside; provider filters non-Seattle out.
- `PlaceSearch` + `RoutesTab`: recent list renders on focus-empty and selecting it calls the
  select handler + records; shared empty/error copy; Enter + button still trigger immediate
  search; type-ahead populates results.

**Live smoke (run/verify skill)** — reconfirms the user's ask: a Seattle address returns
results; "Capitol Hill" resolves in Seattle (not DC); a clearly non-Seattle query (e.g. "Times
Square") returns nothing.

**Gate:** `make test-all` in the worktree.

## Roadmap tick
The PR marks **Phase 4 · H3** done in `docs/ROADMAP.md`.

## Non-goals
- Result ranking (dropped).
- A unified `<SearchBox>` component — keep each consumer's distinct result rendering.
- Any backend geocode change — the region-lock is already correct; we add client-side defense +
  tests only.
- Server-persisted search history (localStorage only).
