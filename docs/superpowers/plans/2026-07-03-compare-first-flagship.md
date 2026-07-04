# Compare-first Flagship — Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Compare tab to render the statistical richness the `/dashboard/compare` payload already returns — a ranked, lowest-first verdict with an honest hybrid callout — driven entirely by that payload, with no backend change.

**Architecture:** A pure derivation module (`compareVerdict.ts`) maps the compare payload to a view model (ranked rows + a callout kind); two compare-owned view components (`CompareVerdict`, `CompareRankedList`) render it reusing existing `mc-verdict`/`mc-vchip`/`mc-cmpbar` CSS; the `CompareTab` shell is rebuilt to drive off `comparison` instead of the Analyze `summary`, and the wire type `Record<string, unknown>` is replaced by a `SiteComparison` type. Frontend only.

**Tech Stack:** React + TypeScript + Vite, Vitest (`vitest run --environment jsdom`), `tsc -b` for type-check. Run from `frontend/`.

**Working context:** Worktree `/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/compare-first-flagship`, branch `jcscocca/claude/compare-first-flagship` (spec committed at `f4b3e96`, off origin/main). Spec: `docs/superpowers/specs/2026-07-03-compare-first-flagship-design.md`. Single PR, gated on `make test-all`.

**The wire contract (verified against `app/services/analysis_service.py` `_comparison_model_payload` / `_option_payload` / `_pairwise_payload`), all snake_case:**
- top: `overview{}`, `analytical{}`, plus `id`, `comparison_type`, `geometry_type`, `radius_m`, dates, offense filters, `created_at`.
- `overview{}`: `label`, `decision_class`, `recommendation_option_id`, `recommendation_label`, `summary_text`, `caveat_text`, `options[]`.
- `analytical{}`: `label`, `source_dataset`, `exposure_unit`, `full_caveat_text`, `options[]`, `pairwise_results[]`.
- **option** (`overview.options[]` and `analytical.options[]`, same array): `id` ← option_id, `label` ← option_label, `geometry_type`, `radius_m`, `incident_count`, `exposure`, `exposure_unit`, `incident_rate`, `geometry_metadata`. **The key is `id`/`label`, NOT `option_id`/`option_label`; `overview.recommendation_option_id` matches an option's `id`.**
- **pairwise** (`analytical.pairwise_results[]`, k−1 of them, candidate-vs-each-other): `id`, `option_a_id`, `option_a_label`, `option_b_id`, `option_b_label`, `winner_option_id`, `winner_label`, `decision_class`, `method`, `incident_count_a`, `incident_count_b`, `exposure_a`, `exposure_b`, `exposure_unit`, `rate_a`, `rate_b`, `rate_ratio`, `ci_lower`, `ci_upper`, `p_value`, `adjusted_p_value`, `overdispersion_phi`, `overdispersion_status`, `minimum_data_status`, `caveat_text`.
- `decision_class` ∈ `statistically_lower | not_statistically_clear | insufficient_data | model_warning`.

**Standing rule:** every user-facing string is bounded to reported-incident-rate vocabulary — never `safe/unsafe/safety/danger/dangerous/risk/risky`. A scoped frontend guard (Task 5) enforces it on the dynamic verdict region only (the fixed caveat legitimately contains "risk prediction").

---

## Task 1: `SiteComparison` wire type

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add the types**

Append to `frontend/src/types.ts` (after the existing `LayerKey` block; exact location doesn't matter as long as it's top-level):

```ts
export type SiteDecisionClass =
  | "statistically_lower"
  | "not_statistically_clear"
  | "insufficient_data"
  | "model_warning";

export type SiteComparisonOption = {
  id: string;
  label: string;
  geometry_type: string;
  radius_m: number;
  incident_count: number;
  exposure: number;
  exposure_unit: string;
  incident_rate: number;
};

export type SitePairwiseResult = {
  id: string;
  option_a_id: string;
  option_a_label: string;
  option_b_id: string;
  option_b_label: string;
  winner_option_id: string | null;
  winner_label: string | null;
  decision_class: SiteDecisionClass;
  method: string;
  incident_count_a: number;
  incident_count_b: number;
  exposure_a: number;
  exposure_b: number;
  exposure_unit: string;
  rate_a: number;
  rate_b: number;
  rate_ratio: number;
  ci_lower: number;
  ci_upper: number;
  p_value: number;
  adjusted_p_value: number;
  overdispersion_phi: number | null;
  overdispersion_status: string;
  minimum_data_status: string;
  caveat_text: string;
};

export type SiteComparisonOverview = {
  label: string;
  decision_class: SiteDecisionClass;
  recommendation_option_id: string | null;
  recommendation_label: string | null;
  summary_text: string;
  caveat_text: string;
  options: SiteComparisonOption[];
};

export type SiteComparisonAnalytical = {
  label: string;
  source_dataset: string;
  exposure_unit: string;
  full_caveat_text: string;
  options: SiteComparisonOption[];
  pairwise_results: SitePairwiseResult[];
};

export type SiteComparison = {
  id: string;
  comparison_type: string;
  geometry_type: string;
  radius_m: number;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  created_at: string;
  overview: SiteComparisonOverview;
  analytical: SiteComparisonAnalytical;
};
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run lint`
Expected: clean (types added, nothing consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat(compare): add SiteComparison wire type"
```

---

## Task 2: `compareVerdict.ts` — pure derivation (TDD, the core)

**Files:**
- Create: `frontend/src/lib/compareVerdict.ts`
- Test: `frontend/src/lib/compareVerdict.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/compareVerdict.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toCompareVerdict } from "./compareVerdict";
import type { SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";

function opt(id: string, label: string, count: number, rate: number): SiteComparisonOption {
  return { id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate };
}

function pair(a: string, b: string, decision: SiteDecisionClass, winner: string | null, ratio: number): SitePairwiseResult {
  return {
    id: `${a}-${b}`, option_a_id: a, option_a_label: a, option_b_id: b, option_b_label: b,
    winner_option_id: winner, winner_label: winner, decision_class: decision, method: "quasipoisson",
    incident_count_a: 0, incident_count_b: 0, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days",
    rate_a: 0, rate_b: 0, rate_ratio: ratio, ci_lower: ratio * 0.6, ci_upper: ratio * 1.4,
    p_value: 0.01, adjusted_p_value: 0.02, overdispersion_phi: 1.0, overdispersion_status: "ok",
    minimum_data_status: "met", caveat_text: "",
  };
}

function comparison(overall: SiteDecisionClass, options: SiteComparisonOption[], pairwise: SitePairwiseResult[], recId: string | null): SiteComparison {
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250,
    analysis_start_date: "2026-01-01", analysis_end_date: "2026-12-31",
    offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: overall, recommendation_option_id: recId, recommendation_label: recId, summary_text: "", caveat_text: "cav", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options, pairwise_results: pairwise },
  };
}

describe("toCompareVerdict", () => {
  it("ranks options ascending by rate with the lowest first and 1-based ranks", () => {
    const c = comparison("not_statistically_clear",
      [opt("b", "Bell", 31, 10.1), opt("a", "Pike", 12, 3.9), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "b", "not_statistically_clear", null, 2.6), pair("a", "y", "not_statistically_clear", null, 3.7)], null);
    const m = toCompareVerdict(c);
    expect(m.rows.map((r) => r.label)).toEqual(["Pike", "Bell", "Yesler"]);
    expect(m.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(m.rows[0].relationship).toBe("lowest");
    expect(m.rows[0].barFraction).toBeCloseTo(3.9 / 14.3, 5);
    expect(m.rows[2].barFraction).toBeCloseTo(1, 5);
    expect(m.rows[1].multipleOfLowest).toBeCloseTo(10.1 / 3.9, 4);
    expect(m.rows[0].multipleOfLowest).toBeNull();
  });

  it("clean sweep -> clear callout, others 'higher'", () => {
    const c = comparison("statistically_lower",
      [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 31, 10.1), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "b", "statistically_lower", "a", 2.6), pair("a", "y", "statistically_lower", "a", 3.7)], "a");
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("clear");
    expect(m.callout.lowestLabel).toBe("Pike");
    expect(m.callout.loweredCount).toBe(2);
    expect(m.callout.otherCount).toBe(2);
    expect(m.rows.filter((r) => r.relationship === "higher")).toHaveLength(2);
  });

  it("partial sweep -> partial callout with N of M and mixed chips", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 12, 3.9), opt("v", "Vine", 14, 4.4), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "v", "not_statistically_clear", null, 1.1), pair("a", "y", "statistically_lower", "a", 3.7)], null);
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("partial");
    expect(m.callout.loweredCount).toBe(1);
    expect(m.callout.otherCount).toBe(2);
    expect(m.rows.find((r) => r.label === "Vine")!.relationship).toBe("similar");
    expect(m.rows.find((r) => r.label === "Yesler")!.relationship).toBe("higher");
  });

  it("no pair clears -> none callout", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 18, 5.8), opt("b", "Bell", 22, 7.1)],
      [pair("a", "b", "not_statistically_clear", null, 1.2)], null);
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("none");
    expect(m.callout.loweredCount).toBe(0);
    expect(m.rows[1].relationship).toBe("similar");
  });

  it("insufficient/model_warning overall -> inconclusive with caveat, even if a pair cleared", () => {
    const c = comparison("insufficient_data",
      [opt("a", "Pike", 2, 0.6), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "y", "statistically_lower", "a", 20)], null);
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("inconclusive");
    expect(m.callout.caveatText).toBe("full cav");
    expect(m.rows.find((r) => r.label === "Yesler")!.relationship).toBe("higher");
  });

  it("insufficient pair -> row relationship 'limited'", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 12, 3.9), opt("z", "Zed", 3, 9.0)],
      [pair("a", "z", "insufficient_data", null, 2.3)], null);
    const m = toCompareVerdict(c);
    expect(m.rows.find((r) => r.label === "Zed")!.relationship).toBe("limited");
  });

  it("zero lowest rate -> multipleOfLowest is null (no divide-by-zero)", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 0, 0), opt("b", "Bell", 10, 4.0)],
      [pair("a", "b", "not_statistically_clear", null, 0)], null);
    const m = toCompareVerdict(c);
    expect(m.rows[1].multipleOfLowest).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/lib/compareVerdict.test.ts`
Expected: FAIL — `toCompareVerdict` is not defined.

- [ ] **Step 3: Implement `compareVerdict.ts`**

Create `frontend/src/lib/compareVerdict.ts`:

```ts
import type { SiteComparison, SitePairwiseResult } from "../types";

export type CompareRelationship = "lowest" | "similar" | "higher" | "limited";

export type CompareVerdictRow = {
  rank: number;
  optionId: string;
  label: string;
  incidentCount: number;
  rate: number;
  barFraction: number;
  multipleOfLowest: number | null;
  relationship: CompareRelationship;
  pairwise: SitePairwiseResult | null;
};

export type CompareCalloutKind = "clear" | "partial" | "none" | "inconclusive";

export type CompareCallout = {
  kind: CompareCalloutKind;
  lowestLabel: string;
  loweredCount: number;
  otherCount: number;
  caveatText: string;
};

export type CompareVerdictModel = {
  rows: CompareVerdictRow[];
  callout: CompareCallout;
};

function relationshipFor(pair: SitePairwiseResult | null): CompareRelationship {
  if (!pair) return "limited";
  if (pair.decision_class === "statistically_lower") return "higher";
  if (pair.decision_class === "not_statistically_clear") return "similar";
  return "limited"; // insufficient_data | model_warning
}

export function toCompareVerdict(comparison: SiteComparison): CompareVerdictModel {
  const options = comparison.analytical.options;
  const pairwise = comparison.analytical.pairwise_results;
  const sorted = [...options].sort((a, b) => a.incident_rate - b.incident_rate);
  const candidate = sorted[0];
  const maxRate = sorted.length ? sorted[sorted.length - 1].incident_rate : 0;
  const lowestRate = candidate ? candidate.incident_rate : 0;

  // Each pairwise is candidate-vs-one-other; key by the "other" option id.
  const pairByOther = new Map<string, SitePairwiseResult>();
  for (const p of pairwise) {
    const otherId = candidate && p.option_a_id === candidate.id ? p.option_b_id
      : candidate && p.option_b_id === candidate.id ? p.option_a_id
      : null;
    if (otherId) pairByOther.set(otherId, p);
  }

  const rows: CompareVerdictRow[] = sorted.map((o, i) => {
    const isLowest = candidate ? o.id === candidate.id : false;
    const pair = isLowest ? null : pairByOther.get(o.id) ?? null;
    return {
      rank: i + 1,
      optionId: o.id,
      label: o.label,
      incidentCount: o.incident_count,
      rate: o.incident_rate,
      barFraction: maxRate > 0 ? o.incident_rate / maxRate : 0,
      multipleOfLowest: isLowest || lowestRate <= 0 ? null : o.incident_rate / lowestRate,
      relationship: isLowest ? "lowest" : relationshipFor(pair),
      pairwise: pair,
    };
  });

  const otherCount = Math.max(0, sorted.length - 1);
  const loweredCount = pairwise.filter((p) => p.decision_class === "statistically_lower").length;
  const overall = comparison.overview.decision_class;
  let kind: CompareCalloutKind;
  if (overall === "statistically_lower") kind = "clear";
  else if (overall === "insufficient_data" || overall === "model_warning") kind = "inconclusive";
  else kind = loweredCount >= 1 ? "partial" : "none";

  const caveatText = comparison.analytical.full_caveat_text || comparison.overview.caveat_text || "";

  return {
    rows,
    callout: { kind, lowestLabel: candidate ? candidate.label : "", loweredCount, otherCount, caveatText },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/lib/compareVerdict.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/compareVerdict.ts frontend/src/lib/compareVerdict.test.ts
git commit -m "feat(compare): pure compare-verdict derivation from the payload"
```

---

## Task 3: `CompareRankedList` component + CSS

**Files:**
- Create: `frontend/src/components/CompareRankedList.tsx`
- Test: `frontend/src/components/CompareRankedList.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/CompareRankedList.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompareRankedList } from "./CompareRankedList";
import { incidentNoun } from "../lib/layerCopy";
import type { CompareVerdictRow } from "../lib/compareVerdict";
import type { SitePairwiseResult } from "../types";

const pair: SitePairwiseResult = {
  id: "a-b", option_a_id: "a", option_a_label: "Pike", option_b_id: "b", option_b_label: "Bell",
  winner_option_id: "a", winner_label: "Pike", decision_class: "statistically_lower", method: "quasipoisson",
  incident_count_a: 12, incident_count_b: 31, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days",
  rate_a: 3.9, rate_b: 10.1, rate_ratio: 2.6, ci_lower: 1.4, ci_upper: 4.9, p_value: 0.001, adjusted_p_value: 0.004,
  overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "",
};

const rows: CompareVerdictRow[] = [
  { rank: 1, optionId: "a", label: "Pike", incidentCount: 12, rate: 3.9, barFraction: 0.27, multipleOfLowest: null, relationship: "lowest", pairwise: null },
  { rank: 2, optionId: "b", label: "Bell", incidentCount: 31, rate: 10.1, barFraction: 0.71, multipleOfLowest: 2.6, relationship: "higher", pairwise: pair },
];

afterEach(cleanup);

describe("CompareRankedList", () => {
  it("renders rows in order with rank, label, count, rate and chips", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("Pike")).toBeInTheDocument();
    expect(within(region).getByText("lowest rate")).toBeInTheDocument();
    expect(within(region).getByText("clearly higher")).toBeInTheDocument();
    expect(within(region).getByText(/2\.6× lowest/)).toBeInTheDocument();
    expect(within(region).getByText(/12 reported incidents/)).toBeInTheDocument();
  });

  it("shows a How-we-know disclosure only for non-lowest rows", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} />);
    const region = screen.getByTestId("compare-ranked");
    const details = within(region).getAllByText("How we know");
    expect(details).toHaveLength(1);
    expect(within(region).getByText(/0\.004/)).toBeInTheDocument(); // adjusted p
  });

  it("never emits safety-ranking vocabulary", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} />);
    const text = (screen.getByTestId("compare-ranked").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/CompareRankedList.test.tsx --environment jsdom`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/CompareRankedList.tsx`:

```tsx
import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareRelationship, CompareVerdictRow } from "../lib/compareVerdict";

const CHIP: Record<CompareRelationship, { label: string; clear: boolean }> = {
  lowest: { label: "lowest rate", clear: true },
  similar: { label: "similar to lowest", clear: false },
  higher: { label: "clearly higher", clear: false },
  limited: { label: "limited data", clear: false },
};

export function CompareRankedList({ rows, noun }: { rows: CompareVerdictRow[]; noun: IncidentNoun }) {
  return (
    <div className="mc-ranked" data-testid="compare-ranked">
      {rows.map((row) => {
        const chip = CHIP[row.relationship];
        return (
          <div className={`mc-ranked-row${row.relationship === "lowest" ? " is-lowest" : ""}`} key={row.optionId}>
            <span className="mc-rank">{row.rank}</span>
            <div className="mc-ranked-name">
              <strong>{row.label}</strong>
              <small>{row.incidentCount} {noun.plural}</small>
            </div>
            <div className="mc-ranked-bar"><span style={{ width: `${Math.round(row.barFraction * 100)}%` }} /></div>
            <span className="mc-ranked-rate">
              {row.rate.toFixed(1)}{row.multipleOfLowest !== null ? ` · ${row.multipleOfLowest.toFixed(1)}× lowest` : ""}
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
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `frontend/src/styles/mapWorkspace.css`:

```css
.mc-ranked{display:grid;gap:2px;margin:0 0 14px;}
.mc-ranked-row{display:grid;grid-template-columns:22px minmax(0,1.6fr) minmax(0,2fr) auto auto;align-items:center;gap:11px;padding:8px 2px;border-bottom:1px solid var(--line);}
.mc-ranked-row .mc-ranked-detail{grid-column:1 / -1;margin-top:2px;}
.mc-rank{width:22px;height:22px;border-radius:50%;border:1px solid var(--line-2);display:flex;align-items:center;justify-content:center;font-family:var(--f-mono);font-size:11px;color:var(--dim);}
.mc-ranked-row.is-lowest .mc-rank{border-color:var(--clay);color:var(--clay);}
.mc-ranked-name{display:grid;gap:1px;min-width:0;}
.mc-ranked-name strong{font-size:13px;color:var(--text);overflow-wrap:anywhere;}
.mc-ranked-name small{font-size:11px;color:var(--faint);}
.mc-ranked-bar{height:13px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden;}
.mc-ranked-bar>span{display:block;height:100%;border-radius:4px;background:var(--slate);}
.mc-ranked-row.is-lowest .mc-ranked-bar>span{background:var(--clay);}
.mc-ranked-rate{font-family:var(--f-mono);font-size:11px;color:var(--dim);white-space:nowrap;}
.mc-ranked-title{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text);}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/CompareRankedList.test.tsx --environment jsdom`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CompareRankedList.tsx frontend/src/components/CompareRankedList.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(compare): ranked lowest-first list with bars and per-row analytics"
```

---

## Task 4: `CompareVerdict` callout component

**Files:**
- Create: `frontend/src/components/CompareVerdict.tsx`
- Test: `frontend/src/components/CompareVerdict.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/CompareVerdict.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompareVerdict } from "./CompareVerdict";
import { incidentNoun } from "../lib/layerCopy";
import type { CompareCallout } from "../lib/compareVerdict";

const base: CompareCallout = { kind: "clear", lowestLabel: "Pike", loweredCount: 2, otherCount: 2, caveatText: "not enough data here" };

afterEach(cleanup);

describe("CompareVerdict", () => {
  it("clear: names the lowest and says lower than every other", () => {
    render(<CompareVerdict callout={base} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/Pike/)).toBeInTheDocument();
    expect(screen.getByText(/statistically lower than every other/i)).toBeInTheDocument();
  });

  it("partial: says lower than N of the M others", () => {
    render(<CompareVerdict callout={{ ...base, kind: "partial", loweredCount: 1, otherCount: 3 }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/lower than 1 of the 3 other addresses/i)).toBeInTheDocument();
  });

  it("none: no statistically clear difference", () => {
    render(<CompareVerdict callout={{ ...base, kind: "none" }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/no statistically clear difference/i)).toBeInTheDocument();
  });

  it("inconclusive: leads with the caveat text", () => {
    render(<CompareVerdict callout={{ ...base, kind: "inconclusive" }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/not enough data here/i)).toBeInTheDocument();
  });

  it("uses the layer noun (911 calls)", () => {
    render(<CompareVerdict callout={base} noun={incidentNoun("calls")} />);
    expect(screen.getByText(/911 call rate/i)).toBeInTheDocument();
  });

  it("never emits safety-ranking vocabulary", () => {
    for (const kind of ["clear", "partial", "none", "inconclusive"] as const) {
      cleanup();
      render(<CompareVerdict callout={{ ...base, kind }} noun={incidentNoun("reported")} />);
      const text = (screen.getByTestId("compare-callout").textContent ?? "").toLowerCase();
      for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
        expect(text).not.toContain(banned);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/CompareVerdict.test.tsx --environment jsdom`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/CompareVerdict.tsx`:

```tsx
import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareCallout } from "../lib/compareVerdict";

export function CompareVerdict({ callout, noun }: { callout: CompareCallout; noun: IncidentNoun }) {
  const { kind, lowestLabel, loweredCount, otherCount, caveatText } = callout;
  const rate = `${noun.singular} rate`;

  if (kind === "clear") {
    return (
      <div className="mc-verdict tone-ok" data-testid="compare-callout" role="status">
        <p className="mc-verdict-headline">
          <strong>{lowestLabel}</strong> has the lowest {rate} — statistically lower than every other address here.
        </p>
      </div>
    );
  }
  if (kind === "partial") {
    return (
      <div className="mc-verdict tone-ok" data-testid="compare-callout" role="status">
        <p className="mc-verdict-headline">
          <strong>{lowestLabel}</strong> has the lowest {rate} — statistically lower than {loweredCount} of the {otherCount} other addresses. The rest are within normal variation.
        </p>
      </div>
    );
  }
  if (kind === "none") {
    return (
      <div className="mc-verdict tone-muted" data-testid="compare-callout" role="status">
        <p className="mc-verdict-headline">No statistically clear difference in {rate} across these addresses — the gaps fall within normal variation.</p>
      </div>
    );
  }
  return (
    <div className="mc-verdict tone-muted" data-testid="compare-callout" role="status">
      <p className="mc-verdict-headline">Not enough data for a clear comparison across these addresses.</p>
      {caveatText ? <p className="mc-verdict-sub">{caveatText}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/CompareVerdict.test.tsx --environment jsdom`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CompareVerdict.tsx frontend/src/components/CompareVerdict.test.tsx
git commit -m "feat(compare): hybrid verdict callout component"
```

---

## Task 5: Rebuild `CompareTab` + wiring + rewritten tests

**Files:**
- Modify: `frontend/src/components/CompareTab.tsx` (full rebuild)
- Modify: `frontend/src/components/CompareTab.test.tsx` (rewrite)
- Modify: `frontend/src/api/client.ts` (return type)
- Modify: `frontend/src/lib/useCompare.ts` (comparison type)
- Modify: `frontend/src/lib/useCompare.test.ts` (mock return shape — no behavior change)
- Modify: `frontend/src/components/MapWorkspace.tsx` (drop `summary` prop from `<CompareTab>`)
- Modify: `frontend/src/types.ts` (`AssistantToolEffect.comparison` type)
- Modify: `frontend/src/lib/assistantBridge.ts` (cast to `SiteComparison`)

- [ ] **Step 1: Type the client return**

In `frontend/src/api/client.ts`: add `SiteComparison` to the type import from `../types` (the existing `import type { ... } from "../types";` block), and change `comparePlaces`:

```ts
export function comparePlaces(
  payload: ComparePlacesPayload,
): Promise<SiteComparison> {
  return request("/dashboard/compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 2: Type `useCompare`**

In `frontend/src/lib/useCompare.ts`: change the import `import type { AnalysisSettings } from "../types";` to `import type { AnalysisSettings, SiteComparison } from "../types";`, and replace every `Record<string, unknown>` referencing the comparison with `SiteComparison`:
- `CompareController.comparison: SiteComparison | null`
- `CompareController.applyAssistant: (comparison: SiteComparison | null) => void`
- `useState<SiteComparison | null>(null)`
- `applyAssistant(next: SiteComparison | null)`

Leave `versionRef`, `runCompare`, and the points/place_ids logic unchanged.

- [ ] **Step 3: Fix the `useCompare` test mock shape**

`useCompare.test.ts` mocks `comparePlaces` returning `{ ok: true }`, which no longer satisfies `SiteComparison`. The test only asserts the *request* payload, so relax the mock's type with a cast — change the mock line to:

```ts
vi.mock("../api/client", () => ({ comparePlaces: vi.fn().mockResolvedValue({} as unknown) }));
```

(The test body is unchanged; it inspects `comparePlaces.mock.calls`, not the resolved value.)

- [ ] **Step 4: Thread the assistant comparison type**

In `frontend/src/types.ts`, change `AssistantToolEffect.comparison` from `Record<string, unknown> | null` to `SiteComparison | null`.
In `frontend/src/lib/assistantBridge.ts:43`, change the cast `comparison: (result.comparison as Record<string, unknown>) ?? null` to `comparison: (result.comparison as SiteComparison) ?? null`, and add `SiteComparison` to that file's `../types` import (verify with `grep -n "from \"../types\"" frontend/src/lib/assistantBridge.ts`).

- [ ] **Step 5: Rebuild `CompareTab.tsx`**

Replace the entire contents of `frontend/src/components/CompareTab.tsx` with:

```tsx
import { toCompareVerdict } from "../lib/compareVerdict";
import { incidentNoun } from "../lib/layerCopy";
import type { AnalysisSettings, Place, SiteComparison } from "../types";
import { CompareRankedList } from "./CompareRankedList";
import { CompareVerdict } from "./CompareVerdict";
import { MethodsAppendix } from "./MethodsAppendix";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  comparison: SiteComparison | null;
  running: boolean;
  onRun: () => void;
  onCopyLink?: () => string | null;
};

const REVISED_CAVEAT =
  "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ selected, analysis, comparison, running, onRun, onCopyLink }: Props) {
  const noun = incidentNoun(analysis.layer);
  const canRun = selected.length >= 2 && !running;

  if (selected.length < 2) {
    return (
      <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
        <div className="mc-panel-head"><h4>Compare places</h4></div>
        <p className="mc-empty-list">Select at least two places to compare {noun.singular} context.</p>
      </div>
    );
  }

  const verdict = comparison ? toCompareVerdict(comparison) : null;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
      <div className="mc-panel-head"><h4>Comparing {selected.length} places <b>{analysis.radiusM} m</b></h4></div>

      {onCopyLink && comparison && (
        <button
          type="button"
          className="mc-link-copy"
          onClick={async () => {
            const url = onCopyLink();
            if (url) await navigator.clipboard.writeText(url);
          }}
        >
          Copy link to this view
        </button>
      )}

      {verdict ? (
        <>
          <CompareVerdict callout={verdict.callout} noun={noun} />
          <p className="mc-ranked-title">Ranked by {noun.singular} rate — lowest first</p>
          <CompareRankedList rows={verdict.rows} noun={noun} />
        </>
      ) : (
        <p className="mc-empty-list">Compare these {selected.length} places to rank their {noun.plural} rates.</p>
      )}

      <div className="mc-caveat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        {REVISED_CAVEAT}
      </div>

      <MethodsAppendix />

      <div className="mc-compare-actions">
        <span className="note">{selected.length} selected · {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing…" : "Compare places"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Drop the `summary` prop at the mount site**

In `frontend/src/components/MapWorkspace.tsx`, the `<CompareTab>` render (around lines 339-341) passes `summary={data.summary}`. Remove only that prop:

```tsx
{activeTab === "compare" ? (
  <CompareTab selected={selected} analysis={analysis} comparison={compare.comparison} running={compare.running} onRun={compare.runCompare} onCopyLink={() => buildShareUrl("compare")} />
) : null}
```

(Leave every other prop and all other compare wiring — `useCompare` call, `invalidate`, `applyAssistant`, badges — unchanged.)

- [ ] **Step 7: Rewrite `CompareTab.test.tsx`**

Replace the entire contents of `frontend/src/components/CompareTab.test.tsx` with:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { AnalysisSettings, Place, SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";

const home: Place = { id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5, total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal" };
const office: Place = { ...home, id: "p2", display_label: "Office" };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY", layer: "reported" };

function opt(id: string, label: string, count: number, rate: number): SiteComparisonOption {
  return { id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate };
}
function pair(a: string, b: string, decision: SiteDecisionClass, winner: string | null): SitePairwiseResult {
  return { id: `${a}-${b}`, option_a_id: a, option_a_label: a, option_b_id: b, option_b_label: b, winner_option_id: winner, winner_label: winner, decision_class: decision, method: "quasipoisson", incident_count_a: 0, incident_count_b: 0, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days", rate_a: 0, rate_b: 0, rate_ratio: 2.6, ci_lower: 1.4, ci_upper: 4.9, p_value: 0.001, adjusted_p_value: 0.004, overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "" };
}
function comparison(overall: SiteDecisionClass, options: SiteComparisonOption[], pairwise: SitePairwiseResult[]): SiteComparison {
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
    offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: overall, recommendation_option_id: null, recommendation_label: null, summary_text: "", caveat_text: "cav", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options, pairwise_results: pairwise },
  };
}
const clearSweep = comparison("statistically_lower", [opt("p1", "Home", 12, 3.9), opt("p2", "Office", 44, 14.3)], [pair("p1", "p2", "statistically_lower", "p1")]);

afterEach(cleanup);

describe("CompareTab", () => {
  it("prompts to select two places when fewer are chosen", () => {
    render(<CompareTab selected={[home]} analysis={analysis} comparison={null} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/select at least two places/i)).toBeInTheDocument();
  });

  it("before running: invites a compare and fires onRun", () => {
    const onRun = vi.fn();
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={null} running={false} onRun={onRun} />);
    expect(screen.getByText(/rank their reported incidents rates/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("clear sweep: ranks lowest-first with the statistically-lower callout", () => {
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={clearSweep} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower than every other/i)).toBeInTheDocument();
    const ranked = screen.getByTestId("compare-ranked");
    expect(within(ranked).getByText("Home")).toBeInTheDocument();
    expect(within(ranked).getByText("lowest rate")).toBeInTheDocument();
    expect(within(ranked).getByText("clearly higher")).toBeInTheDocument();
    expect(screen.getByText(/reported incident context, not a personal risk prediction/i)).toBeInTheDocument();
  });

  it("no clear difference: muted callout, all similar", () => {
    const none = comparison("not_statistically_clear", [opt("p1", "Home", 18, 5.8), opt("p2", "Office", 22, 7.1)], [pair("p1", "p2", "not_statistically_clear", null)]);
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={none} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/no statistically clear difference/i)).toBeInTheDocument();
  });

  it("the dynamic verdict region never emits safety-ranking vocabulary", () => {
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={clearSweep} running={false} onRun={vi.fn()} />);
    const dynamic = `${screen.getByTestId("compare-callout").textContent ?? ""} ${screen.getByTestId("compare-ranked").textContent ?? ""}`.toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(dynamic).not.toContain(banned);
    }
  });

  it("keeps the compare action in the sticky actions bar", () => {
    const { container } = render(<CompareTab selected={[home, office]} analysis={analysis} comparison={null} running={false} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-compare-actions")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Full verification gate**

Run: `cd .. && make test-all` (from the worktree root)
Expected: pytest green (backend untouched), ruff clean, `npm test` green (all compare tests + the rest), `npm run build` succeeds. Fix any `tsc` fallout (most likely a missed `Record<string, unknown>` reference to `SiteComparison`) until green.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "feat(compare): rebuild Compare tab on the payload-driven ranked verdict"
```

---

## Task 6: ROADMAP tick, gate, PR

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Record the decomposition under Phase 5**

In `docs/ROADMAP.md`, under the "## Phase 5 — Compare-first flagship" section, immediately after the line "Each of these needs its own `docs/superpowers/` brainstorm → spec → plan before implementation.", append:

```markdown

**Decomposition (2026-07-03):** worked as three slices, A→B→C, so the compare experience is
strong before it becomes the front door.
- [ ] **Slice A — richer side-by-side verdicts** — specced & built: rebuild the Compare tab
  on the statistical richness the `/dashboard/compare` payload already returns (hybrid
  callout + ranked lowest-first list + per-pair analytics), frontend-only. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-03-compare-first-flagship*`.
- [ ] **Slice B — multi-address compare UX** — a Compare-owned add/remove-address control
  and N-way selection independent of the Places tab. Not yet specced.
- [ ] **Slice C — comparison-first landing** — lead the app with the compare flow. Not yet
  specced.
```

- [ ] **Step 2: Final gate**

Run: `cd frontend && npm run lint && npm test && cd .. && make test-all`
Expected: all green.

- [ ] **Step 3: Commit, push, open PR**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): record Phase 5 A/B/C decomposition; slice A built"
git push -u origin jcscocca/claude/compare-first-flagship
gh pr create --title "feat(compare): richer side-by-side verdicts (Phase 5 slice A)" --body "$(cat <<'EOF'
Phase 5 slice A of the compare-first flagship (spec: docs/superpowers/specs/2026-07-03-compare-first-flagship-design.md).

Rebuilds the Compare tab to render the statistical richness the /dashboard/compare payload already returns — a hybrid verdict callout (statistically-lower / N-of-M / no-clear-difference / inconclusive), a ranked lowest-first list with bars and per-pair rate-ratio/CI/adjusted-p behind "How we know" — all driven by the payload (no more counts faked from the Analyze summary), with a SiteComparison type replacing Record<string, unknown>. Frontend only, no backend change.

Invariant: the dynamic verdict region is guarded against safety-ranking vocabulary; copy is bounded to reported-incident rate.

make test-all green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (do not do here)

- Any backend/`app/` change, new endpoint, schema, or migration.
- Cross-address category breakdown, per-card sparkline, nearest-incident distance (all need a payload extension — deferred fast-follow).
- Slice B (compare-owned add/remove-address UX) and slice C (comparison-first landing).
- Extracting a shared verdict kit across Analyze + Compare (revisit once this is the second consumer).
- Changing the default landing tab.
