# Analyze Owned-Interval Plot (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Analyze tab's verdict cards render the owned-interval multi-baseline plot (place's 95% rate interval as an identity-colored column against mcpp/beat/sector/city ticks), with an aggregate headline replacing the single-baseline chip, a per-baseline "How we know" table, and the legacy single-beat payload fields deleted.

**Architecture:** Backend adds a per-place quasi-Poisson rate interval (`rate_confidence_interval`, the same helper Compare uses) and human-safe MCPP display labels, then deletes the published single-beat pair fields (the internal beat test still runs — it feeds `decision`/`minimum_data_status`, which stay). Frontend gains a `placeIdentity` lib (letters + validated colors), an `aggregateHeadline` that groups `baselines[]` relations into one sentence, and a `BaselineIntervalPlot` component reusing the `.mc-plot-row` idiom. Order matters: additive tasks first; the breaking deletion (backend fields + frontend usage + types) is coordinated in Tasks 3/7 and the full gate only runs at the end.

**Tech Stack:** FastAPI/SQLAlchemy backend, React+TS+Vite frontend, pytest + vitest. Spec: `docs/superpowers/specs/2026-07-12-desktop-focus-multi-baseline-design.md` §2, §5–§7 (in this worktree — slice 1 landed on main as 935f64c).

**Working directory for every command:** `/Users/jscocca/Repos/waypoint/.worktrees/analyze-baseline-plot`
(Worktree env is already set up: `.venv` + `frontend/node_modules` symlinks exist.)

**Verified facts:**
- `rate_confidence_interval(*, count, exposure, overdispersion_phi=None)` in `app/analysis/rate_tests.py:101` returns a `RateInterval` with `.ci_lower/.ci_upper/.method`; rate = count/exposure. Compare's per-address interval uses the address's own trimmed monthly dispersion (`app/analysis/comparison.py:183-202`).
- The only acronym-mangling MCPP names in the vendored 58: `SODO`, `SLU/CASCADE`, plus compass suffixes like `FAUNTLEROY SW`.
- Identity palette (dataviz-validated): A `#534AB7` (dark theme `#6E64D9`), B `#1D9E75`, C `#C2410C`, D `#2E7DD1`; beyond D use slate `#74858E`. Letters are the primary encoding.
- Theme overrides live in `frontend/src/styles.css` via `[data-theme="dark"]{...}` (line 8); component CSS in `frontend/src/styles/mapWorkspace.css`. `.mc-cmpbars/.mc-cmpbar` rules are at `mapWorkspace.css:427-434`; `.mc-plot-*` rows idiom at `:491-499`.
- `annualIncidentsWithin(ratePerKm2Day, radiusM)` and `formatPerYear` in `frontend/src/lib/rateFormat.ts` convert km²·day rates to per-year-within-buffer display units.
- Legacy-field consumers to migrate: `frontend/src/components/AnalyzeTab.tsx` (ComparisonBars + How-we-know), `frontend/src/types.ts:214-238`, `app/assistant/summaries.py:67-91`, fixtures in `frontend/src/components/AnalyzeTab.test.tsx` + `MapWorkspace.test.tsx`, backend tests `tests/test_neighborhood_service.py`, `tests/test_assistant_summaries.py`, `tests/test_assistant_tools.py`. (`CompareRankedList`/`compareVerdict`/`comparison.py` hits are the COMPARE payload — different schema, do NOT touch.)

---

### Task 1: MCPP display labels (backend)

**Files:**
- Modify: `app/analysis/area_baselines.py`
- Modify: `app/services/neighborhood_service.py` (mcpp candidate label)
- Test: `tests/test_area_baselines.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_area_baselines.py`; add `mcpp_display_label` to the existing import from `app.analysis.area_baselines`)

```python
@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("CAPITOL HILL", "Capitol Hill"),
        ("SODO", "SODO"),
        ("SLU/CASCADE", "SLU/Cascade"),
        ("FAUNTLEROY SW", "Fauntleroy SW"),
        ("BALLARD NORTH", "Ballard North"),
    ],
)
def test_mcpp_display_label(name, expected):
    assert mcpp_display_label(name) == expected
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_area_baselines.py -q -k display_label`
Expected: FAIL with `ImportError: cannot import name 'mcpp_display_label'`

- [ ] **Step 3: Implement** in `app/analysis/area_baselines.py` (below `sector_for_beat`):

```python
# Tokens .title() would mangle in user-facing labels: district acronyms and the
# compass suffixes SPD uses in MCPP names.
_LABEL_UPPER_TOKENS = frozenset({"SODO", "SLU", "NE", "NW", "SE", "SW"})


def mcpp_display_label(name: str) -> str:
    """Human display label for an UPPERCASE MCPP name ("SLU/CASCADE" → "SLU/Cascade")."""

    def fix(token: str) -> str:
        return token if token in _LABEL_UPPER_TOKENS else token.title()

    return "/".join(
        " ".join(fix(word) for word in part.split(" ")) for part in name.split("/")
    )
```

In `app/services/neighborhood_service.py`, extend the import to `from app.analysis.area_baselines import mcpp_display_label, sector_for_beat` and in `_baselines_for_place`'s mcpp candidate change `"label": name.title(),` to `"label": mcpp_display_label(name),`.

- [ ] **Step 4: Run tests**

Run: `.venv/bin/python -m pytest tests/test_area_baselines.py tests/test_neighborhood_service.py -q`
Expected: all PASS (the existing test asserts label `"Test Hill"`; `mcpp_display_label("TEST HILL")` still yields it)

- [ ] **Step 5: Commit**

```bash
git add app/analysis/area_baselines.py app/services/neighborhood_service.py tests/test_area_baselines.py
git commit -m "feat(analysis): acronym-safe MCPP display labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Per-place rate interval (backend, additive)

**Files:**
- Modify: `app/services/neighborhood_service.py`
- Test: `tests/test_neighborhood_service.py` (append)

- [ ] **Step 1: Write the failing tests** (append; `_run_with_baselines` already exists in this file)

```python
def test_place_rate_interval_present_and_ordered(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id)["places"][0]
    assert place["place_rate"] > 0
    assert place["place_rate_ci_lower"] < place["place_rate"] < place["place_rate_ci_upper"]


def test_place_rate_interval_present_without_beat_baseline(tmp_path):
    # Even when no beat baseline forms (empty area lookup), the place's own rate and
    # interval are published — the plot renders the band with whatever ticks exist.
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id, area_lookup={})["places"][0]
    assert place["baseline_available"] is False
    assert place["place_rate"] > 0
    assert place["place_rate_ci_lower"] < place["place_rate_ci_upper"]
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py -q -k place_rate_interval`
Expected: FAIL with `KeyError: 'place_rate_ci_lower'` (first test) / `KeyError: 'place_rate'` (second — legacy `place_rate` only exists in the success branch today)

- [ ] **Step 3: Implement** in `app/services/neighborhood_service.py`:

3a. Extend the rate_tests import block with `rate_confidence_interval`:

```python
from app.analysis.rate_tests import (
    benjamini_hochberg,
    compare_incident_rates,
    dispersion_status,
    rate_confidence_interval,
)
```

3b. Add after `_baselines_for_place`:

```python
def _place_rate_fields(
    place_incidents: list[CrimeIncidentData], radius_m: int, days: int, start: date, end: date
) -> dict[str, Any]:
    """The place's own exposure-adjusted rate with a quasi-Poisson interval — same
    helper and same own-monthly-dispersion convention as the Compare tab's per-address
    interval, so the two surfaces share one variance model."""
    exposure = _place_exposure_km2_days(radius_m, days)
    if exposure <= 0:
        return {}
    monthly = trim_partial_edge_months(
        _monthly_counts(place_incidents, start, end), start, end
    )
    dispersion = dispersion_status(monthly)
    interval = rate_confidence_interval(
        count=len(place_incidents), exposure=exposure, overdispersion_phi=dispersion.phi
    )
    return {
        "place_rate": len(place_incidents) / exposure,
        "place_rate_ci_lower": interval.ci_lower,
        "place_rate_ci_upper": interval.ci_upper,
    }
```

3c. In the second loop, where `baselines` is computed (just after `cluster = entry["cluster"]`), add alongside it:

```python
        place_stats = (
            {}
            if cluster.display_latitude is None or cluster.display_longitude is None
            else _place_rate_fields(
                entry.get("place_incidents", []),
                radius_m,
                days,
                analysis_start_date,
                analysis_end_date,
            )
        )
```

and add `**place_stats,` inside the `base = {...}` dict (after `"baselines": baselines,`). The success branch's explicit `"place_rate": result.place_rate` stays for now (identical value; Task 3 removes it).

- [ ] **Step 4: Run tests**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py tests/test_neighborhood_stats_quality.py -q`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/neighborhood_service.py tests/test_neighborhood_service.py
git commit -m "feat(neighborhood): per-place quasi-Poisson rate interval in the payload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Delete legacy pair fields + rewrite assistant summary (backend)

**Files:**
- Modify: `app/services/neighborhood_service.py` (success-branch dict)
- Modify: `app/assistant/summaries.py:67-91`
- Modify: `tests/test_neighborhood_service.py`, `tests/test_assistant_summaries.py`, `tests/test_assistant_tools.py` (and any other backend test greps hit)

The internal beat test (`place_vs_beat` + the across-places BH pool) KEEPS running — it feeds `decision` and `minimum_data_status`, which remain published. Only the pair-stats fields leave the payload.

- [ ] **Step 1: Delete the published fields.** In the success branch's `places.append({...})`, remove these keys (and only these): `"beat_incident_count"`, `"place_rate"` (now supplied via `**place_stats` in `base`), `"beat_rate"`, `"rate_ratio"`, `"ci_lower"`, `"ci_upper"`, `"adjusted_p_value"`, `"exact_p_value"`, `"method"`, `"overdispersion_status"`. Keep `"baseline_available": True`, `"place_incident_count"`, `"minimum_data_status": result.minimum_data_status`, `"decision": result.decision`, `"nearest_incident_m"`, `"monthly_counts"`, `"category_breakdown"`, `"temporal"`.

Note the success branch today takes `decision`/`minimum_data_status` from `result` — preserve exactly that; don't re-derive.

- [ ] **Step 2: Rewrite `_analyze_places_summary`** in `app/assistant/summaries.py` to be neighborhood-first from `baselines[]`:

```python
_RELATION_PHRASES = {
    "above": "above",
    "below": "below",
    "similar": "about the same as",
}


def _primary_baseline(place: dict[str, Any]) -> dict[str, Any] | None:
    by_kind = {entry.get("kind"): entry for entry in place.get("baselines") or []}
    return by_kind.get("mcpp") or by_kind.get("beat") or by_kind.get("city")


def _analyze_places_summary(result: dict[str, Any]) -> str:
    radius = (result.get("settings_used") or {}).get("radius_m")
    lead_in, noun = _layer_terms(result)
    places = (result.get("neighborhood") or {}).get("places") or []
    sentences: list[str] = []
    for place in places:
        label = place.get("place_label") or "The place"
        count = place.get("place_incident_count") or 0
        entry = _primary_baseline(place)
        relation = (entry or {}).get("relation")
        if entry and relation in _RELATION_PHRASES and entry.get("rate_ratio") is not None:
            ci = ""
            lower, upper = entry.get("ci_lower"), entry.get("ci_upper")
            if lower is not None and upper is not None:
                ci = f" (95% CI {lower:.1f}–{upper:.1f})"
            sentences.append(
                f"{label}: {entry['rate_ratio']:.1f}× — {_RELATION_PHRASES[relation]} "
                f"{entry.get('label')}'s rate{ci}; {count} {noun} within {radius} m."
            )
        else:
            phrase = _DECISION_PHRASES.get(place.get("decision"), "no area comparison")
            sentences.append(f"{label}: {count} {noun} within {radius} m ({phrase}).")
    summary = (lead_in + " ".join(sentences)) if sentences else "No places to analyze."
    return _with_provenance(summary, result)
```

(`_DECISION_PHRASES` stays as the fallback for insufficient/unavailable places. No safety wording.)

- [ ] **Step 3: Update backend tests.** First find every assertion on the deleted fields:

Run: `grep -rn "beat_rate\|rate_ratio\|overdispersion_status\|exact_p_value" tests/ | grep -v test_statistical_comparison | grep -v compare`

Known updates (adapt to what grep shows):
- `tests/test_neighborhood_service.py::test_known_beat_returns_place_and_beat_rates`: replace `place["beat_rate"] > 0` with a `baselines[]` check — rename the test `test_known_beat_returns_place_rate_and_beat_baseline` and assert:

```python
    assert place["place_rate"] > 0
    by_kind = {entry["kind"]: entry for entry in place["baselines"]}
    assert by_kind["beat"]["baseline_rate"] > 0
```

  (This direct-call test passes no mcpp kwargs, so only beat/sector/city entries exist — that's fine.)
- `tests/test_neighborhood_service.py::test_baseline_entries_carry_adjusted_p_and_legacy_fields`: rename to `test_baseline_entries_carry_adjusted_p_and_no_legacy_pair_fields`; replace the last two lines with:

```python
    assert place["baseline_available"] is True
    assert "rate_ratio" not in place and "beat_rate" not in place
```

- `tests/test_assistant_summaries.py`: update the analyze-summary expectations to the new sentence shape (the fixture dicts in that file need a `baselines` list; give the primary entry `kind="beat"`, `label="Beat M3"`, `rate_ratio`, `ci_lower`, `ci_upper`, `relation="above"` and assert the rendered sentence contains `"above Beat M3's rate"` — read the existing test bodies and mirror their style).
- `tests/test_assistant_tools.py`: if it asserts legacy fields in the neighborhood result, point those assertions at `baselines[]` entries instead.

- [ ] **Step 4: Run the backend suites**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py tests/test_assistant_summaries.py tests/test_assistant_tools.py tests/test_dashboard_neighborhood_api.py tests/test_public_dashboard_flow.py tests/test_neighborhood_stats_quality.py -q && .venv/bin/ruff check app tests`
Expected: all PASS, lint clean. (Do NOT run the frontend suite yet — it still reads the legacy types until Task 7.)

- [ ] **Step 5: Commit**

```bash
git add app/services/neighborhood_service.py app/assistant/summaries.py tests/
git commit -m "feat(neighborhood)!: drop legacy single-beat pair fields; neighborhood-first assistant summary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Frontend types + placeIdentity lib + identity CSS (additive)

**Files:**
- Modify: `frontend/src/types.ts:214-238` (add only — deletions happen in Task 7)
- Create: `frontend/src/lib/placeIdentity.ts`
- Test: `frontend/src/lib/placeIdentity.test.ts`
- Modify: `frontend/src/styles.css`, `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/placeIdentity.test.ts
import { describe, expect, it } from "vitest";

import { placeIdentity } from "./placeIdentity";

describe("placeIdentity", () => {
  it("assigns letters and color slots in fixed order", () => {
    expect(placeIdentity(0)).toEqual({ letter: "A", slot: "a" });
    expect(placeIdentity(3)).toEqual({ letter: "D", slot: "d" });
  });

  it("falls back to the neutral slot beyond four places, letters continue", () => {
    expect(placeIdentity(4)).toEqual({ letter: "E", slot: "x" });
    expect(placeIdentity(25)).toEqual({ letter: "Z", slot: "x" });
  });

  it("numbers places beyond Z", () => {
    expect(placeIdentity(26)).toEqual({ letter: "#27", slot: "x" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/placeIdentity.test.ts`
Expected: FAIL — cannot resolve `./placeIdentity`

- [ ] **Step 3: Implement**

```typescript
// frontend/src/lib/placeIdentity.ts
// Stable per-place identity for the Analyze pane (and, in slice 3, map pins): a letter
// by position plus one of four validated color slots. The letter is the primary
// encoding — color never carries identity alone, so the neutral fallback is safe.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLOTS = ["a", "b", "c", "d"] as const;

export type IdentitySlot = (typeof SLOTS)[number] | "x";
export type PlaceIdentity = { letter: string; slot: IdentitySlot };

export function placeIdentity(index: number): PlaceIdentity {
  const letter = index < LETTERS.length ? LETTERS[index] : `#${index + 1}`;
  const slot: IdentitySlot = index < SLOTS.length ? SLOTS[index] : "x";
  return { letter, slot };
}
```

- [ ] **Step 4: Add types** in `frontend/src/types.ts` — insert above `NeighborhoodPlace`:

```typescript
export type BaselineEntry = {
  kind: "mcpp" | "beat" | "sector" | "city";
  label: string;
  area_km2: number;
  baseline_incident_count: number;
  baseline_rate: number;
  rate_ratio: number;
  ci_lower: number;
  ci_upper: number;
  adjusted_p_value: number;
  method: string;
  relation: "above" | "similar" | "below" | "insufficient";
};
```

and add to `NeighborhoodPlace` (keep every existing field for now; `baselines` stays
OPTIONAL until Task 7 so existing test fixtures still typecheck):

```typescript
  baselines?: BaselineEntry[];
  place_rate_ci_lower?: number;
  place_rate_ci_upper?: number;
```

- [ ] **Step 5: Add identity color tokens.** In `frontend/src/styles.css`, add to the `:root` block:

```css
--id-a:#534AB7;--id-b:#1D9E75;--id-c:#C2410C;--id-d:#2E7DD1;--id-x:#74858E;
```

and inside the `[data-theme="dark"]{...}` block (styles.css:8): `--id-a:#6E64D9;`

In `frontend/src/styles/mapWorkspace.css`, add after the `.mc-verdict-headline` rule (~line 426):

```css
.mc-idbadge{display:inline-flex;width:20px;height:20px;border-radius:50%;color:#fff;font-size:11px;font-weight:600;align-items:center;justify-content:center;flex:none;}
.mc-idbadge.id-a{background:var(--id-a);}
.mc-idbadge.id-b{background:var(--id-b);}
.mc-idbadge.id-c{background:var(--id-c);}
.mc-idbadge.id-d{background:var(--id-d);}
.mc-idbadge.id-x{background:var(--id-x);}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/lib/placeIdentity.test.ts && npx tsc -b --pretty false`
Expected: tests PASS; tsc clean (additions only)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/placeIdentity.ts frontend/src/lib/placeIdentity.test.ts frontend/src/styles.css frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): BaselineEntry types + place identity letters/colors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: Aggregate headline (additive — decisionHeadline stays until Task 7)

**Files:**
- Modify: `frontend/src/lib/verdictCopy.ts` (add `aggregateHeadline`; do not touch `decisionHeadline` yet)
- Test: `frontend/src/lib/verdictCopy.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append; the file already imports `incidentNoun`)

```typescript
import { aggregateHeadline } from "./verdictCopy";
import type { BaselineEntry, NeighborhoodPlace } from "../types";

const entry = (kind: BaselineEntry["kind"], label: string, relation: BaselineEntry["relation"]): BaselineEntry => ({
  kind, label, relation,
  area_km2: 1, baseline_incident_count: 10, baseline_rate: 0.02,
  rate_ratio: 1.4, ci_lower: 0.9, ci_upper: 2.2, adjusted_p_value: 0.2, method: "quasi_poisson",
});

const basePlace = (baselines: BaselineEntry[], overrides: Partial<NeighborhoodPlace> = {}): NeighborhoodPlace => ({
  place_id: "p1", place_label: "Cafe", beat: "C2", radius_m: 250,
  baseline_available: true, decision: "not_clear", place_incident_count: 12,
  category_breakdown: [], baselines, ...overrides,
});

describe("aggregateHeadline", () => {
  it("groups relations into one sentence in above/below/similar order", () => {
    const headline = aggregateHeadline(
      basePlace([
        entry("mcpp", "Capitol Hill", "similar"),
        entry("beat", "Beat C2", "similar"),
        entry("sector", "Sector C", "above"),
        entry("city", "Citywide", "above"),
      ]),
      incidentNoun("reported"),
    );
    expect(headline).toBe(
      "Cafe's reported incident rate is above its sector (C) and the citywide rate; similar to Capitol Hill and its beat (C2).",
    );
  });

  it("ignores insufficient entries in the sentence", () => {
    const headline = aggregateHeadline(
      basePlace([entry("city", "Citywide", "above"), entry("sector", "Sector C", "insufficient")]),
      incidentNoun("reported"),
    );
    expect(headline).toBe("Cafe's reported incident rate is above the citywide rate.");
  });

  it("explains the radius-too-large case", () => {
    const headline = aggregateHeadline(
      basePlace([], { minimum_data_status: "baseline_too_small", decision: "insufficient_data" }),
      incidentNoun("reported"),
    );
    expect(headline).toContain("smaller radius");
  });

  it("says when every comparison lacked data", () => {
    const headline = aggregateHeadline(
      basePlace([entry("city", "Citywide", "insufficient")], { decision: "insufficient_data" }),
      incidentNoun("reported"),
    );
    expect(headline).toBe("Not enough data to compare Cafe to its area baselines.");
  });

  it("says when no baseline geography resolved at all", () => {
    const headline = aggregateHeadline(
      basePlace([], { decision: "baseline_unavailable", baseline_available: false }),
      incidentNoun("reported"),
    );
    expect(headline).toBe("No area baseline available for Cafe.");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/verdictCopy.test.ts`
Expected: new tests FAIL — `aggregateHeadline` is not exported

- [ ] **Step 3: Implement** — add to `frontend/src/lib/verdictCopy.ts` (imports: add `BaselineEntry` to the existing type import):

```typescript
const KIND_ORDER: BaselineEntry["kind"][] = ["mcpp", "beat", "sector", "city"];
const RELATION_ORDER = ["above", "below", "similar"] as const;

function baselineName(entry: BaselineEntry): string {
  if (entry.kind === "city") return "the citywide rate";
  if (entry.kind === "beat") return `its beat (${entry.label.replace(/^Beat /, "")})`;
  if (entry.kind === "sector") return `its sector (${entry.label.replace(/^Sector /, "")})`;
  return entry.label;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// One aggregate sentence over the baselines[] relations — no baseline is singled out,
// matching the plot's equal-rows treatment. Relations come verbatim from the payload
// (server-side decision machinery); this function only phrases them.
export function aggregateHeadline(
  place: Pick<NeighborhoodPlace, "place_label" | "baselines" | "minimum_data_status" | "radius_m">,
  noun: IncidentNoun = incidentNoun("reported"),
): string {
  const label = place.place_label || "This place";
  const usable = (place.baselines ?? [])
    .filter((entry) => entry.relation !== "insufficient")
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  if (usable.length === 0) {
    if (place.minimum_data_status === "baseline_too_small") {
      return `${label}'s ${place.radius_m} m radius covers nearly all of its surrounding area — there is no area left to compare against. Try a smaller radius.`;
    }
    if ((place.baselines ?? []).length > 0) {
      return `Not enough data to compare ${label} to its area baselines.`;
    }
    return `No area baseline available for ${label}.`;
  }
  const groups: Record<(typeof RELATION_ORDER)[number], string[]> = { above: [], below: [], similar: [] };
  for (const entry of usable) {
    groups[entry.relation as (typeof RELATION_ORDER)[number]].push(baselineName(entry));
  }
  const parts = RELATION_ORDER.filter((relation) => groups[relation].length > 0).map((relation) =>
    relation === "similar" ? `similar to ${joinList(groups[relation])}` : `${relation} ${joinList(groups[relation])}`,
  );
  return `${label}'s ${noun.singular} rate is ${parts.join("; ")}.`;
}
```

Check `IncidentNoun` exposes `singular` (`grep -n "singular" frontend/src/lib/layerCopy.ts`) — it does (used as `noun.singular` in existing code); if the reported-layer singular is not exactly `"reported incident"`, adjust the expected strings in Step 1 to the real value rather than changing layerCopy.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/lib/verdictCopy.test.ts`
Expected: all PASS (old decisionHeadline tests untouched and still green)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/verdictCopy.ts frontend/src/lib/verdictCopy.test.ts
git commit -m "feat(frontend): aggregate multi-baseline headline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: BaselineIntervalPlot component

**Files:**
- Create: `frontend/src/components/BaselineIntervalPlot.tsx`
- Test: `frontend/src/components/BaselineIntervalPlot.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css` (plot styles)

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/BaselineIntervalPlot.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BaselineIntervalPlot, plotDomainMax } from "./BaselineIntervalPlot";
import { incidentNoun } from "../lib/layerCopy";
import { placeIdentity } from "../lib/placeIdentity";
import type { BaselineEntry, NeighborhoodPlace } from "../types";

const entry = (kind: BaselineEntry["kind"], label: string, rate: number, relation: BaselineEntry["relation"]): BaselineEntry => ({
  kind, label, relation, baseline_rate: rate,
  area_km2: 1, baseline_incident_count: 10,
  rate_ratio: 1.2, ci_lower: 0.8, ci_upper: 1.9, adjusted_p_value: 0.3, method: "quasi_poisson",
});

const place: NeighborhoodPlace = {
  place_id: "p1", place_label: "Cafe", beat: "C2", radius_m: 250,
  baseline_available: true, decision: "not_clear", place_incident_count: 12,
  category_breakdown: [],
  place_rate: 0.06, place_rate_ci_lower: 0.04, place_rate_ci_upper: 0.09,
  baselines: [
    entry("mcpp", "Capitol Hill", 0.05, "similar"),
    entry("beat", "Beat C2", 0.052, "similar"),
    entry("sector", "Sector C", 0.03, "above"),
    entry("city", "Citywide", 0.024, "above"),
  ],
};

const noun = incidentNoun("reported");

describe("BaselineIntervalPlot", () => {
  it("renders one row per baseline in fixed kind order plus the place row", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([place])} />);
    const names = screen.getAllByTestId("bplot-name").map((el) => el.textContent);
    expect(names).toEqual(["This place", "Capitol Hill", "Beat C2", "Sector C", "Citywide"]);
  });

  it("shows relation words verbatim from the payload", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([place])} />);
    expect(screen.getAllByText(/place is above/).length).toBe(2);
    expect(screen.getAllByText(/similar/).length).toBe(2);
  });

  it("pins the interval label to the identity", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(1)} noun={noun} domainMax={plotDomainMax([place])} />);
    expect(screen.getByText("B's 95% interval")).toBeInTheDocument();
  });

  it("renders nothing without a place-rate interval", () => {
    const bare = { ...place, place_rate_ci_lower: undefined, place_rate_ci_upper: undefined };
    const { container } = render(<BaselineIntervalPlot place={bare} identity={placeIdentity(0)} noun={noun} domainMax={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("plotDomainMax", () => {
  it("covers the widest CI and every tick across places, zero-anchored", () => {
    const max = plotDomainMax([place]);
    // place ci_upper 0.09 /km²·day is the extreme → domain slightly above its per-year value
    expect(max).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/BaselineIntervalPlot.test.tsx`
Expected: FAIL — cannot resolve `./BaselineIntervalPlot`

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/BaselineIntervalPlot.tsx
import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import type { IncidentNoun } from "../lib/layerCopy";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { BaselineEntry, NeighborhoodPlace } from "../types";

const KIND_ORDER: BaselineEntry["kind"][] = ["mcpp", "beat", "sector", "city"];

const RELATION_TEXT: Record<BaselineEntry["relation"], string> = {
  above: "place is above",
  below: "place is below",
  similar: "similar",
  insufficient: "insufficient data",
};

/** Shared per-year axis domain across all plotted places: covers every place's CI and
 * every baseline tick, zero-anchored with 5% headroom, so the citywide tick lands in
 * the same visual position on every card. */
export function plotDomainMax(places: NeighborhoodPlace[]): number {
  let max = 0;
  for (const place of places) {
    const radius = place.radius_m;
    for (const v of [place.place_rate, place.place_rate_ci_upper]) {
      if (v != null) max = Math.max(max, annualIncidentsWithin(v, radius));
    }
    for (const entry of place.baselines ?? []) {
      max = Math.max(max, annualIncidentsWithin(entry.baseline_rate, radius));
    }
  }
  return max > 0 ? max * 1.05 : 1;
}

// The owned-interval plot: the place's 95% rate interval drawn ONCE as a continuous
// identity-tinted column behind equal baseline rows (bare tick + rate + relation).
// Relations render verbatim from the payload — the plot never re-derives them.
export function BaselineIntervalPlot({
  place,
  identity,
  noun,
  domainMax,
}: {
  place: NeighborhoodPlace;
  identity: PlaceIdentity;
  noun: IncidentNoun;
  domainMax: number;
}) {
  const radius = place.radius_m;
  if (place.place_rate == null || place.place_rate_ci_lower == null || place.place_rate_ci_upper == null) {
    return null;
  }
  const pos = (ratePerKm2Day: number) =>
    Math.max(0, Math.min(100, (annualIncidentsWithin(ratePerKm2Day, radius) / domainMax) * 100));
  const bandLeft = pos(place.place_rate_ci_lower);
  const bandWidth = Math.max(1, pos(place.place_rate_ci_upper) - bandLeft);
  const entries = [...(place.baselines ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const perYear = (rate: number) => formatPerYear(annualIncidentsWithin(rate, radius));

  return (
    <div className={`mc-bplot id-${identity.slot}`} data-testid="baseline-plot">
      <p className="mc-label">{noun.pluralCap} per year within {radius} m — 95% interval</p>
      <div className="mc-bplot-chart">
        <span
          className="mc-bplot-band"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
          title={`95% interval ${perYear(place.place_rate_ci_lower)}–${perYear(place.place_rate_ci_upper)} /yr`}
        />
        <div className="mc-bplot-row">
          <span className="name" data-testid="bplot-name">This place</span>
          <span className="track">
            <span className="bar" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
            <span className="dot" style={{ left: `${pos(place.place_rate)}%` }} title={`${perYear(place.place_rate)} /yr`} />
          </span>
          <span className="val">{perYear(place.place_rate)} /yr</span>
        </div>
        {entries.map((entry) => (
          <div className="mc-bplot-row" key={entry.kind}>
            <span className="name" data-testid="bplot-name">{entry.label}</span>
            <span className="track">
              <span className="tickmark" style={{ left: `${pos(entry.baseline_rate)}%` }} title={`${perYear(entry.baseline_rate)} /yr`} />
            </span>
            <span className="val">{perYear(entry.baseline_rate)} /yr · <em>{RELATION_TEXT[entry.relation]}</em></span>
          </div>
        ))}
        <div className="mc-bplot-foot">
          <span className="name" />
          <span className="track">
            <span className="mc-bplot-bandlabel" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}>
              <i />{identity.letter}&rsquo;s 95% interval
            </span>
            <span className="axis">
              <span style={{ left: "0%" }}>0</span>
              <span style={{ left: "50%" }}>{formatPerYear(domainMax / 2)}</span>
              <span style={{ left: "100%" }}>{formatPerYear(domainMax)} /yr</span>
            </span>
          </span>
          <span className="val" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the plot CSS** to `frontend/src/styles/mapWorkspace.css` (after the `.mc-plot-*` block at ~line 499):

```css
.mc-bplot{display:grid;gap:6px;margin:2px 0 4px;--idc:var(--id-x);}
.mc-bplot.id-a{--idc:var(--id-a);}.mc-bplot.id-b{--idc:var(--id-b);}.mc-bplot.id-c{--idc:var(--id-c);}.mc-bplot.id-d{--idc:var(--id-d);}
.mc-bplot-chart{position:relative;display:grid;gap:5px;}
.mc-bplot-band{position:absolute;top:0;bottom:26px;border-radius:4px;background:color-mix(in srgb,var(--idc) 9%,transparent);border-left:1px dashed color-mix(in srgb,var(--idc) 55%,transparent);border-right:1px dashed color-mix(in srgb,var(--idc) 55%,transparent);pointer-events:none;}
.mc-bplot-row{display:grid;grid-template-columns:96px 1fr 148px;align-items:center;gap:10px;height:16px;position:relative;}
.mc-bplot-row .name{font-size:11.5px;color:var(--text);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mc-bplot-row .track{position:relative;height:100%;}
.mc-bplot-row .bar{position:absolute;top:50%;transform:translateY(-50%);height:8px;border-radius:4px;background:var(--idc);opacity:.35;}
.mc-bplot-row .dot{position:absolute;top:50%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:var(--idc);border:2px solid var(--surface-raised);box-sizing:border-box;}
.mc-bplot-row .tickmark{position:absolute;top:50%;transform:translate(-50%,-50%);width:3px;height:12px;border-radius:2px;background:var(--text);}
.mc-bplot-row .val{font-size:11px;color:var(--text);}
.mc-bplot-foot{display:grid;grid-template-columns:96px 1fr 148px;gap:10px;height:26px;position:relative;}
.mc-bplot-bandlabel{position:absolute;top:1px;display:flex;justify-content:center;gap:4px;align-items:center;font-size:9.5px;color:var(--text);white-space:nowrap;}
.mc-bplot-bandlabel i{width:7px;height:7px;border-radius:2px;background:var(--idc);opacity:.55;}
.mc-bplot-foot .axis{position:absolute;left:0;right:0;bottom:0;height:12px;border-top:1px solid var(--border);font-size:10px;color:var(--text);}
.mc-bplot-foot .axis span{position:absolute;transform:translateX(-50%);}
.mc-bplot-foot .axis span:first-child{transform:none;}
.mc-bplot-foot .axis span:last-child{transform:translateX(-100%);}
```

(`--surface-raised` and `--text` already exist in this stylesheet's token set; `color-mix` is fine — the build targets modern browsers and the codebase already relies on modern CSS.)

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/components/BaselineIntervalPlot.test.tsx`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/BaselineIntervalPlot.tsx frontend/src/components/BaselineIntervalPlot.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): owned-interval multi-baseline plot component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: AnalyzeTab integration + legacy removal (coordinated breaking change)

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx` (VerdictCard + ComparisonBars removal)
- Modify: `frontend/src/types.ts` (delete legacy fields)
- Modify: `frontend/src/lib/verdictCopy.ts` + `verdictCopy.test.ts` (delete decisionHeadline + its tests)
- Modify: `frontend/src/components/AnalyzeTab.test.tsx`, `frontend/src/components/MapWorkspace.test.tsx` (fixtures)
- Modify: `frontend/src/styles/mapWorkspace.css` (delete `.mc-cmpbars/.mc-cmpbar` rules, lines ~427-434)

- [ ] **Step 1: Rewire `VerdictCard`** in `AnalyzeTab.tsx`:

- Change signature to `function VerdictCard({ place, index, windowLabel, noun, domainMax }: { place: NeighborhoodPlace; index: number; windowLabel: string; noun: IncidentNoun; domainMax: number })`.
- Imports: drop `decisionHeadline`; add `aggregateHeadline` from `../lib/verdictCopy`, `BaselineIntervalPlot, plotDomainMax` from `./BaselineIntervalPlot`, `placeIdentity` from `../lib/placeIdentity`, `annualIncidentsWithin, formatPerYear` from `../lib/rateFormat`.
- Header becomes (chip removed):

```tsx
  const identity = placeIdentity(index);
  const headline = aggregateHeadline(place, noun);
  return (
    <section className="mc-verdict" aria-label={`Verdict for ${place.place_label}`}>
      <div className="mc-verdict-head">
        <span className={`mc-idbadge id-${identity.slot}`} aria-hidden="true">{identity.letter}</span>
        <p className="mc-verdict-headline">{headline}</p>
      </div>
```

- Replace `{place.rate_ratio != null ? <ComparisonBars rateRatio={place.rate_ratio} /> : null}` with:

```tsx
          <BaselineIntervalPlot place={place} identity={identity} noun={noun} domainMax={domainMax} />
```

  and render it in BOTH the `baseline_available` branch and the else branch (the plot self-hides without an interval and renders whatever ticks exist — a place with only sector/city baselines still gets a plot).
- Delete the `ComparisonBars` function entirely.
- In "How we know" (`<details className="mc-analytical">`): delete the `<dl>` rows "Place vs area rate", "95% CI (this comparison)", "Adjusted p-value", "Exact p-value", "Dispersion", "Method"; keep "Baseline beats", "Adequacy", "Nearest". Insert before the `<dl>`:

```tsx
            {place.baselines.length > 0 ? (
              <div className="mc-incident-table-wrap">
                <table className="mc-incident-table mc-baseline-table">
                  <thead>
                    <tr><th scope="col">Baseline</th><th scope="col">Rate/yr</th><th scope="col">Ratio</th><th scope="col">95% CI</th><th scope="col">adj p</th><th scope="col">Method</th></tr>
                  </thead>
                  <tbody>
                    {place.baselines.map((b) => (
                      <tr key={b.kind}>
                        <td>{b.label}</td>
                        <td>{formatPerYear(annualIncidentsWithin(b.baseline_rate, place.radius_m))}</td>
                        <td>{b.rate_ratio.toFixed(1)}×</td>
                        <td>{b.ci_lower.toFixed(1)}–{b.ci_upper.toFixed(1)}×</td>
                        <td>{b.adjusted_p_value.toFixed(3)}</td>
                        <td>{b.method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
```

- In the parent render, compute the shared axis once and pass `index`:

```tsx
          {(() => {
            const domainMax = plotDomainMax(neighborhood?.places ?? []);
            return neighborhood?.places?.map((place, index) => (
              <VerdictCard key={place.place_id} place={place} index={index} windowLabel={windowLabel} noun={noun} domainMax={domainMax} />
            ));
          })()}
```

- [ ] **Step 2: Delete legacy types.** In `frontend/src/types.ts` `NeighborhoodPlace`, remove: `beat_incident_count`, `beat_rate`, `rate_ratio`, `ci_lower`, `ci_upper`, `adjusted_p_value`, `exact_p_value`, `method`, `overdispersion_status`. Change `baselines?: BaselineEntry[]` to required `baselines: BaselineEntry[]` (the backend always sends it). Keep `place_rate` and the two new CI fields, `decision`, `minimum_data_status`, everything else.

- [ ] **Step 3: Delete `decisionHeadline`**, `VerdictChip`, `VerdictCopy`, `CLEAR`, `MUTED` from `verdictCopy.ts` and remove their tests from `verdictCopy.test.ts` (keep the `aggregateHeadline` tests). Grep for stray imports: `grep -rn "decisionHeadline\|VerdictChip" frontend/src` — only AnalyzeTab imported it (fixed in Step 1); fix anything else grep reveals.

- [ ] **Step 4: Update test fixtures.** In `AnalyzeTab.test.tsx` and `MapWorkspace.test.tsx`, every `NeighborhoodPlace` fixture: remove deleted fields, add `baselines: []` (or a populated array where the test exercises the plot/headline; give at least one AnalyzeTab test a place with a full 4-entry `baselines` + `place_rate`/CI fields asserting the plot renders — `screen.getByTestId("baseline-plot")` — and the headline text). Any assertions on chip text (`statistically clear` etc.) change to headline assertions.

- [ ] **Step 5: Delete `.mc-cmpbars`/`.mc-cmpbar` rules** (mapWorkspace.css:427-434) and `.mc-vchip` rules (:424-425) — first confirm no other usage: `grep -rn "mc-cmpbar\|mc-vchip" frontend/src --include="*.tsx"` must return nothing after Steps 1–4.

- [ ] **Step 6: Run the full frontend suite + typecheck**

Run: `cd frontend && npx tsc -b --pretty false && npm test`
Expected: tsc clean; all vitest suites PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend)!: verdict cards use owned-interval plot + aggregate headline; drop legacy beat fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: Docs + roadmap

**Files:**
- Modify: `docs/architecture/api.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1:** In `api.md`'s `/dashboard/neighborhood` paragraph, replace the sentence `Legacy top-level beat fields are retained until the frontend migrates (slice 2).` with: `Each place also carries its own quasi-Poisson rate interval (place_rate, place_rate_ci_lower/upper — same variance model as the Compare tab's per-address interval). The former top-level single-beat pair fields (beat_rate, rate_ratio, ci_*, adjusted_p_value, method, overdispersion_status) were removed in slice 2; per-baseline statistics live in baselines[].`

- [ ] **Step 2:** In `docs/ROADMAP.md`'s "Desktop focus mode & multi-baseline analysis" section, tick the slice 2 item (mark its checkbox `[x]` and append `(2026-07-12)`), matching how slice 1's entry is formatted.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: API contract + roadmap tick for slice 2

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: Full gate, visual verification, final review, PR

- [ ] **Step 1:** Run `make test-all` from the worktree — pytest + ruff + vitest + build all green.

- [ ] **Step 2: Visual check.** The Claude Preview harness is anchored to the main checkout (per repo memory), so verify the worktree build via the component tests + `npm run build` in Step 1; a live visual pass happens post-merge from main. Note this in the PR body.

- [ ] **Step 3: Fresh-context final review** with `git diff main...HEAD` + spec §2/§5/§6/§7 as acceptance criteria; flag only correctness/requirement gaps. Product-invariant check: no safety wording in the new headline/plot copy.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin analyze-baseline-plot
gh pr create --title "feat(frontend): Analyze owned-interval multi-baseline plot (slice 2)" --body "Implements slice 2 of docs/superpowers/specs/2026-07-12-desktop-focus-multi-baseline-design.md: verdict cards now render the owned-interval plot (place's 95% rate interval as an identity-tinted column, equal ticks for neighborhood/beat/sector/city), an aggregate headline replaces the single-baseline chip, How-we-know gains the per-baseline stats table, and the legacy single-beat payload fields are removed (assistant summary is neighborhood-first). Backend adds the per-place quasi-Poisson rate interval and acronym-safe MCPP labels.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
