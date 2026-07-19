# Tabby-Central Slice 1: Rail as Primary Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tabby conversation the drawer's primary, full-height surface with typed thread items and an always-visible context strip, while Compare/Export stay reachable behind an overflow menu.

**Architecture:** Thread state (typed items) lifts out of `AssistantPanel` into `MapWorkspace` via a small `useThread` hook, so filter receipts (and, in later slices, analysis cards) can be appended from outside the panel. `BottomSheet` sheds its tab nav and dock slot; `MapWorkspace` composes a `RailNav` (back button + overflow menu) and switches the drawer body between the Tabby rail and the legacy Compare/Export panels. Filter edits flow through `describeAnalysisPatch`, which produces human-readable receipt lines appended to the thread. Analysis-producing actions still open the legacy Compare view (inline result cards arrive in Slice 3).

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library (jsdom), plain CSS in `frontend/src/styles/mapWorkspace.css`. No backend changes in this slice.

**Spec:** `docs/superpowers/specs/2026-07-19-tabby-central-redesign-design.md` (Slice 1 of the slicing sketch).

**Worktree:** Per repo convention, execute in a dedicated git worktree cut from `origin/main`, not the main checkout. Frontend commands run from `frontend/` (`npm test -- <file>` for a single vitest file). Full gate: `make test-all` at repo root.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/src/lib/threadItems.ts` | create | `ThreadItem` discriminated union + `toApiMessages()` |
| `frontend/src/lib/threadItems.test.ts` | create | unit tests for the above |
| `frontend/src/lib/offenseCategories.ts` | create | shared `CATEGORIES` list (moved out of CompareTab) |
| `frontend/src/lib/analysisReceipt.ts` | create | `describeAnalysisPatch()` — settings patch → receipt line |
| `frontend/src/lib/analysisReceipt.test.ts` | create | unit tests |
| `frontend/src/lib/useThread.ts` | create | thread state hook (`items`, `append`, capped) |
| `frontend/src/lib/useThread.test.ts` | create | unit tests |
| `frontend/src/components/ContextStrip.tsx` | create | active-settings summary line + edit popover |
| `frontend/src/components/ContextStrip.test.tsx` | create | component tests |
| `frontend/src/components/RailNav.tsx` | create | back-to-Tabby button + ⋯ overflow menu |
| `frontend/src/components/RailNav.test.tsx` | create | component tests |
| `frontend/src/components/AssistantPanel.tsx` | modify | lifted typed items, no collapse, rail markup, notice/receipt rendering |
| `frontend/src/components/AssistantPanel.test.tsx` | create | component tests (none exist today) |
| `frontend/src/components/BottomSheet.tsx` | modify | drop tab nav + dock slot; add `nav` prop |
| `frontend/src/components/CompareTab.tsx` | modify | import `CATEGORIES` from the new lib (delete local copy) |
| `frontend/src/components/MapWorkspace.tsx` | modify | `railView` state, thread wiring, receipts, composition |
| `frontend/src/components/MapWorkspace.test.tsx` | modify | update nav-related expectations |
| `frontend/src/styles/mapWorkspace.css` | modify | rail, railnav, context-strip styles |

`TabKey` (`"compare" | "export"`) stays as-is in `frontend/src/types.ts:143` — the bridge and legacy views still use it. The rail view union is `type RailView = "tabby" | TabKey`, exported from `RailNav.tsx`.

---

### Task 1: `threadItems` — typed thread items + API mapping

**Files:**
- Create: `frontend/src/lib/threadItems.ts`
- Test: `frontend/src/lib/threadItems.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/threadItems.test.ts
import { describe, expect, it } from "vitest";

import { toApiMessages, type ThreadItem } from "./threadItems";

describe("toApiMessages", () => {
  it("maps user_text and tabby_text to chat roles in order", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "compare my places" },
      { kind: "tabby_text", text: "Here's the side-by-side." },
      { kind: "user_text", text: "evenings only" },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "compare my places" },
      { role: "assistant", content: "Here's the side-by-side." },
      { role: "user", content: "evenings only" },
    ]);
  });

  it("skips receipts and notices", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "hi" },
      { kind: "receipt", text: "Search radius → 500 m" },
      { kind: "notice", text: "Tabby can't reach the case files right now." },
      { kind: "tabby_text", text: "Hello." },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello." },
    ]);
  });

  it("returns an empty array for an empty thread", () => {
    expect(toApiMessages([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/threadItems.test.ts`
Expected: FAIL — cannot resolve `./threadItems`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/threadItems.ts
import type { AssistantMessage } from "../types";

/** One entry in the Tabby rail. Only user/tabby text round-trips to the LLM;
 * receipts and notices are local-only records (deterministic confirmations,
 * errors) per the Tabby-central spec. */
export type ThreadItem =
  | { kind: "user_text"; text: string }
  | { kind: "tabby_text"; text: string }
  | { kind: "receipt"; text: string }
  | { kind: "notice"; text: string };

export function toApiMessages(items: ThreadItem[]): AssistantMessage[] {
  const messages: AssistantMessage[] = [];
  for (const item of items) {
    if (item.kind === "user_text") messages.push({ role: "user", content: item.text });
    else if (item.kind === "tabby_text") messages.push({ role: "assistant", content: item.text });
  }
  return messages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/threadItems.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/threadItems.ts frontend/src/lib/threadItems.test.ts
git commit -m "feat(rail): typed thread items with API message mapping"
```

---

### Task 2: Shared offense categories + `describeAnalysisPatch`

**Files:**
- Create: `frontend/src/lib/offenseCategories.ts`
- Create: `frontend/src/lib/analysisReceipt.ts`
- Modify: `frontend/src/components/CompareTab.tsx:55-60` (delete local `CATEGORIES`, import instead)
- Test: `frontend/src/lib/analysisReceipt.test.ts`

- [ ] **Step 1: Move `CATEGORIES` to a shared lib**

Create:

```ts
// frontend/src/lib/offenseCategories.ts
export const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? "All reported";
}
```

In `frontend/src/components/CompareTab.tsx`, delete the local `const CATEGORIES: { value: string; label: string }[] = [ ... ];` block (lines 55–60) and add to the imports:

```ts
import { CATEGORIES } from "../lib/offenseCategories";
```

- [ ] **Step 2: Verify CompareTab still passes**

Run: `cd frontend && npm test -- src/components/CompareTab.test.tsx`
Expected: PASS (unchanged behavior).

- [ ] **Step 3: Write the failing receipt test**

```ts
// frontend/src/lib/analysisReceipt.test.ts
import { describe, expect, it } from "vitest";

import { describeAnalysisPatch } from "./analysisReceipt";
import type { AnalysisSettings } from "../types";

const base: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-07-19",
  radiusM: 250,
  offenseCategory: "",
  layer: "reported",
};

describe("describeAnalysisPatch", () => {
  it("describes a radius change", () => {
    expect(describeAnalysisPatch(base, { radiusM: 500 })).toBe("Search radius → 500 m");
  });

  it("describes a date-range change with the resulting range", () => {
    expect(describeAnalysisPatch(base, { startDate: "2026-03-01" })).toBe(
      "Date range → 2026-03-01 – 2026-07-19",
    );
  });

  it("describes a category change by label", () => {
    expect(describeAnalysisPatch(base, { offenseCategory: "PROPERTY" })).toBe(
      "Categories → Property",
    );
    expect(
      describeAnalysisPatch({ ...base, offenseCategory: "PROPERTY" }, { offenseCategory: "" }),
    ).toBe("Categories → All reported");
  });

  it("describes a layer change with the layer noun", () => {
    expect(describeAnalysisPatch(base, { layer: "arrests" })).toBe("Layer → Arrests");
  });

  it("joins multiple changes", () => {
    expect(describeAnalysisPatch(base, { radiusM: 1000, offenseCategory: "PERSON" })).toBe(
      "Search radius → 1000 m · Categories → Person",
    );
  });

  it("returns null when nothing effectively changes", () => {
    expect(describeAnalysisPatch(base, { radiusM: 250 })).toBeNull();
    expect(describeAnalysisPatch(base, {})).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/analysisReceipt.test.ts`
Expected: FAIL — cannot resolve `./analysisReceipt`.

- [ ] **Step 5: Write the implementation**

```ts
// frontend/src/lib/analysisReceipt.ts
import { categoryLabel } from "./offenseCategories";
import { incidentNoun } from "./layerCopy";
import type { AnalysisSettings } from "../types";

/** Human-readable receipt for a settings patch, or null if it's a no-op.
 * Receipts land in the Tabby thread so filter changes leave a visible trail. */
export function describeAnalysisPatch(
  current: AnalysisSettings,
  patch: Partial<AnalysisSettings>,
): string | null {
  const next = { ...current, ...patch };
  const parts: string[] = [];
  if (next.startDate !== current.startDate || next.endDate !== current.endDate) {
    parts.push(`Date range → ${next.startDate} – ${next.endDate}`);
  }
  if (next.radiusM !== current.radiusM) {
    parts.push(`Search radius → ${next.radiusM} m`);
  }
  if (next.offenseCategory !== current.offenseCategory) {
    parts.push(`Categories → ${categoryLabel(next.offenseCategory)}`);
  }
  if (next.layer !== current.layer) {
    parts.push(`Layer → ${incidentNoun(next.layer).pluralCap}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/analysisReceipt.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/offenseCategories.ts frontend/src/lib/analysisReceipt.ts frontend/src/lib/analysisReceipt.test.ts frontend/src/components/CompareTab.tsx
git commit -m "feat(rail): analysis-change receipts + shared offense categories"
```

---

### Task 3: `useThread` hook

**Files:**
- Create: `frontend/src/lib/useThread.ts`
- Test: `frontend/src/lib/useThread.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/useThread.test.ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { THREAD_CAP, useThread } from "./useThread";

describe("useThread", () => {
  it("appends items in order", () => {
    const { result } = renderHook(() => useThread());
    act(() => result.current.append({ kind: "user_text", text: "hi" }));
    act(() => result.current.append({ kind: "receipt", text: "Search radius → 500 m" }));
    expect(result.current.items).toEqual([
      { kind: "user_text", text: "hi" },
      { kind: "receipt", text: "Search radius → 500 m" },
    ]);
  });

  it("keeps append identity stable across renders", () => {
    const { result, rerender } = renderHook(() => useThread());
    const first = result.current.append;
    rerender();
    expect(result.current.append).toBe(first);
  });

  it("caps the thread at THREAD_CAP items, dropping the oldest", () => {
    const { result } = renderHook(() => useThread());
    act(() => {
      for (let i = 0; i < THREAD_CAP + 5; i += 1) {
        result.current.append({ kind: "receipt", text: `r${i}` });
      }
    });
    expect(result.current.items).toHaveLength(THREAD_CAP);
    expect(result.current.items[0]).toEqual({ kind: "receipt", text: "r5" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/useThread.test.ts`
Expected: FAIL — cannot resolve `./useThread`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/useThread.ts
import { useCallback, useState } from "react";

import type { ThreadItem } from "./threadItems";

/** Session-scoped cap — the thread is not persisted, this just bounds memory/DOM. */
export const THREAD_CAP = 200;

export function useThread() {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const append = useCallback((item: ThreadItem) => {
    setItems((current) => {
      const next = [...current, item];
      return next.length > THREAD_CAP ? next.slice(next.length - THREAD_CAP) : next;
    });
  }, []);
  return { items, append };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/useThread.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useThread.ts frontend/src/lib/useThread.test.ts
git commit -m "feat(rail): useThread hook for session-scoped thread state"
```

---

### Task 4: `ContextStrip` component

Always-visible one-line summary of the active `AnalysisSettings`; tapping it opens an inline editor (date inputs, radius chips, category chips — same controls and CSS classes as CompareTab's query bar). Layer is displayed but edited via the existing topbar `LayerToggle`, not here.

**Files:**
- Create: `frontend/src/components/ContextStrip.tsx`
- Test: `frontend/src/components/ContextStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ContextStrip.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextStrip } from "./ContextStrip";
import type { AnalysisSettings } from "../types";

const analysis: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-07-19",
  radiusM: 250,
  offenseCategory: "",
  layer: "reported",
};

afterEach(cleanup);

function setup(overrides: Partial<AnalysisSettings> = {}) {
  const onChange = vi.fn();
  render(
    <ContextStrip
      analysis={{ ...analysis, ...overrides }}
      availableRadii={[250, 500, 1000]}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe("ContextStrip", () => {
  it("summarizes the active context", () => {
    setup({ offenseCategory: "PROPERTY", layer: "arrests" });
    const toggle = screen.getByRole("button", { name: /analysis context/i });
    expect(toggle).toHaveTextContent("2026-01-01 – 2026-07-19");
    expect(toggle).toHaveTextContent("250 m");
    expect(toggle).toHaveTextContent("Property");
    expect(toggle).toHaveTextContent("Arrests");
  });

  it("opens the editor on click and patches the radius", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });
  });

  it("patches dates through the date inputs", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-03-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-03-01" });
  });

  it("patches the offense category", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });
  });

  it("closes the editor with the Done button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/ContextStrip.test.tsx`
Expected: FAIL — cannot resolve `./ContextStrip`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/components/ContextStrip.tsx
import { useState } from "react";

import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { incidentNoun } from "../lib/layerCopy";
import { CATEGORIES, categoryLabel } from "../lib/offenseCategories";
import type { AnalysisSettings } from "../types";

type Props = {
  analysis: AnalysisSettings;
  availableRadii: number[];
  onChange: (patch: Partial<AnalysisSettings>) => void;
};

/** One-line active-context summary above Tabby's input. This is literally the
 * dashboard_state Tabby sees each turn — tapping it opens inline editors. */
export function ContextStrip({ analysis, availableRadii, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];

  return (
    <div className="mc-ctx">
      <button
        type="button"
        className="mc-ctx-summary"
        aria-expanded={open}
        aria-label={`Analysis context: ${analysis.startDate} – ${analysis.endDate}, ${analysis.radiusM} m, ${categoryLabel(analysis.offenseCategory)}, ${incidentNoun(analysis.layer).pluralCap}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{analysis.startDate} – {analysis.endDate}</span>
        <span>· {analysis.radiusM} m</span>
        <span>· {categoryLabel(analysis.offenseCategory)}</span>
        <span>· {incidentNoun(analysis.layer).pluralCap}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>

      {open ? (
        <div className="mc-ctx-editor">
          <div className="mc-field">
            <label htmlFor="ctx-start-date">Date range</label>
            <div className="mc-inputs">
              <input id="ctx-start-date" type="date" className="mc-inp" value={analysis.startDate} min={ANALYSIS_MIN_DATE} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
              <input id="ctx-end-date" type="date" className="mc-inp" value={analysis.endDate} min={ANALYSIS_MIN_DATE} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
            </div>
          </div>
          <div className="mc-field">
            <label id="ctx-radius-label">Search radius</label>
            <div className="mc-chips" role="group" aria-labelledby="ctx-radius-label">
              {radii.map((value) => (
                <button key={value} type="button" className={`mc-chip${analysis.radiusM === value ? " on" : ""}`} aria-pressed={analysis.radiusM === value} onClick={() => onChange({ radiusM: value })}>
                  {value} m
                </button>
              ))}
            </div>
          </div>
          <div className="mc-field">
            <label id="ctx-category-label">Incident categories</label>
            <div className="mc-chips" role="group" aria-labelledby="ctx-category-label">
              {CATEGORIES.map((category) => (
                <button key={category.value || "all"} type="button" className={`mc-chip${analysis.offenseCategory === category.value ? " on" : ""}`} aria-pressed={analysis.offenseCategory === category.value} onClick={() => onChange({ offenseCategory: category.value })}>
                  {category.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="mc-chip" onClick={() => setOpen(false)}>Done</button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/components/ContextStrip.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ContextStrip.tsx frontend/src/components/ContextStrip.test.tsx
git commit -m "feat(rail): ContextStrip active-settings summary + inline editor"
```

---

### Task 5: `RailNav` component

Slim strip where the tab nav used to be: a "← Tabby" back button when a legacy view is open, and a "More panels" (⋯) overflow menu listing Compare (with count) and Export.

**Files:**
- Create: `frontend/src/components/RailNav.tsx`
- Test: `frontend/src/components/RailNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/RailNav.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailNav } from "./RailNav";

afterEach(cleanup);

describe("RailNav", () => {
  it("shows no back button on the Tabby view", () => {
    render(<RailNav view="tabby" compareCount={0} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /back to tabby/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More panels" })).toBeInTheDocument();
  });

  it("opens the menu and selects Compare with its count", () => {
    const onSelect = vi.fn();
    render(<RailNav view="tabby" compareCount={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "More panels" }));
    const compare = screen.getByRole("menuitem", { name: /compare/i });
    expect(compare).toHaveTextContent("2");
    fireEvent.click(compare);
    expect(onSelect).toHaveBeenCalledWith("compare");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selects Export from the menu", () => {
    const onSelect = vi.fn();
    render(<RailNav view="tabby" compareCount={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "More panels" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    expect(onSelect).toHaveBeenCalledWith("export");
  });

  it("returns to Tabby from a legacy view", () => {
    const onSelect = vi.fn();
    render(<RailNav view="compare" compareCount={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Tabby" }));
    expect(onSelect).toHaveBeenCalledWith("tabby");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/RailNav.test.tsx`
Expected: FAIL — cannot resolve `./RailNav`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/components/RailNav.tsx
import { useState } from "react";

import type { TabKey } from "../types";

export type RailView = "tabby" | TabKey;

type Props = {
  view: RailView;
  compareCount: number;
  onSelect: (view: RailView) => void;
};

/** Drawer nav in rail mode: Tabby is home; legacy panels live behind the
 * overflow menu until the parity checklist retires them (spec §Migration). */
export function RailNav({ view, compareCount, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  function select(next: RailView) {
    setOpen(false);
    onSelect(next);
  }

  return (
    <nav className="mc-railnav" aria-label="Workspace sections">
      {view !== "tabby" ? (
        <button type="button" className="mc-railnav-back" aria-label="Back to Tabby" onClick={() => select("tabby")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
          Tabby
        </button>
      ) : null}
      <div className="mc-railnav-spacer" />
      <div className="mc-railnav-more">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More panels"
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        {open ? (
          <div role="menu" className="mc-railnav-menu" aria-label="Panels">
            <button type="button" role="menuitem" onClick={() => select("compare")}>
              Compare{compareCount ? <span className="pill">{compareCount}</span> : null}
            </button>
            <button type="button" role="menuitem" onClick={() => select("export")}>
              Export
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/components/RailNav.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RailNav.tsx frontend/src/components/RailNav.test.tsx
git commit -m "feat(rail): RailNav back button + overflow menu"
```

---

### Task 6: `AssistantPanel` — lifted typed items, full-height rail

The panel stops owning message state. It receives `items` + `onAppend`, renders each `ThreadItem` by kind, appends a `notice` on stream errors (Retry re-sends the thread as-is), and loses its collapse chevron — the drawer's collapse handles minimization. A `contextStrip` slot renders between the chip row and the form.

**Files:**
- Modify: `frontend/src/components/AssistantPanel.tsx` (full rewrite below)
- Test: `frontend/src/components/AssistantPanel.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/AssistantPanel.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ streamAssistantChat: vi.fn() }));

import { AssistantPanel } from "./AssistantPanel";
import { streamAssistantChat } from "../api/client";
import type { ThreadItem } from "../lib/threadItems";
import type { AssistantDashboardState } from "../types";

const dashboardState: AssistantDashboardState = {
  selected_place_ids: [],
  analysis_start_date: null,
  analysis_end_date: null,
  radii_m: [250],
  offense_category: null,
  offense_subcategory: null,
  nibrs_group: null,
  layer: "reported",
};

/** Harness owning thread state the way MapWorkspace does. */
function Harness({ initial = [] as ThreadItem[] }) {
  const [items, setItems] = useState<ThreadItem[]>(initial);
  return (
    <AssistantPanel
      dashboardState={dashboardState}
      items={items}
      onAppend={(item) => setItems((current) => [...current, item])}
      contextStrip={<div data-testid="ctx-slot" />}
    />
  );
}

beforeEach(() => {
  vi.mocked(streamAssistantChat).mockReset();
  localStorage.clear();
});
afterEach(cleanup);

describe("AssistantPanel", () => {
  it("renders items by kind, including receipts and notices", () => {
    render(
      <Harness
        initial={[
          { kind: "user_text", text: "hello" },
          { kind: "tabby_text", text: "Hi there." },
          { kind: "receipt", text: "Search radius → 500 m" },
          { kind: "notice", text: "Something went sideways." },
        ]}
      />,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there.")).toBeInTheDocument();
    const receipt = screen.getByText("Search radius → 500 m");
    expect(receipt.closest(".mc-dock-msg")).toHaveClass("is-receipt");
    expect(screen.getByText("Something went sideways.").closest(".mc-dock-msg")).toHaveClass("is-notice");
    expect(screen.getByTestId("ctx-slot")).toBeInTheDocument();
  });

  it("appends the user turn and Tabby's reply on a successful stream", async () => {
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "On it." } });
      onEvent({ event: "done", data: {} });
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Home" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("analyze Home")).toBeInTheDocument();
    expect(await screen.findByText("On it.")).toBeInTheDocument();
    const call = vi.mocked(streamAssistantChat).mock.calls[0][0];
    expect(call.messages).toEqual([{ role: "user", content: "analyze Home" }]);
  });

  it("appends a notice with Retry on stream error, and Retry re-sends the same turn", async () => {
    vi.mocked(streamAssistantChat).mockImplementationOnce(async (_payload, { onEvent }) => {
      onEvent({ event: "error", data: { message: "LLM unreachable" } });
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("LLM unreachable")).toBeInTheDocument();

    vi.mocked(streamAssistantChat).mockImplementationOnce(async (_payload, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "Back now." } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Back now.")).toBeInTheDocument();
    // Retry must not duplicate the user turn.
    const retryCall = vi.mocked(streamAssistantChat).mock.calls[1][0];
    expect(retryCall.messages).toEqual([{ role: "user", content: "hi" }]);
    await waitFor(() => expect(screen.getAllByText("hi")).toHaveLength(1));
  });

  it("shows the empty state with suggested prompts and no collapse control", () => {
    render(<Harness />);
    expect(screen.getByText(/point me at a place/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare my places" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse analyst/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/AssistantPanel.test.tsx`
Expected: FAIL — `AssistantPanel` has no `items` prop (type error / undefined rendering).

- [ ] **Step 3: Rewrite `AssistantPanel.tsx`**

Replace the entire file with:

```tsx
// frontend/src/components/AssistantPanel.tsx
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { streamAssistantChat } from "../api/client";
import { toApiMessages, type ThreadItem } from "../lib/threadItems";
import type { AssistantDashboardState } from "../types";
import { TabbyAvatar } from "./TabbyAvatar";

type Props = {
  dashboardState: AssistantDashboardState;
  items: ThreadItem[];
  onAppend: (item: ThreadItem) => void;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
  contextStrip?: ReactNode;
};

type ToolActivity = {
  label: string;
};

const OFFLINE_MESSAGE =
  "Tabby can't reach the case files right now. Your data is unaffected — the rest of CompCat works.";

const SUGGESTED_PROMPTS = [
  "What's near this pin?",
  "Compare my places",
  "What's on file around here?",
];

const GREETED_KEY = "wp-copper-greeted";

export function AssistantPanel({ dashboardState, items, onAppend, onToolResult, contextStrip }: Props) {
  const [draft, setDraft] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [input, setInput] = useState("");
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [sending, setSending] = useState(false);
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");

  // text === null re-sends the thread as-is (Retry after an error notice).
  async function sendTurn(text: string | null) {
    if (!greeted) {
      localStorage.setItem(GREETED_KEY, "1");
      setGreeted(true);
    }
    const apiMessages = toApiMessages(items);
    if (text !== null) {
      apiMessages.push({ role: "user", content: text });
      onAppend({ kind: "user_text", text });
    }
    let assistantText = "";
    let errored = false;
    let turnError = "";
    setDraft("");
    setStatusLine("");
    setToolActivity([]);
    setSending(true);

    try {
      await streamAssistantChat(
        { messages: apiMessages, dashboard_state: dashboardState },
        {
          onEvent: (event) => {
            if (event.event === "tool") {
              const toolName = String(event.data.tool_name ?? "tool");
              setToolActivity((current) => [{ label: toolName }, ...current].slice(0, 4));
              onToolResult?.(event.data);
            }
            if (event.event === "status") {
              setStatusLine(String(event.data.label ?? ""));
            }
            if (event.event === "token") {
              assistantText += event.data.delta ?? "";
              setStatusLine("");
              setDraft(assistantText);
            }
            if (event.event === "replace") {
              assistantText = String(event.data.text ?? "");
              setStatusLine("");
              setDraft(assistantText);
            }
            if (event.event === "error") {
              if (!errored) turnError = String(event.data.message ?? "").trim();
              errored = true;
            }
          },
        },
      );
      // Don't commit a partial/empty answer when the turn errored — record a notice
      // instead, so Retry re-sends the same (still-unanswered) last turn.
      if (!errored && assistantText.trim()) {
        onAppend({ kind: "tabby_text", text: assistantText.trim() });
      }
      setDraft("");
      if (errored) onAppend({ kind: "notice", text: turnError || OFFLINE_MESSAGE });
    } catch {
      setDraft("");
      onAppend({ kind: "notice", text: OFFLINE_MESSAGE });
    } finally {
      setStatusLine("");
      setSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    void sendTurn(content);
  }

  const conversationEmpty = items.every((item) => item.kind === "receipt");

  return (
    <aside className="mc-dock mc-rail" aria-label="Tabby">
      <div className="mc-dock-head">
        <h3>
          <TabbyAvatar variant="mark" size={20} className={greeted ? undefined : "mc-tabby-pulse"} />
          Tabby
          <span className="mc-dock-role">case desk · analyst</span>
        </h3>
        <span className="mc-dock-status">{sending ? "Checking the files…" : "At the desk"}</span>
      </div>

      <div className="mc-dock-log" aria-live="polite">
        {items.map((item, index) => {
          if (item.kind === "user_text") {
            return <div key={index} className="mc-dock-msg is-user">{item.text}</div>;
          }
          if (item.kind === "tabby_text") {
            return (
              <div key={index} className="mc-dock-msg is-assistant">
                <ReactMarkdown>{item.text}</ReactMarkdown>
              </div>
            );
          }
          if (item.kind === "receipt") {
            return <div key={index} className="mc-dock-msg is-receipt">{item.text}</div>;
          }
          return (
            <div key={index} className="mc-dock-msg is-notice" role="status">
              <p>{item.text}</p>
              {index === items.length - 1 ? (
                <button type="button" className="mc-chip" onClick={() => void sendTurn(null)} disabled={sending}>
                  Retry
                </button>
              ) : null}
            </div>
          );
        })}
        {draft ? (
          <div className="mc-dock-msg is-assistant">
            <ReactMarkdown>{draft}</ReactMarkdown>
          </div>
        ) : null}
        {!draft && statusLine ? (
          <div className="mc-dock-msg is-assistant mc-dock-statusline">{statusLine}</div>
        ) : null}
        {conversationEmpty && !draft ? (
          <div className="mc-dock-empty">
            <TabbyAvatar variant="bust" size={72} />
            <p>Tabby, case desk. Point me at a place and I'll pull the reports near it.</p>
            <div className="mc-dock-chips">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" className="mc-chip" disabled={sending}
                  onClick={() => void sendTurn(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {toolActivity.length ? (
        <ul className="mc-dock-tools" aria-label="Tool activity">
          {toolActivity.map((item, index) => (
            <li key={`${item.label}-${index}`}>{item.label}</li>
          ))}
        </ul>
      ) : null}

      {contextStrip}

      <form className="mc-dock-form" onSubmit={handleSubmit}>
        <label className="mc-sr" htmlFor="assistant-message">Analyst message</label>
        <textarea
          id="assistant-message"
          value={input}
          rows={2}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/components/AssistantPanel.test.tsx`
Expected: PASS (4 tests). (`MapWorkspace.test.tsx` will fail to compile until Task 7 — that's expected; do not run the full suite yet.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssistantPanel.tsx frontend/src/components/AssistantPanel.test.tsx
git commit -m "feat(rail): AssistantPanel renders lifted typed thread items"
```

---

### Task 7: `BottomSheet` + `MapWorkspace` rewire

Atomic task — these must change together to keep TypeScript compiling. `BottomSheet` loses `activeTab`/`onTabChange`/`tabBadges`/`dock` and gains `nav`; `MapWorkspace` gains `railView`, the thread, receipts, and composes everything.

**Files:**
- Modify: `frontend/src/components/BottomSheet.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/components/MapWorkspace.test.tsx` (update in Task 8)

- [ ] **Step 1: Simplify `BottomSheet`**

In `frontend/src/components/BottomSheet.tsx`:

1. Change the props type and destructuring — remove `activeTab`, `onTabChange`, `tabBadges`, `dock`; add `nav`:

```ts
type Props = {
  collapsed: boolean;
  widthPx: number;
  onToggleCollapsed: () => void;
  onResize: (px: number) => void;
  onPreset: (preset: DrawerPreset) => void;
  nav?: ReactNode;
  isMobile?: boolean;
  peekHeader?: ReactNode;
  children: ReactNode;
};
```

```ts
export function BottomSheet({
  collapsed,
  widthPx,
  onToggleCollapsed,
  onResize,
  onPreset,
  nav,
  isMobile = false,
  peekHeader,
  children,
}: Props) {
```

2. Delete the `TABS` const (lines 25–44) and the `import type { TabKey } from "../types";` line.
3. Replace the `<nav className="mc-tabs" ...>...</nav>` block (lines 224–243) with:

```tsx
      {nav}
```

4. Delete the dock slot line (line 245): `{dock ? <div className="mc-dock-slot">{dock}</div> : null}`.

Everything else (grabber, handle, presets, panels) stays byte-identical.

- [ ] **Step 2: Rewire `MapWorkspace`**

All edits in `frontend/src/components/MapWorkspace.tsx`:

**(a) Imports** — add:

```ts
import { describeAnalysisPatch } from "../lib/analysisReceipt";
import { useThread } from "../lib/useThread";
import { ContextStrip } from "./ContextStrip";
import { RailNav, type RailView } from "./RailNav";
```

**(b) Replace the tab state** (line 47):

```ts
// old
const [activeTab, setActiveTab] = useState<TabKey>("compare");
// new
const [railView, setRailView] = useState<RailView>("tabby");
const thread = useThread();
```

(`TabKey` stays imported — `pinDraft` and the bridge still use it.)

**(c) `selectPlaceIds`** (line 226-231) — replace `setActiveTab("compare")` with `setRailView("compare")`.

**(d) `pinDraft` wiring** (line 233-238) — `usePinDraft` takes `setActiveTab: (tab: TabKey) => void`; pass a pass-through so pin-drop still opens the legacy compare view (where the draft popover also renders):

```ts
const pinDraft = usePinDraft({
  selectPlaceIds,
  refreshWithFallback: data.refreshWithFallback,
  setActiveTab: (tab) => setRailView(tab),
  setDrawerCollapsed,
});
```

**(e) `handleLookup`** (line 246-253) — replace `setActiveTab("compare")` with `setRailView("compare")`.

**(f) `handleAnalysisChange`** (line 272-275) — append a receipt. The append must stay
OUTSIDE the `setAnalysis` updater: updaters must be pure (StrictMode double-invokes them
in dev, which would duplicate every receipt):

```ts
function handleAnalysisChange(patch: Partial<AnalysisSettings>) {
  invalidateAnalysisContext();
  const receipt = describeAnalysisPatch(analysis, patch);
  if (receipt) thread.append({ kind: "receipt", text: receipt });
  setAnalysis((current) => ({ ...current, ...patch }));
}
```

**(g) `applyAssistantToolResult`** (line 305-334) — receipt for assistant-driven settings changes, and `railView` instead of tab:

```ts
// old
if (effect.settings) {
  setAnalysis((current) => ({ ...current, ...effect.settings }));
}
// new — same hoist as (f): the append is a side effect, so it cannot live inside the
// updater. Reading render-scope `analysis` for the receipt text is an accepted trade-off;
// the state merge itself still uses `current`.
if (effect.settings) {
  const receipt = describeAnalysisPatch(analysis, effect.settings);
  if (receipt) thread.append({ kind: "receipt", text: receipt });
  setAnalysis((current) => ({ ...current, ...effect.settings }));
}
```

```ts
// old (last line of the function)
if (effect.tab) setActiveTab(effect.tab);
// new
if (effect.tab) setRailView(effect.tab);
```

**(h) Auto-run opens the legacy compare view** (line 183-188) — results still render there until Slice 3:

```ts
useEffect(() => {
  if (!pendingAutoRun || list.entries.length === 0) return;
  setPendingAutoRun(false);
  setRailView("compare");
  void compare.run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pendingAutoRun, list.entries]);
```

**(i) `showLanding`** (line 361-362) — landing overrides the rail unless the user is in Export:

```ts
const showLanding =
  data.places.length === 0 && list.entries.length === 0 && railView !== "export" && !pinDraft.draft;
```

**(j) The `BottomSheet` invocation** (lines 487-557) — replace the whole block with:

```tsx
<BottomSheet
  collapsed={drawer.collapsed}
  widthPx={drawer.widthPx}
  onToggleCollapsed={onToggleCollapsed}
  onResize={onDrawerResize}
  onPreset={onPreset}
  isMobile={isMobile}
  peekHeader={isMobile ? layerControls : undefined}
  nav={<RailNav view={railView} compareCount={list.entries.length} onSelect={setRailView} />}
>
  {showLanding ? (
    <AddressLookup provider={geocodingProvider} onSelect={handleLookup} onManual={() => setManagePlaces("manual")} />
  ) : railView === "tabby" ? (
    <div className="mc-rail-wrap">
      {drawerTopSlot}
      <AssistantPanel
        dashboardState={assistantState}
        items={thread.items}
        onAppend={thread.append}
        onToolResult={applyAssistantToolResult}
        contextStrip={
          <ContextStrip analysis={analysis} availableRadii={data.availableRadii} onChange={handleAnalysisChange} />
        }
      />
    </div>
  ) : (
    <>
      {railView === "compare" ? (
        <CompareTab
          topSlot={drawerTopSlot}
          entries={list.entries}
          provider={geocodingProvider}
          onAddEntry={(entry) => { invalidateAnalysisContext(); list.add(entry); }}
          onRemoveEntry={(index) => { invalidateAnalysisContext(); list.removeAt(index); }}
          savedKeys={savedPlaceKeys}
          onSaveEntry={async (entry) => {
            data.setError("");
            try {
              const created = await createPlace({ display_label: entry.label, latitude: entry.latitude, longitude: entry.longitude, visit_count: 1, sensitivity_class: "normal" });
              list.markSaved(keyOf(entry), created.id);
              await data.refreshWithFallback("Saved, but your places list could not refresh.");
            } catch {
              data.setError("Unable to save this address. Try again.");
            }
          }}
          analysis={analysis}
          availableRadii={data.availableRadii}
          comparison={compare.comparison}
          neighborhood={compare.neighborhood}
          incidents={compare.incidents}
          runPoints={compare.runPoints}
          running={compare.running}
          error={data.error}
          panelWidthPx={drawer.widthPx}
          isMobile={isMobile}
          onChange={handleAnalysisChange}
          onRun={compare.run}
          onCopyLink={buildShareUrl}
          onHoverPlace={setHoveredPlaceId}
          mcppPolygons={mcppPolygons}
          onFlyTo={({ latitude, longitude }) => setChipFlyTo({ lat: latitude, lng: longitude })}
        />
      ) : null}
      {railView === "export" ? (
        <ExportTab
          href={data.exportHref}
          places={data.places}
          onToggleExport={async (id, include) => {
            data.setError("");
            try {
              await updatePlace(id, { sensitivity_class: include ? "normal" : "suppress_from_public_export" });
              await data.refreshWithFallback("Updated export setting, but dashboard totals could not refresh.");
            } catch {
              data.setError("Unable to update export setting. Try again.");
            }
          }}
        />
      ) : null}
    </>
  )}
</BottomSheet>
```

(The `CompareTab`/`ExportTab` props are byte-identical to today except `activeTab === "compare"` / `"export"` conditions became `railView` checks.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. Two likely stragglers: any missed `activeTab` reference (`grep -n "activeTab\|setActiveTab" src/components/MapWorkspace.tsx` should return nothing), and the now-unreferenced `TabKey` in MapWorkspace's type-import list — remove it from the import if TypeScript flags it unused (the `(tab) => setRailView(tab)` lambda infers its type from `usePinDraft`'s signature).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BottomSheet.tsx frontend/src/components/MapWorkspace.tsx
git commit -m "feat(rail): rail-first drawer with legacy panels behind RailNav overflow"
```

---

### Task 8: Update `MapWorkspace.test.tsx` + full frontend suite

Most existing tests should survive because every analysis-producing path (`selectPlaceIds`, `handleLookup`, auto-run, bridge `effect.tab`) opens the legacy compare view where the `tabpanel` assertions look. Update what doesn't.

- [ ] **Step 1: Run the suite and catalogue failures**

Run: `cd frontend && npm test -- src/components/MapWorkspace.test.tsx`

Expected failure classes and their fixes:

1. **Tests that clicked the old tab buttons** (any `fireEvent.click` on a `role="tab"` or a button named `Compare`/`Export`): replace with the overflow menu:

```tsx
function openLegacyView(name: "Compare" | "Export") {
  fireEvent.click(screen.getByRole("button", { name: "More panels" }));
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(name, "i") }));
}
```

Add that helper near the top of the describe block and call it where the test previously clicked a tab.

2. **Tests that assumed CompareTab renders immediately at rest** (no analysis flow ran): call `openLegacyView("Compare")` after render.

3. **Tests asserting the dock/collapse** (`Collapse analyst` / `Expand analyst` buttons, `defaultCollapsed`): the chevron no longer exists — delete those assertions; the drawer grabber/handle owns collapse.

4. **Tab badge pill assertions** (if any assert the `pill` count on the tab): the count now lives on the overflow menu's Compare item — open the menu first, then assert `within(screen.getByRole("menu")).getByText("2")`.

Do NOT weaken assertions about analysis results, bridge effects, share links, landing, or pin drafts — those flows must pass unchanged (they auto-open the compare view).

- [ ] **Step 2: Verify the whole frontend suite**

Run: `cd frontend && npm test`
Expected: PASS across all files (including untouched `CompareTab`, `ExportTab`, `useDrawer` suites).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MapWorkspace.test.tsx
git commit -m "test(rail): navigate legacy panels via RailNav overflow in workspace tests"
```

---

### Task 9: CSS for rail, railnav, and context strip

**Files:**
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Adjust dock rules and append rail styles**

1. `.mc-dock` (line 100) currently caps the dock: `max-height:44vh`. Keep it (harmless default), and add rail overrides *after* the existing `.mc-dock-*` block (after line ~123):

```css
/* --- Tabby rail (Slice 1: rail-first drawer) --- */
.mc-rail-wrap{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;}
.mc-dock.mc-rail{flex:1;min-height:0;max-height:none;display:flex;flex-direction:column;gap:10px;overflow:hidden;}
.mc-dock.mc-rail .mc-dock-log{flex:1;min-height:0;max-height:none;overflow:auto;}
.mc-railnav{display:flex;align-items:center;gap:8px;padding:48px 18px 8px;border-bottom:1px solid var(--border);}
.mc-railnav-spacer{flex:1;}
.mc-railnav-back{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border:1px solid var(--border);border-radius:9px;background:transparent;color:var(--text-strong);font-size:12.5px;font-weight:600;cursor:pointer;}
.mc-railnav-back:hover{background:var(--surface-sunken);}
.mc-railnav-more{position:relative;}
.mc-railnav-more>button{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;}
.mc-railnav-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;display:grid;gap:2px;min-width:160px;padding:6px;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:0 8px 24px rgba(0,0,0,.18);}
.mc-railnav-menu button{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--text-strong);font-size:12.5px;text-align:left;cursor:pointer;}
.mc-railnav-menu button:hover{background:var(--surface-sunken);}
.mc-dock-msg.is-receipt{margin:0 22px 0 0;padding:5px 10px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);font-family:var(--f-mono);font-size:11px;}
.mc-dock-msg.is-notice{margin-right:22px;border:1px solid var(--danger);background:var(--surface-sunken);color:var(--danger);font-size:12px;}
.mc-dock-msg.is-notice p{margin:0 0 6px;}
.mc-ctx{position:relative;}
.mc-ctx-summary{display:flex;flex-wrap:wrap;align-items:center;gap:5px;width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:9px;background:var(--surface-sunken);color:var(--text-dim);font-family:var(--f-mono);font-size:10.5px;cursor:pointer;text-align:left;}
.mc-ctx-summary:hover{color:var(--text);}
.mc-ctx-summary svg{margin-left:auto;}
.mc-ctx-editor{display:grid;gap:10px;margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);}
```

2. In the mobile media block (near line 449), the old `.mc-tabs` rules can stay (dead selectors are cleaned up in Slice 7 with the tabs themselves), but add below them:

```css
  .mc-railnav{padding:0 14px 8px;}
```

- [ ] **Step 2: Visual sanity check**

Run: `cd frontend && npm run build`
Expected: clean build. Then verify in the running app (use the project's `/verify` skill, or `make run` + browser): rail fills the drawer full-height, thread scrolls, context strip sits above the input, ⋯ menu opens Compare/Export, "← Tabby" returns, mobile sheet unchanged at ≤760px.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/mapWorkspace.css
git commit -m "style(rail): full-height rail, railnav overflow menu, context strip"
```

---

### Task 10: Full verification gate

- [ ] **Step 1: Run the repo gate**

Run (repo root): `make test-all`
Expected: pytest PASS (backend untouched — must stay green), ruff clean, frontend vitest PASS, frontend build clean.

- [ ] **Step 2: Fix any stragglers and commit**

If `make test-all` surfaced anything (e.g. an eslint/ruff nit or a missed import), fix it minimally and:

```bash
git add -A
git commit -m "fix(rail): test-all stragglers"
```

- [ ] **Step 3: End-to-end check via the verify skill**

Use the project's `/verify` skill recipe (build/launch/drive the dev app in the worktree) to confirm: default view is the Tabby rail; typing a message streams a reply; changing radius in the context strip appends a "Search radius → …" receipt; overflow → Compare shows today's Compare tab intact; landing (fresh session) still shows the address lookup.

---

## Out of scope for this slice (later slices per spec)

- `/assistant/commands` endpoint, chips-as-commands, degraded-mode gating (Slice 2)
- Inline analysis cards + run-scoped export + follow-up chips (Slice 3)
- Presence badges, badge descriptors, fly-to padding (Slice 4)
- Proactive onboarding / place-added moments, auto-run audit (Slice 5)
- Mobile snap heights beyond today's binary collapse (Slice 6)
- Deleting Compare/Export + dead CSS (Slice 7, gated on the parity checklist)
