# CompCat Restructure (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the drawer to three tabs (Analyze · Compare · Export, Analyze default), demote Places to a chip strip atop Analyze/Compare plus a manage modal — no backend changes.

**Architecture:** `PlacesTab` dissolves into two focused pieces: a new `PlaceChipStrip` (toggle chips with the existing `placeIdentity` letters/colors, hover-synced to map pins) rendered above the Analyze/Compare panels, and a new `ManagePlacesModal` (the current modal grown a "Manage" view hosting the relocated place list, drawer search, drop-pin button, and privacy notice). `TabKey` loses `"places"`; the pin-draft flow retargets to Analyze. Spec: `docs/superpowers/specs/2026-07-13-compcat-resurface-design.md` §4 (this is slice 2; slice 1 = rebrand, merged as PR #137).

**Tech Stack:** React + TypeScript + Vite (vitest), plain CSS in the `mc-` token system. Frontend-only.

**Prerequisite:** PR #137 (slice 1) is squash-merged to main. Branch this work from the updated `origin/main`.

**Spec deviation (deliberate):** the spec's §4 says the Manage view offers "rename/delete (the current list UI, relocated)" — but the current PlacesTab list has select/delete only; rename never existed. This plan relocates the list as-is (select/delete). Rename is a new feature and stays out of a restructure slice; flag it as a follow-up candidate in the PR if wanted.

**Verification gate:** `make test-all` before the PR.

## Key facts discovered up front (trust these; verify lines if drifted)

- `TabKey` lives at `frontend/src/types.ts:143`: `"places" | "analyze" | "compare" | "export"`; also used at `types.ts:185` (`initialView.tab`).
- Share links can only encode `tab: "analyze" | "compare"` (`frontend/src/lib/savedView.ts:19`) and the assistant bridge only sets `"analyze"`/`"compare"` (`frontend/src/lib/assistantBridge.ts:46,55`) — removing `"places"` breaks no persisted state.
- `frontend/src/lib/usePinDraft.ts` is hard-wired to the places tab: prop type `setActiveTab: (tab: "places") => void` (line 25) and three `setActiveTab("places")` calls (`startAddPin`, `handleMapClick`, `handleSearchSelect`; a fourth may exist in `saveDraft` — grep for all).
- `MapWorkspace.tsx`: `activeTab` default `initialView?.tab ?? "places"` (line 48); `manualEntry` state (line 54) exists only to suppress the landing while manual-adding — it becomes dead; `showLanding` (line 335) gates the `AddressLookup` landing on `activeTab === "places"`; `identityByPlaceId: Map<string, PlaceIdentity>` (line ~116) maps SELECTED place ids to `{letter, slot}` — index-within-`selected`, the same identity the Analyze cards and map pins use; `PlacesTab` render block at lines 429–454 receives `search` (`PlaceSearch`) and `draftPopover` (`PinDraftPopover`) as nodes.
- `placeIdentity(index)` → `{letter: "A"…, slot: "a"|"b"|"c"|"d"|"x"}` (`frontend/src/lib/placeIdentity.ts`); badge CSS `.mc-idbadge.id-{slot}` at `mapWorkspace.css:438-443`.
- `BottomSheet.tsx` owns the tab bar: `TABS` array (4 entries with inline SVG icons), `tabBadges?: Partial<Record<TabKey, number>>`; MapWorkspace passes `tabBadges={{ places: …, compare: … }}`.
- Tests: `App.test.tsx:42` asserts `getAllByRole("tab")).toHaveLength(4)`; `MapWorkspace.test.tsx` (727 lines) drives flows by clicking tabs and the places list; `PlacesTab.test.tsx` (78 lines) covers the list/modal.

---

### Task 0: Worktree setup

**Files:** none (environment)

- [ ] **Step 1: Confirm the prerequisite and create the worktree**

```bash
cd /Users/jscocca/Repos/waypoint
git fetch origin
git log --oneline origin/main -3   # confirm the CompCat rebrand (PR #137 squash) is present; if not, STOP and report
git worktree add ../waypoint-slice2 -b compcat-restructure-slice2 origin/main
cd ../waypoint-slice2
ln -s /Users/jscocca/Repos/waypoint/.venv .venv
ln -s /Users/jscocca/Repos/waypoint/frontend/node_modules frontend/node_modules
echo ".venv" >> "$(git rev-parse --git-path info/exclude)"
echo "frontend/node_modules" >> "$(git rev-parse --git-path info/exclude)"
```

- [ ] **Step 2: Sanity-check**

```bash
cd /Users/jscocca/Repos/waypoint-slice2/frontend && npx vitest run src/components/BottomSheet.test.tsx
```

Expected: green. All subsequent tasks run inside `../waypoint-slice2`.

---

### Task 1: PlaceChipStrip component

**Files:**
- Create: `frontend/src/components/PlaceChipStrip.tsx`
- Create: `frontend/src/components/PlaceChipStrip.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css` (append chip rules after the `.mc-idbadge` block, ~line 443)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/PlaceChipStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceChipStrip } from "./PlaceChipStrip";
import { placeIdentity } from "../lib/placeIdentity";
import type { Place } from "../types";

afterEach(cleanup);

function place(id: string, label: string): Place {
  return {
    id,
    display_label: label,
    latitude: 47.6,
    longitude: -122.3,
    visit_count: 1,
    total_dwell_minutes: null,
    inferred_place_type: "manual",
    sensitivity_class: "normal",
  } as Place;
}

const places = [place("p1", "Home"), place("p2", "Work"), place("p3", "Gym")];
// p2 selected first, p1 second — identity letters follow selection order, not list order.
const identity = new Map([
  ["p2", placeIdentity(0)],
  ["p1", placeIdentity(1)],
]);

describe("PlaceChipStrip", () => {
  it("renders a checked chip with its identity letter for selected places", () => {
    render(
      <PlaceChipStrip places={places} identityByPlaceId={identity} onToggle={vi.fn()} onHoverPlace={vi.fn()} onAdd={vi.fn()} />,
    );
    const work = screen.getByRole("checkbox", { name: "Work" });
    expect(work).toHaveAttribute("aria-checked", "true");
    expect(work).toHaveTextContent("A");
    const home = screen.getByRole("checkbox", { name: "Home" });
    expect(home).toHaveTextContent("B");
    expect(screen.getByRole("checkbox", { name: "Gym" })).toHaveAttribute("aria-checked", "false");
  });

  it("toggles on click and reports hover for pin sync", () => {
    const onToggle = vi.fn();
    const onHover = vi.fn();
    render(
      <PlaceChipStrip places={places} identityByPlaceId={identity} onToggle={onToggle} onHoverPlace={onHover} onAdd={vi.fn()} />,
    );
    const gym = screen.getByRole("checkbox", { name: "Gym" });
    fireEvent.click(gym);
    expect(onToggle).toHaveBeenCalledWith("p3");
    fireEvent.mouseEnter(gym);
    expect(onHover).toHaveBeenCalledWith("p3");
    fireEvent.mouseLeave(gym);
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it("has a trailing Add chip that opens the manager", () => {
    const onAdd = vi.fn();
    render(
      <PlaceChipStrip places={places} identityByPlaceId={identity} onToggle={vi.fn()} onHoverPlace={vi.fn()} onAdd={onAdd} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    expect(onAdd).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/PlaceChipStrip.test.tsx`
Expected: FAIL — cannot resolve `./PlaceChipStrip`.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/PlaceChipStrip.tsx`:

```tsx
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { Place } from "../types";

type Props = {
  places: Place[];
  identityByPlaceId: Map<string, PlaceIdentity>;
  onToggle: (id: string) => void;
  onHoverPlace: (id: string | null) => void;
  onAdd: () => void;
};

export function PlaceChipStrip({ places, identityByPlaceId, onToggle, onHoverPlace, onAdd }: Props) {
  return (
    <div className="mc-chipstrip" role="group" aria-label="Saved places">
      {places.map((place) => {
        const identity = identityByPlaceId.get(place.id);
        const selected = identity !== undefined;
        return (
          <button
            key={place.id}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={place.display_label}
            className={`mc-chip${selected ? " on" : ""}`}
            onClick={() => onToggle(place.id)}
            onMouseEnter={() => onHoverPlace(place.id)}
            onMouseLeave={() => onHoverPlace(null)}
            onFocus={() => onHoverPlace(place.id)}
            onBlur={() => onHoverPlace(null)}
          >
            {selected ? (
              <span className={`mc-idbadge id-${identity.slot}`} aria-hidden="true">{identity.letter}</span>
            ) : null}
            <span className="mc-chip-label">{place.display_label}</span>
          </button>
        );
      })}
      <button type="button" className="mc-chip mc-chip-add" aria-label="Add or manage places" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add
      </button>
    </div>
  );
}
```

(Chips for unselected places have no identity entry — `identityByPlaceId` is built from the `selected` array — so letter badges appear only on selected chips, matching the Analyze cards and map pins.)

- [ ] **Step 4: Add the chip CSS**

In `frontend/src/styles/mapWorkspace.css`, directly after the `.mc-idbadge.id-x{...}` rule (~line 443), append:

```css
.mc-chipstrip{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 10px;}
.mc-chip{display:inline-flex;align-items:center;gap:6px;max-width:180px;padding:4px 10px;border-radius:999px;
  border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;cursor:pointer;}
.mc-chip:hover{border-color:var(--border-strong);}
.mc-chip.on{border-color:var(--accent);background:var(--accent-soft);color:var(--text-strong);}
.mc-chip.on:hover{border-color:var(--accent-deep);}
.mc-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.mc-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mc-chip-add{color:var(--accent-deep);border-style:dashed;}
.mc-chip .mc-idbadge{width:16px;height:16px;font-size:9.5px;margin-left:-4px;}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/PlaceChipStrip.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PlaceChipStrip.tsx frontend/src/components/PlaceChipStrip.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(drawer): PlaceChipStrip - identity chips for saved places"
```

---

### Task 2: ManagePlacesModal component

The existing `PlacesTab` modal (Manual / Bulk CSV / Upload views) grows a fourth **Manage** view hosting the relocated place list, the drawer `PlaceSearch` slot, the drop-pin button, and the privacy `Notice`. `PlacesTab.tsx` itself is NOT deleted yet (Task 4) — this task only creates the new component so every commit stays green.

**Files:**
- Create: `frontend/src/components/ManagePlacesModal.tsx`
- Create: `frontend/src/components/ManagePlacesModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ManagePlacesModal.test.tsx` (adapted from `PlacesTab.test.tsx` — read that file first; reuse its fixture style for `Place`/`summary` objects):

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagePlacesModal } from "./ManagePlacesModal";
import type { Place } from "../types";

afterEach(cleanup);

function place(id: string, label: string): Place {
  return {
    id,
    display_label: label,
    latitude: 47.6,
    longitude: -122.3,
    visit_count: 1,
    total_dwell_minutes: null,
    inferred_place_type: "manual",
    sensitivity_class: "normal",
  } as Place;
}

const baseProps = {
  places: [place("p1", "Home"), place("p2", "Work")],
  selectedIds: new Set(["p1"]),
  summary: null,
  radiusM: 400,
  addPinMode: false,
  search: <div data-testid="search-slot" />,
  onStartAddPin: vi.fn(),
  onToggleSelect: vi.fn(),
  onDelete: vi.fn(),
  onManualSubmit: vi.fn().mockResolvedValue(undefined),
  onImportSubmit: vi.fn().mockResolvedValue(undefined),
  onUploaded: undefined,
  onClose: vi.fn(),
};

describe("ManagePlacesModal", () => {
  it("opens on the Manage view with the place list, search slot, and privacy note", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    expect(screen.getByRole("dialog", { name: "Manage places" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Home" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Work" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("search-slot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Work" })).toBeInTheDocument();
  });

  it("switches to the Manual view and submits a place", async () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    expect(screen.getByRole("dialog", { name: "Add a place manually" })).toBeInTheDocument();
  });

  it("opens directly on a non-manage view when asked", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manual" />);
    expect(screen.getByRole("dialog", { name: "Add a place manually" })).toBeInTheDocument();
  });

  it("delegates delete, toggle, drop-pin, and close", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Work" }));
    expect(baseProps.onToggleSelect).toHaveBeenCalledWith("p2");
    fireEvent.click(screen.getByRole("button", { name: "Remove Home" }));
    expect(baseProps.onDelete).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /drop pin/i }));
    expect(baseProps.onStartAddPin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/ManagePlacesModal.test.tsx`
Expected: FAIL — cannot resolve `./ManagePlacesModal`.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/ManagePlacesModal.tsx`. This is the modal + list from `PlacesTab.tsx` (read it side-by-side; the list `<ul className="mc-list">` body, `coords`, `pinSvg`, and `modalLabel` helpers move over verbatim except where shown):

```tsx
import { useState } from "react";
import type { ReactNode } from "react";

import { BulkPlaceEntry } from "./BulkPlaceEntry";
import { Notice } from "./Notice";
import { PersonalUpload } from "./PersonalUpload";
import { PlaceForm } from "./PlaceForm";
import { incidentCountForPlace } from "../lib/incidentSummaries";
import { isSensitive } from "../lib/sensitivity";
import type { DashboardSummary, Place, PlaceCreate } from "../types";

export type ManageView = "manage" | "manual" | "import" | "upload";

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  summary: DashboardSummary | null;
  radiusM: number;
  addPinMode: boolean;
  search: ReactNode;
  initialView: ManageView;
  onStartAddPin: () => void;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onManualSubmit: (place: PlaceCreate) => Promise<void>;
  onImportSubmit: (csv: string) => Promise<void>;
  onUploaded?: () => void;
  onClose: () => void;
};

function modalLabel(kind: ManageView): string {
  if (kind === "manage") return "Manage places";
  if (kind === "manual") return "Add a place manually";
  if (kind === "import") return "Import places";
  return "Upload location history";
}

function coords(place: Place): string {
  if (place.latitude === null || place.longitude === null) {
    return "No coordinates";
  }
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
}

function pinSvg(selected: boolean) {
  return (
    <svg width="15" height="20" viewBox="0 0 24 32">
      <path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill={selected ? "var(--accent)" : "#3A3F46"} />
      <circle cx="12" cy="11.5" r="4.4" fill="#fff" />
    </svg>
  );
}

export function ManagePlacesModal({
  places,
  selectedIds,
  summary,
  radiusM,
  addPinMode,
  search,
  initialView,
  onStartAddPin,
  onToggleSelect,
  onDelete,
  onManualSubmit,
  onImportSubmit,
  onUploaded,
  onClose,
}: Props) {
  const [view, setView] = useState<ManageView>(initialView);
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;

  return (
    <div className="mc-modal-scrim" role="dialog" aria-modal="true" aria-label={modalLabel(view)}>
      <div className="mc-modal">
        <div className="mc-modal-head">
          <h3>{modalLabel(view)}</h3>
          <button type="button" className="mc-iconbtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="mc-modal-tabs">
          <button type="button" className={`mc-modal-tab${view === "manage" ? " on" : ""}`} onClick={() => setView("manage")}>Manage</button>
          <button type="button" className={`mc-modal-tab${view === "manual" ? " on" : ""}`} onClick={() => setView("manual")}>Manual</button>
          <button type="button" className={`mc-modal-tab${view === "import" ? " on" : ""}`} onClick={() => setView("import")}>Bulk CSV</button>
          {onUploaded ? <button type="button" className={`mc-modal-tab${view === "upload" ? " on" : ""}`} onClick={() => setView("upload")}>Upload</button> : null}
        </div>
        {view === "manage" ? (
          <div className="mc-manage">
            <div className="mc-head-actions">
              <button type="button" className={`mc-tinybtn${addPinMode ? " on" : ""}`} onClick={onStartAddPin}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                {addPinMode ? "Click map..." : "Drop pin"}
              </button>
            </div>
            {search}
            {places.length === 0 ? (
              <p className="mc-empty-list">No places yet. Choose <strong>Drop pin</strong> then click the map, or search for an address.</p>
            ) : (
              <ul className="mc-list" aria-label="Saved places">
                {places.map((place) => {
                  const selected = selectedIds.has(place.id);
                  const count = incidentCountForPlace(summary, place.id, radiusM);
                  const low = count === null && analyzedAtRadius && selected;
                  return (
                    <li key={place.id} className={`mc-card${selected ? " on" : ""}`}>
                      <button
                        type="button"
                        className="chk"
                        role="checkbox"
                        aria-checked={selected}
                        aria-label={`Select ${place.display_label}`}
                        onClick={() => onToggleSelect(place.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
                      </button>
                      <span className="gly">{pinSvg(selected)}</span>
                      <div className="meta">
                        <div className="nm">{place.display_label}</div>
                        <div className="sub">{coords(place)}</div>
                        {isSensitive(place.sensitivity_class) ? (
                          <span className="cnt" title="Excluded from public CSV exports">Hidden from exports</span>
                        ) : null}
                      </div>
                      <div className="right">
                        {count !== null ? <span className="cnt">{count} {summary?.layer === "calls" ? "calls" : summary?.layer === "arrests" ? "arr." : "inc."}</span> : null}
                        {low ? <span className="cnt low">Low data</span> : null}
                        <button type="button" className="ico" aria-label={`Remove ${place.display_label}`} onClick={() => onDelete(place.id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mc-places-note"><Notice /></div>
          </div>
        ) : view === "manual" ? (
          <PlaceForm onSubmit={async (place) => { await onManualSubmit(place); setView("manage"); }} />
        ) : view === "import" ? (
          <BulkPlaceEntry onSubmit={async (csv) => { await onImportSubmit(csv); setView("manage"); }} />
        ) : (
          <PersonalUpload onUploaded={onUploaded ?? (() => {})} />
        )}
      </div>
    </div>
  );
}
```

(Two deliberate behavior changes vs. PlacesTab: after Manual/Bulk submit the modal switches to the Manage view instead of closing — the user sees the result in the list; and the drop-pin button lives in the Manage view. If `.mc-manage` needs spacing, add `.mc-manage{display:grid;gap:10px;}` to `mapWorkspace.css` — no other new CSS; `mc-list`/`mc-card`/`mc-modal*` rules already exist.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ManagePlacesModal.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Full suite still green (PlacesTab untouched so far)**

Run: `cd frontend && npx vitest run`
Expected: all green, existing counts + 7 new tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ManagePlacesModal.tsx frontend/src/components/ManagePlacesModal.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(drawer): ManagePlacesModal - place list + add flows behind one modal"
```

---

### Task 3: Three tabs + MapWorkspace rewiring (atomic)

`TabKey` loses `"places"` — the type change, BottomSheet tab list, pin-draft retarget, and MapWorkspace rewiring must land in ONE commit or intermediate states won't compile.

**Files:**
- Modify: `frontend/src/types.ts:143`
- Modify: `frontend/src/components/BottomSheet.tsx` (TABS array)
- Modify: `frontend/src/lib/usePinDraft.ts` (prop type + all `setActiveTab("places")` calls)
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/App.test.tsx`, `frontend/src/components/MapWorkspace.test.tsx`, `frontend/src/components/BottomSheet.test.tsx`, `frontend/src/lib/usePinDraft.test.ts` (if it asserts tab switches)

- [ ] **Step 1: Update headline test assertions first**

- `App.test.tsx:42`: `expect(screen.getAllByRole("tab")).toHaveLength(4)` → `toHaveLength(3)`.
- `BottomSheet.test.tsx`: find assertions naming the Places tab (`grep -n "Places" frontend/src/components/BottomSheet.test.tsx`) and remove/retarget them; a tab-count assertion goes to 3.
- `MapWorkspace.test.tsx`: run `grep -n "places\|Places" frontend/src/components/MapWorkspace.test.tsx` and apply this mapping:
  - Clicking the Places tab to reach the list → open the manage modal instead: click the chip strip's `getByRole("button", { name: "Add or manage places" })`.
  - Selecting a place via the list checkbox (`Select Home`) → the same `role="checkbox"` names now ALSO exist as chips (`getByRole("checkbox", { name: "Home" })` — chip aria-label is the bare display label, list rows inside the modal keep `Select Home`). Prefer the chip for selection tests.
  - Tests asserting the drawer starts on Places → assert Analyze is the selected tab: `expect(screen.getByRole("tab", { name: /analyze/i })).toHaveAttribute("aria-selected", "true")`.
  - Tests exercising Drop pin / manual add / import flows → open the manage modal first, then proceed unchanged (the modal internals are the same components).
  - The `tabBadges` places-count pill assertions (if any) → delete; only the compare badge remains.

- [ ] **Step 2: Run to verify the updated tests fail**

Run: `cd frontend && npx vitest run src/App.test.tsx src/components/BottomSheet.test.tsx`
Expected: FAIL (still 4 tabs rendered).

- [ ] **Step 3: The type + tab bar + pin-draft changes**

- `frontend/src/types.ts:143`: `export type TabKey = "analyze" | "compare" | "export";`
- `BottomSheet.tsx`: delete the `places` entry from `TABS` (the whole first object, including its map-pin SVG icon).
- `usePinDraft.ts`: prop type → `setActiveTab: (tab: "analyze") => void;` and every `setActiveTab("places")` → `setActiveTab("analyze")` (grep for all occurrences — `startAddPin`, `handleMapClick`, `handleSearchSelect`, possibly `saveDraft`). Update the comment above `previewSearch` that references "the Places-tab switch" to say Analyze.

- [ ] **Step 4: Rewire MapWorkspace**

In `frontend/src/components/MapWorkspace.tsx`:

1. Imports: drop `PlacesTab`, add `ManagePlacesModal` (and its `ManageView` type) and `PlaceChipStrip`.
2. Line 48: `useState<TabKey>(initialView?.tab ?? "analyze")`.
3. Line 54: delete the `manualEntry` state. Where `setManualEntry` was called (`handleLookup`, `AddressLookup onManual`): delete the call in `handleLookup`; the landing's manual affordance becomes `onManual={() => setManagePlaces("manual")}`.
4. Add modal state near the other UI state: `const [managePlaces, setManagePlaces] = useState<ManageView | null>(null);`
5. `showLanding` (line ~335): `data.places.length === 0 && !lookupPoint && !sharedPoints && activeTab === "analyze" && !pinDraft.draft;`
6. `tabBadges`: `{{ compare: compareSet.points.length }}`.
7. Replace the `activeTab === "places" ? <PlacesTab .../> : null` block with nothing, and above the tab blocks (inside the non-landing fragment) render the strip + relocated draft popover:

```tsx
          {activeTab === "analyze" || activeTab === "compare" ? (
            <PlaceChipStrip
              places={data.places}
              identityByPlaceId={identityByPlaceId}
              onToggle={handleToggleSelect}
              onHoverPlace={setHoveredPlaceId}
              onAdd={() => setManagePlaces("manage")}
            />
          ) : null}
          {pinDraft.draft ? (
            <PinDraftPopover
              draft={pinDraft.draft}
              saving={pinDraft.draftSaving}
              error={pinDraft.draftError}
              onChange={(patch) => pinDraft.setDraft((current) => (current ? { ...current, ...patch } : current))}
              onSave={pinDraft.saveDraft}
              onCancel={() => pinDraft.setDraft(null)}
            />
          ) : null}
```

8. After the `</BottomSheet>` closing tag (so it overlays regardless of landing state), render the modal:

```tsx
        {managePlaces ? (
          <ManagePlacesModal
            places={data.places}
            selectedIds={selectedIds}
            summary={data.summary}
            radiusM={analysis.radiusM}
            addPinMode={pinDraft.addPinMode}
            search={<PlaceSearch provider={geocodingProvider} onSelectResult={pinDraft.handleSearchSelect} />}
            initialView={managePlaces}
            onStartAddPin={() => { setManagePlaces(null); pinDraft.startAddPin(); }}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDelete}
            onManualSubmit={handleManualSubmit}
            onImportSubmit={handleImport}
            onUploaded={data.personalUploadsEnabled ? () => data.refreshWithFallback("Uploaded, but dashboard totals could not refresh.") : undefined}
            onClose={() => setManagePlaces(null)}
          />
        ) : null}
```

(`onStartAddPin` closes the modal first — the user must click the MAP next, which the modal scrim would block.)

9. Check remaining `"places"` references compile away: `grep -n '"places"' frontend/src/components/MapWorkspace.tsx` — the only valid leftover is the `tabBadges` key removal already done; anything else (e.g. `initialView?.tab` comparisons) must be updated.

- [ ] **Step 5: Typecheck, then iterate the suite**

```bash
cd frontend && npx tsc -b && npx vitest run
```

Expected: tsc clean; vitest green after the Step 1 mapping is fully applied. Budget iteration here — MapWorkspace.test.tsx is 727 lines and several flows changed homes. Rules: fix tests by retargeting interactions (chips/modal), NEVER by weakening assertions on analysis/compare behavior; if a test covered a Places-tab behavior that no longer exists (e.g. the places-count tab badge), delete that test and note it in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src
git commit -m "feat(drawer): three tabs - Analyze default, chip strip + manage modal replace PlacesTab"
```

---

### Task 4: Delete PlacesTab + audit

**Files:**
- Delete: `frontend/src/components/PlacesTab.tsx`, `frontend/src/components/PlacesTab.test.tsx`

- [ ] **Step 1: Delete and verify nothing references it**

```bash
git rm frontend/src/components/PlacesTab.tsx frontend/src/components/PlacesTab.test.tsx
grep -rn "PlacesTab" frontend/src
```

Expected: grep empty.

- [ ] **Step 2: Behavior audit greps**

```bash
grep -rn '"places"' frontend/src --include="*.ts" --include="*.tsx" | grep -v test
grep -rn "setActiveTab" frontend/src/lib/usePinDraft.ts
```

Expected: first grep — no TabKey-valued `"places"` left (object keys like `data.places` are fine — read matches in context); second — only `"analyze"` targets.

- [ ] **Step 3: Full suite**

Run: `cd frontend && npx vitest run`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git commit -am "chore(drawer): remove PlacesTab (superseded by chip strip + manage modal)"
```

---

### Task 5: Verification gate + visual check + PR

- [ ] **Step 1: Full gate**

Run from the worktree root: `make test-all`
Expected: pytest 617 passed / 3 skipped (backend untouched — any backend failure is a stop-and-report), ruff clean, vitest green, build clean.

- [ ] **Step 2: Visual spot-check**

Prepare the worktree DB once: `mkdir -p dev-output && .venv/bin/python -m alembic upgrade head`. Then reuse the slice-1 launch configs in the MAIN checkout's `.claude/launch.json` (`compcat-api` on :8001 / `compcat-web` on :5176) — update both `cd` paths from `waypoint-compcat-rebrand` to `waypoint-slice2` first. Start both via the preview harness (never Bash). Verify: drawer opens on Analyze with three tabs; landing shows on empty session; after adding a place via the manage modal, chips appear with identity letters on Analyze AND Compare; chip hover pulses the matching map pin; chip toggle updates the Analyze cards; Export unchanged.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin compcat-restructure-slice2
gh pr create --title "feat(drawer): three-tab drawer - Analyze default, place chip strip + manage modal (slice 2)" --body "$(cat <<'EOF'
Slice 2 of the CompCat resurface (spec: docs/superpowers/specs/2026-07-13-compcat-resurface-design.md §4; slice 1 = #137).

- Tab bar is now Analyze · Compare · Export; Analyze is the default tab
- Places is no longer a tab: saved places render as identity-lettered toggle chips atop Analyze/Compare (hover-synced with map pins), with a trailing "Add" chip
- ManagePlacesModal hosts the relocated place list (select/delete), drawer search, drop-pin, and the Manual/Bulk CSV/Upload flows; Manual/Bulk submits land on the Manage view
- Pin-draft and lookup flows retarget to Analyze; the manualEntry landing dead-end is gone
- Share links and assistant tab effects only ever used analyze/compare - no migration needed

No backend changes. `make test-all` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; user squash-merges. Follow-up candidate after this ships (not in scope): "analysis greets you on load" — auto-run for saved places so first paint shows verdicts.
