# Analyze Tab Clarity Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Analyze tab lead with a plain-language verdict per place (headline + significance chip + beat-vs-place comparison bars), push the statistics into a "How we know" reveal, and collapse the raw incident table behind a "See the N incidents" reveal.

**Architecture:** Frontend-only. A new pure `decisionHeadline()` maps the existing `decision` field to copy; a rewritten verdict card (still `.mc-verdict`) renders it with neutral-palette comparison bars; `AnalyzeTab` wraps the populated incident table in a `<details>`. No backend/agent/data change — every field is already on the neighborhood result. Existing tests that assert the old copy/layout are updated.

**Tech Stack:** React + TypeScript + Vite; Vitest + @testing-library/react (jsdom). All commands run from `frontend/` in the worktree `/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/analyze-tab-redesign`.

---

## File Structure

- **Create** `frontend/src/lib/verdictCopy.ts` — `decisionHeadline(place)` pure mapping (decision → headline + chip).
- **Create** `frontend/src/lib/verdictCopy.test.ts` — its unit tests.
- **Modify** `frontend/src/components/AnalyzeTab.tsx` — replace the `VerdictBlock` component with `VerdictCard` (uses `decisionHeadline` + new `ComparisonBars`, neutral palette); wrap the populated incident table/cards in a `<details>`; remove the now-dead `DECISION_COPY`.
- **Modify** `frontend/src/components/AnalyzeTab.test.tsx` — update the tests that assert the old verdict copy and the always-visible incident table.
- **Modify** `frontend/src/styles/mapWorkspace.css` — add `.mc-vchip`, `.mc-verdict-headline`, `.mc-cmpbar(s)`, `.mc-incident-reveal` classes (neutral palette).

---

## Task 1: `decisionHeadline` mapping

**Files:**
- Create: `frontend/src/lib/verdictCopy.ts`
- Test: `frontend/src/lib/verdictCopy.test.ts`

- [ ] **Step 1: Write the failing test** — create `frontend/src/lib/verdictCopy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { decisionHeadline } from "./verdictCopy";

const at = (decision: string) =>
  decisionHeadline({ decision, place_label: "Home" } as never);

describe("decisionHeadline", () => {
  it("maps above_clear to a 'more' headline with a clear chip", () => {
    const v = at("above_clear");
    expect(v.headline).toBe("Home has more reported incidents than its surrounding beat.");
    expect(v.chip).toEqual({ label: "✓ statistically clear", tone: "clear" });
  });

  it("maps below_clear to a 'fewer' headline with a clear chip", () => {
    const v = at("below_clear");
    expect(v.headline).toBe("Home has fewer reported incidents than its surrounding beat.");
    expect(v.chip.tone).toBe("clear");
  });

  it("maps not_clear to an 'about the same' headline with a muted chip", () => {
    const v = at("not_clear");
    expect(v.headline).toBe("Home is about the same as its surrounding beat.");
    expect(v.chip).toEqual({ label: "~ not statistically clear", tone: "muted" });
  });

  it("maps insufficient_data and model_warning to a 'not enough data' headline", () => {
    expect(at("insufficient_data").headline).toBe("Not enough data to compare Home to its beat.");
    expect(at("model_warning").headline).toBe("Not enough data to compare Home to its beat.");
    expect(at("insufficient_data").chip).toEqual({ label: "too little data", tone: "muted" });
  });

  it("maps baseline_unavailable to a 'no baseline' headline", () => {
    const v = at("baseline_unavailable");
    expect(v.headline).toBe("No neighborhood baseline available for Home.");
    expect(v.chip).toEqual({ label: "no baseline", tone: "muted" });
  });

  it("falls back safely for an unknown decision", () => {
    const v = at("something_new");
    expect(v.headline).toBe("Home compared to its surrounding beat.");
    expect(v.chip.tone).toBe("muted");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/analyze-tab-redesign/frontend" && npm test -- verdictCopy`
Expected: FAIL — `./verdictCopy` does not exist.

- [ ] **Step 3: Implement** — create `frontend/src/lib/verdictCopy.ts`:

```ts
import type { NeighborhoodPlace } from "../types";

export type VerdictChip = { label: string; tone: "clear" | "muted" };
export type VerdictCopy = { headline: string; chip: VerdictChip };

const CLEAR: VerdictChip = { label: "✓ statistically clear", tone: "clear" };
const MUTED = (label: string): VerdictChip => ({ label, tone: "muted" });

// Plain-language verdict for one neighborhood place. The chip encodes statistical CLARITY
// (clear vs not), never a safety judgement — the product reports reported-incident context.
export function decisionHeadline(
  place: Pick<NeighborhoodPlace, "decision" | "place_label">,
): VerdictCopy {
  const label = place.place_label || "This place";
  switch (place.decision) {
    case "above_clear":
      return { headline: `${label} has more reported incidents than its surrounding beat.`, chip: CLEAR };
    case "below_clear":
      return { headline: `${label} has fewer reported incidents than its surrounding beat.`, chip: CLEAR };
    case "not_clear":
      return {
        headline: `${label} is about the same as its surrounding beat.`,
        chip: MUTED("~ not statistically clear"),
      };
    case "insufficient_data":
    case "model_warning":
      return {
        headline: `Not enough data to compare ${label} to its beat.`,
        chip: MUTED("too little data"),
      };
    case "baseline_unavailable":
      return {
        headline: `No neighborhood baseline available for ${label}.`,
        chip: MUTED("no baseline"),
      };
    default:
      return { headline: `${label} compared to its surrounding beat.`, chip: MUTED("—") };
  }
}
```

- [ ] **Step 4: Run it — expect PASS** (6 tests). Then `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/verdictCopy.ts frontend/src/lib/verdictCopy.test.ts
git commit -m "feat(frontend): decisionHeadline plain-language verdict mapping"
```

---

## Task 2: `VerdictCard` (rewrite the verdict card) + CSS

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx` (replace `VerdictBlock`; add `ComparisonBars`; render `VerdictCard`)
- Modify: `frontend/src/components/AnalyzeTab.test.tsx` (update the verdict + no-baseline tests)
- Modify: `frontend/src/styles/mapWorkspace.css` (add chip/headline/bar classes)

- [ ] **Step 1: Update the failing tests first** — in `frontend/src/components/AnalyzeTab.test.tsx`:

Replace the body of the test `"renders a verdict block and exposes every measure’s definition"` so the first two assertions read:

```ts
    expect(
      screen.getByText("Home has more reported incidents than its surrounding beat."),
    ).toBeInTheDocument();
    expect(screen.getByText("✓ statistically clear")).toBeInTheDocument();
    expect(screen.getByText("4.0×")).toBeInTheDocument();
```

Replace the `"shows a fallback line when a place has no beat baseline"` assertions with:

```ts
    expect(screen.getByText("No neighborhood baseline available for Cabin.")).toBeInTheDocument();
    expect(
      screen.getByText(/3 reported incidents in range; no beat baseline\./i),
    ).toBeInTheDocument();
```

(The `"shows the confidence interval in analytical detail…"` test, the `"renders a sparkline bar…"` test, and the loading-skeleton test stay unchanged — the rewrite keeps `.mc-verdict-sub` for the context line, `.mc-analytical` for the reveal, `.mc-spark` for the sparkline, and `aria-label="Verdict for …"`.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- AnalyzeTab`
Expected: the two updated tests FAIL (old copy "above its beat" / "neighborhood baseline unavailable" still rendered).

- [ ] **Step 3: Implement the rewrite** in `frontend/src/components/AnalyzeTab.tsx`.

Add the import near the top (with the other imports):

```tsx
import { decisionHeadline } from "../lib/verdictCopy";
```

Add a `ComparisonBars` helper and replace the entire `VerdictBlock` function with `VerdictCard` (delete `VerdictBlock` and the `DECISION_COPY` constant it used):

```tsx
function ComparisonBars({ rateRatio }: { rateRatio: number }) {
  const CAP = 3;
  const width = (value: number) => `${(Math.min(value, CAP) / CAP) * 100}%`;
  return (
    <div className="mc-cmpbars" aria-hidden="true">
      <div className="mc-cmpbar">
        <span className="name">surrounding beat</span>
        <span className="track"><span className="fill beat" style={{ width: width(1) }} /></span>
        <span className="val">1.0×</span>
      </div>
      <div className="mc-cmpbar">
        <span className="name">this place</span>
        <span className="track"><span className="fill place" style={{ width: width(rateRatio) }} /></span>
        <span className="val">{rateRatio.toFixed(1)}×</span>
      </div>
    </div>
  );
}

function VerdictCard({ place, windowLabel }: { place: NeighborhoodPlace; windowLabel: string }) {
  const { headline, chip } = decisionHeadline(place);
  return (
    <section className="mc-verdict" aria-label={`Verdict for ${place.place_label}`}>
      <div className="mc-verdict-head">
        <span className={`mc-vchip ${chip.tone}`}>{chip.label}</span>
      </div>
      <p className="mc-verdict-headline">{headline}</p>
      {place.baseline_available ? (
        <>
          <p className="mc-verdict-sub">
            {place.place_incident_count} reported incidents within {place.radius_m} m · {windowLabel}
          </p>
          {place.rate_ratio != null ? <ComparisonBars rateRatio={place.rate_ratio} /> : null}
          {place.monthly_counts?.length ? (
            <div className="mc-spark" aria-hidden="true">
              {place.monthly_counts.map((n, i) => (
                <span key={i} style={{ height: `${barHeight(n, place.monthly_counts!)}%` }} />
              ))}
            </div>
          ) : null}
          <details className="mc-analytical">
            <summary>How we know</summary>
            <dl>
              <div><dt>Place vs beat rate</dt><dd>{place.place_rate?.toFixed(2)} vs {place.beat_rate?.toFixed(2)} /km²·day</dd></div>
              <div><dt>95% CI (this comparison)</dt><dd>{place.ci_lower != null ? `${place.ci_lower.toFixed(1)}–${place.ci_upper?.toFixed(1)}×` : "—"}</dd></div>
              <div><dt>Adjusted p-value</dt><dd>{place.adjusted_p_value != null ? place.adjusted_p_value.toFixed(3) : "—"}</dd></div>
              <div><dt>Exact p-value</dt><dd>{place.exact_p_value != null ? place.exact_p_value.toFixed(3) : "—"}</dd></div>
              <div><dt>Dispersion</dt><dd>{place.overdispersion_status}</dd></div>
              <div><dt>Method</dt><dd>{place.method}</dd></div>
              <div><dt>Adequacy</dt><dd>{place.minimum_data_status}</dd></div>
              <div><dt>Nearest</dt><dd>{place.nearest_incident_m != null ? `${Math.round(place.nearest_incident_m)} m` : "—"}</dd></div>
            </dl>
            {place.type_mix?.length ? (
              <ul className="mc-typemix">
                {place.type_mix.map((t) => <li key={t.label}>{t.label} · {t.count}</li>)}
              </ul>
            ) : null}
          </details>
        </>
      ) : (
        <p className="mc-verdict-sub">{place.place_incident_count} reported incidents in range; no beat baseline.</p>
      )}
    </section>
  );
}
```

In `AnalyzeTab`'s render, where it currently maps `neighborhood?.places?.map((place) => <VerdictBlock key={place.place_id} place={place} />)`, replace with (compute the window label once, just above the `return` of `AnalyzeTab`):

```tsx
  const windowLabel = `${analysis.startDate} – ${analysis.endDate}`;
```

and the map becomes:

```tsx
          {neighborhood?.places?.map((place) => (
            <VerdictCard key={place.place_id} place={place} windowLabel={windowLabel} />
          ))}
```

- [ ] **Step 4: Add the CSS** — append to `frontend/src/styles/mapWorkspace.css` (neutral palette; no red/green):

```css
.mc-vchip{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.02em;padding:2px 9px;border-radius:20px;border:1px solid var(--line);color:var(--dim);background:rgba(255,255,255,.05);}
.mc-vchip.clear{color:var(--text);border-color:var(--line-2);background:rgba(255,255,255,.08);}
.mc-verdict-headline{margin:7px 0 2px;font-size:14px;font-weight:600;line-height:1.35;color:var(--text);overflow-wrap:anywhere;}
.mc-cmpbars{display:grid;gap:6px;margin-top:2px;}
.mc-cmpbar{display:flex;align-items:center;gap:9px;font-size:11px;}
.mc-cmpbar .name{width:104px;flex:none;text-align:right;color:var(--dim);}
.mc-cmpbar .track{flex:1;height:13px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden;}
.mc-cmpbar .fill{display:block;height:100%;border-radius:4px;}
.mc-cmpbar .fill.beat{background:rgba(255,255,255,.22);}
.mc-cmpbar .fill.place{background:var(--slate);}
.mc-cmpbar .val{width:40px;flex:none;font-family:var(--f-mono);color:var(--text);}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- AnalyzeTab`
Expected: all AnalyzeTab tests pass (the two updated, plus the unchanged CI/sparkline/loading tests). Then `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): verdict card leads with plain headline + comparison bars"
```

---

## Task 3: Collapse the incident table behind a reveal

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx` (wrap the populated incident table/cards in a `<details>`)
- Modify: `frontend/src/components/AnalyzeTab.test.tsx` (open the reveal before asserting the table/cards)
- Modify: `frontend/src/styles/mapWorkspace.css` (`.mc-incident-reveal`)

- [ ] **Step 1: Update the failing tests** — in `frontend/src/components/AnalyzeTab.test.tsx`:

In `"renders reported incident details in a table"`, before `const table = screen.getByRole("table");`, add:

```ts
    fireEvent.click(screen.getByText(/See the 1 reported incidents/i));
```

In `"renders incidents as cards (no table) when the panel is narrow"`, before the `expect(screen.getByText("100 BLOCK MAIN ST"…))`, add:

```ts
    fireEvent.click(screen.getByText(/See the 1 reported incidents/i));
```

In `"renders incidents as a full table when the panel is wide"`, before `expect(screen.getByRole("table"))`, add:

```ts
    fireEvent.click(screen.getByText(/See the 1 reported incidents/i));
```

(The `"shows an empty incident-detail message…"` test stays unchanged — an empty result is rendered directly, not behind the reveal.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- AnalyzeTab`
Expected: the three table/card tests FAIL — `getByText(/See the 1 reported incidents/i)` is not found yet (and the table is still rendered un-wrapped).

- [ ] **Step 3: Implement** in `frontend/src/components/AnalyzeTab.tsx`. Replace the current incident-details render (the `incidentLayout === "table" ? <IncidentDetailsTable … /> : <IncidentDetailsCards … />` block) with:

```tsx
          {incidentDetails && incidentDetails.incidents.length > 0 ? (
            <details className="mc-incident-reveal">
              <summary>See the {incidentDetails.total_count} reported incidents</summary>
              {incidentLayout === "table" ? (
                <IncidentDetailsTable details={incidentDetails} />
              ) : (
                <IncidentDetailsCards details={incidentDetails} />
              )}
            </details>
          ) : incidentLayout === "table" ? (
            <IncidentDetailsTable details={incidentDetails} />
          ) : (
            <IncidentDetailsCards details={incidentDetails} />
          )}
```

- [ ] **Step 4: Add the CSS** — append to `frontend/src/styles/mapWorkspace.css`:

```css
.mc-incident-reveal{margin-top:4px;}
.mc-incident-reveal>summary{cursor:pointer;font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);list-style:none;display:inline-flex;align-items:center;gap:6px;}
.mc-incident-reveal>summary::before{content:"▸";font-size:10px;transition:transform .15s ease;}
.mc-incident-reveal[open]>summary::before{transform:rotate(90deg);}
.mc-incident-reveal>summary:hover{color:var(--text);}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- AnalyzeTab`
Expected: all AnalyzeTab tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): collapse the Analyze incident table behind a reveal"
```

---

## Task 4: Clean up + full gate

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx` (remove any now-dead code)

- [ ] **Step 1: Remove dead code.** Confirm `DECISION_COPY` and the old `VerdictBlock` are gone (replaced in Task 2). Run a check:

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/analyze-tab-redesign/frontend"
grep -n "DECISION_COPY\|VerdictBlock" src/components/AnalyzeTab.tsx || echo "clean"
```
Expected: `clean`. (If anything remains, delete it.) If the `NeighborhoodPlace["decision"]` type import or any helper became unused, remove it so lint stays clean.

- [ ] **Step 2: Full frontend gate**

```bash
npm test
npm run lint
npm run build
```
Expected: all tests pass, lint clean, build succeeds.

- [ ] **Step 3: Commit (if Step 1 changed anything)**

```bash
git add frontend/src/components/AnalyzeTab.tsx
git commit -m "chore(frontend): drop dead DECISION_COPY/VerdictBlock after verdict redesign"
```

---

## Self-Review

- **Spec coverage:** `decisionHeadline` (Task 1) ✓; `VerdictCard` headline+chip+bars+sparkline+"How we know" reveal, neutral palette, baseline-unavailable path (Task 2) ✓; incident table collapsed + pairwise stays secondary-below (Task 3 — pairwise position is already below the verdict map in `AnalyzeTab`, unchanged) ✓; settings querybar unchanged ✓; frontend-only ✓; tests per the spec ✓.
- **Placeholders:** none — every step has complete code or an exact command.
- **Type consistency:** `decisionHeadline` returns `{ headline, chip: { label, tone } }` and `VerdictCard` consumes `chip.tone`/`chip.label`; `ComparisonBars` takes `rateRatio: number`; all `NeighborhoodPlace` fields used (`decision`, `place_label`, `baseline_available`, `rate_ratio`, `radius_m`, `place_incident_count`, `place_rate`, `beat_rate`, `ci_lower/upper`, `adjusted_p_value`, `exact_p_value`, `overdispersion_status`, `method`, `minimum_data_status`, `nearest_incident_m`, `monthly_counts`, `type_mix`) exist on the type.
- **Invariant:** the chip encodes statistical clarity; the palette is neutral (no red-for-above / green-for-below). No safety language.
