# Arrests as a third, de-merged incident-context layer — design

**Date:** 2026-07-02 · **Roadmap item:** Phase 4 · C4 follow-up (arrests enforcement lens) ·
**Status:** approved design, pre-implementation.

## Problem

C4 inc 1 ingested SPD Arrest Data and **unioned it into the `reported` layer**
(`LAYERS[LAYER_REPORTED] = (SOURCE_SPD_CRIME, SOURCE_SPD_ARRESTS)`). That conflates two
different measurements:

- A **reported incident** says an offense was *reported to have occurred* here.
- An **arrest** is *enforcement activity* — a person taken into custody, logged **where the
  arrest was made** (which may differ from where the offense occurred). Most reported crimes
  never produce an arrest, many arrests (drug/DUI/warrant) have no victim report, and an
  arrest's geography reflects patrol/enforcement patterns as much as crime.

Counting arrests as reported incidents therefore launders enforcement geography into apparent
crime geography — the exact distortion the product invariant ("report *reported incident
context*; never rank places safe/unsafe") exists to prevent. It also **double-counts**: a
crime report and its resulting arrest are both counted in `reported`, and the code comment
notes they "may share a `report_number`" ([app/crime/sources.py:57](../../app/crime/sources.py)).

The union is only tenable where arrests and crimes can be reliably linked. On Waypoint's
**public** deployment they cannot — public arrest/crime data is redacted enough that an arrest
can't be joined back to its crime to dedupe or attribute location. (On internal SPD data the
two are far better matched, but the product ships against the public data.)

## Decision

De-merge arrests: make `reported` **crime-reports-only** and surface arrests as their **own,
third, clearly-labeled layer** (Reported / Arrests / Calls), framed as *enforcement activity,
not incidents* — mirroring how the `calls` layer is framed as *requests for service, not
confirmed incidents*.

## Key finding (why this is mostly copy, not plumbing)

The source-aware layer architecture (C4) was built for exactly this. Adding a key to the
`LAYERS` dict auto-propagates to:
- **Validation** — `app/api/dashboard_schemas.py` `_validate_layer` and
  `app/routing/schemas.py` both check `value in LAYERS`; no hardcoded `{"reported","calls"}`.
- **Freshness** — `dashboard_freshness_by_layer` iterates `LAYERS.items()`, so arrests gets
  its own "data through" date automatically.
- **Query paths** — every `sources_for_layer(layer)` call (Analyze/Compare/Routes/Assistant/
  exports) resolves the new layer's source with no change.
- **Category handling** — arrests carry `offense_category=None` (NIBRS text in
  `offense_subcategory`), so a crime-category filter naturally excludes them, identical to the
  existing calls behavior.

So the substantive work is **framing copy** (so arrests never read as incidents) + tests + docs.
No database migration: `layer` is a string column and "arrests" is just a new valid value.

## Scope

**In scope:**
1. `LAYERS` change: `reported` → `(SOURCE_SPD_CRIME,)`; add `LAYER_ARRESTS = "arrests"` →
   `(SOURCE_SPD_ARRESTS,)`; `calls` unchanged. Disjoint three-layer model.
2. Framing copy for arrests across backend (semantic layer + prompt) and frontend (toggle,
   noun helper, freshness label, analyze note, saved-view decode), plus correcting the
   *reported* wording from "crime + arrests" to "crime reports."
3. Tests (three-layer disjointness, freshness, analysis, framing) and
   `docs/architecture/data-model.md`.

**Out of scope (explicitly deferred):**
- **Taxonomy crosswalk** (unifying arrest NIBRS descriptions with the crime offense taxonomy).
  The arrests layer works without it — its category breakdown groups by the arrest's own
  subcategories. A crosswalk is only needed to compare arrest categories *against* crime
  categories, and remains a separate roadmap follow-up.
- **Arrest demographics** (still not ingested).
- **`CALLS_DATA_FLOOR` drift** (separate follow-up).
- Any change to the safety-refusal guard — it is layer-independent and stays untouched.

## Approach

### 1 · Layer model (`app/crime/sources.py`)

```python
LAYER_REPORTED = "reported"
LAYER_ARRESTS = "arrests"
LAYER_CALLS = "calls"

LAYERS: dict[str, tuple[str, ...]] = {
    LAYER_REPORTED: (SOURCE_SPD_CRIME,),
    LAYER_ARRESTS: (SOURCE_SPD_ARRESTS,),
    LAYER_CALLS: (SOURCE_SPD_911,),
}
```
Update the module comment (currently describes reported as "SPD reports and arrests are
unioned") to describe three disjoint layers. `LAYER_REPORTED` remains the default everywhere.

### 2 · Framing copy

The canonical arrest caveat (reused verbatim where a full sentence fits):

> **"Arrests are enforcement activity, not reported incidents. An arrest is logged where the
> arrest was made — which may differ from where an offense occurred — and most reported crimes
> never result in one."**

Spots to update:

**Backend**
- `app/assistant/semantic_layer.py` — the `POLICY_CAVEATS` layer clause and the
  `analyze_places`/`compare_places` tool descriptions: add the arrests meaning; change
  "'reported' is SPD crime + arrests" → "'reported' is SPD crime reports"; add "'arrests' is
  SPD arrest records — enforcement activity, not reported incidents."
- `app/assistant/prompts.py` — the `PLANNING_SYSTEM_PROMPT` layer definition: same three-layer
  wording.

**Frontend**
- `frontend/src/types.ts` — `LayerKey = "reported" | "calls" | "arrests"`.
- `frontend/src/components/LayerToggle.tsx` — add `{ value: "arrests", label: "Arrests" }`
  (plain label; the analyze note carries the framing). Toggle renders three options.
- `frontend/src/lib/layerCopy.ts` — `incidentNoun("arrests")` → singular `"arrest"`, plural
  `"arrests"`, pluralCap `"Arrests"`.
- `frontend/src/components/DataFreshness.tsx` — noun for arrests → `"SPD arrests"`.
- `frontend/src/components/AnalyzeTab.tsx` — the `mc-layer-note` (currently shown for calls)
  gains an arrests branch rendering the caveat above.
- `frontend/src/lib/savedView.ts` — the decode fallback
  `layer: wire.ly === "calls" ? "calls" : "reported"` becomes a known-layer check that also
  passes `"arrests"` through (so a shared arrests view round-trips instead of silently
  coercing to reported).

### 3 · Category filter behavior on the arrests layer

No new logic. Arrests (`offense_category=None`) behave exactly as calls do under the existing
category filter (a crime-category filter excludes them). Mirror whatever the UI already does
for the calls layer with the offense-category selector (e.g. the calls-layer note/handling in
AnalyzeTab). This is an existing pattern, not new work.

## Data flow (unchanged plumbing)

`layer` flows request → `sources_for_layer(layer)` → incident query filtered to that layer's
`source_dataset`(s). The only behavioral change is the *contents* of `reported` (crime only)
and the *existence* of `arrests`. Freshness, exports, routes corridor context, and assistant
tools all resolve the new layer through the same `sources_for_layer` path.

## Error handling / edge cases

- **Unknown layer** still rejected by the existing `_validate_layer`/`value in LAYERS` checks
  (arrests now passes; typos still 422).
- **Stored summaries computed under the old union:** `AnalysisRun`/`PlaceCrimeSummary`/
  `RouteRequest` rows with `layer="reported"` written before this change reflect the old
  crime+arrests count. They are recomputed on next run (points path is stateless; place runs
  recompute), so no migration and no durable wrong state — worth a one-line note in the PR.
- **Category filter on arrests/calls:** yields empty by design (category is a crime-report
  concept); mirrors calls, no regression.
- **Product invariant:** de-merging strengthens it. The safety guard is layer-independent and
  untouched. All new copy stays neutral/enforcement-framed — never "safe/unsafe/dangerous."

## Testing

- `tests/test_crime_sources.py`: three layers map to disjoint single sources
  (`reported→(crime,)`, `arrests→(arrests,)`, `calls→(911,)`); all pairwise disjoint;
  unknown-layer still rejected.
- `tests/test_dashboard_freshness.py`: response includes an `arrests` entry with its own
  count/`data_through`; empty-dataset case includes arrests; retire/rename the obsolete
  "defaults to reports and ignores arrests" test.
- `tests/test_dashboard_analysis_api.py`: the reported layer returns crime **only** (no longer
  unions arrests); a new arrests-layer query returns arrests only; calls unchanged. Update the
  `_seed_layered_incident` helper accordingly.
- Framing tests: the planning prompt / semantic layer contain the arrest enforcement wording;
  frontend `incidentNoun("arrests")` and the AnalyzeTab arrests note render the caveat.
- Existing unknown-layer-rejection and "summary records analyzed layer" tests stay green.

## Verification gate

`make test-all` (pytest + ruff + frontend `npm test` + `npm run build`) from the worktree.

## Roadmap tick

On merge, update the C4 line in `docs/ROADMAP.md`: the arrests enforcement-lens follow-up is
shipped as a de-merged third layer (`reported` now crime-only; arrests disjoint, enforcement-
framed); note the taxonomy crosswalk and `CALLS_DATA_FLOOR` drift remain deferred.
