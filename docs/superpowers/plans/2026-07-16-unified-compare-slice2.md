# Unified Compare surface — Slice 2 (Unify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Analyze/Compare split into one surface named Compare: one address list (1–10, saved or ad-hoc), one run, one panel whose results scale with list size; tabs become Compare + Export.

**Architecture:** Evolve `useCompareSet` into the single address list (`AddressEntry` gains `savedPlaceId?`; seeded from the persisted saved selection; write-through persistence of its saved ids). Extend `useCompare` into the single run hook (always-points payloads; parallel `neighborhood` + `incidents` always, `compare` at N≥2, plus a `place_ids` `analyzePlaces` refresh when saved entries are present so saved-place summaries/map rings stay fresh; results carry a `runPoints` snapshot so expansions never drift from the run). Rebuild `CompareTab` as the unified panel (absorbs AnalyzeTab's querybar, layer notes, incident disclosure, and N=1 full-width module path; wires locator/hover/fly-to into expansions). Rewrite `MapWorkspace` around the one list (deleting `sharedPoints`/`lookupPoint`/`selectedIds`-driven `selected` synthesis), collapse `TabKey`, migrate the share-link codec (no `tab` discriminator; legacy links decode) and the assistant bridge. Delete `AnalyzeTab` (PairwiseSection and the compare bridge die with it).

**Tech Stack:** React + TypeScript + Vite, Vitest (`npx vitest run --environment jsdom`), `npm run lint` (tsc -b). Frontend commands from `frontend/`; git from the worktree root (shell cwd resets — re-cd every command).

**Working context:** Worktree `/Users/jscocca/Repos/compcat/.worktrees/unified-compare-surface`, branch `jcscocca/claude/unified-compare-slice2` (off merged main `f457201`). Spec: `docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md`. Single PR gated on `make test-all` from the worktree root.

**Standing rule:** every user-facing string stays in reported-incident-rate vocabulary — never `safe/unsafe/safety/danger/dangerous/risk/risky`.

**Deliberate behavior decisions (spec deltas are recorded in Task 8):**
1. **Auto-run policy:** seeding events auto-run (persisted-selection restore, share link, landing lookup). Manual list edits and analysis-control changes invalidate results and wait for the Run button. This REMOVES today's "points-subject re-runs on控 controls change" special case (lookup/shared views) — one rule for everyone.
2. **Saved-place summaries:** the unified run always sends `points`, but additionally fires `analyzePlaces({ place_ids })` for the list's saved entries — the points path never persists `crime_summaries`, and the map's per-place radius rings read them from `GET /dashboard/summary`.
3. **Adaptive CTA** ("Run analysis" at ≤1 / "Compare N addresses" at ≥2) is pulled forward from slice 3 — the querybar is being rebuilt anyway.
4. `PlaceContextCard`'s section `aria-label` becomes "Context for X" (it renders under a ranking; "Verdict" read as a judgment header).

**Verified wire/code facts this plan relies on:**
- `DashboardAnalyzeRequest`/`DashboardCompareRequest` accept exactly one of `place_ids` | `points` (≤10). Points path synthesizes non-persisted clusters in input order; `place_ids` path persists `crime_summaries` (the rings' data source).
- `getIncidentDetails(payload)` takes the analyze payload shape (`radii_m` array) and returns `IncidentDetailsResponse` (`frontend/src/api/client.ts:144-151`).
- `usePersistedSelection` (`frontend/src/lib/usePersistedSelection.ts`) restores `compcat.selection` (saved-place ids) once places arrive, falling back to ALL places; `restored` flips true after.
- `interpretToolResult` (`frontend/src/lib/assistantBridge.ts`) maps assistant tools to `AssistantToolEffect`; `add_place` results carry the full created place object (id + coords + label).
- `useCompareSet.add` normalizes coords to 3 decimals so `keyOf` matches the backend's privacy-generalized saved coords.
- MapCanvas renders pins only from `places` + `selectedIds` (`frontend/src/components/MapCanvas.tsx:124-135`) — ad-hoc entries have never had pins (lookup shows the draft marker instead). Slice 2 keeps that parity; pins-for-ad-hoc is slice-3 polish.

---

## Task 1: Share-link codec — drop the tab discriminator, keep decoding legacy links

**Files:**
- Modify: `frontend/src/lib/savedView.ts`
- Modify: `frontend/src/lib/savedView.test.ts`
- Modify: `frontend/src/components/MapWorkspace.tsx` (three call-site fixes, Step 4)
- Modify: `frontend/src/components/MapWorkspace.test.tsx` (drop `tab:` from its three `encodeView({...})` fixture literals — they exercise current-format links; legacy-format coverage lives in `savedView.test.ts` and Task 6)

- [ ] **Step 1: Extend the tests (fail first)**

In `frontend/src/lib/savedView.test.ts`, first read the existing file. Update every construction of a `SavedView` literal to drop the `tab:` field (TypeScript will enforce this after Step 3), and add these tests to the existing describe block:

```ts
  it("encodes without a tab discriminator", () => {
    const encoded = encodeView({
      points: [{ latitude: 47.6, longitude: -122.33, label: "Home" }],
      radiusM: 250, startDate: "2026-01-01", endDate: "2026-06-30",
      layer: "reported", offenseCategory: "",
    });
    const wire = JSON.parse(
      decodeURIComponent(escape(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")))),
    );
    expect(wire.t).toBeUndefined();
    expect(wire.pts).toHaveLength(1);
  });

  it("decodes a legacy tab=analyze link onto the unified view", () => {
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "analyze", r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "Home" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const view = decodeView(legacy);
    expect(view).not.toBeNull();
    expect(view!.points[0].label).toBe("Home");
  });

  it("decodes a legacy tab=compare link onto the unified view", () => {
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "compare", r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "A" }, { y: 47.61, x: -122.34, l: "B" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const view = decodeView(legacy);
    expect(view).not.toBeNull();
    expect(view!.points).toHaveLength(2);
  });

  it("still rejects wire garbage (unknown t value)", () => {
    const bad = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "bogus", r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "Home" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeView(bad)).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failures**

Run: `cd frontend && npx vitest run src/lib/savedView.test.ts --environment jsdom`
Expected: FAIL (encode still emits `t`; type errors on dropped `tab:` fields).

- [ ] **Step 3: Implement the codec change**

In `frontend/src/lib/savedView.ts`:

1. Delete the `export type ViewTab = "analyze" | "compare";` line (line 3).
2. Change `PointsSavedView` to drop the tab field — replace:

```ts
export interface PointsSavedView extends SharedViewFields {
  tab: "analyze" | "compare";
  points: ViewPoint[];
  offenseCategory: string;
}
```

with:

```ts
export interface PointsSavedView extends SharedViewFields {
  points: ViewPoint[];
  offenseCategory: string;
}
```

3. In `encodeView`, replace the `base` line with (drop `t`):

```ts
  const base = { v: VERSION, r: view.radiusM, s: view.startDate, e: view.endDate, ly: view.layer };
```

4. In `decodeView`, replace the tab guard line `if (wire.t !== "analyze" && wire.t !== "compare") return null;` with (legacy links carry `t`; tolerate known values, reject garbage so corrupted params don't half-decode):

```ts
    if (wire.t !== undefined && wire.t !== "analyze" && wire.t !== "compare") return null;
```

5. In `decodeView`'s returned object, delete the `tab: wire.t,` line.

- [ ] **Step 4: Run to verify pass; check remaining consumers still compile**

Run: `cd frontend && npx vitest run src/lib/savedView.test.ts --environment jsdom`
Expected: PASS.
Run: `cd frontend && npm run lint`
Expected: **ERRORS in `MapWorkspace.tsx`** (it still passes/reads `tab`). Fix ONLY the minimal call sites now so the tree stays green (the full rewrite comes in Task 5):
- `MapWorkspace.tsx:50`: change `useState<TabKey>(initialView?.tab ?? "analyze")` → `useState<TabKey>(initialView ? "compare" : "analyze")` (any shared link lands on Compare — both legacy kinds carry points the compare surface renders).
- `MapWorkspace.tsx:149-154` (the run-once effect): replace the two-branch dispatch with:

```tsx
  useEffect(() => {
    if (!initialView) return;
    if (initialView.points.length >= 2) void compare.runCompare();
    else void analyze.runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

  and change the initial-tab line above accordingly: a 1-point legacy link should land on `"analyze"`, 2+ on `"compare"` — so make the `useState` initializer: `useState<TabKey>(initialView ? (initialView.points.length >= 2 ? "compare" : "analyze") : "analyze")`.
- `MapWorkspace.tsx:352-356` (`buildShareUrl`): remove `tab,` from the `encodeView({...})` object literal. Keep the function's `tab` parameter for now (it still selects which points to encode); Task 5 removes it.

Re-run `npm run lint` → clean. Run the two workspace suites: `npx vitest run src/components/MapWorkspace.test.tsx src/App.test.tsx --environment jsdom` → PASS (shared-view tests exercise decode+auto-run, unchanged behavior for 1-point analyze links and 2-point compare links).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/savedView.ts frontend/src/lib/savedView.test.ts frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(share): tab-free share links; legacy analyze/compare links decode onto one surface"
```

---

## Task 2: The single address list — `useAddressList` (evolved `useCompareSet`)

The list becomes the app's one selection source: entries are `{ latitude, longitude, label, savedPlaceId? }`. It seeds once from the persisted saved selection (so "analysis greets you" still works), persists its saved ids write-through, and supports ad-hoc adds, saved toggles, removals, and wholesale replacement (share links, lookup, assistant).

**Files:**
- Modify: `frontend/src/lib/useCompareSet.ts` (full replacement below — same file, richer API; old exports kept as aliases until Task 7)
- Modify: `frontend/src/lib/useCompareSet.test.ts` (full replacement below)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `frontend/src/lib/useCompareSet.test.ts` with:

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddressList, keyOf, MAX_ADDRESSES, entriesFromPlaces } from "./useCompareSet";
import type { Place } from "../types";

const place = (id: string, label: string, lat: number, lng: number): Place => ({
  id, display_label: label, latitude: lat, longitude: lng, visit_count: 1,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
});
const home = place("p1", "Home", 47.61, -122.33);
const work = place("p2", "Work", 47.62, -122.34);

const persistSpy = vi.fn();

beforeEach(() => {
  localStorage.clear();
  persistSpy.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("useAddressList", () => {
  it("seeds once from the provided saved places and reports their ids", () => {
    const { result } = renderHook(() => useAddressList({ seed: [home, work], onSavedIdsChange: persistSpy }));
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({ label: "Home", savedPlaceId: "p1" });
    expect(result.current.savedIds()).toEqual(["p1", "p2"]);
  });

  it("re-seeds when the seed changes until the first manual edit, then stays put", () => {
    const { result, rerender } = renderHook(({ seed }) => useAddressList({ seed, onSavedIdsChange: persistSpy }), {
      initialProps: { seed: [home] },
    });
    rerender({ seed: [home, work] });
    expect(result.current.entries).toHaveLength(2);
    act(() => result.current.add({ latitude: 47.7, longitude: -122.3, label: "Adhoc" }));
    rerender({ seed: [home] });
    expect(result.current.entries).toHaveLength(3);
  });

  it("add() normalizes coords to 3 decimals and dedupes by keyOf, capped at MAX", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.add({ latitude: 47.6123456, longitude: -122.334567, label: "A" }));
    act(() => result.current.add({ latitude: 47.6123999, longitude: -122.334999, label: "A dup" }));
    expect(result.current.entries).toHaveLength(2 - 1);
    expect(result.current.entries[0].latitude).toBe(47.612);
    for (let i = 0; i < MAX_ADDRESSES + 3; i += 1) {
      act(() => result.current.add({ latitude: 47.0 + i * 0.01, longitude: -122.0, label: `P${i}` }));
    }
    expect(result.current.entries.length).toBeLessThanOrEqual(MAX_ADDRESSES);
  });

  it("toggleSaved adds a saved place as an entry and removes it on second call", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.toggleSaved(home));
    expect(result.current.entries[0]).toMatchObject({ savedPlaceId: "p1", label: "Home" });
    act(() => result.current.toggleSaved(home));
    expect(result.current.entries).toHaveLength(0);
  });

  it("replaceAll swaps the whole list and counts as an edit", () => {
    const { result, rerender } = renderHook(({ seed }) => useAddressList({ seed, onSavedIdsChange: persistSpy }), {
      initialProps: { seed: [home] },
    });
    act(() => result.current.replaceAll([{ latitude: 47.65, longitude: -122.3, label: "Shared A" }]));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].label).toBe("Shared A");
    rerender({ seed: [home, work] });
    expect(result.current.entries).toHaveLength(1);
  });

  it("notifies onSavedIdsChange with the saved ids present after each change (post-seed)", () => {
    const { result } = renderHook(() => useAddressList({ seed: [home], onSavedIdsChange: persistSpy }));
    act(() => result.current.toggleSaved(work));
    expect(persistSpy).toHaveBeenLastCalledWith(["p1", "p2"]);
    act(() => result.current.removeAt(0));
    expect(persistSpy).toHaveBeenLastCalledWith(["p2"]);
  });

  it("markSaved upgrades a matching ad-hoc entry in place (opt-in Save flow)", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.add({ latitude: 47.61, longitude: -122.33, label: "Home" }));
    act(() => result.current.markSaved(keyOf(result.current.entries[0]), "p1"));
    expect(result.current.entries[0].savedPlaceId).toBe("p1");
  });

  it("entriesFromPlaces drops null coords and caps", () => {
    const noCoords: Place = { ...home, id: "p9", latitude: null, longitude: null };
    expect(entriesFromPlaces([home, noCoords, work])).toHaveLength(2);
  });
});
```

Note the deliberate `toHaveLength(2 - 1)` in the dedupe test — both points round to the same 3-decimal key, so one entry results.

- [ ] **Step 2: Run to verify failures**

Run: `cd frontend && npx vitest run src/lib/useCompareSet.test.ts --environment jsdom`
Expected: FAIL — `useAddressList` not exported.

- [ ] **Step 3: Implement**

Replace the entire contents of `frontend/src/lib/useCompareSet.ts` with:

```ts
import { useEffect, useRef, useState } from "react";

import type { Place } from "../types";

export type AddressEntry = {
  latitude: number;
  longitude: number;
  label: string;
  /** Present when this entry is one of the user's saved places. */
  savedPlaceId?: string;
};

export const MAX_ADDRESSES = 10;

/** @deprecated slice-2 transition aliases — removed in the cleanup task. */
export type ComparePoint = AddressEntry;
export const MAX_COMPARE_POINTS = MAX_ADDRESSES;

export interface AddressList {
  entries: AddressEntry[];
  add: (entry: AddressEntry) => void;
  removeAt: (index: number) => void;
  /** Add the saved place as an entry, or remove its entry if present. */
  toggleSaved: (place: Place) => void;
  /** Swap the whole list (share links, lookup, assistant). Counts as an edit. */
  replaceAll: (entries: AddressEntry[]) => void;
  /** Stamp a savedPlaceId onto the entry matching keyOf (opt-in Save flow). */
  markSaved: (key: string, savedPlaceId: string) => void;
  /** Saved-place ids currently in the list, in list order. */
  savedIds: () => string[];
}

export function keyOf(p: { latitude: number; longitude: number }): string {
  return `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
}

function normalize(entry: AddressEntry): AddressEntry {
  // Backend generalizes saved coords to ~3 decimals for privacy; normalizing here keeps
  // keyOf matches (Saved badges, dedupe) stable across the save round-trip.
  return { ...entry, latitude: Number(entry.latitude.toFixed(3)), longitude: Number(entry.longitude.toFixed(3)) };
}

function dedupeCap(entries: AddressEntry[]): AddressEntry[] {
  const seen = new Set<string>();
  const out: AddressEntry[] = [];
  for (const e of entries) {
    const k = keyOf(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= MAX_ADDRESSES) break;
  }
  return out;
}

/** Convert saved places to entries, dropping null coords, de-duped and capped. */
export function entriesFromPlaces(places: Place[]): AddressEntry[] {
  const entries: AddressEntry[] = [];
  for (const place of places) {
    if (place.latitude == null || place.longitude == null) continue;
    entries.push({ latitude: place.latitude, longitude: place.longitude, label: place.display_label, savedPlaceId: place.id });
  }
  return dedupeCap(entries);
}

/** @deprecated transition alias — removed in the cleanup task. */
export const pointsFromPlaces = entriesFromPlaces;

interface AddressListDeps {
  /** Saved places to seed from (the restored persisted selection). Re-seeds until the first edit. */
  seed: Place[];
  /** Called with the list's saved ids after every post-seed change (selection persistence). */
  onSavedIdsChange?: (ids: string[]) => void;
}

/**
 * The workspace's single address list (1–MAX_ADDRESSES entries, saved or ad-hoc). Seeds
 * synchronously from the restored saved selection and re-seeds on seed changes until the
 * user's first manual edit — after that the list is theirs. Saved ids are reported
 * outward on every change so the returning-session selection stays persisted.
 */
function sameEntries(a: AddressEntry[], b: AddressEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => keyOf(e) === keyOf(b[i]) && e.label === b[i].label && e.savedPlaceId === b[i].savedPlaceId);
}

export function useAddressList({ seed, onSavedIdsChange }: AddressListDeps): AddressList {
  const editedRef = useRef(false);
  const [entries, setEntries] = useState<AddressEntry[]>(() => entriesFromPlaces(seed));

  // Re-seed (content-compared, so identical seeds don't churn renders) until first edit.
  useEffect(() => {
    if (editedRef.current) return;
    setEntries((cur) => {
      const next = entriesFromPlaces(seed);
      return sameEntries(cur, next) ? cur : next;
    });
  }, [seed]);

  // Notify saved-id changes from an effect (functional updaters below can't call out),
  // deduped so persistence writes only when membership actually changed.
  const onSavedIdsChangeRef = useRef(onSavedIdsChange);
  onSavedIdsChangeRef.current = onSavedIdsChange;
  const lastSavedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const ids = entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
    const key = ids.join("|");
    if (key === lastSavedKeyRef.current) return;
    lastSavedKeyRef.current = key;
    onSavedIdsChangeRef.current?.(ids);
  }, [entries]);

  // All mutations use functional updates so same-tick batches (bulk import, multi-id
  // selection) compose instead of clobbering each other.
  function add(entry: AddressEntry) {
    editedRef.current = true;
    setEntries((cur) => dedupeCap([...cur, normalize(entry)]));
  }

  function removeAt(index: number) {
    editedRef.current = true;
    setEntries((cur) => cur.filter((_, i) => i !== index));
  }

  function toggleSaved(place: Place) {
    if (place.latitude == null || place.longitude == null) return;
    editedRef.current = true;
    setEntries((cur) => {
      const existing = cur.findIndex((e) => e.savedPlaceId === place.id);
      if (existing >= 0) return cur.filter((_, i) => i !== existing);
      return dedupeCap([...cur, { latitude: place.latitude as number, longitude: place.longitude as number, label: place.display_label, savedPlaceId: place.id }]);
    });
  }

  function replaceAll(next: AddressEntry[]) {
    editedRef.current = true;
    setEntries(dedupeCap(next.map(normalize)));
  }

  function markSaved(key: string, savedPlaceId: string) {
    setEntries((cur) => cur.map((e) => (keyOf(e) === key ? { ...e, savedPlaceId } : e)));
  }

  function savedIds() {
    return entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
  }

  return { entries, add, removeAt, toggleSaved, replaceAll, markSaved, savedIds };
}

/**
 * @deprecated slice-2 transition shim for the old CompareSet consumers; removed in the
 * cleanup task once MapWorkspace is on useAddressList.
 */
export interface CompareSet {
  points: AddressEntry[];
  add: (point: AddressEntry) => void;
  removeAt: (index: number) => void;
}

/** @deprecated transition shim — removed in the cleanup task. */
export function useCompareSet(seed: Place[]): CompareSet {
  const list = useAddressList({ seed });
  return { points: list.entries, add: list.add, removeAt: list.removeAt };
}
```

- [ ] **Step 4: Run the hook tests + the full suite**

Run: `cd frontend && npx vitest run src/lib/useCompareSet.test.ts --environment jsdom`
Expected: PASS (8 tests).
Run: `cd frontend && npx vitest run --environment jsdom && npm run lint`
Expected: all green — the deprecated shims keep `MapWorkspace`/`CompareTab` compiling unchanged. (The old `useCompareSet` behavior tests were replaced wholesale; the shim is exercised through `MapWorkspace.test.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useCompareSet.ts frontend/src/lib/useCompareSet.test.ts
git commit -m "feat(compare): single address list hook (saved + ad-hoc entries, persistence callback)"
```

---

## Task 3: The single run hook — extend `useCompare`

One run for the whole surface: always-points `neighborhood` + `incidents` (N≥1), `compare` only at N≥2, an additional `place_ids` `analyzePlaces` for saved entries (summaries/rings), one version guard around ALL result writes including `running`, and a `runPoints` snapshot so downstream rendering (expansion coords, letters) reflects the run rather than the live list. `applyAssistant` grows to cover both payload kinds (it replaces `useAnalyze.applyAssistant` in Task 5).

**Files:**
- Modify: `frontend/src/lib/useCompare.ts` (full replacement below)
- Modify: `frontend/src/lib/useCompare.test.ts` (full replacement below)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `frontend/src/lib/useCompare.test.ts` with:

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

vi.mock("../api/client", () => ({
  analyzePlaces: vi.fn().mockResolvedValue({ summary_count: 1 }),
  comparePlaces: vi.fn().mockResolvedValue({ id: "cmp" } as unknown),
  getIncidentDetails: vi.fn().mockResolvedValue({ incidents: [], total_count: 0, returned_count: 0, radius_m: 250 } as unknown),
  getNeighborhoodAnalysis: vi.fn().mockResolvedValue({ places: [] } as unknown),
}));
import { analyzePlaces, comparePlaces, getIncidentDetails, getNeighborhoodAnalysis } from "../api/client";

const analysis = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 250, offenseCategory: "", layer: "reported" as const };
const A = { latitude: 47.61, longitude: -122.34, label: "A" };
const B = { latitude: 47.62, longitude: -122.33, label: "B", savedPlaceId: "p2" };

function mock(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>;
}

afterEach(() => vi.clearAllMocks());

describe("useCompare unified run", () => {
  it("N=1: fetches neighborhood + incidents with points, skips compare", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({ points: [expect.objectContaining({ label: "A" })], radii_m: [250] }));
    expect(getIncidentDetails).toHaveBeenCalledWith(expect.objectContaining({ radii_m: [250] }));
    expect(comparePlaces).not.toHaveBeenCalled();
    expect(result.current.neighborhood).toEqual({ places: [] });
    expect(result.current.incidents).toEqual(expect.objectContaining({ total_count: 0 }));
    expect(result.current.comparison).toBeNull();
    expect(result.current.runPoints).toEqual([expect.objectContaining({ label: "A" })]);
  });

  it("N=2: adds the compare call; payloads share points, radius fields differ per endpoint", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({ radius_m: 250 }));
    expect(mock(comparePlaces).mock.calls[0][0].radii_m).toBeUndefined();
    expect(mock(getNeighborhoodAnalysis).mock.calls[0][0].radius_m).toBeUndefined();
    expect(result.current.comparison).toEqual({ id: "cmp" });
  });

  it("refreshes saved-place summaries via place_ids when saved entries exist", async () => {
    const onSummariesRefreshed = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn(), onSummariesRefreshed }));
    await act(async () => { await result.current.run(); });
    expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({ place_ids: ["p2"] }));
    expect(mock(analyzePlaces).mock.calls[0][0].points).toBeUndefined();
    expect(onSummariesRefreshed).toHaveBeenCalled();
  });

  it("skips the place_ids refresh when the list is all ad-hoc", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(analyzePlaces).not.toHaveBeenCalled();
  });

  it("caps >120-char labels in the POSTed points", async () => {
    const longLabel = "A".repeat(140);
    const { result } = renderHook(() => useCompare({ entries: [{ ...A, label: longLabel }], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(mock(getNeighborhoodAnalysis).mock.calls[0][0].points[0].label).toHaveLength(120);
  });

  it("neighborhood failure alone degrades without an error; incidents survive", async () => {
    mock(getNeighborhoodAnalysis).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError }));
    await act(async () => { await result.current.run(); });
    expect(result.current.neighborhood).toBeNull();
    expect(result.current.comparison).toEqual({ id: "cmp" });
    expect(result.current.incidents).not.toBeNull();
    expect(setError).not.toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("N≥2 compare failure sets the error and clears the comparison", async () => {
    mock(comparePlaces).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError }));
    await act(async () => { await result.current.run(); });
    expect(result.current.comparison).toBeNull();
    expect(setError).toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("N=1 neighborhood failure sets the error (it is the primary payload)", async () => {
    mock(getNeighborhoodAnalysis).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError }));
    await act(async () => { await result.current.run(); });
    expect(setError).toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("invalidate clears every result slice including runPoints", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    act(() => { result.current.invalidate(); });
    expect(result.current.comparison).toBeNull();
    expect(result.current.neighborhood).toBeNull();
    expect(result.current.incidents).toBeNull();
    expect(result.current.runPoints).toBeNull();
  });

  it("applyAssistant(comparison) replaces the pane and clears the other slices", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    act(() => { result.current.applyAssistant({ comparison: { id: "c9" } as never }); });
    expect(result.current.comparison).toEqual({ id: "c9" });
    expect(result.current.neighborhood).toBeNull();
    expect(result.current.runPoints).toBeNull();
  });

  it("applyAssistant(neighborhood/incidents) replaces those panes and clears the comparison", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    act(() => { result.current.applyAssistant({ neighborhood: { places: [] } as never, incidents: null }); });
    expect(result.current.neighborhood).toEqual({ places: [] });
    expect(result.current.comparison).toBeNull();
  });

  it("a stale run cannot overwrite results after invalidate", async () => {
    let release: (v: unknown) => void = () => {};
    mock(getNeighborhoodAnalysis).mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn() }));
    let pending: Promise<void>;
    act(() => { pending = result.current.run(); });
    act(() => { result.current.invalidate(); });
    await act(async () => { release({ places: ["stale"] }); await pending!; });
    expect(result.current.neighborhood).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `cd frontend && npx vitest run src/lib/useCompare.test.ts --environment jsdom`
Expected: FAIL — the hook's deps/interface don't exist yet (`entries`, `run`, `incidents`, …).

- [ ] **Step 3: Implement**

Replace the entire contents of `frontend/src/lib/useCompare.ts` with:

```ts
import { useRef, useState } from "react";

import { analyzePlaces, comparePlaces, getIncidentDetails, getNeighborhoodAnalysis } from "../api/client";
import type { AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, SiteComparison } from "../types";
import type { AddressEntry } from "./useCompareSet";

export interface CompareController {
  running: boolean;
  /** Cross-address ranking; null below two entries or when the compare call failed. */
  comparison: SiteComparison | null;
  /** Per-address neighborhood context; null when unavailable. */
  neighborhood: NeighborhoodAnalysis | null;
  /** Combined incident disclosure rows for the whole list; null when unavailable. */
  incidents: IncidentDetailsResponse | null;
  /** Snapshot of the points the current results were computed from (expansion coords,
   * letters). Null when no results are on screen. */
  runPoints: AddressEntry[] | null;
  run: () => Promise<void>;
  /** Drop in-flight + current results (list or analysis controls changed). */
  invalidate: () => void;
  /** Apply analyst-provided slices directly (no re-fetch). The applied slice becomes the
   * source of truth; the other pane is cleared, and runPoints resets (assistant results
   * are keyed to saved-place selections, not this list's snapshot). */
  applyAssistant: (next: {
    comparison?: SiteComparison | null;
    neighborhood?: NeighborhoodAnalysis | null;
    incidents?: IncidentDetailsResponse | null;
  }) => void;
}

interface CompareDeps {
  entries: AddressEntry[];
  analysis: AnalysisSettings;
  setError: (message: string) => void;
  /** Called after a successful saved-place summary refresh (place_ids analyze path). */
  onSummariesRefreshed?: () => void;
}

const RUN_ERROR = "Unable to run this analysis. Try again.";

/**
 * The unified surface's single run: neighborhood + incident details for every entry
 * (always via inline points), the cross-address comparison at 2+, and — when the list
 * contains saved places — a place_ids analyze pass so persisted crime summaries (map
 * rings, dashboard totals) stay fresh. All calls run in parallel and fail independently;
 * the primary payload (comparison at 2+, neighborhood at 1) failing is the run error.
 * One version ref gates every result write, including `running`.
 */
export function useCompare({ entries, analysis, setError, onSummariesRefreshed }: CompareDeps): CompareController {
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<SiteComparison | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodAnalysis | null>(null);
  const [incidents, setIncidents] = useState<IncidentDetailsResponse | null>(null);
  const [runPoints, setRunPoints] = useState<AddressEntry[] | null>(null);
  const versionRef = useRef(0);

  function invalidate() {
    versionRef.current += 1;
    setComparison(null);
    setNeighborhood(null);
    setIncidents(null);
    setRunPoints(null);
    setRunning(false);
  }

  async function run() {
    if (entries.length < 1) return;
    setError("");
    setRunning(true);
    const version = versionRef.current + 1;
    versionRef.current = version;
    const snapshot = entries.map((e) => ({ ...e, label: e.label.slice(0, 120) }));
    const points = snapshot.map(({ latitude, longitude, label }) => ({ latitude, longitude, label }));
    const savedIds = snapshot.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
    const shared = {
      analysis_start_date: analysis.startDate,
      analysis_end_date: analysis.endDate,
      offense_category: analysis.offenseCategory || null,
      layer: analysis.layer,
    };
    const analyzePayload = { points, ...shared, radii_m: [analysis.radiusM] };
    const wantCompare = snapshot.length >= 2;

    const [neighborhoodResult, incidentsResult, compareResult, summariesResult] = await Promise.allSettled([
      getNeighborhoodAnalysis(analyzePayload),
      getIncidentDetails(analyzePayload),
      wantCompare
        ? comparePlaces({ points, ...shared, radius_m: analysis.radiusM })
        : Promise.resolve(null),
      savedIds.length > 0
        ? analyzePlaces({ place_ids: savedIds, ...shared, radii_m: [analysis.radiusM] })
        : Promise.resolve(null),
    ]);

    if (versionRef.current === version) {
      setNeighborhood(neighborhoodResult.status === "fulfilled" ? neighborhoodResult.value : null);
      setIncidents(incidentsResult.status === "fulfilled" ? incidentsResult.value : null);
      setComparison(compareResult.status === "fulfilled" ? compareResult.value : null);
      setRunPoints(snapshot);
      const primaryFailed = wantCompare
        ? compareResult.status === "rejected"
        : neighborhoodResult.status === "rejected";
      if (primaryFailed) setError(RUN_ERROR);
      if (summariesResult.status === "fulfilled" && summariesResult.value !== null) onSummariesRefreshed?.();
      setRunning(false);
    }
  }

  function applyAssistant(next: {
    comparison?: SiteComparison | null;
    neighborhood?: NeighborhoodAnalysis | null;
    incidents?: IncidentDetailsResponse | null;
  }) {
    versionRef.current += 1;
    if (next.comparison !== undefined) {
      setComparison(next.comparison);
      setNeighborhood(null);
      setIncidents(null);
    }
    if (next.neighborhood !== undefined || next.incidents !== undefined) {
      setComparison(null);
      if (next.neighborhood !== undefined) setNeighborhood(next.neighborhood);
      if (next.incidents !== undefined) setIncidents(next.incidents);
    }
    setRunPoints(null);
    setRunning(false);
  }

  return { running, comparison, neighborhood, incidents, runPoints, run, invalidate, applyAssistant };
}
```

- [ ] **Step 4: Run hook tests, then check consumers**

Run: `cd frontend && npx vitest run src/lib/useCompare.test.ts --environment jsdom`
Expected: PASS (13 tests).
Run: `cd frontend && npm run lint`
Expected: **ERRORS in `MapWorkspace.tsx`** (old `useCompare({selectedIds, …, points})` deps and `runCompare`/`neighborhood` reads). Apply the minimal bridge at the two call sites so the tree stays green until Task 5:

- `MapWorkspace.tsx:136`: replace the `useCompare(...)` line with:

```tsx
  const compare = useCompare({ entries: compareSet.points, analysis, setError: data.setError });
```

- In the shared-view run-once effect (Task 1 rewrote it): change `compare.runCompare()` → `compare.run()`.
- `<CompareTab ... onRun={compare.runCompare}` → `onRun={compare.run}`.
- `applyAssistantToolResult`: change `compare.applyAssistant(effect.comparison)` → `compare.applyAssistant({ comparison: effect.comparison })`.

Run: `cd frontend && npx vitest run --environment jsdom && npm run lint`
Expected: all green (CompareTab renders from `comparison`/`neighborhood` which kept their names; `MapWorkspace.test` mocks the api client module, which now also needs `getIncidentDetails`/`getNeighborhoodAnalysis` present — they already are, from the slice-1 era mock; if the suite reports a missing mock export, add `getIncidentDetails: vi.fn().mockResolvedValue({ incidents: [], total_count: 0, returned_count: 0, radius_m: 250 })` to the `vi.mock("../api/client", ...)` factory in `MapWorkspace.test.tsx`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/useCompare.ts frontend/src/lib/useCompare.test.ts frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(compare): one run — neighborhood + incidents always, compare at 2+, saved summaries refresh"
```

---

## Task 4: The unified panel — rebuild `CompareTab`, lift the incident section, retitle the module

`CompareTab` becomes the whole surface: address list + querybar controls + adaptive CTA, layer notes, results that scale with the run (N=1 → full-width `PlaceContextCard` with locator/hover/fly-to; N≥2 → callout + spine with fully-wired expansions), the combined incident disclosure, caveat, methods. `AnalyzeTab` keeps rendering unchanged until Task 5 removes it (its incident components are LIFTED — copied, not moved — so both compile).

**Files:**
- Create: `frontend/src/components/IncidentDetailsSection.tsx` (lift from `AnalyzeTab.tsx`)
- Modify: `frontend/src/components/PlaceContextCard.tsx` (one line: aria-label)
- Modify: `frontend/src/components/PlaceContextCard.test.tsx` (one line)
- Modify: `frontend/src/components/CompareTab.tsx` (full replacement below)
- Modify: `frontend/src/components/CompareTab.test.tsx` (full replacement below)
- Modify: `frontend/src/components/MapWorkspace.tsx` (mount-site props)
- Modify: `frontend/src/components/AnalyzeTab.test.tsx` (two aria-label assertions)

- [ ] **Step 1: Lift the incident section into its own component**

Create `frontend/src/components/IncidentDetailsSection.tsx`. Copy — verbatim — from `frontend/src/components/AnalyzeTab.tsx` the four helpers `incidentCategoryLabel`, `incidentSubtypeLabel`, `incidentIdentifier`, `formatIncidentTime`, plus `formatDistanceMeters`, `IncidentDetailsTable`, and `IncidentDetailsCards` (current lines 66-214), with this file header and exported wrapper appended:

```tsx
import type { IncidentDetail, IncidentDetailsResponse } from "../types";
import { formatIncidentAddress, titleCase } from "../lib/addressLabel";
import { countNoun, type IncidentNoun } from "../lib/layerCopy";
```

…(the seven lifted definitions, unchanged, module-private)…

```tsx
export function IncidentDetailsSection({ details, noun, layout, showCategory, subcategoryHeader }: {
  details: IncidentDetailsResponse | null | undefined;
  noun: IncidentNoun;
  layout: "table" | "cards";
  showCategory: boolean;
  subcategoryHeader: string;
}) {
  if (!details) return null;
  const body = layout === "table" ? (
    <IncidentDetailsTable details={details} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
  ) : (
    <IncidentDetailsCards details={details} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
  );
  if (details.incidents.length > 0) {
    return (
      <details className="mc-incident-reveal">
        <summary>See the {details.total_count} {countNoun(noun, details.total_count)}</summary>
        {body}
      </details>
    );
  }
  return body;
}
```

- [ ] **Step 2: Retitle the module's landmark**

In `frontend/src/components/PlaceContextCard.tsx`, change the section's `aria-label={`Verdict for ${place.place_label}`}` to `aria-label={`Context for ${place.place_label}`}` (the module now renders under a ranking; "Verdict" read as a judgment header — the headline copy itself is unchanged).

Matching assertion updates:
- `frontend/src/components/PlaceContextCard.test.tsx`: `getByLabelText("Verdict for Home")` → `getByLabelText("Context for Home")`.
- `frontend/src/components/AnalyzeTab.test.tsx`: update its two `/Verdict for/` label queries (currently lines ~166 and ~467) to `/Context for/`.

- [ ] **Step 3: Write the failing unified-panel tests**

Replace the entire contents of `frontend/src/components/CompareTab.test.tsx` with:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { GeocodingProvider } from "../lib/geocoding";
import type { AddressEntry } from "../lib/useCompareSet";
import { keyOf } from "../lib/useCompareSet";
import type { AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, NeighborhoodPlace, SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";

const provider: GeocodingProvider = { search: vi.fn().mockResolvedValue([]) };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY", layer: "reported" };
const entriesOf = (...labels: string[]): AddressEntry[] => labels.map((l, i) => ({ latitude: 47.6 + i * 0.01, longitude: -122.3 - i * 0.01, label: l }));

function opt(id: string, label: string, count: number, rate: number): SiteComparisonOption {
  return { id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate };
}
function pair(a: string, b: string, decision: SiteDecisionClass, winner: string | null): SitePairwiseResult {
  return { id: `${a}-${b}`, option_a_id: a, option_a_label: a, option_b_id: b, option_b_label: b, winner_option_id: winner, winner_label: winner, decision_class: decision, method: "quasipoisson", incident_count_a: 0, incident_count_b: 0, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days", rate_a: 0, rate_b: 0, rate_ratio: 0.38, ci_lower: 0.2, ci_upper: 0.71, p_value: 0.001, adjusted_p_value: 0.004, overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "" };
}
const clearSweep: SiteComparison = {
  id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
  offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
  overview: { label: "Overview", decision_class: "statistically_lower", recommendation_option_id: "a", recommendation_label: "Pike", summary_text: "", caveat_text: "cav", options: [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 44, 14.3)] },
  analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options: [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 44, 14.3)], pairwise_results: [pair("a", "b", "statistically_lower", "a")] },
};

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
const twoPlaceNeighborhood: NeighborhoodAnalysis = {
  radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
  offense_category: null, pairwise: [], places: [contextPlace("n1", "Pike", 12), contextPlace("n2", "Bell", 44)],
};
const onePlaceNeighborhood: NeighborhoodAnalysis = { ...twoPlaceNeighborhood, places: [contextPlace("n1", "Pike", 12)] };
const incidents: IncidentDetailsResponse = {
  radius_m: 250, total_count: 2, returned_count: 2,
  incidents: [
    { place_id: "n1", place_label: "Pike", incident_id: "i1", external_incident_id: null, report_number: "R-1", occurred_at: "2026-03-01T10:00:00Z", reported_at: "2026-03-01T11:00:00Z", offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A", distance_m: 40, block_address: "500 BLOCK PIKE ST" },
    { place_id: "n2", place_label: "Bell", incident_id: "i2", external_incident_id: null, report_number: "R-2", occurred_at: "2026-03-02T10:00:00Z", reported_at: "2026-03-02T11:00:00Z", offense_category: "PERSON", offense_subcategory: "ASSAULT", nibrs_group: "A", distance_m: 60, block_address: "2200 BLOCK BELL ST" },
  ],
} as unknown as IncidentDetailsResponse;

afterEach(cleanup);

const base = {
  provider,
  onAddEntry: vi.fn(), onRemoveEntry: vi.fn(), onSaveEntry: vi.fn(),
  savedKeys: new Set<string>(),
  analysis, availableRadii: [250, 500], running: false,
  comparison: null as SiteComparison | null,
  neighborhood: null as NeighborhoodAnalysis | null,
  incidents: null as IncidentDetailsResponse | null,
  runPoints: null as AddressEntry[] | null,
  onChange: vi.fn(), onRun: vi.fn(),
};

describe("CompareTab (unified panel)", () => {
  it("empty list: invites adding an address; Run disabled", () => {
    render(<CompareTab {...base} entries={[]} />);
    expect(screen.getByText(/add at least one address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("one entry: CTA reads Run analysis and fires onRun", () => {
    const onRun = vi.fn();
    render(<CompareTab {...base} onRun={onRun} entries={entriesOf("Pike")} />);
    const cta = screen.getByRole("button", { name: /run analysis/i });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    expect(onRun).toHaveBeenCalled();
  });

  it("two entries: CTA adapts to Compare 2 addresses", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} />);
    expect(screen.getByRole("button", { name: /compare 2 addresses/i })).toBeInTheDocument();
  });

  it("querybar controls emit onChange patches", () => {
    const onChange = vi.fn();
    render(<CompareTab {...base} onChange={onChange} entries={entriesOf("Pike")} />);
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-02-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-02-01" });
  });

  it("N=1 result: renders the context module full-width (no spine)", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} incidents={incidents} />);
    expect(screen.getByLabelText("Context for Pike")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument();
  });

  it("N=2 result: callout + spine + expansions joined by index", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} />);
    expect(screen.getByText(/statistically lower than every other/i)).toBeInTheDocument();
    const ranked = screen.getByTestId("compare-ranked");
    expect(within(ranked).getAllByText("Full context")).toHaveLength(2);
    expect(within(ranked).getByText(/12 reported incidents within 250 m/)).toBeInTheDocument();
  });

  it("comparison without neighborhood: spine renders with the unavailable note", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} runPoints={entriesOf("Pike", "Bell")} />);
    expect(screen.getByText(/per-address context unavailable for this run/i)).toBeInTheDocument();
  });

  it("renders the combined incident disclosure from the incidents payload", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} incidents={incidents} />);
    fireEvent.click(screen.getByText(/see the 2 reported incidents/i));
    expect(screen.getByText("500 BLOCK PIKE ST")).toBeInTheDocument();
  });

  it("address rows: remove fires with the index; unsaved rows offer Save", () => {
    const onRemoveEntry = vi.fn();
    const onSaveEntry = vi.fn();
    const entries = entriesOf("Pike", "Bell");
    render(<CompareTab {...base} onRemoveEntry={onRemoveEntry} onSaveEntry={onSaveEntry} savedKeys={new Set([keyOf(entries[1])])} entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: /remove Pike/i }));
    expect(onRemoveEntry).toHaveBeenCalledWith(0);
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    expect(saveButtons).toHaveLength(1);
    fireEvent.click(saveButtons[0]);
    expect(onSaveEntry).toHaveBeenCalledWith(entries[0]);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows the calls layer note on the calls layer and hides the category chips", () => {
    render(<CompareTab {...base} analysis={{ ...analysis, layer: "calls" }} entries={entriesOf("Pike")} />);
    expect(screen.getByText(/requests for service/i)).toBeInTheDocument();
    expect(screen.queryByText("Incident categories")).not.toBeInTheDocument();
  });

  it("mobile: collapses the querybar to a summary once results exist; Adjust reopens", () => {
    render(<CompareTab {...base} isMobile entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} />);
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /adjust/i }));
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
  });

  it("running: shows skeletons, not results", () => {
    render(<CompareTab {...base} running entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} />);
    expect(screen.getByText(/running analysis/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Context for Pike")).not.toBeInTheDocument();
  });

  it("dynamic regions never emit safety-ranking vocabulary", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} incidents={incidents} />);
    const panel = screen.getByRole("tabpanel");
    const text = (panel.textContent ?? "").toLowerCase().replace("not a personal risk prediction", "");
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
```

- [ ] **Step 4: Run to verify failures**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx --environment jsdom`
Expected: FAIL — props/interface mismatch throughout.

- [ ] **Step 5: Rebuild `CompareTab.tsx`**

Replace the entire contents of `frontend/src/components/CompareTab.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { toCompareVerdict } from "../lib/compareVerdict";
import { countNoun, incidentNoun } from "../lib/layerCopy";
import { collectionBox, mosaicPath } from "../lib/locatorGeometry";
import type { GeocodingProvider } from "../lib/geocoding";
import type { AddressEntry } from "../lib/useCompareSet";
import { MAX_ADDRESSES, keyOf } from "../lib/useCompareSet";
import type { AnalysisSettings, IncidentDetailsResponse, McppFeatureCollection, NeighborhoodAnalysis, SiteComparison } from "../types";
import { plotDomainMax } from "./BaselineIntervalPlot";
import { CompareAddressInput } from "./CompareAddressInput";
import { CompareRankedList } from "./CompareRankedList";
import { CompareRateNumberLine } from "./CompareRateNumberLine";
import { CompareVerdict } from "./CompareVerdict";
import { IncidentDetailsSection } from "./IncidentDetailsSection";
import type { LocatorData } from "./LocatorChip";
import { MethodsAppendix } from "./MethodsAppendix";
import { PlaceContextCard } from "./PlaceContextCard";

const INCIDENT_TABLE_MIN = 560;

type Props = {
  entries: AddressEntry[];
  provider: GeocodingProvider;
  onAddEntry: (entry: AddressEntry) => void;
  onRemoveEntry: (index: number) => void;
  /** Coord keys of saved places, so already-saved entries show "Saved" not "Save". */
  savedKeys: Set<string>;
  onSaveEntry: (entry: AddressEntry) => void;
  analysis: AnalysisSettings;
  availableRadii: number[];
  running: boolean;
  comparison: SiteComparison | null;
  neighborhood: NeighborhoodAnalysis | null;
  incidents: IncidentDetailsResponse | null;
  /** Snapshot of the points the results were computed from (coords, letters). */
  runPoints: AddressEntry[] | null;
  error?: string;
  panelWidthPx?: number;
  /** True in the mobile bottom sheet; collapses the controls to a summary after a run. */
  isMobile?: boolean;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
  onCopyLink?: () => string | null;
  onHoverPlace?: (savedPlaceId: string | null) => void;
  mcppPolygons?: McppFeatureCollection | null;
  onFlyTo?: (target: { latitude: number; longitude: number }) => void;
  /** Drawer-level chrome (chip strip, pin-draft popover) — must render inside the panel. */
  topSlot?: ReactNode;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

const REVISED_CAVEAT =
  "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ entries, provider, onAddEntry, onRemoveEntry, savedKeys, onSaveEntry, analysis, availableRadii, running, comparison, neighborhood, incidents, runPoints, error, panelWidthPx, isMobile = false, onChange, onRun, onCopyLink, onHoverPlace, mcppPolygons, onFlyTo, topSlot }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const noun = useMemo(() => incidentNoun(analysis.layer), [analysis.layer]);
  const canRun = entries.length >= 1 && !running;
  const hasResults = Boolean(neighborhood || comparison);

  const resultsAnchorRef = useRef<HTMLDivElement>(null);
  const wasRunningRef = useRef(false);
  const [editingControls, setEditingControls] = useState(false);
  useEffect(() => {
    if (wasRunningRef.current && !running) {
      if (isMobile) {
        setEditingControls(false);
      } else {
        resultsAnchorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    }
    wasRunningRef.current = running;
  }, [running, isMobile]);

  const locator = useMemo<LocatorData | null>(() => {
    if (!mcppPolygons) return null;
    const box = collectionBox(mcppPolygons);
    return box ? { polygons: mcppPolygons, box, mosaic: mosaicPath(mcppPolygons, box) } : null;
  }, [mcppPolygons]);

  const width = panelWidthPx ?? Infinity;
  const incidentLayout = width >= INCIDENT_TABLE_MIN ? "table" : "cards";
  const windowLabel = neighborhood
    ? `${neighborhood.analysis_start_date} – ${neighborhood.analysis_end_date}`
    : "";

  const isCallsLayer = analysis.layer === "calls";
  const isArrestsLayer = analysis.layer === "arrests";
  const showCategory = analysis.layer !== "calls";
  const subcategoryHeader = isCallsLayer ? "Call type" : isArrestsLayer ? "Charge" : "Subcategory";
  const categoryLabel = CATEGORIES.find((c) => c.value === analysis.offenseCategory)?.label ?? "All reported";
  const showFullControls = !isMobile || !hasResults || editingControls;

  const verdict = comparison ? toCompareVerdict(comparison) : null;

  function moduleFor(index: number): ReactNode | null {
    const place = neighborhood?.places?.[index];
    if (!place || !neighborhood) return null;
    const point = runPoints?.[index];
    return (
      <PlaceContextCard
        place={place}
        index={index}
        windowLabel={windowLabel}
        noun={noun}
        domainMax={plotDomainMax(neighborhood.places)}
        onHoverPlace={onHoverPlace ? (id) => onHoverPlace(id ? point?.savedPlaceId ?? null : null) : undefined}
        locator={locator}
        coords={point ? { latitude: point.latitude, longitude: point.longitude } : null}
        onFlyTo={onFlyTo}
      />
    );
  }

  const expansionByOptionId = useMemo(() => {
    if (!comparison || !neighborhood?.places?.length) return undefined;
    const map = new Map<string, ReactNode>();
    comparison.analytical.options.forEach((option, index) => {
      const node = moduleFor(index);
      if (node) map.set(option.id, node);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison, neighborhood, runPoints, noun, locator, onHoverPlace, onFlyTo]);

  return (
    <div className="mc-panel is-active has-querybar" role="tabpanel" aria-label="Compare">
      {topSlot}
      <div className="mc-panel-head"><h4>Compare addresses</h4></div>

      <div className="mc-cmpset">
        <div className="mc-cmpset-head"><span className="mc-label">Addresses to compare · {entries.length} of {MAX_ADDRESSES}</span></div>
        <CompareAddressInput provider={provider} onAdd={onAddEntry} disabled={entries.length >= MAX_ADDRESSES} />
        {entries.length === 0 ? (
          <p className="mc-empty-list">Add at least one address to see its {noun.singular} context — two or more to compare.</p>
        ) : (
          <ul className="mc-cmpset-rows" aria-label="Addresses to compare">
            {entries.map((entry, index) => (
              <li key={keyOf(entry)} className="mc-cmpset-row">
                <span className="idx">{index + 1}</span>
                <span className="lbl">{entry.label}</span>
                {entry.savedPlaceId || savedKeys.has(keyOf(entry)) ? (
                  <span className="saved">Saved</span>
                ) : (
                  <button type="button" className="save" onClick={() => onSaveEntry(entry)}>Save</button>
                )}
                <button type="button" className="rm" aria-label={`Remove ${entry.label}`} onClick={() => onRemoveEntry(index)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showFullControls ? (
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="analysis-start-date">Date range</label>
          <div className="mc-inputs">
            <input id="analysis-start-date" type="date" className="mc-inp" value={analysis.startDate} min={ANALYSIS_MIN_DATE} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
            <input id="analysis-end-date" type="date" className="mc-inp" value={analysis.endDate} min={ANALYSIS_MIN_DATE} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
          </div>
        </div>

        <div className="mc-field">
          <label id="radius-label">Search radius</label>
          <div className="mc-chips" role="group" aria-labelledby="radius-label">
            {radii.map((value) => (
              <button key={value} type="button" className={`mc-chip${analysis.radiusM === value ? " on" : ""}`} aria-pressed={analysis.radiusM === value} onClick={() => onChange({ radiusM: value })}>
                {value} m
              </button>
            ))}
          </div>
        </div>

        {showCategory ? (
          <div className="mc-field">
            <label id="category-label">Incident categories</label>
            <div className="mc-chips" role="group" aria-labelledby="category-label">
              {CATEGORIES.map((category) => (
                <button key={category.value || "all"} type="button" className={`mc-chip${analysis.offenseCategory === category.value ? " on" : ""}`} aria-pressed={analysis.offenseCategory === category.value} onClick={() => onChange({ offenseCategory: category.value })}>
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mc-querybar-run">
          <span className="note">{entries.length} address{entries.length === 1 ? "" : "es"} · {analysis.radiusM} m</span>
          <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>
            {running ? "Running…" : entries.length >= 2 ? `Compare ${entries.length} addresses` : "Run analysis"}
          </button>
        </div>
      </div>
      ) : (
      <div className="mc-querybar-summary">
        <span className="mc-querybar-sum">{entries.length} address{entries.length === 1 ? "" : "es"} · {analysis.radiusM} m{showCategory ? ` · ${categoryLabel}` : ""}</span>
        <button type="button" className="mc-querybar-edit" onClick={() => setEditingControls(true)}>Adjust</button>
      </div>
      )}

      <div ref={resultsAnchorRef} aria-hidden="true" />

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
          most reported crimes never result in one. Categories are a <strong>best-effort</strong>{" "}
          NIBRS crosswalk from the arrest offense.
        </p>
      ) : null}

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {running ? (
        <div className="mc-analysis-loading" aria-live="polite" aria-busy="true">
          <span className="mc-sr">Running analysis…</span>
          <div className="mc-skeleton" style={{ height: 96 }} />
          <div className="mc-skeleton" style={{ height: 96 }} />
          <div className="mc-skeleton" style={{ height: 168 }} />
        </div>
      ) : (
        <>
          {hasResults && onCopyLink ? (
            <div className="mc-analyze-actions">
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
            </div>
          ) : null}

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
          ) : neighborhood?.places?.length ? (
            neighborhood.places.map((_, index) => moduleFor(index))
          ) : null}

          {hasResults ? (
            <IncidentDetailsSection details={incidents} noun={noun} layout={incidentLayout} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
          ) : null}

          <div className="mc-caveat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            {REVISED_CAVEAT}
          </div>

          <MethodsAppendix />
        </>
      )}
    </div>
  );
}
```

Notes for the implementer: `CompareAddressInput`'s `onAdd` emits `{latitude, longitude, label}` — structurally an `AddressEntry` without `savedPlaceId`, so it type-checks; `countNoun` is imported for `IncidentDetailsSection`'s reveal summary — if `tsc` flags it unused here, remove it from this file's import (the section owns it).

- [ ] **Step 6: Update the mount site in `MapWorkspace.tsx`**

Replace the `<CompareTab ... />` mount (the whole element) with:

```tsx
            <CompareTab
              topSlot={drawerTopSlot}
              entries={compareSet.points}
              provider={geocodingProvider}
              onAddEntry={compareSet.add}
              onRemoveEntry={compareSet.removeAt}
              savedKeys={savedPlaceKeys}
              onSaveEntry={async (entry) => {
                data.setError("");
                try {
                  await createPlace({ display_label: entry.label, latitude: entry.latitude, longitude: entry.longitude, visit_count: 1, sensitivity_class: "normal" });
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
              onCopyLink={() => buildShareUrl("compare")}
              onHoverPlace={setHoveredPlaceId}
              mcppPolygons={mcppPolygons}
              onFlyTo={({ latitude, longitude }) => setChipFlyTo({ lat: latitude, lng: longitude })}
            />
```

- [ ] **Step 7: Run the suites**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx src/components/PlaceContextCard.test.tsx src/components/AnalyzeTab.test.tsx src/components/MapWorkspace.test.tsx --environment jsdom && npm run lint`
Expected: PASS. (`MapWorkspace.test` compare-flow tests exercise the new panel through the old flows; if an assertion queries copy that moved — e.g. the old "Add at least two addresses" empty-state — update THAT assertion to the new copy shown in Step 5's code, and nothing else.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/IncidentDetailsSection.tsx frontend/src/components/PlaceContextCard.tsx frontend/src/components/PlaceContextCard.test.tsx frontend/src/components/CompareTab.tsx frontend/src/components/CompareTab.test.tsx frontend/src/components/MapWorkspace.tsx frontend/src/components/AnalyzeTab.test.tsx
git commit -m "feat(compare): unified panel — list + controls + scaling results in one surface"
```

---

## Task 5: One list in the workspace — rewrite `MapWorkspace` wiring, collapse tabs

The list becomes the only selection source. `sharedPoints`, `lookupPoint`, the `selected` synthesis, `useAnalyze`, and the analyze tab all go. Every hunk below quotes the current code as its anchor — apply top to bottom; `npm run lint` after Step 4 is the drift check.

**Files:**
- Modify: `frontend/src/types.ts` (TabKey)
- Modify: `frontend/src/components/BottomSheet.tsx` (drop the analyze tab entry)
- Modify: `frontend/src/lib/usePinDraft.ts` (tab type + calls)
- Modify: `frontend/src/lib/assistantBridge.ts` (tab targets)
- Modify: `frontend/src/components/MapWorkspace.tsx` (the rewrite)

- [ ] **Step 1: Mechanical satellites**

1. `frontend/src/types.ts:143`: `export type TabKey = "analyze" | "compare" | "export";` → `export type TabKey = "compare" | "export";`
2. `frontend/src/components/BottomSheet.tsx`: delete the whole `{ key: "analyze", ... }` object from the `TABS` array (lines 26-37), leaving compare + export.
3. `frontend/src/lib/usePinDraft.ts`: in `PinDraftDeps`, `setActiveTab: (tab: "analyze") => void;` → `setActiveTab: (tab: "compare") => void;` and replace every `setActiveTab("analyze")` call in the file with `setActiveTab("compare")` (there are two — `startAddPin` and inside `saveDraft`; verify with `grep -n 'setActiveTab' frontend/src/lib/usePinDraft.ts`).
4. `frontend/src/lib/assistantBridge.ts`: in the `analyze_places` case, `tab: "analyze",` → `tab: "compare",` (the `compare_places` case already targets compare).

- [ ] **Step 2: Rewrite `MapWorkspace.tsx` — apply these hunks in order**

**Hunk A — imports.** Remove the `useAnalyze` and `AnalyzeTab` import lines. Change the `useCompareSet` import line to:

```tsx
import { entriesFromPlaces, keyOf, useAddressList, type AddressEntry } from "../lib/useCompareSet";
```

Delete the separate `import type { ComparePoint } ...` line (line 37). Remove `AddressLookup`'s import ONLY if Step 2 Hunk J below removes its usage — it does not; keep it.

**Hunk B — shared/lookup state → banner + list seed.** Replace:

```tsx
  const [sharedPoints, setSharedPoints] = useState(initialView ? initialView.points : null);
  const [showBadLink, setShowBadLink] = useState(hadViewParam && initialView === null);

  const [activeTab, setActiveTab] = useState<TabKey>(initialView ? (initialView.points.length >= 2 ? "compare" : "analyze") : "analyze");
  const [lookupPoint, setLookupPoint] = useState<ComparePoint | null>(null);
```

with:

```tsx
  const [sharedBanner, setSharedBanner] = useState(Boolean(initialView));
  const [showBadLink, setShowBadLink] = useState(hadViewParam && initialView === null);

  const [activeTab, setActiveTab] = useState<TabKey>("compare");
```

(Note: Task 1/3 already edited the `useState<TabKey>` initializer and run-once effect; this hunk supersedes those lines.)

**Hunk C — the list replaces `selected` + `compareSet`.** Replace the whole block from `const { selectedIds, setSelectedIds, restored } = usePersistedSelection(data.places);` through the `const compareSet = useCompareSet(selected);` line (currently: persisted-selection line, `pendingAutoRun` state, drawer line, the `selected` useMemo, the `identityByPlaceId` useMemo, `hoveredPlaceId`, `compareSet`) with:

```tsx
  const { selectedIds, setSelectedIds, restored } = usePersistedSelection(data.places);
  const [pendingAutoRun, setPendingAutoRun] = useState(false);
  const { drawer, setCollapsed: setDrawerCollapsed, onResize: onDrawerResize, onToggleCollapsed, onPreset } = useDrawer();

  // The single address list: seeded from the restored saved selection (share links replace
  // it on mount below). Saved ids write back through so returning sessions keep their list.
  const seedPlaces = useMemo(
    () => (initialView ? [] : data.places.filter((place) => selectedIds.has(place.id))),
    [initialView, data.places, selectedIds],
  );
  const list = useAddressList({
    seed: seedPlaces,
    onSavedIdsChange: (ids) => setSelectedIds(new Set(ids)),
  });

  // One identity source for cards AND pins: index within the list (saved entries carry
  // their place id so pins and chips can letter themselves).
  const identityByPlaceId = useMemo(
    () =>
      new Map<string, PlaceIdentity>(
        list.entries
          .map((entry, index) => [entry.savedPlaceId, placeIdentity(index)] as const)
          .filter((pair): pair is [string, PlaceIdentity] => Boolean(pair[0])),
      ),
    [list.entries],
  );
  const savedIdSet = useMemo(
    () => new Set(list.entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id))),
    [list.entries],
  );
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
```

**Hunk D — hooks.** Replace the `useAnalyze` + `useCompare` lines (and the `highlightBeats` memo's source) with:

```tsx
  const compare = useCompare({
    entries: list.entries,
    analysis,
    setError: data.setError,
    onSummariesRefreshed: () => void data.refreshWithFallback("Ran, but dashboard totals could not refresh."),
  });

  // analyzed-beat highlight from the neighborhood payload
  const highlightBeats = useMemo(
    () =>
      (compare.neighborhood?.places ?? [])
        .map((place) => place.beat)
        .filter((beat): beat is string => Boolean(beat)),
    [compare.neighborhood],
  );
```

**Hunk E — mount effects.** Replace the share-link run-once effect AND the "analysis greets you" pair AND the points-subject rerun effect (three effect blocks plus `autoRunArmedRef`/`analysisMountRef`) with:

```tsx
  // A ?view= link replaces the list on mount; the pending-auto-run effect below owns the
  // first run once the entries commit.
  useEffect(() => {
    if (!initialView) return;
    list.replaceAll(initialView.points);
    setPendingAutoRun(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Analysis greets you": one shot after the persisted selection seeds the list. Share
  // links own their first run above; landing lookups arm pendingAutoRun themselves.
  const autoRunArmedRef = useRef(false);
  useEffect(() => {
    if (autoRunArmedRef.current || initialView || !restored) return;
    if (list.entries.length > 0) {
      autoRunArmedRef.current = true;
      setPendingAutoRun(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, list.entries.length]);

  useEffect(() => {
    if (!pendingAutoRun || list.entries.length === 0) return;
    setPendingAutoRun(false);
    void compare.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoRun, list.entries]);
```

**Hunk F — selection plumbing.** Replace `invalidateAnalysisContext`, `selectPlaceIds`, `handleLookup`, `handleSaveLookup`, and `handleToggleSelect` (keep `pinDraft` and the chip-fly effect between them) with:

```tsx
  function invalidateAnalysisContext() {
    compare.invalidate();
  }

  // Resolve saved-place ids to list entries; ids whose places haven't loaded yet are
  // queued and appended when data.places refreshes (pin saves and assistant adds land
  // before the summary refetch completes).
  const pendingIdsRef = useRef<string[]>([]);
  function entriesForIds(ids: string[]): AddressEntry[] {
    const resolved: AddressEntry[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const place = data.places.find((p) => p.id === id);
      if (place && place.latitude != null && place.longitude != null) {
        resolved.push({ latitude: place.latitude, longitude: place.longitude, label: place.display_label, savedPlaceId: place.id });
      } else {
        missing.push(id);
      }
    }
    pendingIdsRef.current = [...pendingIdsRef.current, ...missing];
    return resolved;
  }
  useEffect(() => {
    if (pendingIdsRef.current.length === 0) return;
    const pending = pendingIdsRef.current;
    pendingIdsRef.current = [];
    const resolved = entriesForIds(pending);
    resolved.forEach((entry) => list.add(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.places]);

  function selectPlaceIds(ids: string[]) {
    if (ids.length === 0) return;
    invalidateAnalysisContext();
    setActiveTab("compare");
    entriesForIds(ids).forEach((entry) => list.add(entry));
  }
```

(`usePinDraft`, `handleManualSubmit`, and `handleImport` keep calling `selectPlaceIds` unchanged.)

```tsx
  function handleLookup(result: GeocodeResult) {
    pinDraft.previewSearch(result);
    invalidateAnalysisContext();
    setSharedBanner(false);
    list.replaceAll([{ latitude: result.latitude, longitude: result.longitude, label: compactGeocodeLabel(result.label) }]);
    setActiveTab("compare");
    setPendingAutoRun(true);
  }

  function handleToggleSelect(id: string) {
    invalidateAnalysisContext();
    pinDraft.setDraft(null);
    setSharedBanner(false);
    const place = data.places.find((p) => p.id === id);
    if (place) list.toggleSaved(place);
  }
```

Delete `handleSaveLookup` entirely.

**Hunk G — assistant effects.** Replace the body of `applyAssistantToolResult` with:

```tsx
    const effect = interpretToolResult(payload);
    if (!effect) return;
    if (effect.selection || effect.neighborhood !== undefined || effect.incidents !== undefined || effect.comparison !== undefined) {
      pinDraft.setDraft(null);
      setSharedBanner(false);
    }
    if (effect.settings) {
      setAnalysis((current) => ({ ...current, ...effect.settings }));
    }
    if (effect.selection) {
      const { mode, ids } = effect.selection;
      if (mode === "clear") list.replaceAll([]);
      else if (mode === "replace") list.replaceAll(entriesForIds(ids));
      else entriesForIds(ids).forEach((entry) => list.add(entry));
    }
    if (effect.comparison !== undefined) {
      compare.applyAssistant({ comparison: effect.comparison });
    }
    if (effect.neighborhood !== undefined || effect.incidents !== undefined) {
      compare.applyAssistant({ neighborhood: effect.neighborhood, incidents: effect.incidents });
    }
    if (effect.refetchSummary) {
      void data.refreshWithFallback("Analyst updated the view, but dashboard totals could not refresh.");
    }
    if (effect.tab) setActiveTab(effect.tab);
```

**Hunk H — share URL.** Replace `buildShareUrl` with:

```tsx
  const buildShareUrl = useCallback((): string | null => {
    const points = list.entries.map((e) => ({ latitude: Number(e.latitude.toFixed(3)), longitude: Number(e.longitude.toFixed(3)), label: e.label }));
    if (points.length === 0) return null;
    const encoded = encodeView({
      points, radiusM: analysis.radiusM,
      startDate: analysis.startDate, endDate: analysis.endDate,
      layer: analysis.layer, offenseCategory: analysis.offenseCategory,
    });
    return `${window.location.origin}/?view=${encoded}`;
  }, [list, analysis]);
```

And `assistantState`'s `selected_place_ids: Array.from(selectedIds),` → `selected_place_ids: list.savedIds(),`.

**Hunk I — landing + banner.** Replace the `showLanding` computation with:

```tsx
  const showLanding =
    data.places.length === 0 && list.entries.length === 0 && activeTab === "compare" && !pinDraft.draft;
```

Replace the shared-view banner block (`{sharedPoints ? ... : null}`) with:

```tsx
        {sharedBanner ? (
          <div className="mc-banner" role="status">
            Shared view · reported incident context.{" "}
            <button
              type="button"
              onClick={() => {
                setSharedBanner(false);
                invalidateAnalysisContext();
                list.replaceAll(entriesFromPlaces(data.places.filter((p) => selectedIds.has(p.id))));
                setPendingAutoRun(true);
              }}
            >
              Exit
            </button>
          </div>
        ) : null}
```

**Hunk J — render tree.** In `MapCanvas`, `selectedIds={selectedIds}` → `selectedIds={savedIdSet}`. In `BottomSheet`, `tabBadges={{ compare: compareSet.points.length }}` → `tabBadges={{ compare: list.entries.length }}`. Delete the whole `{activeTab === "analyze" ? (<AnalyzeTab .../>) : null}` block. In the `CompareTab` mount (from Task 4), change `entries={compareSet.points}` → `entries={list.entries}`, `onAddEntry={compareSet.add}` → `onAddEntry={(entry) => { invalidateAnalysisContext(); list.add(entry); }}`, `onRemoveEntry={compareSet.removeAt}` → `onRemoveEntry={(index) => { invalidateAnalysisContext(); list.removeAt(index); }}`, `onCopyLink={() => buildShareUrl("compare")}` → `onCopyLink={buildShareUrl}`, and the `onSaveEntry` body gains the in-place upgrade — replace it with:

```tsx
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
```

In `ManagePlacesModal`, `selectedIds={selectedIds}` → `selectedIds={savedIdSet}`.

**Hunk K — error placement.** The map-level error line `{data.error && (showLanding || activeTab !== "analyze") ? ...}` → `{data.error && showLanding ? <p className="mc-error" role="alert">{data.error}</p> : null}` (the panel shows its own inline error otherwise).

- [ ] **Step 3: Sweep for stragglers**

Run: `grep -n "analyze\b\|AnalyzeTab\|sharedPoints\|lookupPoint\|compareSet\|runCompare\|useAnalyze" frontend/src/components/MapWorkspace.tsx`
Expected: no hits except comments you intentionally kept and `analyzePlaces` (the api function name, only inside the removed code — should be gone too). Fix any leftovers.

- [ ] **Step 4: Compile + targeted suites**

Run: `cd frontend && npm run lint`
Expected: errors ONLY in test files (`MapWorkspace.test.tsx`, possibly `App.test.tsx`, `BottomSheet.test.tsx`) — production code compiles. Task 6 fixes the tests; do NOT fix them here beyond confirming the errors are test-side.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/BottomSheet.tsx frontend/src/lib/usePinDraft.ts frontend/src/lib/assistantBridge.ts frontend/src/components/MapWorkspace.tsx
git commit -m "feat(compare): one address list drives the workspace; tabs collapse to Compare + Export"
```

(Committing with red tests is deliberate here — Task 6 lands the test migration in the very next commit; the PR is reviewed as a unit and the gate runs before push.)

---

## Task 6: Test migration — workspace, bridge, bottom sheet, app

**Files:**
- Modify: `frontend/src/components/MapWorkspace.test.tsx`
- Modify: `frontend/src/lib/assistantBridge.test.ts` (if present; else skip)
- Modify: `frontend/src/components/BottomSheet.test.tsx`
- Modify: `frontend/src/App.test.tsx` (only if red)

- [ ] **Step 1: Read the failures**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx src/components/BottomSheet.test.tsx src/App.test.tsx --environment jsdom 2>&1 | tail -40` and `npm run lint 2>&1 | head -40`. Every remaining failure belongs to one of the dispositions below.

- [ ] **Step 2: Apply dispositions to `MapWorkspace.test.tsx`**

Work test-by-test through the file, applying the matching rule:

1. **Tab queries.** Any `getByRole("tab", { name: /analyze/i })` or click on the Analyze tab: the tab no longer exists. If the test was *about* tab switching to Analyze, retarget it to Compare (`/compare/i`); if it merely started on the analyze tab as scenery, delete the navigation line (Compare is now the default tab).
2. **Run assertions.** Tests asserting `analyzePlaces` was called after a selection run: the unified run calls `getNeighborhoodAnalysis` + `getIncidentDetails` with `points` (and `analyzePlaces` with `place_ids` only when saved entries exist — which is true for saved-place selections, so `analyzePlaces` assertions may stay IF the test's entries are saved places; verify the payload key is now `place_ids`).
3. **Selection semantics.** Tests that toggled chips/markers and asserted `selectedIds` behavior (e.g. "selects a newly saved pin"): the observable is now the list — assert the address row appears in the panel (`within(screen.getByLabelText("Addresses to compare")).getByText(<label>)`) and/or the run fires.
4. **Lookup flow.** Tests around the landing lookup ("shows the address's context"): now assert the panel is the Compare panel (`getByRole("tabpanel", { name: "Compare" })`), the looked-up label appears as row 1, and the run auto-fires (`getNeighborhoodAnalysis` called with one point).
5. **Compare-flow tests.** Should pass with at most copy updates ("Add at least two addresses" → "Add at least one address…", CTA name "Compare addresses" → "Compare 2 addresses").
6. **Share-view tests.** Legacy `tab=analyze`/`tab=compare` fixtures both land on the Compare panel and auto-run; update tab/name assertions accordingly. Keep both fixtures — they're the legacy-decode regression tests.
7. **Chrome tests** (theme, focus mode, pin-mode collapse, manage modal, rename error): unaffected in substance; fix only compile errors from the mock shape.
8. The client mock factory must export every function the workspace now calls: ensure `getIncidentDetails` and `getNeighborhoodAnalysis` are present with resolved-value defaults (see Task 3 Step 4's snippet).

Then add these new tests at the end of the describe block (fixtures `home`/`work`/`makeSummary` already exist in the file; add `waitFor` to the `@testing-library/react` import if it isn't there):

```tsx
  it("legacy 1-point analyze share link lands on the unified Compare surface and auto-runs", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([]));
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "analyze", r: 250, s: "2026-01-01", e: "2026-06-24", ly: "reported",
      pts: [{ y: 47.61, x: -122.33, l: "Shared spot" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.history.replaceState(null, "", `/?view=${legacy}`);
    render(<MapWorkspace />);
    expect(await screen.findByRole("tabpanel", { name: "Compare" })).toBeInTheDocument();
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      points: [expect.objectContaining({ label: "Shared spot" })],
    })));
    expect(comparePlaces).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("assistant analyze_places result applies panes onto the Compare surface", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    render(<MapWorkspace />);
    await screen.findByRole("tabpanel", { name: "Compare" });
    // interpretToolResult maps analyze_places → tab "compare" now; simulate via the panel's
    // public entry point the same way existing assistant tests in this file do (reuse their
    // helper/pattern — search the file for applyAssistantToolResult / AssistantPanel mock).
  });
```

For the second test, follow the file's existing assistant-result pattern exactly (it mocks `AssistantPanel` and captures `onToolResult`); assert that after an `analyze_places` result with a `neighborhood` payload, the Compare panel shows the module content and `comparePlaces` was not called. If the file has NO existing assistant-driven test, implement the capture through the same `vi.mock("./AssistantPanel", ...)` seam the dock uses, storing `onToolResult` from props.

- [ ] **Step 3: `BottomSheet.test.tsx` and `App.test.tsx`**

- `BottomSheet.test.tsx`: remove/retarget any Analyze-tab expectations (tab count drops to 2 + dock).
- `App.test.tsx`: update only if red (it mounts the workspace; landing copy is unchanged).
- If `frontend/src/lib/assistantBridge.test.ts` exists: update `analyze_places` expectations to `tab: "compare"`.

- [ ] **Step 4: Full frontend suite green**

Run: `cd frontend && npx vitest run --environment jsdom && npm run lint`
Expected: all green. Iterate within the dispositions until it is; if a failure doesn't fit any disposition, STOP and report it (don't invent behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "test: migrate workspace/bridge/sheet suites to the unified Compare surface"
```

---

## Task 7: Retire the old parts

**Files:**
- Delete: `frontend/src/components/AnalyzeTab.tsx`, `frontend/src/components/AnalyzeTab.test.tsx`
- Delete: `frontend/src/lib/useAnalyze.ts`, `frontend/src/lib/useAnalyze.test.ts` (verify the test file's name with `ls frontend/src/lib/useAnalyze*`)
- Modify: `frontend/src/lib/useCompareSet.ts` (drop the deprecated aliases)

- [ ] **Step 1: Delete the retired files**

```bash
git rm frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx frontend/src/lib/useAnalyze.ts
ls frontend/src/lib/useAnalyze* 2>/dev/null && git rm frontend/src/lib/useAnalyze.test.ts
```

(PairwiseSection and the "+ Compare with another address" bridge die with `AnalyzeTab.tsx` — verify with `grep -rn "PairwiseSection\|Compare with another address" frontend/src/` → no hits.)

- [ ] **Step 2: Drop the transition aliases**

In `frontend/src/lib/useCompareSet.ts`, delete the deprecated block: `ComparePoint` type alias, `MAX_COMPARE_POINTS`, `pointsFromPlaces` alias, the `CompareSet` interface, and the `useCompareSet` shim function. Then fix the fallout the compiler names — expected: `CompareAddressInput.tsx` and `CompareRateNumberLine.tsx`/`CompareRankedList.tsx` or tests importing `ComparePoint`/`MAX_COMPARE_POINTS` — switch them to `AddressEntry`/`MAX_ADDRESSES` (`grep -rn "ComparePoint\|MAX_COMPARE_POINTS\|pointsFromPlaces\|useCompareSet(" frontend/src/` and update each).

- [ ] **Step 3: Full suite + sweep**

Run: `cd frontend && npx vitest run --environment jsdom && npm run lint`
Expected: green.
Run: `grep -rn "\"analyze\"\|'analyze'" frontend/src/ | grep -v analyzePlaces | grep -v test`
Expected: only the legacy-decode tolerance in `savedView.ts`. Anything else is a straggler — fix it.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "chore(compare): retire AnalyzeTab, useAnalyze, and transition aliases"
```

---

## Task 8: Docs, gate, end-to-end verify, PR

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md`

- [ ] **Step 1: Record the spec deltas**

Append to the spec file, before "## Out of scope":

```markdown
## Implementation deltas (slice 2, recorded 2026-07-16)

- **Saved-place summaries:** the unified run additionally fires `analyzePlaces({ place_ids })`
  for the list's saved entries — the points path never persists `crime_summaries`, and the
  map's per-place rings read them from the summary payload.
- **Auto-run policy:** seeding events auto-run (persisted-selection restore, share link,
  landing lookup); manual list edits and control changes invalidate and wait for Run. The
  old "points-subject re-runs on control change" special case is retired.
- **Adaptive CTA** shipped in slice 2 (querybar rebuild made it free).
- The module's landmark reads "Context for X" (was "Verdict for X").
```

- [ ] **Step 2: Tick the roadmap**

In `docs/ROADMAP.md`, flip the slice-2 line to checked and summarize:

```markdown
- [x] **Slice 2 — unify** — shipped: one address list (saved + ad-hoc, persisted saved ids),
  one run (neighborhood + incidents always, compare at 2+, saved-summary refresh), one panel;
  tabs collapsed to Compare + Export; tab-free share links with legacy decode; assistant
  bridge and pin/lookup/manage flows retargeted. Plan:
  `docs/superpowers/plans/2026-07-16-unified-compare-slice2.md`.
```

- [ ] **Step 3: Full gate**

Run from the worktree root: `make test-all`
Expected: pytest green (backend untouched), ruff clean, frontend green, build succeeds.

- [ ] **Step 4: End-to-end verification (required before the PR)**

Follow `/Users/jscocca/Repos/compcat/.claude/skills/verify/SKILL.md` (the project verify skill): seed the worktree DB if not already seeded, launch via the Browser pane on a spare port, and drive:
1. Fresh session → landing lookup → context module renders for entry #1 (auto-run).
2. Add a second address → CTA reads "Compare 2 addresses" → run → callout + spine → expand a row.
3. A legacy `tab=analyze` share link (1 point) → lands on Compare, auto-runs, module renders.
4. Toggle a saved place via the chip strip → row appears; Save an ad-hoc entry → row flips to "Saved".
5. Sweep the live panel for banned vocabulary (only the fixed caveat's "risk").
Capture screenshots; report PASS/FAIL with evidence. FAIL → fix before the PR.

- [ ] **Step 5: Commit, push, PR**

```bash
git add docs/ROADMAP.md docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md
git commit -m "docs: record slice-2 deltas; tick the roadmap"
git push -u origin jcscocca/claude/unified-compare-slice2
gh pr create --title "feat(compare): one surface — unified list, run, and panel (unified Compare, slice 2)" --body "$(cat <<'EOF'
Slice 2 of the unified Compare surface (spec: docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md, incl. recorded deltas).

- One address list (1–10, saved + ad-hoc entries; persisted saved ids) replaces selected places, the lookup point, shared-view points, and the compare set.
- One run: neighborhood + incident details for every entry (always inline points), the cross-address comparison at 2+, and a place_ids analyze pass so saved-place summaries/map rings stay fresh. Results carry a runPoints snapshot; expansions can't drift from the run.
- One panel: querybar + adaptive CTA, N=1 full-width context module (locator/hover/fly-to wired), N≥2 callout + ranked spine with fully-wired expansions, combined incident disclosure.
- Tabs collapse to Compare + Export; share links drop the tab discriminator (legacy links decode + auto-run); assistant bridge, pin drafts, lookup, and manage flows retarget the one surface. AnalyzeTab, useAnalyze, PairwiseSection, and the compare bridge are retired.

Invariant: reported-incident-rate vocabulary only; sweeps cover the unified panel.

make test-all green; end-to-end verified per the project verify skill.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (do not do here)

- Any backend/`app/` change.
- Pins for ad-hoc entries, pin-to-compare side-by-side columns, progressive spine-first rendering (slice 3 / later).
- Export flow changes beyond the tab set.
- Assistant tool schema changes (the bridge adapts client-side only).


