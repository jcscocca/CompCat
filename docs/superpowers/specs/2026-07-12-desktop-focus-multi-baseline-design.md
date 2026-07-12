# Desktop focus mode & multi-baseline analysis — design

**Date:** 2026-07-12
**Status:** approved (brainstorm 2026-07-12)

## Summary

Three connected changes to how Waypoint presents analysis on desktop:

1. **Focus mode** — a fourth drawer preset that gives the workspace panel ~90% of the
   viewport for reading analysis, leaving the map as a live peek strip.
2. **Place identity + locator system** — every selected place gets a stable letter +
   color used on map pins, verdict cards, and plots, plus a small offline SVG locator
   chip on each verdict card so cross-city selections keep spatial context in focus mode.
3. **Multi-baseline comparison** — the Analyze verdict card compares each place against
   four nested baselines — MCPP neighborhood, police beat, sector, citywide — on one
   stacked number-line plot ("owned-interval" plot), replacing the two-bar
   `ComparisonBars` widget. MCPP becomes a first-class geography in the backend.

The product invariant is unchanged: Waypoint reports *reported incident context*. All
relation copy is "above / similar to / below" an area's **reported-incident rate** —
never safety language.

## Goals

- Reading four selected places' analyses on desktop without squinting into a 400px drawer.
- Neighborhood (MCPP) names — "Capitol Hill", "Ballard" — in headlines instead of beat codes.
- Every baseline treated equally on the plot; no visually privileged comparison.
- The plot and the "How we know" fine print derive from the same per-baseline statistics,
  so they can never disagree.

## Non-goals

- No changes to the Compare tab's ranked verdicts or number line (identity colors flow
  through, but its layout is untouched; a citywide tick there is a possible follow-up).
- No mobile/iOS layout work (Slice B of the iOS track is separate).
- Beats are **not** removed from ingest or the data model — they become one baseline
  among four.
- No new hypothesis-testing framework; the existing quasi-Poisson machinery is reused
  per baseline.

## 1. Desktop focus mode

- New drawer preset `focus` added to `peek | default | wide` in
  `frontend/src/lib/drawer.ts` and the `mc-snaps` segmented control in `BottomSheet.tsx`.
- Width: `min(viewportWidth - 96, viewportWidth * 0.9)` — the map peek strip never drops
  below 96px. `drawerMax()`'s current 720px cap does not apply to the focus preset.
- The peek strip stays a live `MapCanvas` (no snapshot): pins remain visible and
  hover-sync (§2) works against it.
- Entry/exit: user clicks the preset (or keyboard-activates it, same pattern as existing
  presets). Exiting focus returns to the previous preset. Persisted via the existing
  `drawerStorage` mechanism.
- All existing width-responsive behavior keys off `panelWidthPx` and continues to work
  (e.g. the incident table/cards switch in `AnalyzeTab`).

## 2. Place identity system

- Each place in the current selection gets a **letter** (A, B, C… by selection order,
  stable for the session) and a **color** from a fixed, validated categorical set:

  | Slot | Light theme | Notes |
  |------|-------------|-------|
  | A | `#534AB7` purple | dark theme uses a lightened step (`#6E64D9`, re-validated with the six-checks script at implementation) to clear 3:1 contrast |
  | B | `#1D9E75` teal | |
  | C | `#C2410C` orange | |
  | D | `#2E7DD1` blue | |

  Validated with the dataviz six-checks script (light + dark). Colors are assigned in
  fixed order, never cycled; places beyond D keep their letter but wear a neutral slate —
  the letter badge is always the primary identity encoding, so color is never
  load-bearing alone.
- The identity appears on: map pin markers, verdict card headers (badge), the
  owned-interval plot (band + dot), locator chips, and Compare-tab rows for the same
  places.
- **Hover-sync:** hovering a verdict card (or its locator chip) pulses the matching map
  pin; clicking the chip flies the map to it. Works at every drawer width.

## 3. Locator chips

- Each verdict card carries a ~64×72px inline SVG: simplified city outline, the place's
  MCPP polygon highlighted in the place's identity tint, a dot at the place location,
  and the neighborhood name as its caption.
- Rendered entirely client-side from vendored geometry — no map tiles. Geometry comes
  from a new public endpoint (§4) fetched once and cached alongside the existing
  `getBeatPolygons` payload; polygons are simplified server-side at asset-build time so
  the payload stays small (target: < 150 KB gzipped).
- Fallback: if the place has no MCPP assignment (§4 edge cases) the chip shows the city
  outline + dot with no highlight, captioned with the beat code if known, else nothing.

## 4. MCPP as first-class geography (backend)

**Already true:** every incident row stores `mcpp` (`app/models.py:147`); ingest maps it
for all three layers — reported crime `mcpp`, arrests `neighborhood`, 911 calls
`dispatch_neighborhood` (`app/crime/seattle_socrata.py`). No schema migration needed.

**New assets** (vendored under `app/data/`, same pattern as
`seattle_police_beats_2018.geojson` + area CSV):

- `seattle_mcpp_areas.geojson` — Micro-Community Policing Plan boundaries from Seattle
  GeoData, plus a simplified variant for the frontend/locator chips. The simplified
  payload also carries a precomputed city outline ring (union of the MCPP polygons,
  computed at asset-build time) so the locator chip never derives geometry client-side.
- `seattle_mcpp_areas_area.csv` — per-MCPP land area (km²), generated the same way as
  the beat area CSV.

**Derived geographies (no new assets):**

- **Sector** = beats sharing the letter prefix (beat `C2` ⊂ sector `C`); sector area =
  sum of member beat areas from the existing CSV.
- **Citywide** = all beats; area = sum of all beat areas (keeps one consistent
  denominator source).

**Assignment & bucketing** (mirrors the beat pipeline in
`app/services/neighborhood_service.py`):

- Place → MCPP by point-in-polygon on the display point (same rationale as
  `_assign_beat`).
- Incident bucketing by the **row attribute** (`mcpp` / `beat` / `sector` columns), not
  spatial join — robust to SPD's block-level coordinate fuzzing, same as beats today.
- The circle/area overlap correction (per the beat-area overlap fix, #107) is applied to
  MCPP exactly as to beats. Sector and citywide baselines use **whole-area** rates (no
  rest-of-area subtraction): the place circle's contribution is negligible at those
  scales; the Methods appendix states this.
- MCPP and beat baselines remain **rest-of-area** (excluding the place circle), as today.

**Junk values:** `NULL`, empty, `UNKNOWN`, and `OOJ` (out of jurisdiction) `mcpp` values
are treated as no-neighborhood for bucketing; such incidents still count toward
beat/sector/city where those fields are valid.

**Endpoints:** a public-tier `GET /dashboard/mcpp-polygons` (session-gated like the beat
polygons endpoint, `include_in_schema` consistent with its peer). No bare-path internal
re-exposure; `tests/test_internal_surface.py` continues to enforce the tier rules.

## 5. Multi-baseline comparison (API)

Extend the neighborhood analysis payload: each place gains

```
baselines: [
  { kind: "mcpp" | "beat" | "sector" | "city",
    label: "Capitol Hill" | "Beat C2" | "Sector C" | "Citywide",
    area_km2, baseline_rate,            # incidents /km²·day, same units as today
    rate_ratio, ci_lower, ci_upper,     # place vs this baseline (quasi-Poisson, φ floor)
    adjusted_p_value,
    relation: "above" | "similar" | "below" | "insufficient" }
]
```

- The existing single-beat fields (`beat_rate`, `rate_ratio`, CI, p) are superseded by
  the array; the React UI and assistant tools (`app/assistant/tools.py`) are the only
  consumers, so the old fields ship alongside the array in slice 1 and are deleted in
  slice 2 (see §10). Assistant narration/summaries switch to
  neighborhood-first copy ("similar to Capitol Hill's reported rate…") and must keep
  refusing safety-score asks.
- **Multiplicity:** the four per-place baseline tests are Holm-adjusted **within each
  place** (same approach as the existing pairwise section). The baselines are nested and
  correlated; Holm is conservative and cheap.
- `relation` is computed server-side with the existing verdict rules (adjusted p
  threshold + the 1.25× effect floor); `insufficient` when the minimum-data rule fails
  for that baseline. The frontend renders relations verbatim — it never re-derives them
  from band-vs-tick geometry, so plot and fine print cannot diverge.
- A baseline with zero incidents in the window reuses the existing zero-count CI
  handling; its tick renders at 0 with the note copy.
- Missing baselines (place outside every MCPP polygon; no sector because beat unknown)
  are simply omitted from the array; the headline aggregates whatever is present.

## 6. Owned-interval plot (frontend)

New component (working name `BaselineIntervalPlot`) replacing `ComparisonBars` inside
`VerdictCard` in `AnalyzeTab.tsx`:

- **Rows:** "This place" (identity-colored dot + solid 95% interval bar), then one row
  per baseline in fixed order — neighborhood, beat, sector, citywide — each a bare
  neutral tick + right-column "`{rate}/yr · {relation}`". All baseline rows share one
  style; nothing is privileged.
- **The owned interval:** the place's 95% interval is drawn **once** as a single
  continuous column behind all rows — tinted with the place's identity color (~9%
  opacity), dashed edges in the same hue running unbroken from the solid bar down
  through every row, and a small swatch + label ("A's 95% interval") pinned at the
  column's foot. Baseline rows carry nothing that could read as their own error bar.
- **Axis:** shared across all verdict cards in the current run (one domain covering
  every place's CI and every tick, zero-anchored), in the existing
  "incidents per year within {radius} m" unit via `annualIncidentsWithin`
  (`frontend/src/lib/rateFormat.ts`). Shared axis means the citywide tick lands in the
  same visual position on every card.
- **Headline:** `decisionHeadline` (`frontend/src/lib/verdictCopy.ts`) is reworked to
  aggregate relations into one sentence — "Above the citywide and sector rates; similar
  to Capitol Hill and its beat." The single-baseline tone chip is removed.
- **Hover:** per-mark tooltips (tick → "Sector C · 8.7 /yr"; band → interval bounds).
- **"How we know"** gains a per-baseline table: kind, label, place vs baseline rate,
  ratio CI, adjusted p, method — the same numbers the relations were derived from.
- Layer-awareness carries over: copy uses `incidentNoun(analysis.layer)`; the plot works
  identically for reported / calls / arrests.

## 7. Copy & invariant guardrails

- Relation vocabulary is fixed: "above / similar to / below the reported-incident rate
  of {area}". No safe/unsafe/dangerous, no ranking language. The output ranking-prose
  guard (#106) applies to assistant narration of these results.
- Methods appendix (`frontend/src/lib/methodsDefinitions.ts`) documents: MCPP source and
  vintage, rest-of-area vs whole-area baselines, Holm adjustment across the four
  baselines, and the nested-baseline caveat.
- `docs/architecture/data-model.md` and the API contract doc get the payload change;
  ROADMAP gets its tick per the usual cadence.

## 8. Edge cases

- **Place outside all MCPP polygons** (waterfront, boundary sliver): omit neighborhood
  baseline; locator chip falls back per §3.
- **Beat unknown** → sector also unknown; both omitted.
- **Wide CI swallowing all ticks:** headline reads "similar to" everything — correct and
  honest; small-sample note (existing `< 20` incidents rule) still renders.
- **Shared-view / lookup subjects** (synthesized places): identity letters assign the
  same way; save-to-places keeps the letter.
- **>4 places selected:** letters continue, neutral slate color per §2.
- **SQLite + Postgres:** no migrations; asset loading and SoQL-independent, so no
  dialect branching needed.

## 9. Testing

- **Backend (pytest):** MCPP point-in-polygon assignment (boundary + outside cases);
  junk-value bucketing; sector derivation from beat prefixes; area sums; per-baseline
  ratio/CI/p against hand-computed fixtures; Holm adjustment ordering; zero-count and
  missing-baseline payload shapes; endpoint tier placement (`test_internal_surface.py`).
- **Frontend (vitest):** relation rendering is verbatim from payload; shared-axis domain
  computation; identity letter/color assignment incl. >4 places; focus preset clamp
  math and persistence; locator chip fallback; `ComparisonBars` removal doesn't orphan
  CSS.
- Gate: `make test-all` before any completion claim.

## 10. Implementation order

Three PR-sized slices, each independently shippable:

1. **Backend geography + API** — MCPP assets, sector/city derivation, `baselines[]`
   payload, assistant tool copy, tests. (UI still renders old fields until slice 2 —
   ship both field sets in this slice, delete old fields in slice 2.)
2. **Analyze tab plot** — `BaselineIntervalPlot`, headline aggregation, How-we-know
   table, identity badges on cards, remove `ComparisonBars` + old payload fields.
3. **Focus mode + locators** — drawer preset, locator chips, hover-sync, pin identity
   styling. Pure frontend.
