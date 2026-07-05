# Map & UI overhaul — design

**Date:** 2026-07-04 · **Status:** approved design, pre-plan.
**Scope:** one direction, three shippable slices (each gets its own plan → PR).

## Why

Three user-named problems with the current app:

1. **No visible geography.** The map reads as blank; beat baselines ("vs rest of Beat U2")
   reference geography the user has never seen drawn.
2. **No visible incidents.** Incident data is block-level, but the map renders no incident
   dots — incidents exist only in tables.
3. **The shell is unloved.** The Analyst floats bottom-left unexplained; Add Pin hides
   top-left; all real interaction crams into the right panel; no cohesive visual language.

## Decisions (brainstormed & approved 2026-07-04)

| Decision | Choice | Rationale |
|---|---|---|
| Basemap serving | **Self-hosted vector tiles** (PMTiles) | Privacy: viewport reveals candidate home addresses; matches the geocode-proxy precedent. Vector enables dual light/dark styles from one artifact. |
| Map engine | **maplibre-gl**, replacing Leaflet/react-leaflet | GPU vector rendering for tiles + beat polygons + thousands of dots; two style JSONs for theming. Used directly, no react-map-gl wrapper — our surface is small. |
| Incident display | **Numbered clusters zoomed out → clickable dots zoomed in** (initial threshold z14, a named constant tuned during live preview) | Density at a glance plus drill-down. Explicitly **no heatmap** — see invariant section. |
| Visual direction | **"Civic Clear"**: white surfaces, cool grays, one confident blue; **plus night mode** | User choice. Night mode = `[data-theme="dark"]` token overrides + a dark map style. |
| Layout | **Evolved Workspace**: prominent top-left search pill (absorbs pin-drop), right panel keeps tabs, Analyst docks into the panel — labeled, first-class | A bottom "command deck" was seriously considered and rejected **for now**: the local LLM's 7–30s classify latency shouldn't be the advertised front door, and the deliberately narrow assistant would be oversold by an "ask anything" bar. The Analyst dock is designed so promoting it to a command bar later is a contained change. |

## Data facts that constrain the design (verified 2026-07-04)

- **SPD crime reports (`tazs-3rd5`):** all published locations are blurred to the 100-block
  (per the dataset dictionary). Additionally, **14.5% of rows carry the literal string
  `"REDACTED"`** in address/lat/lon — heavily skewed (rape 99.1%, fondling 90%, DV-adjacent
  person crimes 23–35%, property 0.2–3.2%). Redacted rows retain `beat` → they are
  beat-level-only context and can never appear as dots.
- **Arrests (`9bjs-7a7w`):** 100-block blur; no REDACTED policy; ~1.9% unknown locations use
  a **−1.0/−1.0 coordinate sentinel** which our ingest stores as valid floats. Bbox-gated
  queries already exclude it; any dot layer must filter it explicitly.
- **911 calls (`33kz-ixgy`):** ~76% carry 100-block `dispatch_latitude/longitude`; 24% are
  `"REDACTED"` (already handled at ingest → stored as null).
- **Both sides of place-vs-beat stats already exclude coordinate-null rows consistently**
  (`neighborhood_service.py` gates the beat baseline on `latitude IS NOT NULL`), so dots
  and stats will agree; the redaction disclosure (below) is a transparency add, not a fix.
- **Beat geometry:** our `app/data/seattle_police_beats_2018.geojson` (~428 KB, 55 beats)
  matches the authoritative current ArcGIS "Current_Beats" layer (2017–present vintage).
  Precinct/sector are attributes on it. Other city layers (Neighborhood Map Atlas, CRA,
  MCPP, parks, shoreline) are available as GeoJSON later — out of scope here.

## Slice 1 — Map foundation

**Goal:** real, crisp, self-hosted geography under everything, themable light/dark.

- Replace Leaflet in `frontend/src/components/MapCanvas.tsx` with **maplibre-gl**.
  Re-implement the existing surface 1:1: four semantic pin kinds
  (default/selected/analyzed/low-data) as DOM markers, radius rings as geodesic circle
  polygons (small pure helper — no turf dependency), click-to-place, `flyTo`, and the
  count badge on analyzed pins.
- **Tiles:** a Seattle-metro **PMTiles** extract (~50–100 MB) built from the Protomaps
  planet build via `pmtiles extract`. Served by the backend as a static file with HTTP
  range support (the static mount if Starlette's range handling suffices — verify at plan
  time — else a small range-aware endpoint); no tile server either way. The artifact is
  **not in git**:
  `make fetch-tiles` + a deploy-script step fetch it; `docs/DEPLOY.md` documents it.
- **Styles:** two MapLibre style JSONs — `civic-light`, `civic-night` — derived from the
  Protomaps basemap styles, recolored to the Civic Clear palette (pinned in this slice).
  Glyphs and sprites bundled as local frontend assets; zero external requests. OSM
  attribution stays on the map.
- **Degradation:** missing/unreachable tile file → flat styled background + a small notice;
  app remains fully functional. The Carto raster fallback stays behind a dev flag until the
  artifact pipeline is proven, then is deleted.

## Slice 2 — Transparency layers ✅ SHIPPED

**Goal:** see the beat you're being compared against; see the incidents being counted.

**Shipped deviations from the draft below (verified during build):**
- Beat GeoJSON properties slim to **`{beat}` only** — the bundled 2018 file carries no
  precinct/sector (those are attributes of the ArcGIS layer we don't bundle).
- Beat labels are **static symbol labels at zoom ≥ 12**, not hover-only — simpler and works
  on touch.
- The response field is **`unmappable_citywide_count`** (renamed from `unmappable_count`):
  it is citywide while the shown/`total_count` is viewport-scoped, so the name and the chip
  copy both carry "citywide" to avoid implying the redacted incidents are "in this view".
- `POST /dashboard/incident-points` (not GET — it carries a bounds/filter body).
- The disclosure chip sits **bottom-center** (the draft's bottom-left is the Analyst panel);
  it wraps within the viewport on narrow screens rather than overflowing.

Two new **public, session-gated, read-only** endpoints (same tier/gating as the rest of
`/dashboard/*`; `tests/test_internal_surface.py`-style coverage):

- `GET /dashboard/beats` — beat polygons as GeoJSON, properties slimmed to **`{beat}`**,
  gzip content-negotiated (`Vary: Accept-Encoding`, `Cache-Control`), cached in-process.
  No DB touch (reads the bundled file).
- `POST /dashboard/incident-points` — bounds **required** (Seattle-intersect-validated) +
  Seattle-clamped, plus the existing date/category/layer filters. Returns capped points
  `{id, latitude, longitude, offense_category, offense_subcategory, occurred_at, block_address, source_dataset}`
  — hard cap 5,000 rows (`INCIDENT_POINTS_LIMIT`, most-recent-first), excludes null coords and
  the arrests −1/−1 sentinel (structurally, via the Seattle clamp).
  Response includes `unmappable_citywide_count`: rows matching the same non-spatial filters
  whose location is redacted (drives the disclosure chip), plus `returned_count`/`total_count`
  for truncation disclosure.

Frontend map layers:

- **Beat outlines** from `/dashboard/beats`: subtle line layer + hover label; the analyzed
  place's assigned beat gets a soft fill highlight while its analysis is open, so
  "vs rest of Beat U2" has a visible referent.
- **Incident source** (`cluster: true`): numbered cluster circles zoomed out; individual
  dots at high zoom; dot click opens a small card (category, subcategory, date, block
  address). Follows the global layer toggle (Reported/Arrests/Calls) and active filters.
  Viewport-driven fetch, debounced with stale-request abort (the `useAddressSearch` pattern).
- **Disclosure chip** (bottom-left, always present when dots are on):
  "42 incidents shown · +6 with redacted location — in beat stats only."

## Slice 3 — Shell overhaul

**Goal:** the layout and visual language the app deserves.

- **Layout:** top-left **search pill** ("Search address or drop a pin") absorbs the Add Pin
  affordance — its pin button arms the existing click-to-place mode; the orphaned top-left
  button dies. Top bar: brand, layer toggle, freshness pill, session chip, **theme toggle**.
  Right panel: the four tabs (Places/Analyze/Compare/Export) plus the **Analyst dock** in
  the panel's lower section — always visible, titled, with an empty-state explainer and
  quick-action chips ("What's near this pin?", "Compare my places") wired to the existing
  SSE chat. Legend + zoom controls cluster bottom-right.
- **Theme:** rewrite the `mc-` token set (`frontend/src/styles/mapWorkspace.css`, 512
  lines) as Civic Clear semantic tokens with `[data-theme="dark"]` overrides. Night mode
  defaults to `prefers-color-scheme`, persists explicit choice in localStorage, and swaps
  the map style JSON in sync. Fold the legacy Inter `:root` scope (`styles.css`) into the
  one theme system. Type: Archivo for UI, IBM Plex Mono for figures; Fraunces (display
  serif) is dropped. Self-host the webfonts while at it: `frontend/index.html` still loads
  them from Google Fonts — the app's last external request (user IP + referrer leak),
  found during slice 1's live network audit.
- Behavior-preserving against the existing MapWorkspace/hook tests (updated for the new
  structure); per-tab hooks are untouched.

## Invariant guards (product: no safety scoring)

A crime-dot map is one color choice away from a "danger map." Hard rules:

- Dots/clusters are **one calm blue in both themes** — no red/amber, no severity gradient,
  **no heatmap** (numbered clusters give honest counts instead of ominous glow).
- Category is distinguished in the click card (text/icon), never by alarm color on the map.
- All new copy says *reported incidents* / *enforcement activity* / *calls for service*
  per layer — never safety language. Output-guard tests extend to the new strings.
- The redaction disclosure keeps the map honest about what it cannot show (most sex/DV
  offenses) instead of letting blank areas imply calm.

## Testing & rollout

- Per slice: unit tests for new logic (circle-polygon helper, incident-points
  filters/caps/sentinel exclusion, `unmappable_count`, theme persistence + style swap);
  updated MapCanvas/MapWorkspace tests; `make test-all` green before each PR; live preview
  pass including night mode and the missing-tile fallback.
- No DB migrations in any slice. Slices ship in order 1 → 2 → 3; the app is fully working
  after each.
- After all three land: roadmap gains a Phase 6 entry recording this direction; deploy doc
  gains the tile-artifact step (slice 1).

## Out of scope (recorded, not planned)

- Heat/density gradient rendering (rejected — invariant).
- Additional geographic layers (neighborhoods/CRA/MCPP, parks, shoreline) — cataloged and
  available as GeoJSON if wanted later.
- Assistant tools for driving the new map layers (toggle dots, highlight beats).
- Promoting the Analyst dock to a bottom command bar (the "Command Deck" layout) — viable
  future evolution if local-LLM latency improves materially.
- Per-category dot filtering UI beyond the existing category filter.
