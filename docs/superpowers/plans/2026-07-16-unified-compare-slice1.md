# Unified Compare surface — Slice 1 (Extract + enrich) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-address context module out of `AnalyzeTab` into a reusable `PlaceContextCard`, and give the Compare tab expandable ranked rows that fetch the points-based neighborhood analysis and render that module per address.

**Architecture:** Pure component extraction (no behavior change) + a parallel second fetch in `useCompare` (`/dashboard/neighborhood` alongside `/dashboard/compare`, via `Promise.allSettled` so one failure doesn't sink the other) + an `expansionByOptionId` map threaded into `CompareRankedList`, joined by **index** (both endpoints preserve input-point order; ids are per-request synthetics, so index is the only reliable join). Frontend only; no backend change; no structural/tab change (that's slice 2).

**Tech Stack:** React + TypeScript + Vite, Vitest (`npx vitest run --environment jsdom`), `npm run lint` = `tsc -b` + eslint. Frontend commands run from `frontend/`.

**Working context:** Worktree `/Users/jscocca/Repos/compcat/.worktrees/unified-compare-surface`, branch `jcscocca/claude/unified-compare-surface`. Spec: `docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md` (committed at `951602c`). Baseline `make test-all` green at plan time. Single PR at the end, gated on `make test-all` from the worktree root.

**Standing rule:** every user-facing string stays in reported-incident-rate vocabulary — never `safe/unsafe/safety/danger/dangerous/risk/risky`. New dynamic regions get banned-vocabulary tests.

**Verified wire facts this plan relies on:**
- `getNeighborhoodAnalysis(payload)` POSTs `/dashboard/neighborhood` with `AnalyzePlacesPayload` (`points` OR `place_ids`, plus `analysis_start_date`, `analysis_end_date`, `radii_m: number[]`, `offense_category`, `layer`) → `NeighborhoodAnalysis` (`frontend/src/api/client.ts:181-188`).
- Points requests: backend `point_clusters()` (`app/services/analysis_points.py`) builds synthetic clusters **in input order** with `id` = fresh uuid per request; `dashboard_analysis_service` iterates clusters in order, so `NeighborhoodAnalysis.places[]` order == input `points[]` order.
- Compare: `compare_site_options()` (`app/services/analysis_service.py:32`) iterates options in input order, so `SiteComparison.analytical.options[]` order == input `points[]` order. Therefore `options[i]` ↔ `places[i]` ↔ `set[i]`.
- `useCompare` currently mocks in tests as `{ comparePlaces: vi.fn() }` — the mock module must gain `getNeighborhoodAnalysis` (Task 2) or the import throws.

---

## Task 1: Extract `PlaceContextCard` from `AnalyzeTab`

The per-address context module = today's internal `VerdictCard` (verdict head with locator chip + identity badge + headline, sub-line, `BaselineIntervalPlot`, monthly sparkline, "How we know" analytics, `CategoryBreakdown`) + its private helpers (`barHeight`, `ProfileBars`, `TemporalSection`, `CategoryBreakdown`). Pure move + rename; `AnalyzeTab` behavior is unchanged.

**Files:**
- Create: `frontend/src/components/PlaceContextCard.tsx`
- Create: `frontend/src/components/PlaceContextCard.test.tsx`
- Modify: `frontend/src/components/AnalyzeTab.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/PlaceContextCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlaceContextCard } from "./PlaceContextCard";
import { incidentNoun } from "../lib/layerCopy";
import type { NeighborhoodPlace } from "../types";

const homePlace: NeighborhoodPlace = {
  place_id: "p1", place_label: "Home", beat: "M2", radius_m: 250,
  baseline_available: true, decision: "above_clear", place_incident_count: 12,
  place_rate: 0.67, place_rate_ci_lower: 0.41, place_rate_ci_upper: 0.98,
  minimum_data_status: "met",
  nearest_incident_m: 42, monthly_counts: [1, 2, 1, 3, 2, 3],
  baselines: [
    { kind: "mcpp", label: "Capitol Hill", area_km2: 2.4, baseline_incident_count: 320, baseline_rate: 0.20, rate_ratio: 3.4, ci_lower: 2.1, ci_upper: 5.5, adjusted_p_value: 0.002, method: "quasi_poisson", relation: "above" },
    { kind: "beat", label: "Beat M2", area_km2: 1.1, baseline_incident_count: 180, baseline_rate: 0.17, rate_ratio: 4.0, ci_lower: 2.1, ci_upper: 7.6, adjusted_p_value: 0.002, method: "quasi_poisson", relation: "above" },
  ],
  category_breakdown: [
    { label: "Theft", place_count: 5, place_share: 0.71, beat_share: 0.20 },
    { label: "Assault", place_count: 2, place_share: 0.29, beat_share: null },
  ],
  temporal: {
    hour_by_dow: Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => (d <= 4 && h === 17 ? 4 : d === 5 && h === 2 ? 20 : 0)),
    ),
    hour_counts: Array.from({ length: 24 }, (_, h) => (h === 17 ? 20 : h === 2 ? 20 : 0)),
    dow_counts: [4, 4, 4, 4, 4, 20, 0],
    total_with_time: 40,
    without_time: 0,
  },
};

const noun = incidentNoun("reported");

afterEach(cleanup);

function renderCard(place: NeighborhoodPlace = homePlace) {
  return render(
    <PlaceContextCard
      place={place}
      index={0}
      windowLabel="2026-01-01 – 2026-06-30"
      noun={noun}
      domainMax={6}
      locator={null}
      coords={{ latitude: 47.61, longitude: -122.33 }}
    />,
  );
}

describe("PlaceContextCard", () => {
  it("renders the verdict region with the count sub-line", () => {
    renderCard();
    expect(screen.getByLabelText("Verdict for Home")).toBeInTheDocument();
    expect(screen.getByText(/12 reported incidents within 250 m/)).toBeInTheDocument();
  });

  it("shows baseline analytics behind How we know", () => {
    renderCard();
    const summary = screen.getByText("How we know");
    // Scope to the disclosure: the baseline label also appears in the interval plot.
    const details = summary.closest("details")!;
    expect(within(details).getByText("Capitol Hill")).toBeInTheDocument();
    expect(within(details).getAllByText("0.002").length).toBeGreaterThan(0);
  });

  it("renders the temporal profile with the travel-window callout", () => {
    renderCard();
    expect(screen.getByText(/When reported incidents occurred/i)).toBeInTheDocument();
    expect(screen.getByText(/of the 40 reported incidents with a recorded time/)).toBeInTheDocument();
  });

  it("renders category rows with place and beat shares", () => {
    renderCard();
    expect(screen.getByText("Theft")).toBeInTheDocument();
    expect(screen.getByText(/71% here · 20% nearby/)).toBeInTheDocument();
  });

  it("falls back cleanly when no beat baseline is available", () => {
    renderCard({ ...homePlace, baseline_available: false, baselines: [] });
    expect(screen.getByText(/12 reported incidents in range; no beat baseline/)).toBeInTheDocument();
  });

  it("never emits safety-ranking vocabulary", () => {
    const { container } = renderCard();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/PlaceContextCard.test.tsx --environment jsdom`
Expected: FAIL — `Cannot find module './PlaceContextCard'` (or equivalent resolve error).

- [ ] **Step 3: Create `PlaceContextCard.tsx` by moving code out of `AnalyzeTab.tsx`**

Create `frontend/src/components/PlaceContextCard.tsx` with this exact import header and export shape:

```tsx
import { useState } from "react";

import type { CategoryShare, NeighborhoodPlace, TemporalProfile } from "../types";
import { countNoun, type IncidentNoun } from "../lib/layerCopy";
import { aggregateHeadline } from "../lib/verdictCopy";
import { placeIdentity } from "../lib/placeIdentity";
import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import { BaselineIntervalPlot } from "./BaselineIntervalPlot";
import { LocatorChip, type LocatorData } from "./LocatorChip";
import {
  clampInt,
  DAYSET_DAYS,
  DAYSET_LABELS,
  DEFAULT_TRAVEL_WINDOW,
  DOW_LABELS,
  windowShare,
  type TravelWindow,
} from "../lib/temporalWindow";

export type PlaceContextCardProps = {
  place: NeighborhoodPlace;
  index: number;
  windowLabel: string;
  noun: IncidentNoun;
  domainMax: number;
  onHoverPlace?: (placeId: string | null) => void;
  locator: LocatorData | null;
  coords: { latitude: number; longitude: number } | null;
  onFlyTo?: (target: { latitude: number; longitude: number }) => void;
};
```

Then move — **verbatim, no edits beyond the two renames below** — these functions from `AnalyzeTab.tsx` into this file, in this order (current line numbers on branch HEAD):

1. `barHeight` (AnalyzeTab.tsx:115-118)
2. `ProfileBars` (AnalyzeTab.tsx:120-144)
3. `TemporalSection` (AnalyzeTab.tsx:146-239)
4. `CategoryBreakdown` (AnalyzeTab.tsx:241-265)
5. `VerdictCard` (AnalyzeTab.tsx:267-347)

Renames while moving `VerdictCard`:
- `function VerdictCard(` → `export function PlaceContextCard(`
- Replace its inline props annotation (the `{ place, index, ... }: { place: NeighborhoodPlace; ... }` object type) with `{ place, index, windowLabel, noun, domainMax, onHoverPlace, locator, coords, onFlyTo }: PlaceContextCardProps`

`barHeight`, `ProfileBars`, `TemporalSection`, and `CategoryBreakdown` stay module-private (no `export`).

- [ ] **Step 4: Update `AnalyzeTab.tsx` to use the extracted component**

In `frontend/src/components/AnalyzeTab.tsx`:

1. Delete lines 115-347 (`barHeight` through `VerdictCard` inclusive). Keep `formatDistanceMeters` (111-113) and `PairwiseSection` (349-366) — `PairwiseSection` is retired in slice 2, not here.
2. Replace the `<VerdictCard` usage (line 619 in the `neighborhood?.places?.map` block) with `<PlaceContextCard` — same props, nothing else changes.
3. Fix imports at the top of the file:
   - Remove `CategoryShare` and `TemporalProfile` from the `../types` type import (still used: `AnalysisSettings`, `IncidentDetail`, `IncidentDetailsResponse`, `McppFeatureCollection`, `NeighborhoodAnalysis`, `NeighborhoodPlace`, `Place`).
   - Remove the imports of `aggregateHeadline` (`../lib/verdictCopy`), `placeIdentity` (`../lib/placeIdentity`), `annualIncidentsWithin, formatPerYear` (`../lib/rateFormat`), and the whole `../lib/temporalWindow` block.
   - Change `import { BaselineIntervalPlot, plotDomainMax } from "./BaselineIntervalPlot";` to `import { plotDomainMax } from "./BaselineIntervalPlot";`
   - Change `import { LocatorChip, type LocatorData } from "./LocatorChip";` to `import type { LocatorData } from "./LocatorChip";`
   - Add `import { PlaceContextCard } from "./PlaceContextCard";`
   - Keep `useState` in the react import (`editingControls` still uses it).

- [ ] **Step 5: Run the new test and the existing AnalyzeTab suite**

Run: `cd frontend && npx vitest run src/components/PlaceContextCard.test.tsx src/components/AnalyzeTab.test.tsx --environment jsdom`
Expected: PASS both (6 new tests; the full existing AnalyzeTab suite unchanged and green — it exercises the moved code through `AnalyzeTab`).

- [ ] **Step 6: Lint (catches dead imports)**

Run: `cd frontend && npm run lint`
Expected: clean. If it flags unused imports in `AnalyzeTab.tsx`, remove exactly those.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/PlaceContextCard.tsx frontend/src/components/PlaceContextCard.test.tsx frontend/src/components/AnalyzeTab.tsx
git commit -m "refactor(analyze): extract PlaceContextCard per-address context module"
```

---

## Task 2: `useCompare` fetches neighborhood context in parallel

**Files:**
- Modify: `frontend/src/lib/useCompare.ts` (full replacement below)
- Modify: `frontend/src/lib/useCompare.test.ts`

- [ ] **Step 1: Extend the tests (they must fail first)**

Replace the entire contents of `frontend/src/lib/useCompare.test.ts` with:

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

vi.mock("../api/client", () => ({
  comparePlaces: vi.fn().mockResolvedValue({} as unknown),
  getNeighborhoodAnalysis: vi.fn().mockResolvedValue({} as unknown),
}));
import { comparePlaces, getNeighborhoodAnalysis } from "../api/client";

const analysis = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 250, offenseCategory: "", layer: "reported" as const };
const points = [
  { latitude: 47.61, longitude: -122.34, label: "A" },
  { latitude: 47.62, longitude: -122.33, label: "B" },
];

afterEach(() => vi.clearAllMocks());

describe("useCompare shared-view points", () => {
  it("sends points (not place_ids) when a points override is provided", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({ points }));
    expect((comparePlaces as ReturnType<typeof vi.fn>).mock.calls[0][0].place_ids).toBeUndefined();
  });

  it("caps a >120-char point label at 120 chars in the POSTed body", async () => {
    const longLabel = "A".repeat(140);
    const longPoints = [
      { latitude: 47.61, longitude: -122.34, label: longLabel },
      { latitude: 47.62, longitude: -122.33, label: "B" },
    ];
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points: longPoints }));
    await act(async () => { await result.current.runCompare(); });
    const sentPoints = (comparePlaces as ReturnType<typeof vi.fn>).mock.calls[0][0].points;
    expect(sentPoints[0].label).toBe(longLabel.slice(0, 120));
    expect(sentPoints[0].label.length).toBe(120);
  });
});

describe("useCompare neighborhood context", () => {
  it("fetches the neighborhood analysis in parallel with the same points and radii_m", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({ points, radii_m: [250] }));
    expect((getNeighborhoodAnalysis as ReturnType<typeof vi.fn>).mock.calls[0][0].radius_m).toBeUndefined();
    expect(result.current.neighborhood).toEqual({});
  });

  it("keeps the comparison and clears neighborhood when only the neighborhood call fails", async () => {
    (getNeighborhoodAnalysis as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError, points }));
    await act(async () => { await result.current.runCompare(); });
    expect(result.current.comparison).toEqual({});
    expect(result.current.neighborhood).toBeNull();
    expect(setError).toHaveBeenCalledWith("");
    expect(setError).not.toHaveBeenCalledWith("Unable to compare places. Try again.");
  });

  it("errors and keeps no comparison when the compare call fails, even if neighborhood succeeds", async () => {
    (comparePlaces as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError, points }));
    await act(async () => { await result.current.runCompare(); });
    expect(result.current.comparison).toBeNull();
    expect(setError).toHaveBeenCalledWith("Unable to compare places. Try again.");
  });

  it("invalidate clears both comparison and neighborhood", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    act(() => { result.current.invalidate(); });
    expect(result.current.comparison).toBeNull();
    expect(result.current.neighborhood).toBeNull();
  });

  it("applyAssistant sets the comparison and clears any stale neighborhood", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    act(() => { result.current.applyAssistant({ id: "c9" } as never); });
    expect(result.current.comparison).toEqual({ id: "c9" });
    expect(result.current.neighborhood).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/lib/useCompare.test.ts --environment jsdom`
Expected: FAIL — `result.current.neighborhood` is `undefined` (property doesn't exist yet); the two original tests still pass.

- [ ] **Step 3: Implement**

Replace the entire contents of `frontend/src/lib/useCompare.ts` with:

```ts
import { useRef, useState } from "react";

import { comparePlaces, getNeighborhoodAnalysis } from "../api/client";
import type { AnalysisSettings, NeighborhoodAnalysis, SiteComparison } from "../types";

export interface CompareController {
  running: boolean;
  comparison: SiteComparison | null;
  /** Per-address neighborhood context for the same run; null when unavailable. */
  neighborhood: NeighborhoodAnalysis | null;
  runCompare: () => Promise<void>;
  /** Drop in-flight + current comparison (selection or analysis controls changed). */
  invalidate: () => void;
  /** Apply an analyst-provided comparison directly (no re-fetch). */
  applyAssistant: (comparison: SiteComparison | null) => void;
}

interface CompareDeps {
  selectedIds: Set<string>;
  analysis: AnalysisSettings;
  setError: (message: string) => void;
  points?: { latitude: number; longitude: number; label: string }[];
}

/**
 * Owns the Compare tab: runs the side-by-side comparison for the current selection at a
 * single radius, plus the per-address neighborhood analysis in parallel (the ranked rows
 * expand into full context). A version ref guards against a stale in-flight result
 * landing after the selection/controls moved on. The two calls fail independently: a
 * missing neighborhood degrades expansions, only a failed compare is an error.
 * `applyAssistant` lets the chat agent populate the pane (comparison only — expansions
 * degrade until the next manual run).
 */
export function useCompare({ selectedIds, analysis, setError, points }: CompareDeps): CompareController {
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<SiteComparison | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodAnalysis | null>(null);
  const versionRef = useRef(0);

  function invalidate() {
    versionRef.current += 1;
    setComparison(null);
    setNeighborhood(null);
  }

  async function runCompare() {
    const usePoints = points && points.length >= 2;
    if (!usePoints && selectedIds.size < 2) return;
    setError("");
    setRunning(true);
    const version = versionRef.current + 1;
    versionRef.current = version;
    const idPayload = usePoints
      ? { points: points!.map((p) => ({ ...p, label: p.label.slice(0, 120) })) }
      : { place_ids: Array.from(selectedIds) };
    const shared = {
      analysis_start_date: analysis.startDate,
      analysis_end_date: analysis.endDate,
      offense_category: analysis.offenseCategory || null,
      layer: analysis.layer,
    };
    const [compareResult, neighborhoodResult] = await Promise.allSettled([
      comparePlaces({ ...idPayload, ...shared, radius_m: analysis.radiusM }),
      getNeighborhoodAnalysis({ ...idPayload, ...shared, radii_m: [analysis.radiusM] }),
    ]);
    if (versionRef.current === version) {
      if (compareResult.status === "fulfilled") {
        setComparison(compareResult.value);
      } else {
        setComparison(null);
        setError("Unable to compare places. Try again.");
      }
      setNeighborhood(neighborhoodResult.status === "fulfilled" ? neighborhoodResult.value : null);
    }
    setRunning(false);
  }

  function applyAssistant(next: SiteComparison | null) {
    setComparison(next);
    setNeighborhood(null);
  }

  return { running, comparison, neighborhood, runCompare, invalidate, applyAssistant };
}
```

- [ ] **Step 4: Run to verify all tests pass**

Run: `cd frontend && npx vitest run src/lib/useCompare.test.ts --environment jsdom`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useCompare.ts frontend/src/lib/useCompare.test.ts
git commit -m "feat(compare): fetch per-address neighborhood context alongside the comparison"
```

---

## Task 3: Expandable ranked rows rendering `PlaceContextCard`

**Files:**
- Modify: `frontend/src/components/CompareRankedList.tsx` (full replacement below)
- Modify: `frontend/src/components/CompareRankedList.test.tsx` (additions below)
- Modify: `frontend/src/components/CompareTab.tsx`
- Modify: `frontend/src/components/CompareTab.test.tsx` (additions below)
- Modify: `frontend/src/components/MapWorkspace.tsx` (one prop)

- [ ] **Step 1: Add the failing CompareRankedList tests**

In `frontend/src/components/CompareRankedList.test.tsx`, add inside the existing `describe("CompareRankedList", ...)` block (keep every existing test):

```tsx
  it("renders a Full context disclosure only for rows with an expansion", () => {
    const expansions = new Map([["b", <p key="x">Bell context body</p>]]);
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} expansionByOptionId={expansions} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getAllByText("Full context")).toHaveLength(1);
    expect(within(region).getByText("Bell context body")).toBeInTheDocument();
  });

  it("renders no Full context disclosure when no expansions are provided", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    expect(within(screen.getByTestId("compare-ranked")).queryByText("Full context")).not.toBeInTheDocument();
  });
```

(The existing file already imports `render`, `screen`, `within`, `incidentNoun`, and defines `rows`; no import changes are needed beyond what's already there.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/CompareRankedList.test.tsx --environment jsdom`
Expected: FAIL — TypeScript/prop error or missing "Full context" text (component has no `expansionByOptionId` prop yet).

- [ ] **Step 3: Implement the expandable rows**

Replace the entire contents of `frontend/src/components/CompareRankedList.tsx` with:

```tsx
import type { ReactNode } from "react";

import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareRelationship, CompareVerdictRow } from "../lib/compareVerdict";

const CHIP: Record<CompareRelationship, { label: string; clear: boolean }> = {
  lowest: { label: "lowest rate", clear: true },
  similar: { label: "similar to lowest", clear: false },
  higher: { label: "clearly higher", clear: false },
  limited: { label: "limited data", clear: false },
};

export function CompareRankedList({ rows, noun, radiusM, expansionByOptionId }: { rows: CompareVerdictRow[]; noun: IncidentNoun; radiusM: number; expansionByOptionId?: Map<string, ReactNode> }) {
  return (
    <div className="mc-ranked" data-testid="compare-ranked">
      {rows.map((row) => {
        const chip = CHIP[row.relationship];
        const expansion = expansionByOptionId?.get(row.optionId) ?? null;
        return (
          <div className={`mc-ranked-row${row.relationship === "lowest" ? " is-lowest" : ""}`} key={row.optionId}>
            <span className="mc-rank">{row.rank}</span>
            <div className="mc-ranked-name">
              <strong>{row.label}</strong>
              <small>{row.incidentCount} {noun.plural}</small>
            </div>
            <div className="mc-ranked-bar"><span style={{ width: `${Math.round(row.barFraction * 100)}%` }} /></div>
            <span className="mc-ranked-rate">
              {formatPerYear(annualIncidentsWithin(row.rate, radiusM))}/yr{row.multipleOfLowest !== null ? ` · ${row.multipleOfLowest.toFixed(1)}× lowest` : ""}
            </span>
            <span className={`mc-vchip${chip.clear ? " clear" : ""}`}>{chip.label}</span>
            {row.pairwise ? (
              <details className="mc-analytical mc-ranked-detail">
                <summary>How we know</summary>
                <dl>
                  <div><dt>rate-ratio</dt><dd>{row.pairwise.rate_ratio.toFixed(2)}×</dd></div>
                  <div><dt>95% CI</dt><dd>{row.pairwise.ci_lower.toFixed(2)}–{row.pairwise.ci_upper.toFixed(2)}</dd></div>
                  <div><dt>adjusted p</dt><dd>{row.pairwise.adjusted_p_value.toFixed(3)}</dd></div>
                  <div><dt>method</dt><dd>{row.pairwise.method}</dd></div>
                </dl>
              </details>
            ) : null}
            {expansion ? (
              <details className="mc-analytical mc-ranked-detail mc-ranked-context">
                <summary>Full context</summary>
                {expansion}
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
```

(No CSS change: `mc-ranked-detail` already spans the row grid via `.mc-ranked-row .mc-ranked-detail{grid-column:1 / -1}` in `frontend/src/styles/mapWorkspace.css`, and the expansion body is a `mc-verdict` section with existing styling.)

- [ ] **Step 4: Run to verify CompareRankedList tests pass**

Run: `cd frontend && npx vitest run src/components/CompareRankedList.test.tsx --environment jsdom`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Add the failing CompareTab tests**

In `frontend/src/components/CompareTab.test.tsx`:

1. Extend the type import from `../types` to include `NeighborhoodAnalysis` and `NeighborhoodPlace`:

```tsx
import type { AnalysisSettings, NeighborhoodAnalysis, NeighborhoodPlace, SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";
```

2. Add fixtures after the `clearSweep` constant:

```tsx
function contextPlace(id: string, label: string, count: number): NeighborhoodPlace {
  return {
    place_id: id, place_label: label, beat: "M2", radius_m: 250,
    baseline_available: true, decision: "above_clear", place_incident_count: count,
    place_rate: 0.5, place_rate_ci_lower: 0.3, place_rate_ci_upper: 0.8,
    minimum_data_status: "met", nearest_incident_m: 42, monthly_counts: [1, 2, 3],
    baselines: [
      { kind: "beat", label: "Beat M2", area_km2: 1.1, baseline_incident_count: 180, baseline_rate: 0.17, rate_ratio: 2.0, ci_lower: 1.1, ci_upper: 3.6, adjusted_p_value: 0.012, method: "quasi_poisson", relation: "above" },
    ],
    category_breakdown: [{ label: "Theft", place_count: 3, place_share: 0.6, beat_share: 0.2 }],
    temporal: {
      hour_by_dow: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      hour_counts: Array.from({ length: 24 }, (_, h) => (h === 17 ? 5 : 0)),
      dow_counts: [5, 0, 0, 0, 0, 0, 0],
      total_with_time: 5,
      without_time: 0,
    },
  };
}

// Order matches clearSweep's analytical.options: [a "Pike", b "Bell"].
const contextNeighborhood: NeighborhoodAnalysis = {
  radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
  offense_category: null, pairwise: [], places: [contextPlace("n1", "Pike", 12), contextPlace("n2", "Bell", 44)],
};
```

3. Update the `base` constant to include a default `neighborhood: null`:

```tsx
const base = { provider, onAddPoint: vi.fn(), onRemovePoint: vi.fn(), savedKeys: new Set<string>(), onSavePoint: vi.fn(), analysis, running: false, onRun: vi.fn(), neighborhood: null };
```

4. Add these tests inside the existing describe block:

```tsx
  it("expands a ranked row into the full per-address context", () => {
    render(<CompareTab {...base} set={setOf("Pike", "Bell")} comparison={clearSweep} neighborhood={contextNeighborhood} />);
    const ranked = screen.getByTestId("compare-ranked");
    expect(within(ranked).getAllByText("Full context")).toHaveLength(2);
    expect(within(ranked).getByText(/12 reported incidents within 250 m/)).toBeInTheDocument();
    expect(within(ranked).getAllByText(/When reported incidents occurred/i)).toHaveLength(2);
  });

  it("notes missing per-address context when the neighborhood payload is unavailable", () => {
    render(<CompareTab {...base} set={setOf("Pike", "Bell")} comparison={clearSweep} neighborhood={null} />);
    expect(screen.getByText(/per-address context unavailable for this run/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("compare-ranked")).queryByText("Full context")).not.toBeInTheDocument();
  });

  it("expanded context regions never emit safety-ranking vocabulary", () => {
    render(<CompareTab {...base} set={setOf("Pike", "Bell")} comparison={clearSweep} neighborhood={contextNeighborhood} />);
    const text = (screen.getByTestId("compare-ranked").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx --environment jsdom`
Expected: FAIL — `neighborhood` prop unknown / "Full context" absent.

- [ ] **Step 7: Wire expansions in `CompareTab.tsx`**

In `frontend/src/components/CompareTab.tsx`:

1. Update imports — add `useMemo` and the new pieces:

```tsx
import { useMemo } from "react";
import type { ReactNode } from "react";

import { toCompareVerdict } from "../lib/compareVerdict";
import { incidentNoun } from "../lib/layerCopy";
import type { GeocodingProvider } from "../lib/geocoding";
import type { ComparePoint } from "../lib/useCompareSet";
import { MAX_COMPARE_POINTS, keyOf } from "../lib/useCompareSet";
import type { AnalysisSettings, NeighborhoodAnalysis, SiteComparison } from "../types";
import { plotDomainMax } from "./BaselineIntervalPlot";
import { CompareAddressInput } from "./CompareAddressInput";
import { CompareRankedList } from "./CompareRankedList";
import { CompareRateNumberLine } from "./CompareRateNumberLine";
import { CompareVerdict } from "./CompareVerdict";
import { MethodsAppendix } from "./MethodsAppendix";
import { PlaceContextCard } from "./PlaceContextCard";
```

2. Add to `Props`:

```tsx
  /** Per-address neighborhood context from the same run; null degrades expansions. */
  neighborhood: NeighborhoodAnalysis | null;
```

3. Destructure `neighborhood` in the component signature (after `comparison`).

4. Inside the component body, after `const verdict = ...`, build the expansion map. Join by index: `analytical.options[]`, `neighborhood.places[]`, and `set` all preserve the submitted points order:

```tsx
  const expansionByOptionId = useMemo(() => {
    if (!comparison || !neighborhood?.places?.length) return undefined;
    const domainMax = plotDomainMax(neighborhood.places);
    const windowLabel = `${neighborhood.analysis_start_date} – ${neighborhood.analysis_end_date}`;
    const map = new Map<string, ReactNode>();
    comparison.analytical.options.forEach((option, index) => {
      const place = neighborhood.places[index];
      if (!place) return;
      const point = set[index];
      map.set(
        option.id,
        <PlaceContextCard
          place={place}
          index={index}
          windowLabel={windowLabel}
          noun={noun}
          domainMax={domainMax}
          locator={null}
          coords={point ? { latitude: point.latitude, longitude: point.longitude } : null}
        />,
      );
    });
    return map;
  }, [comparison, neighborhood, set, noun]);
```

5. In the JSX, pass the map to the ranked list and add the degradation note. Replace the current verdict block:

```tsx
      {verdict ? (
        <>
          <CompareVerdict callout={verdict.callout} noun={noun} />
          <p className="mc-ranked-title">Ranked by {noun.singular} rate — lowest first</p>
          <CompareRankedList rows={verdict.rows} noun={noun} radiusM={analysis.radiusM} expansionByOptionId={expansionByOptionId} />
          {!expansionByOptionId ? (
            <p className="mc-search-msg">Per-address context unavailable for this run.</p>
          ) : null}
          <CompareRateNumberLine rows={verdict.rows} noun={noun} radiusM={analysis.radiusM} />
        </>
      ) : set.length >= 2 ? (
        <p className="mc-empty-list">Compare these {set.length} addresses to rank their {noun.singular} rates.</p>
      ) : null}
```

6. In `frontend/src/components/MapWorkspace.tsx`, at the `<CompareTab` mount (around line 527), add the prop alongside `comparison={compare.comparison}`:

```tsx
              neighborhood={compare.neighborhood}
```

- [ ] **Step 8: Run the compare suites**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx src/components/CompareRankedList.test.tsx src/components/MapWorkspace.test.tsx --environment jsdom`
Expected: PASS. (If `MapWorkspace.test.tsx` fails to compile because a mocked `useCompare` return object lacks `neighborhood`, add `neighborhood: null` to that mock object — search the file for `comparison:` to find it.)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/CompareRankedList.tsx frontend/src/components/CompareRankedList.test.tsx frontend/src/components/CompareTab.tsx frontend/src/components/CompareTab.test.tsx frontend/src/components/MapWorkspace.tsx
git commit -m "feat(compare): ranked rows expand into full per-address context"
```

---

## Task 4: Roadmap note, full gate, PR

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Record slice 1 under Phase 5**

In `docs/ROADMAP.md`, immediately after the Slice C bullet (the one ending `...compare-single-address-entry*.`), append:

```markdown
**Unified Compare surface (2026-07-16):** the tabs converge on one surface named Compare
(spec: `docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md`), in three
slices.
- [x] **Slice 1 — extract + enrich** — `PlaceContextCard` extracted from Analyze; Compare
  fetches the points-based neighborhood analysis in parallel and ranked rows expand into
  full per-address context. Plan: `docs/superpowers/plans/2026-07-16-unified-compare-slice1.md`.
- [ ] **Slice 2 — unify** — one list + one panel, tabs collapse to Compare + Export,
  pairwise section and bridge retire, share-link + assistant-bridge migration.
- [ ] **Slice 3 — polish** — adaptive CTA label, mobile tuning; later optional:
  pin-to-compare columns, progressive spine-first rendering.
```

- [ ] **Step 2: Full verification gate**

Run from the worktree root: `make test-all`
Expected: pytest green (backend untouched), ruff clean, frontend tests green, `npm run build` succeeds.

- [ ] **Step 3: Commit, push, open PR**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): record unified-Compare decomposition; slice 1 built"
git push -u origin jcscocca/claude/unified-compare-surface
gh pr create --title "feat(compare): ranked rows expand into full per-address context (unified Compare, slice 1)" --body "$(cat <<'EOF'
Slice 1 of the unified Compare surface (spec: docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md).

- Extracts the per-address context module (verdict + baseline analytics + temporal profile + category mix) out of AnalyzeTab into a reusable PlaceContextCard. Pure move; Analyze behavior unchanged.
- useCompare now fetches /dashboard/neighborhood in parallel with /dashboard/compare (Promise.allSettled — the calls degrade independently), joined to ranked rows by input-order index (both payloads preserve input point order; ids are per-request synthetics).
- Each ranked Compare row gains a "Full context" disclosure rendering the module for that address; a quiet note appears when context is unavailable (e.g. assistant-applied comparisons).

Invariant: dynamic regions stay in reported-incident-rate vocabulary; new banned-vocabulary tests cover the module and expansions.

make test-all green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (do not do here)

- Any backend/`app/` change.
- Retiring `PairwiseSection`, the compare bridge, the two-address minimum, or any tab/nav change (slice 2).
- Locator chip / fly-to / hover-linking inside compare expansions (needs `mcppPolygons` wiring — revisit in slice 2).
- Adaptive CTA label, pinned columns, progressive rendering (slice 3).
