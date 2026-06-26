# Analyze Tab — Neighborhood-Relative Statistics + Methods Appendix

**Date:** 2026-06-25
**Status:** Approved for implementation
**Related:** supersedes the redundant presentation introduced in `2026-06-25-incident-detail-analysis-design.md`

## Goal

Rebuild the Analyze tab to (1) remove the redundant findings/charts/table restatement and (2) surface the statistical engine that is computed on every run but never displayed — framed as **each place measured against its own police-beat baseline**. Add an always-accessible **Methods appendix** that defines every measure shown.

## Background / current state

- `frontend/src/components/AnalyzeTab.tsx` stacks three overlapping sections that restate the same counts: auto-written findings bullets, two bar charts (Crime mix = % of total; Specific offenses = % of the largest offense — inconsistent denominators), and the incident-details table.
- The engine (`app/analysis/rate_tests.py`, `app/analysis/comparison.py`) computes exposure-adjusted rates, rate ratios, 95% CIs, exact-/quasi-Poisson p-values, Benjamini–Hochberg adjustment, overdispersion φ, decision classes, and data-adequacy gates. Only a single `overview.summary_text` sentence reaches the UI (Compare tab); the entire `analytical` payload is unused.
- The Analyze path (`app/services/dashboard_analysis_service.py::analyze_selected_places` → `app/crime/summaries.py`) computes only raw counts, not the rate engine.

## Decisions (locked in brainstorming)

1. **Baseline = the place's own SPD police beat** (2018-present geometry). Each place is scored as an exposure-adjusted rate (incidents per km²·day) and compared to its beat's rate.
2. **Denominator = official beat area.** Computed once, offline, from Seattle's published "Seattle Police Beats 2018-Present" polygons, **reprojected to a local/equal-area CRS before measuring** (Web Mercator inflates area ~2× at Seattle's latitude; the place buffer is in true meters, so the beat must be too). Shipped as a static `beat → area_km²` lookup. No live geometry or point-in-polygon at runtime.
3. **Data scope = 2018-01-01 onward.** Crime ingestion gains a 2018 floor; UI date pickers floor at 2018-01-01. This matches the single 2018-present beat vintage to the data and eliminates era-matching.
4. **Layout = verdict-first with analytical on tap**, rendering the engine's existing overview/analytical tiers:
   `verdict (ratio + decision badge) → evidence line (place rate, beat rate, 95% CI) → monthly trend → ▸ analytical detail (p, φ/method, adequacy, baseline, source) → nearest incidents`.
   One block per selected place. Filter controls move to the **top** of the panel (fixes "set filters after reading results").
5. **Multi-place:** blocks stack; in addition to each place-vs-beat verdict, show place-vs-place pairwise comparisons. A beat too sparse under the active filter degrades to "insufficient data," never a fabricated ratio.
6. **Methods appendix:** an always-accessible glossary (reusing the existing `BottomSheet`) reachable via an inline ⓘ next to each measure and a persistent "Methods" button. Analyze and Compare share one definition source. A test asserts every rendered measure has an entry.

**Out of scope / future:** MCPP and sector/precinct baselines (beat-only for v1, but the data layer stays generic enough to add levels); fallback to a coarser level for sparse beats; friendly beat names; any pre-2018 data; the two retired bar charts and the per-visit / per-dwell rates (stay retired as previously deemed misleading).

## Architecture

### New asset — beat-area reference
- Static `beat → area_km²` table (repo data file + loader, or a migration-seeded table — decided in planning). Source: Seattle GeoData "Seattle Police Beats 2018-Present" polygons; areas precomputed offline by a documented one-off script (reproject → area). Keyed by the `beat` string stored on `CrimeIncident`.
- A coverage check flags any `beat` value present in the crime data but missing an area.

### Backend
- **Beat baseline computation.** For each selected place + date range + offense filter: determine the place's beat (modal `beat` tag among incidents in its buffer, falling back to nearest tagged incident), count the beat's incidents under the same filters, look up the beat area, and form exposure `(count, area_km² × days)`. Run the existing `compare_incident_rates` between the place `(count, π·r² × days)` and its beat, reusing `comparison.py` (monthly-count dispersion, BH adjustment across the comparison set, decision classes, adequacy gates).
- **Extend `dashboard_analysis_service`** with a neighborhood analysis returning, per place: place rate, beat baseline rate, rate ratio + CI + adjusted p + decision class + φ/method + adequacy status + monthly counts + nearest distance + type mix; plus, for ≥2 places, pairwise place-vs-place results.
- **Ingestion floor.** Admin/Socrata ingest defaults and clamps `start_date` to ≥ 2018-01-01; earlier rows are skipped.
- **Endpoint:** `/dashboard/neighborhood` (or an extension of `/dashboard/analyze`) returning the structured payload. Compute on demand to start; persistence reuse is a planning question. **The neighborhood endpoint is a new route backed by a new `beat_baselines` module and never reads or writes `place_crime_summaries`, so this work stays decoupled from analysis-run provenance (roadmap WS2) and avoids merge collisions with the existing analyze path.**

### Frontend
- **Rebuilt `AnalyzeTab`:** filter bar (top) → one block per place → run button. Each block = verdict, evidence row, monthly-trend sparkline, collapsible analytical detail, nearest-incidents list. Retire the two bar charts and per-visit/per-dwell rates.
- **`MethodsAppendix` component** (wraps `BottomSheet`): renders entries from a shared `methodsDefinitions` module; opened by inline ⓘ (anchored to a term) and a persistent button. Reused by Analyze and Compare.
- **Types/client:** new response types + a `getNeighborhoodAnalysis(...)` client call; `MapWorkspace` fetches after Run, stores the result, and invalidates on selection/filter change (mirrors the existing `incidentDetails` wiring).
- **Date floor:** pickers `min = 2018-01-01`; update defaults in `frontend/src/lib/analysisDefaults.ts`.

### Shared definitions (single source of truth)
- `methodsDefinitions`: for every measure, `{ id, term, shownAs, plain, howToRead, formulaOrCaveat }`. The appendix renders it; a unit test asserts every measure `id` rendered on the tab resolves to a definition (the glossary cannot silently drift).

## Data flow

1. User selects places, sets filters (top of panel), clicks Run.
2. Frontend → `/dashboard/neighborhood` with `place_ids`, `radius_m`, date range (≥ 2018-01-01), offense filter.
3. Backend resolves each place's beat, computes place + beat exposure-adjusted rates, runs the rate tests (and pairwise for multiple places), returns the structured payload.
4. Frontend renders one block per place; the Methods appendix is reachable throughout.

## Error handling / edge cases

- **Beat unknown** for a place (no tagged incidents nearby) → count-only block, "neighborhood baseline unavailable."
- **Beat area missing** from the lookup → same fallback + coverage warning logged.
- **Adequacy gate unmet** (< 30 days or < 10 combined incidents) → "insufficient data" verdict, no ratio.
- **Sparse/zero counts** → continuity correction (already in `compare_incident_rates`); degenerate cases surface as insufficient/model-warning, never `∞`.
- **Date range partly before 2018** → clamp to 2018-01-01 with a visible notice.

## Testing

- **Backend:** beat assignment; beat-area lookup + coverage; exposure-adjusted rate; rate-ratio integration (reuse `rate_tests`); pairwise for ≥2 places; adequacy gating; 2018 ingestion floor.
- **Frontend:** AnalyzeTab renders verdict/evidence/trend/analytical/incidents; appendix opens via ⓘ and via the button; **coverage test** (every rendered measure has a definition); date floor enforced; multi-place stacking.
- **Test data:** a realistic 2018+ SPD sample ingested into the dev DB (Socrata `tazs-3rd5`, `start_date=2018-01-01`), plus precomputed areas for the beats present in the sample.

## Open questions for planning

- Persist neighborhood results, or compute on demand? (Lean on-demand.)
- Beat-area asset format: repo CSV/JSON + loader vs migration-seeded table.
- Exact place→beat assignment rule (modal tag in buffer vs nearest incident) and tie-breaks.
