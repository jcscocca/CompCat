# Arrests as a De-merged Third Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `reported` layer crime-reports-only and surface SPD arrests as their own disjoint, enforcement-framed third layer (Reported / Arrests / Calls).

**Architecture:** The source-aware layer model (`app/crime/sources.py` `LAYERS` dict) drives validation, freshness, and every incident query via `sources_for_layer`. Adding one dict key auto-propagates the plumbing; the substantive work is (a) the dict change and (b) framing copy — backend assistant prompt/semantic layer and frontend toggle/notes/labels — so arrests read as enforcement activity, never as incidents. No database migration (`layer` is a string column).

**Tech Stack:** FastAPI + SQLAlchemy (Python), React + TypeScript (Vitest). `make test-all` gate.

**Design reference:** `docs/superpowers/specs/2026-07-02-arrests-third-layer-design.md`

---

## File Structure

- **Backend model:** `app/crime/sources.py` — the `LAYERS` dict + `LAYER_ARRESTS` (Task 1).
- **Backend framing:** `app/assistant/semantic_layer.py`, `app/assistant/prompts.py` (Task 2).
- **Frontend plumbing/copy:** `frontend/src/types.ts`, `components/LayerToggle.tsx`, `lib/layerCopy.ts`, `components/DataFreshness.tsx`, `lib/savedView.ts` (Task 3).
- **Frontend Analyze framing:** `frontend/src/components/AnalyzeTab.tsx` — layer note, category-filter gate, incident-details header generalization (Task 4).
- **Frontend Compare + docs:** `frontend/src/components/CompareTab.tsx`, `docs/architecture/data-model.md` (Task 5).
- **Tests** live beside each: `tests/test_crime_sources.py`, `tests/test_dashboard_analysis_api.py`, `tests/test_dashboard_freshness.py` (Task 1); a framing assertion (Task 2); `*.test.tsx`/`*.test.ts` for the frontend (Tasks 3–4).
- **Gate + roadmap + PR** (Task 6).

Run Python tests with `.venv/bin/python -m pytest <file> -v`; frontend with `cd frontend && npx vitest run <file>` and `npx tsc --noEmit`.

---

## Task 1: Backend layer model — `reported` becomes crime-only, add `arrests`

**Files:**
- Modify: `app/crime/sources.py`
- Test: `tests/test_crime_sources.py`, `tests/test_dashboard_analysis_api.py`, `tests/test_dashboard_freshness.py`

- [ ] **Step 1: Rewrite the layer tests to the three-layer model.** In `tests/test_crime_sources.py`, replace the body of `test_layers_map_to_underlying_sources` and `test_layers_are_disjoint_so_a_call_is_never_blended_with_its_report` (keep the function names or rename to the below — either is fine, but the assertions must be):

```python
def test_layers_map_to_underlying_sources():
    assert sources_for_layer(LAYER_REPORTED) == (SOURCE_SPD_CRIME,)
    assert sources_for_layer(LAYER_ARRESTS) == (SOURCE_SPD_ARRESTS,)
    assert sources_for_layer(LAYER_CALLS) == (SOURCE_SPD_911,)


def test_layers_are_pairwise_disjoint():
    # Reported (crime reports), arrests (enforcement), and calls (911) are distinct,
    # non-overlapping source sets — an arrest is never counted as a reported incident.
    sets = [
        set(sources_for_layer(LAYER_REPORTED)),
        set(sources_for_layer(LAYER_ARRESTS)),
        set(sources_for_layer(LAYER_CALLS)),
    ]
    for i in range(len(sets)):
        for j in range(i + 1, len(sets)):
            assert sets[i].isdisjoint(sets[j])
```

Add `LAYER_ARRESTS` to the imports at the top of `tests/test_crime_sources.py` (from `app.crime.sources`).

- [ ] **Step 2: Run to verify it fails.**
Run: `.venv/bin/python -m pytest tests/test_crime_sources.py -v`
Expected: FAIL — `LAYER_ARRESTS` doesn't exist and `reported` still returns `(crime, arrests)`.

- [ ] **Step 3: Update `app/crime/sources.py`.** Replace the layer block (the comment on lines ~56-59, the `LAYER_REPORTED`/`LAYER_CALLS` constants, and the `LAYERS` dict) with:

```python
# Map analysis (UI) layers onto the underlying source datasets. The three layers are
# mutually exclusive: "reported" is SPD crime reports only; "arrests" is SPD arrest records
# (enforcement activity — an arrest is logged where the arrest was made, which may differ from
# where an offense occurred, and most reported crimes never result in one); "calls" is 911
# calls for service. Arrests are deliberately NOT unioned into "reported" — on the public
# (redacted) data an arrest can't be linked back to its crime, so unioning double-counts and
# conflates enforcement geography with incidence. See docs/architecture/data-model.md.
LAYER_REPORTED = "reported"
LAYER_ARRESTS = "arrests"
LAYER_CALLS = "calls"

LAYERS: dict[str, tuple[str, ...]] = {
    LAYER_REPORTED: (SOURCE_SPD_CRIME,),
    LAYER_ARRESTS: (SOURCE_SPD_ARRESTS,),
    LAYER_CALLS: (SOURCE_SPD_911,),
}
```

- [ ] **Step 4: Run to verify it passes.**
Run: `.venv/bin/python -m pytest tests/test_crime_sources.py -v`
Expected: PASS.

- [ ] **Step 5: Fix the dashboard-analysis layer test.** In `tests/test_dashboard_analysis_api.py`, replace `test_dashboard_incidents_reported_layer_unions_crime_and_arrests` (lines ~171-194, which asserts the OLD union) with the disjoint-layer test below. It reuses the file's real helpers verbatim: `_client_with_places_and_crime(tmp_path)` (pre-seeds a crime row `"incident-a"` at the Downtown place) and `_seed_layered_incident(client, *, source, external_id)`:

```python
def test_dashboard_incidents_layers_are_disjoint(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    # incident-a (crime) is already at the Downtown place; add an arrest and a 911 call there.
    _seed_layered_incident(client, source="seattle_spd_arrests", external_id="arr-1")
    _seed_layered_incident(client, source="seattle_spd_911", external_id="call-1")
    place_id = client.get("/places").json()["places"][0]["id"]
    body = {
        "place_ids": [place_id],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }

    def ids(layer: str) -> set[str]:
        resp = client.post("/dashboard/incidents", json={**body, "layer": layer})
        assert resp.status_code == 200, resp.text
        return {row["incident_id"] for row in resp.json()["incidents"]}

    # reported = crime only — the arrest is no longer unioned in.
    assert ids("reported") == {"incident-a"}
    # arrests layer = arrests only.
    assert ids("arrests") == {"arr-1"}
    # calls layer = 911 only.
    assert ids("calls") == {"call-1"}
    # No layer specified still defaults to reported (crime only).
    default = client.post("/dashboard/incidents", json=body).json()
    assert {row["incident_id"] for row in default["incidents"]} == {"incident-a"}
```

Keep the pre-existing `test_dashboard_analyze_rejects_unknown_layer` and `test_dashboard_summary_reports_the_analyzed_layer` unchanged.

- [ ] **Step 6: Fix the freshness tests.** In `tests/test_dashboard_freshness.py` (seeds via `_client(tmp_path)` + direct `CrimeIncident(...)` rows):

(a) In `test_freshness_reports_count_range_and_last_ingested`, after the existing `assert body["calls"]["incident_count"] == 0`, add:
```python
    # The arrests layer is empty here too (seeded rows are reported crime).
    assert body["arrests"]["incident_count"] == 0
```

(b) In `test_freshness_empty_dataset_returns_nulls`, change the expected mapping to three keys:
```python
    assert response.json() == {"reported": empty, "arrests": empty, "calls": empty}
```

(c) Replace `test_freshness_defaults_to_reports_and_ignores_arrests` (around line 91 — its premise that arrests fold into reported's default is now obsolete) with:
```python
def test_freshness_arrests_layer_is_separate_from_reported(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id="c1", source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 1, 5, tzinfo=UTC),
                offense_category="PROPERTY", latitude=47.6, longitude=-122.3,
            ),
            CrimeIncident(
                id="a1", source_dataset="seattle_spd_arrests",
                offense_start_utc=datetime(2024, 1, 6, tzinfo=UTC),
                latitude=47.6, longitude=-122.3,
            ),
        ]
    )
    session.commit()
    session.close()

    body = client.get("/dashboard/freshness").json()
    assert set(body) >= {"reported", "arrests", "calls"}
    assert body["reported"]["incident_count"] == 1   # crime only (arrest not unioned in)
    assert body["arrests"]["incident_count"] == 1     # arrests only
    assert body["calls"]["incident_count"] == 0
```

- [ ] **Step 7: Run the affected suites.**
Run: `.venv/bin/python -m pytest tests/test_crime_sources.py tests/test_dashboard_analysis_api.py tests/test_dashboard_freshness.py -v`
Expected: PASS. If another backend test elsewhere asserted the old union, fix it to the new behavior and note it.

- [ ] **Step 8: Commit.**
```bash
git add app/crime/sources.py tests/test_crime_sources.py tests/test_dashboard_analysis_api.py tests/test_dashboard_freshness.py
git commit -m "feat(crime): de-merge arrests into a disjoint third layer (reported now crime-only)"
```

---

## Task 2: Backend assistant framing (prompt + semantic layer)

**Files:**
- Modify: `app/assistant/semantic_layer.py`, `app/assistant/prompts.py`
- Test: `tests/test_assistant_semantic_layer.py` (add a framing assertion)

- [ ] **Step 1: Write the failing test.** Append to `tests/test_assistant_semantic_layer.py` (match its existing import style; `POLICY_CAVEATS` is importable from `app.assistant.semantic_layer`):

```python
def test_policy_caveats_frame_the_three_layers_including_arrests():
    from app.assistant.semantic_layer import POLICY_CAVEATS

    text = " ".join(POLICY_CAVEATS).lower()
    # Reported is crime reports only (arrests are no longer unioned into it).
    assert "crime + arrests" not in text
    # Each layer is named and arrests are framed as enforcement, not incidents.
    assert "arrests" in text
    assert "enforcement" in text
    assert "911 calls" in text or "calls for service" in text
```

- [ ] **Step 2: Run to verify it fails.**
Run: `.venv/bin/python -m pytest tests/test_assistant_semantic_layer.py::test_policy_caveats_frame_the_three_layers_including_arrests -v`
Expected: FAIL — the caveat still says "SPD crime + arrests" and doesn't mention "enforcement".

- [ ] **Step 3: Update `app/assistant/semantic_layer.py`.** Replace the layer clause in `POLICY_CAVEATS` (the entry that currently begins "The active layer (active_filters.layer) decides what the counts mean: 'reported' is SPD crime + arrests…") with:

```python
    (
        "The active layer (active_filters.layer) decides what the counts mean: 'reported' is "
        "SPD crime reports; 'arrests' is SPD arrest records — enforcement activity, not "
        "reported incidents (an arrest is logged where the arrest was made, which may differ "
        "from where an offense occurred, and most reported crimes never result in one); "
        "'calls' is 911 calls for service — requests, not confirmed incidents (one event can "
        "generate several calls, and many are proactive officer activity). Describe results "
        "using the active layer's terms."
    ),
```

Then update the `analyze_places` and `compare_places` tool descriptions in `AVAILABLE_TOOLS` so the parenthetical lists three layers, e.g. change "the active layer (reported incidents, or 911 calls when layer is 'calls')" → "the active layer (reported incidents; arrests when layer is 'arrests'; 911 calls when layer is 'calls')", and the compare one similarly.

- [ ] **Step 4: Update `app/assistant/prompts.py`.** In `PLANNING_SYSTEM_PROMPT`, replace the layer-definition sentence (lines ~9-13, "The active data layer is active_filters.layer: "reported" means SPD crime + arrests; …") with:

```
The active data layer is active_filters.layer: "reported" means SPD crime reports;
"arrests" means SPD arrest records — enforcement activity, not reported incidents (an arrest
is logged where the arrest was made, which may differ from where an offense occurred, and most
reported crimes never result in one); "calls" means 911 calls for service — requests for
service, not confirmed incidents (one event can generate several calls, and many are proactive
officer activity). Tools run against the active layer automatically; describe results in that
layer's terms (reported incidents, arrests, or 911 calls) and never present arrests or 911
calls as confirmed crimes.
```

- [ ] **Step 5: Run to verify it passes + the assistant suite.**
Run: `.venv/bin/python -m pytest tests/test_assistant_semantic_layer.py tests/test_assistant_agent.py -v`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add app/assistant/semantic_layer.py app/assistant/prompts.py tests/test_assistant_semantic_layer.py
git commit -m "feat(assistant): frame arrests as a distinct enforcement layer in prompt + caveats"
```

---

## Task 3: Frontend layer type, toggle, copy helpers, freshness, saved-view

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/components/LayerToggle.tsx`, `frontend/src/lib/layerCopy.ts`, `frontend/src/components/DataFreshness.tsx`, `frontend/src/lib/savedView.ts`
- Test: `frontend/src/lib/layerCopy.test.ts` (create if absent), `frontend/src/components/LayerToggle.test.tsx`, `frontend/src/lib/savedView.test.ts`

- [ ] **Step 1: Write the failing tests.**

(a) `frontend/src/lib/layerCopy.test.ts` — add (or create the file with) a case:
```ts
import { describe, expect, it } from "vitest";
import { incidentNoun } from "./layerCopy";

describe("incidentNoun arrests", () => {
  it("uses arrest nouns for the arrests layer", () => {
    expect(incidentNoun("arrests")).toEqual({ singular: "arrest", plural: "arrests", pluralCap: "Arrests" });
  });
});
```

(b) `frontend/src/components/LayerToggle.test.tsx` — add (or create) a case asserting all three options render. Model it on the file's existing tests if present; otherwise:
```ts
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerToggle } from "./LayerToggle";

afterEach(cleanup);

describe("LayerToggle", () => {
  it("offers reported, arrests, and calls", () => {
    render(<LayerToggle layer="reported" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /reported incidents/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^arrests$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /911 calls/i })).toBeInTheDocument();
  });
});
```

(c) `frontend/src/lib/savedView.test.ts` — add a case that an arrests layer survives round-trip:
```ts
it("preserves the arrests layer through encode/decode", () => {
  const view = { tab: "analyze" as const, points: [{ latitude: 47.6, longitude: -122.3, label: "P" }], radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31", layer: "arrests" as const, offenseCategory: "" };
  expect(decodeView(encodeView(view))?.layer).toBe("arrests");
});
```
(Ensure `decodeView`/`encodeView` are imported at the top of that test file.)

- [ ] **Step 2: Run to verify they fail.**
Run: `cd frontend && npx vitest run src/lib/layerCopy.test.ts src/components/LayerToggle.test.tsx src/lib/savedView.test.ts`
Expected: FAIL — `LayerKey` doesn't include "arrests", the toggle lacks the option, incidentNoun has no arrests case, and decode coerces unknown layers to "reported".

- [ ] **Step 3: Widen the `LayerKey` type.** In `frontend/src/types.ts`, change:
```ts
export type LayerKey = "reported" | "calls";
```
to:
```ts
export type LayerKey = "reported" | "arrests" | "calls";
```

- [ ] **Step 4: Add the toggle option.** In `frontend/src/components/LayerToggle.tsx`, change the `LAYERS` array to:
```ts
const LAYERS: { value: LayerKey; label: string }[] = [
  { value: "reported", label: "Reported incidents" },
  { value: "arrests", label: "Arrests" },
  { value: "calls", label: "911 calls" },
];
```
and update the component doc-comment's "'reported' unions SPD crime + arrests" to "'reported' is SPD crime reports; 'arrests' is SPD arrest records (enforcement activity); 'calls' is 911 calls for service."

- [ ] **Step 5: Add the arrests noun.** In `frontend/src/lib/layerCopy.ts`, add an arrests branch to `incidentNoun` (before the reported fallback) and update the file doc-comment:
```ts
export function incidentNoun(layer: LayerKey): IncidentNoun {
  if (layer === "calls") {
    return { singular: "911 call", plural: "911 calls", pluralCap: "911 calls" };
  }
  if (layer === "arrests") {
    return { singular: "arrest", plural: "arrests", pluralCap: "Arrests" };
  }
  return {
    singular: "reported incident",
    plural: "reported incidents",
    pluralCap: "Reported incidents",
  };
}
```

- [ ] **Step 6: Add the freshness noun.** In `frontend/src/components/DataFreshness.tsx`, change:
```ts
  const noun = layer === "calls" ? "911 calls" : "reported SPD incidents";
```
to:
```ts
  const noun =
    layer === "calls" ? "911 calls" : layer === "arrests" ? "SPD arrests" : "reported SPD incidents";
```

- [ ] **Step 7: Pass arrests through saved-view decode.** In `frontend/src/lib/savedView.ts`, change the decode fallback:
```ts
      layer: wire.ly === "calls" ? "calls" : "reported",
```
to:
```ts
      layer: wire.ly === "calls" ? "calls" : wire.ly === "arrests" ? "arrests" : "reported",
```

- [ ] **Step 8: Run tests + full typecheck.**
Run: `cd frontend && npx vitest run src/lib/layerCopy.test.ts src/components/LayerToggle.test.tsx src/lib/savedView.test.ts && npx tsc --noEmit`
Expected: the three specs PASS; `tsc --noEmit` clean. **If `tsc` flags an exhaustiveness error** (e.g. a `Record<LayerKey, …>` map somewhere now missing an `arrests` key), add the `arrests` entry there mirroring the sibling values, and report which file.

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/types.ts frontend/src/components/LayerToggle.tsx frontend/src/lib/layerCopy.ts frontend/src/components/DataFreshness.tsx frontend/src/lib/savedView.ts frontend/src/lib/layerCopy.test.ts frontend/src/components/LayerToggle.test.tsx frontend/src/lib/savedView.test.ts
git commit -m "feat(saved-views): add arrests as a third data layer (type, toggle, copy, freshness)"
```

---

## Task 4: AnalyzeTab arrests framing + category handling

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx`
- Test: `frontend/src/components/AnalyzeTab.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append inside the top-level `describe` in `frontend/src/components/AnalyzeTab.test.tsx`. These match the file's real render style (a `home` fixture and an `analysis` fixture already exist; the calls-layer test at line ~84 uses `analysis={{ ...analysis, layer: "calls" }}`). The category-filter field's label is "Incident categories":

```ts
  it("shows the arrests enforcement note and hides the category filter on the arrests layer", () => {
    render(<AnalyzeTab selected={[home]} analysis={{ ...analysis, layer: "arrests" }} availableRadii={[250, 500, 1000]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/enforcement activity, not reported incidents/i)).toBeInTheDocument();
    expect(screen.queryByText(/incident categories/i)).not.toBeInTheDocument();
  });

  it("shows the category filter and no arrests note on the reported layer", () => {
    render(<AnalyzeTab selected={[home]} analysis={{ ...analysis, layer: "reported" }} availableRadii={[250, 500, 1000]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.queryByText(/enforcement activity, not reported incidents/i)).not.toBeInTheDocument();
    expect(screen.getByText(/incident categories/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails.**
Run: `cd frontend && npx vitest run src/components/AnalyzeTab.test.tsx`
Expected: FAIL — no arrests note; category filter still shows on arrests.

- [ ] **Step 3: Generalize the layer flags + incident-details header.** In `frontend/src/components/AnalyzeTab.tsx`:

3a. Replace the two component-body derivations (around line 444-445):
```ts
  const isCallsLayer = analysis.layer === "calls";
  const noun = incidentNoun(analysis.layer);
```
with:
```ts
  const isCallsLayer = analysis.layer === "calls";
  const isArrestsLayer = analysis.layer === "arrests";
  const showCategory = analysis.layer === "reported"; // only reported carries offense categories
  const subcategoryHeader = isCallsLayer ? "Call type" : isArrestsLayer ? "Charge" : "Subcategory";
  const noun = incidentNoun(analysis.layer);
```

3b. Change the category-filter field gate (around line 469) from `{isCallsLayer ? null : (` to `{showCategory ? (` … and flip the branch so the category field renders when `showCategory` (i.e. `{showCategory ? (<category field/>) : null}`).

3c. Replace the layer-note block (around lines 488-500) with:
```tsx
      {isCallsLayer ? (
        <p className="mc-layer-note" role="note">
          911 calls are <strong>requests for service</strong>, not confirmed incidents. The same
          event can generate several calls, many are proactive officer activity, and a call does
          not mean a crime occurred. Counts below are call volume, not reported crime.
        </p>
      ) : isArrestsLayer ? (
        <p className="mc-layer-note" role="note">
          Arrests are <strong>enforcement activity, not reported incidents</strong>. An arrest is
          logged where the arrest was made — which may differ from where an offense occurred — and
          most reported crimes never result in one.
        </p>
      ) : null}
```
(This deletes the old reported+category note, which is now wrong: reported no longer includes arrests, so "arrests are excluded while a category is selected" no longer applies.)

3d. Generalize the two incident-details sub-components. Change `IncidentDetailsTable` and `IncidentDetailsCards` to take `showCategory: boolean` and `subcategoryHeader: string` instead of `isCalls: boolean`:
- Signature: `{ details, noun, showCategory, subcategoryHeader }: { details: …; noun: IncidentNoun; showCategory: boolean; subcategoryHeader: string }`.
- Category `<th>`/`<td>` (and the card `<span>`): render when `showCategory` (was `!isCalls`).
- The second column header text: use `{subcategoryHeader}` (was `{isCalls ? "Call type" : "Subcategory"}`).
- Update the `{/* 911 calls carry no offense category … */}` comment to: `{/* calls and arrests carry no offense category — show only the type/charge column. */}`.

3e. Update the four call sites (around lines 536-544) from `isCalls={isCallsLayer}` to `showCategory={showCategory} subcategoryHeader={subcategoryHeader}`.

- [ ] **Step 4: Run to verify it passes.**
Run: `cd frontend && npx vitest run src/components/AnalyzeTab.test.tsx && npx tsc --noEmit`
Expected: new tests PASS, all pre-existing AnalyzeTab tests PASS, tsc clean.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx
git commit -m "feat(analyze): arrests enforcement note + charge column; category filter reported-only"
```

---

## Task 5: CompareTab category gate + data-model docs

**Files:**
- Modify: `frontend/src/components/CompareTab.tsx`, `docs/architecture/data-model.md`

- [ ] **Step 1: Gate compare's category behavior to reported only.** In `frontend/src/components/CompareTab.tsx`, the category-comparison gate (around line 95) currently reads `analysis.layer !== "calls" && …`. Since arrests also carry no offense category, change it to require the reported layer:
```ts
    analysis.layer === "reported" && analysis.offenseCategory !== "" && analysis.offenseCategory !== "PERSON";
```
The `incidentNoun(analysis.layer)` call (line 96) already yields arrest nouns after Task 3, so the rest of the compare copy follows the active layer automatically. (Leave `REVISED_CAVEAT` as-is — it is a general, layer-agnostic footer already shown for calls today; refining it is out of scope.)

- [ ] **Step 2: Typecheck + compare tests.**
Run: `cd frontend && npx tsc --noEmit && npx vitest run src/components/CompareTab.test.tsx`
Expected: clean + pass. (If a compare test asserted the `!== "calls"` gate specifically, update it to the reported-only gate and note it.)

- [ ] **Step 3: Update the data-model docs.** In `docs/architecture/data-model.md`, update the "Sources, layers, and the `report_number` linkage" section (around lines 29-37) and the Crime-entity note so they describe **three disjoint layers**: `reported` = SPD crime reports only; `arrests` = SPD arrest records (enforcement activity, logged where the arrest was made, not unioned into reported); `calls` = 911 calls for service. Remove/replace the prose that says reported unions crime + arrests. State explicitly that arrests are no longer folded into reported (fixing the prior double-count on shared `report_number`).

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/components/CompareTab.tsx docs/architecture/data-model.md
git commit -m "feat(compare): category-compare reported-only; docs: three disjoint layers"
```

---

## Task 6: Verification gate + roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Full gate.**
Run: `make test-all`
Expected: `pytest` + `ruff check .` + frontend `npm test` + `npm run build` all pass.

- [ ] **Step 2: Tick the roadmap.** In `docs/ROADMAP.md`, find the C4 line's "Remaining follow-up" note (it mentions "surface arrests as a clearly-labeled, enforcement-framed lens … + a taxonomy crosswalk"). Update it to record that the arrests lens shipped as a **de-merged third layer** — `reported` is now crime-reports-only; `arrests` is a disjoint, enforcement-framed layer (fixing the prior union double-count / enforcement-vs-incidence conflation) — and that the **taxonomy crosswalk** and **`CALLS_DATA_FLOOR` drift** remain the deferred follow-ups.

- [ ] **Step 3: Commit.**
```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): arrests de-merged into a third enforcement-framed layer"
```

- [ ] **Step 4: Push and open the PR.**
```bash
git push -u origin demerge-arrests
gh pr create --base main --title "feat(crime): arrests as a de-merged, enforcement-framed third layer" --body "$(cat <<'EOF'
## Summary
Splits SPD arrests out of the `reported` layer into their own disjoint, clearly-labeled third layer (**Reported / Arrests / Calls**).

- **`reported` is now crime-reports-only** (`LAYERS[reported] = (SOURCE_SPD_CRIME,)`); a new `arrests` layer = `(SOURCE_SPD_ARRESTS,)`. Fixes the prior double-count (a crime report and its resulting arrest were both counted, "may share a `report_number`") and the enforcement-vs-incidence conflation.
- **Framing:** arrests read as *enforcement activity, not reported incidents* everywhere — assistant prompt + semantic caveats, the layer toggle, the Analyze note, incident-detail "Charge" column, and the freshness/copy nouns — mirroring how 911 calls are framed as "requests for service."
- **Why now:** on Waypoint's public (redacted) data an arrest can't be linked back to its crime, so the union double-counts and misattributes location; the merge only held up on internal linked data.

The source-aware layer model made this mostly a one-line `LAYERS` change (validation, freshness, and every `sources_for_layer` query path auto-propagate) plus framing copy. No database migration (`layer` is a string column). Stored summaries computed under the old union recompute on next run.

**Deferred:** the arrest↔crime taxonomy crosswalk and `CALLS_DATA_FLOOR` drift remain separate follow-ups; arrest demographics still not ingested.

## Tests
Three-layer disjointness (`test_crime_sources`, `test_dashboard_analysis_api`), arrests freshness entry (`test_dashboard_freshness`), arrest framing in the prompt/caveats, and frontend toggle/copy/note tests. `make test-all` green.

Spec/plan: `docs/superpowers/{specs,plans}/2026-07-02-arrests-third-layer*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **No database migration.** `layer` is a plain string column; "arrests" is just a new valid value. Do not add a migration.
- **Auto-propagation is real:** you should NOT need to touch layer *validation*, the *freshness service*, `sources_for_layer` call sites, exports, or route corridor context — adding the `LAYERS` key covers them. If you find yourself editing those, stop and re-read Task 1.
- **Product invariant:** arrests copy must read as *enforcement activity*, never as incidents, and never "safe/unsafe/dangerous." The de-merge strengthens the invariant; the safety guard is layer-independent and untouched.
- **Match existing test conventions:** the exact seed/fixture helper names in the Python and `.test.tsx` files may differ from the illustrative snippets — read each file first and adapt; the assertions (behaviors) are the requirement.
