# Routes Saved Views (C3 · inc 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shareable `?view=` link pattern (shipped for Analyze/Compare in #78) to the Routes corridor tab.

**Architecture:** Frontend-only. The Routes backend already accepts inline coordinate endpoints (`RouteEndpoint` is `place_id` XOR `lat/lng`), so a shared Routes view reuses `POST /routes/alternatives` with generalized (~110 m) coordinate endpoints. We add a `routes` variant to the `SavedView` wire format, a generalizing copy-link button on `RoutesTab`, and a routes branch to `MapWorkspace`'s `?view=` hydration. Opening a shared Routes view recomputes once on mount (stateful, like normal Routes use — accepted).

**Tech Stack:** React + TypeScript + Vite, Vitest + Testing Library. No backend/Python changes.

**Design reference:** `docs/superpowers/specs/2026-07-02-routes-saved-views-design.md`

---

## File Structure

- **Modify:** `frontend/src/lib/savedView.ts` — `SavedView` becomes a discriminated union (`PointsSavedView | RoutesSavedView`); `encodeView`/`decodeView` gain a routes branch (Task 1).
- **Modify:** `frontend/src/lib/savedView.test.ts` — routes round-trip + rejection tests (Task 1).
- **Modify:** `frontend/src/components/MapWorkspace.tsx` — union-narrowing compat (Task 1); routes hydration + `buildRoutesShareUrl` + banner generalization (Task 3).
- **Modify:** `frontend/src/components/RoutesTab.tsx` — `initialOrigin/initialDestination/initialMode` seeding + run-once + copy-link button (Task 2).
- **Modify:** `frontend/src/components/RoutesTab.test.tsx` — seeding/run-once + copy-link tests (Task 2).
- **Modify:** `frontend/src/components/MapWorkspace.test.tsx` — routes `?view=` hydration test (Task 3).
- **Modify:** `docs/ROADMAP.md` — C3 increment-2 tick (Task 4).

Reference facts (verified against the worktree):
- `frontend/src/lib/geocoding.ts` exports `SEATTLE_BBOX` and `withinSeattleBbox({ latitude, longitude })`.
- `RouteEndpointInput = { place_id: string } | { latitude: number; longitude: number; label: string }` (`frontend/src/types.ts:141`).
- `LayerKey = "reported" | "calls"` (`frontend/src/types.ts:167`).
- Modes: `transit | walk | bike | drive` (`RoutesTab.tsx:6`).
- Copy pattern (`AnalyzeTab.tsx:513`): `onCopyLink?: () => string | null`; button `onClick` calls it and does `navigator.clipboard.writeText(url)`. No transient "Copied" state — match this.
- Place option key: `place:${id}`; geo option key: `geo:${lat},${lng}` (`RoutesTab.tsx:111,117`).

---

## Task 1: Routes wire format in `savedView.ts` (+ union compat in MapWorkspace)

**Files:**
- Modify: `frontend/src/lib/savedView.ts`
- Modify: `frontend/src/components/MapWorkspace.tsx` (3 narrowing fixes only)
- Test: `frontend/src/lib/savedView.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/savedView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeView, encodeView, type RoutesSavedView } from "./savedView";

describe("savedView routes variant", () => {
  const view: RoutesSavedView = {
    tab: "routes",
    origin: { latitude: 47.62, longitude: -122.33, label: "Home" },
    destination: { latitude: 47.61, longitude: -122.34, label: "Office" },
    mode: "transit",
    radiusM: 500,
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    layer: "calls",
  };

  it("round-trips a routes view", () => {
    expect(decodeView(encodeView(view))).toEqual(view);
  });

  it("rejects an endpoint outside the Seattle bbox", () => {
    const bad = { ...view, destination: { latitude: 40.0, longitude: -74.0, label: "NYC" } };
    expect(decodeView(encodeView(bad))).toBeNull();
  });

  it("rejects an unknown mode", () => {
    const encoded = encodeView({ ...view, mode: "teleport" as unknown as RoutesSavedView["mode"] });
    expect(decodeView(encoded)).toBeNull();
  });

  it("rejects a routes view missing an endpoint", () => {
    // Hand-craft wire with no destination.
    const wire = { v: 1, t: "routes", o: { y: 47.62, x: -122.33, l: "Home" }, m: "transit", r: 500, s: "a", e: "b", ly: "reported" };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(wire)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeView(encoded)).toBeNull();
  });
});
```

If the existing test file lacks these imports at top, this appended `import` is fine (Vitest allows multiple import statements). Do NOT remove existing tests.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/lib/savedView.test.ts`
Expected: FAIL — `RoutesSavedView` is not exported and the routes branch doesn't exist.

- [ ] **Step 3: Implement the routes variant in `savedView.ts`**

Replace the entire contents of `frontend/src/lib/savedView.ts` with:

```ts
import type { LayerKey } from "../types";
import { withinSeattleBbox } from "./geocoding";

export type ViewTab = "analyze" | "compare" | "routes";
export type RouteMode = "transit" | "walk" | "bike" | "drive";
const ROUTE_MODES: RouteMode[] = ["transit", "walk", "bike", "drive"];

export interface ViewPoint {
  latitude: number;
  longitude: number;
  label: string;
}

interface SharedViewFields {
  radiusM: number;
  startDate: string;
  endDate: string;
  layer: LayerKey;
}

export interface PointsSavedView extends SharedViewFields {
  tab: "analyze" | "compare";
  points: ViewPoint[];
  offenseCategory: string;
}

export interface RoutesSavedView extends SharedViewFields {
  tab: "routes";
  origin: ViewPoint;
  destination: ViewPoint;
  mode: RouteMode;
}

export type SavedView = PointsSavedView | RoutesSavedView;

const VERSION = 1;
const MAX_ENCODED_LENGTH = 2000;

function toBase64Url(json: string): string {
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const padded = param.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(padded)));
}

const wirePoint = (p: ViewPoint) => ({ y: p.latitude, x: p.longitude, l: p.label });

export function encodeView(view: SavedView): string {
  const base = { v: VERSION, t: view.tab, r: view.radiusM, s: view.startDate, e: view.endDate, ly: view.layer };
  const wire =
    view.tab === "routes"
      ? { ...base, o: wirePoint(view.origin), d: wirePoint(view.destination), m: view.mode }
      : { ...base, pts: view.points.map(wirePoint), c: view.offenseCategory || null };
  return toBase64Url(JSON.stringify(wire));
}

// Parse one wire point. `bbox` gates on the Seattle bounding box (used for routes endpoints;
// the analyze/compare points path keeps its inc-1 behavior of not bbox-checking on decode).
function readWirePoint(raw: unknown, bbox: boolean): ViewPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const { y, x, l } = raw as { y: unknown; x: unknown; l: unknown };
  if (typeof y !== "number" || typeof x !== "number") return null;
  if (typeof l !== "string" || l.length === 0) return null;
  if (bbox && !withinSeattleBbox({ latitude: y, longitude: x })) return null;
  return { latitude: y, longitude: x, label: l };
}

function decodeRoutesView(wire: {
  o?: unknown; d?: unknown; m?: unknown; r?: unknown; s?: unknown; e?: unknown; ly?: unknown;
}): RoutesSavedView | null {
  const origin = readWirePoint(wire.o, true);
  const destination = readWirePoint(wire.d, true);
  if (!origin || !destination) return null;
  if (typeof wire.m !== "string" || !ROUTE_MODES.includes(wire.m as RouteMode)) return null;
  return {
    tab: "routes",
    origin,
    destination,
    mode: wire.m as RouteMode,
    radiusM: Number(wire.r),
    startDate: String(wire.s),
    endDate: String(wire.e),
    layer: wire.ly === "calls" ? "calls" : "reported",
  };
}

export function decodeView(param: string): SavedView | null {
  if (!param || param.length > MAX_ENCODED_LENGTH) return null;
  try {
    const wire = JSON.parse(fromBase64Url(param));
    if (wire.v !== VERSION) return null;
    if (wire.t === "routes") return decodeRoutesView(wire);
    if (wire.t !== "analyze" && wire.t !== "compare") return null;
    if (!Array.isArray(wire.pts) || wire.pts.length === 0) return null;
    const points = wire.pts.map((p: unknown) => readWirePoint(p, false));
    if (points.some((p: ViewPoint | null) => p === null)) return null;
    return {
      tab: wire.t,
      points: points as ViewPoint[],
      radiusM: Number(wire.r),
      startDate: String(wire.s),
      endDate: String(wire.e),
      layer: wire.ly === "calls" ? "calls" : "reported",
      offenseCategory: wire.c ?? "",
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Fix the 3 union-narrowing spots in `MapWorkspace.tsx` (keep tsc green)**

`SavedView` is now a union, so three existing `initialView.*` accesses must narrow. Make exactly these edits:

(a) `frontend/src/components/MapWorkspace.tsx:37` — replace:
```ts
  const [sharedPoints, setSharedPoints] = useState(initialView?.points ?? null);
```
with:
```ts
  const [sharedPoints, setSharedPoints] = useState(
    initialView && initialView.tab !== "routes" ? initialView.points : null,
  );
```

(b) `frontend/src/components/MapWorkspace.tsx:48` — inside the `if (initialView)` analysis-seed block, replace:
```ts
        offenseCategory: initialView.offenseCategory,
```
with:
```ts
        offenseCategory: initialView.tab === "routes" ? "" : initialView.offenseCategory,
```

(c) `frontend/src/components/MapWorkspace.tsx:64-69` — replace the run-once effect body so it only auto-runs analyze/compare (routes will run itself in Task 2):
```ts
  useEffect(() => {
    if (!initialView) return;
    if (initialView.tab === "compare") void compare.runCompare();
    else void analyze.runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
with:
```ts
  useEffect(() => {
    if (!initialView) return;
    if (initialView.tab === "compare") void compare.runCompare();
    else if (initialView.tab === "analyze") void analyze.runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/lib/savedView.test.ts && npx tsc --noEmit`
Expected: savedView tests PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/savedView.ts frontend/src/lib/savedView.test.ts frontend/src/components/MapWorkspace.tsx
git commit -m "feat(saved-views): routes wire-format variant + union narrowing"
```

---

## Task 2: RoutesTab — seed from a shared view, run once, copy-link

**Files:**
- Modify: `frontend/src/components/RoutesTab.tsx`
- Test: `frontend/src/components/RoutesTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/RoutesTab.test.tsx` (inside the top-level `describe("RoutesTab", ...)` block, or as a new `describe`):

```ts
  it("seeds From/To/mode from initial props and runs once on mount", () => {
    const onRun = vi.fn();
    render(
      <RoutesTab
        analysis={analysis}
        running={false}
        result={null}
        places={places}
        geocodeSearch={vi.fn()}
        onRun={onRun}
        initialOrigin={{ latitude: 47.62, longitude: -122.33, label: "Shared Home" }}
        initialDestination={{ latitude: 47.61, longitude: -122.34, label: "Shared Office" }}
        initialMode="bike"
      />,
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith(
      { latitude: 47.62, longitude: -122.33, label: "Shared Home" },
      { latitude: 47.61, longitude: -122.34, label: "Shared Office" },
      "bike",
    );
    // The chosen endpoints are shown (chooser collapses to the selected label).
    expect(screen.getByText("Shared Home")).toBeInTheDocument();
    expect(screen.getByText("Shared Office")).toBeInTheDocument();
  });

  it("copies a share link built from the current endpoints when a result is present", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onCopyLink = vi.fn().mockReturnValue("http://x/?view=ROUTESTOKEN");
    render(
      <RoutesTab
        analysis={analysis}
        running={false}
        result={twoAlt}
        places={places}
        geocodeSearch={vi.fn()}
        onRun={vi.fn()}
        onCopyLink={onCopyLink}
        initialOrigin={{ latitude: 47.62, longitude: -122.33, label: "Shared Home" }}
        initialDestination={{ latitude: 47.61, longitude: -122.34, label: "Shared Office" }}
        initialMode="transit"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));
    expect(onCopyLink).toHaveBeenCalledWith(
      { latitude: 47.62, longitude: -122.33, label: "Shared Home" },
      { latitude: 47.61, longitude: -122.34, label: "Shared Office" },
      "transit",
    );
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("http://x/?view=ROUTESTOKEN");
  });

  it("hides the copy-link button until a result exists", () => {
    render(
      <RoutesTab
        analysis={analysis}
        running={false}
        result={null}
        places={places}
        geocodeSearch={vi.fn()}
        onRun={vi.fn()}
        onCopyLink={vi.fn()}
        initialOrigin={{ latitude: 47.62, longitude: -122.33, label: "Shared Home" }}
        initialDestination={{ latitude: 47.61, longitude: -122.34, label: "Shared Office" }}
      />,
    );
    expect(screen.queryByRole("button", { name: /copy link to this view/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/RoutesTab.test.tsx`
Expected: FAIL — the new props and copy-link button don't exist yet.

- [ ] **Step 3: Add the props, seeding, run-once, and copy-link to `RoutesTab.tsx`**

3a. Update imports (line 1) to include `useEffect` and `useRef`:
```ts
import { useEffect, useMemo, useRef, useState } from "react";
```

3b. Add a module-level key helper just below the `MODES` const (after line 11):
```ts
function endpointKey(input: RouteEndpointInput): string {
  return "place_id" in input ? `place:${input.place_id}` : `geo:${input.latitude},${input.longitude}`;
}
```

3c. Extend `Props` (the `type Props = {...}` block, lines 15-23) with the new optional props:
```ts
type Props = {
  analysis: AnalysisSettings;
  running: boolean;
  result?: RouteComparison | null;
  error?: string;
  places: Place[];
  geocodeSearch: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onRun: (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string) => void;
  initialOrigin?: RouteEndpointInput;
  initialDestination?: RouteEndpointInput;
  initialMode?: string;
  onCopyLink?: (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string) => string | null;
};
```

3d. Update the component signature (line 94) to destructure the new props:
```ts
export function RoutesTab({ analysis, running, result, error, places, geocodeSearch, onRun, initialOrigin, initialDestination, initialMode, onCopyLink }: Props) {
```

3e. Seed the selection state from the initial props. Replace lines 105-107:
```ts
  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [mode, setMode] = useState("transit");
```
with:
```ts
  const [originKey, setOriginKey] = useState(initialOrigin ? endpointKey(initialOrigin) : "");
  const [destinationKey, setDestinationKey] = useState(initialDestination ? endpointKey(initialDestination) : "");
  const [mode, setMode] = useState(initialMode ?? "transit");
```

3f. Inject the shared endpoints into `options` so the choosers can render them. In the `options` useMemo (lines 109-140), add a seeded-options array and prepend it, deduping by key. Replace the `return [...placeOptions, ...geoOptions, ...recentOptions];` line (139) and the dependency array (140) with:
```ts
    const seededOptions: EndpointOption[] = [];
    for (const ep of [initialOrigin, initialDestination]) {
      if (ep && "latitude" in ep) {
        seededOptions.push({ key: endpointKey(ep), label: ep.label, input: ep, geoResult: undefined });
      }
    }

    const seen = new Set<string>();
    return [...seededOptions, ...placeOptions, ...geoOptions, ...recentOptions].filter((o) => {
      if (seen.has(o.key)) return false;
      seen.add(o.key);
      return true;
    });
  }, [places, geoResults, recent, originKey, destinationKey, initialOrigin, initialDestination]);
```

3g. Run the shared route once on mount. Insert after the `destinationOption`/`canRun` derivations (after line 145):
```ts
  const didInitialRun = useRef(false);
  useEffect(() => {
    if (didInitialRun.current) return;
    if (initialOrigin && initialDestination) {
      didInitialRun.current = true;
      onRun(initialOrigin, initialDestination, initialMode ?? "transit");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

3h. Add the copy-link button. Insert immediately after the querybar `</div>` and before the `{error ? ... : null}` line (after line 201, before line 203):
```ts
      {onCopyLink && originOption && destinationOption && result ? (
        <button
          type="button"
          className="mc-link-copy"
          onClick={async () => {
            const url = onCopyLink(originOption.input, destinationOption.input, mode);
            if (url) await navigator.clipboard.writeText(url);
          }}
        >
          Copy link to this view
        </button>
      ) : null}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/RoutesTab.test.tsx`
Expected: PASS (new tests + all pre-existing RoutesTab tests).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/RoutesTab.tsx frontend/src/components/RoutesTab.test.tsx
git commit -m "feat(saved-views): RoutesTab shared-view seeding, run-once, copy-link"
```

---

## Task 3: MapWorkspace — hydrate a routes `?view=` and build the share URL

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/components/MapWorkspace.test.tsx`

- [ ] **Step 1: Extend the `../api/client` mock, then write the failing test**

The existing `../api/client` mock (`MapWorkspace.test.tsx:17-29`) does NOT stub `createRouteAlternatives` (routes weren't exercised). Add it.

(i) In the `vi.mock("../api/client", () => ({ ... }))` object, add one line:
```ts
  createRouteAlternatives: vi.fn(),
```

(ii) In the `import { ... } from "../api/client";` line (`MapWorkspace.test.tsx:33`), add `createRouteAlternatives` to the destructured names.

(iii) Append this test inside the top-level `describe(...)` block. It mirrors the existing `?view=` analyze/compare tests (`MapWorkspace.test.tsx:388-431`) — same `window.history.replaceState` URL setup and reset, same `vi.mocked(...)` seeding. `encodeView`, `waitFor`, `getDashboardSummary`, `createSession` are already imported at the top of the file:

```ts
  it("hydrates a routes ?view= link: routes tab active, banner shown, one route run", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(createRouteAlternatives).mockResolvedValue({
      request: { id: "r", origin: { label: "Home" }, destination: { label: "Office" }, mode: "transit" },
      alternatives: [],
      context_summaries: [],
      statistical_comparison: null,
    });

    const view = encodeView({
      tab: "routes",
      origin: { latitude: 47.62, longitude: -122.33, label: "Home" },
      destination: { latitude: 47.61, longitude: -122.34, label: "Office" },
      mode: "transit",
      radiusM: 500, startDate: "2024-01-01", endDate: "2024-01-31", layer: "reported",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    expect(await screen.findByText(/shared view/i)).toBeInTheDocument();
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Office")).toBeInTheDocument();
    await waitFor(() => expect(createRouteAlternatives).toHaveBeenCalledTimes(1));
    window.history.replaceState({}, "", "/");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx`
Expected: FAIL — routes props aren't passed to `RoutesTab`, so no route runs and the banner may not show.

- [ ] **Step 3: Wire routes hydration into `MapWorkspace.tsx`**

3a. Derive the shared route from the decoded view. Immediately after the `sharedPoints`/`showBadLink` state (after line 38), add:
```ts
  const initialRoute = initialView?.tab === "routes" ? initialView : null;
```

3b. Generalize the shared-view banner so it also shows for routes views. Replace the `sharedPoints` banner block (lines 279-284):
```ts
        {sharedPoints ? (
          <div className="mc-banner" role="status">
            Shared view · reported incident context.{" "}
            <button type="button" onClick={() => setSharedPoints(null)}>Exit</button>
          </div>
        ) : null}
```
with:
```ts
        {sharedPoints || initialRoute ? (
          <div className="mc-banner" role="status">
            Shared view · reported incident context.{" "}
            <button type="button" onClick={() => setSharedPoints(null)}>Exit</button>
          </div>
        ) : null}
```

3c. Add `buildRoutesShareUrl`. Immediately after the existing `buildShareUrl` `useCallback` (after line 202), add:
```ts
  const buildRoutesShareUrl = useCallback(
    (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string): string | null => {
      const resolve = (ep: RouteEndpointInput) => {
        if ("place_id" in ep) {
          const place = data.places.find((p) => p.id === ep.place_id);
          if (!place) return null;
          return {
            latitude: Number(place.latitude.toFixed(3)),
            longitude: Number(place.longitude.toFixed(3)),
            label: place.display_label,
          };
        }
        return {
          latitude: Number(ep.latitude.toFixed(3)),
          longitude: Number(ep.longitude.toFixed(3)),
          label: ep.label,
        };
      };
      const o = resolve(origin);
      const d = resolve(destination);
      if (!o || !d) return null;
      const encoded = encodeView({
        tab: "routes",
        origin: o,
        destination: d,
        mode: (["transit", "walk", "bike", "drive"].includes(mode) ? mode : "transit") as "transit" | "walk" | "bike" | "drive",
        radiusM: analysis.radiusM,
        startDate: analysis.startDate,
        endDate: analysis.endDate,
        layer: analysis.layer,
      });
      return `${window.location.origin}/?view=${encoded}`;
    },
    [data.places, analysis],
  );
```

3d. Add the `RouteEndpointInput` import. In the type-import line (line 29), add `RouteEndpointInput`:
```ts
import type { AnalysisSettings, AssistantDashboardState, PlaceCreate, RouteEndpointInput, TabKey } from "../types";
```

3e. Pass the routes props to `RoutesTab`. Replace the RoutesTab render block (lines 346-356):
```ts
          {activeTab === "routes" ? (
            <RoutesTab
              analysis={analysis}
              running={routes.running}
              result={routes.result}
              error={routes.error}
              places={data.places}
              geocodeSearch={geocodingProvider.search}
              onRun={routes.runRoute}
            />
          ) : null}
```
with:
```ts
          {activeTab === "routes" ? (
            <RoutesTab
              analysis={analysis}
              running={routes.running}
              result={routes.result}
              error={routes.error}
              places={data.places}
              geocodeSearch={geocodingProvider.search}
              onRun={routes.runRoute}
              initialOrigin={initialRoute?.origin}
              initialDestination={initialRoute?.destination}
              initialMode={initialRoute?.mode}
              onCopyLink={buildRoutesShareUrl}
            />
          ) : null}
```

Note: `initialRoute?.origin` is a `ViewPoint` (`{ latitude, longitude, label }`), which is assignable to the `{ latitude, longitude, label }` arm of `RouteEndpointInput`. No conversion needed.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx`
Expected: PASS (new test + all pre-existing MapWorkspace tests).

- [ ] **Step 5: Typecheck + full frontend tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all frontend tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(saved-views): hydrate routes ?view= + build routes share link"
```

---

## Task 4: Verification gate + roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Full verification gate**

Run: `make test-all`
Expected: `pytest` + `ruff check .` + frontend `npm test` + `npm run build` all pass. (Backend unchanged; the Python suite should be untouched-green.)

- [ ] **Step 2: Tick C3 increment 2 in the roadmap**

In `docs/ROADMAP.md`, find the C3 line. Replace the queued-increment-2 sentence:
```
_Increment 2
  (queued): **Routes saved views** — extend shareable views to the Routes corridor tab._
```
with:
```
_Increment 2 shipped:
  **Routes saved views** — the shareable `?view=` link now covers the Routes corridor tab. A
  routes view carries generalized (~110 m) origin/destination coordinates + mode + settings;
  opening it recomputes the corridor comparison once on load. Frontend-only (the routes
  backend already accepts inline coordinate endpoints); saved-place endpoints are resolved to
  generalized coordinates so no `place_id` enters the link. Unlike inc 1's stateless points
  path, a shared routes view recomputes via `/routes/alternatives` and persists a
  `RouteRequest` under the opener's session — accepted, since that is normal Routes usage.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-07-02-routes-saved-views*`._
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): tick C3 increment 2 — Routes saved views"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin routes-saved-views
gh pr create --base main --title "feat(saved-views): shareable Routes corridor view links (C3 inc 2)" --body "$(cat <<'EOF'
## Summary
Extends the shareable `?view=` link pattern (Analyze/Compare, #78) to the **Routes** corridor tab (C3 increment 2).

- **Wire format:** a `routes` variant of `SavedView` carrying generalized (~110 m) origin/destination coordinates + mode + radius/dates/layer (`frontend/src/lib/savedView.ts`).
- **Copy link:** a "Copy link to this view" button on RoutesTab that generalizes both endpoints and resolves any saved-place endpoint to coordinates — **no `place_id` ever enters the link** (the opener can't resolve another account's saved place).
- **Open:** MapWorkspace hydrates a routes `?view=` → seeds the Routes tab + settings + endpoints and recomputes the corridor comparison once on mount.

**Frontend-only** — the Routes backend already accepts inline coordinate endpoints (`RouteEndpoint` is `place_id` XOR `lat/lng`), so no schema/endpoint/migration change. Opening a shared routes view recomputes via `/routes/alternatives` and persists a `RouteRequest` under the opener's session — the one accepted deviation from inc 1's stateless points path, since it's identical to normal Routes usage.

## Tests
Routes round-trip + rejection (bbox / unknown mode / missing endpoint) in `savedView.test.ts`; seeding + run-once + copy-link (no `place_id` leak) in `RoutesTab.test.tsx`; routes `?view=` hydration in `MapWorkspace.test.tsx`. `make test-all` green.

Spec/plan: `docs/superpowers/{specs,plans}/2026-07-02-routes-saved-views*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **No backend/Python changes.** If you find yourself editing anything under `app/`, stop — the design is frontend-only.
- **Privacy invariant:** the share link must never contain a `place_id` and must carry only 3-decimal (~110 m) coordinates. The `buildRoutesShareUrl` resolver enforces both.
- **Product invariant:** all new copy stays neutral ("Copy link to this view", "Shared view") — never "safe/unsafe/dangerous/risk".
- **Run-once:** the shared route runs exactly once per RoutesTab mount (guarded by `didInitialRun`). RoutesTab unmounts when the user switches tabs (existing behavior), so revisiting Routes re-seeds from the link — acceptable (recompute-on-open).
