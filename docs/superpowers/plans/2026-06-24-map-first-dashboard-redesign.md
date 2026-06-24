# Map-First Public Dashboard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the form-and-table public dashboard with a map-first workspace — a full-bleed Leaflet map for dropping and searching place pins, a graphite tabbed bottom sheet (Places / Analyze / Compare / Export), and reported-incident context shown as radius rings + count badges — matching the visual target mockup.

**Architecture:** A new `MapWorkspace` component owns all session/summary/selection/analysis state (lifted from today's `App.tsx`) and composes presentational children: `MapCanvas` (Leaflet tiles, markers, rings), `BottomSheet` (snap states + tab bar), and four tab panels. Tile and geocoding services sit behind small provider modules so they are swappable. The existing API client (`src/api/client.ts`) and all backend endpoints are unchanged — this is a frontend interaction/presentation change only.

**Tech Stack:** React 19 + TypeScript + Vite; Leaflet 1.9 + react-leaflet 5; Vitest + React Testing Library (jsdom); plain CSS ported from the mockup. Fonts: Fraunces / Archivo / IBM Plex Mono.

**Visual target:** `docs/superpowers/specs/2026-06-24-map-first-dashboard-mockup.html` — open in a browser and match it. Tokens are documented in the spec's "Visual Design" section (`docs/superpowers/specs/2026-06-24-map-first-dashboard-redesign-design.md`). The mock's basemap is hand-drawn SVG for portability; the app uses real Leaflet tiles. Match the look, not the drawing technique.

---

## Conventions

- **TDD.** For every component/module: write the failing test, run it red, implement, run it green, commit. Setup/CSS tasks have no test — verify with `npm run lint` and/or a screenshot.
- **Run commands from `frontend/`.** All paths below are relative to `frontend/` unless noted. Tests: `npm test` (alias for `vitest run --environment jsdom`); a single file: `npx vitest run src/components/Foo.test.tsx`. Types: `npm run lint` (`tsc -b`).
- **CSS class names match the mockup** (the `mc-` prefix). Components reproduce the mockup's DOM structure + classes and add props/behavior. This keeps pixel fidelity high.
- **Numbers use the mono font** via existing CSS (counts, coords, radii already styled by `mc-` classes).
- **Commit messages:** Conventional Commits (`feat:`, `test:`, `refactor:`, `chore:`).
- **Map/geocoding are mocked in tests** (jsdom cannot run Leaflet). Each task that touches the map provides the exact mock.

## Shared contracts

These types/signatures are defined in Phase 0–1 and referenced throughout. Keep names exact.

```ts
// src/types.ts (added in Task 3)
export type TabKey = "places" | "analyze" | "compare" | "export";
export type SheetState = "peek" | "half" | "full";
export type LatLng = { lat: number; lng: number };
export type DraftPin = {
  latitude: number;
  longitude: number;
  display_label: string;
  visit_count: number;
  source: "map" | "search";
};
export type GeocodeResult = { label: string; latitude: number; longitude: number; source: string };
export type AnalysisSettings = { startDate: string; endDate: string; radiusM: number; offenseCategory: string };
```

```ts
// src/lib/mapTiles.ts (Task 4)
export type TileConfig = { url: string; attribution: string; maxZoom: number; provider: string };
export const defaultTileConfig: TileConfig;

// src/lib/geocoding.ts (Task 5)
export interface GeocodingProvider { search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>; }
export function createNominatimProvider(endpoint?: string): GeocodingProvider;
export const geocodingProvider: GeocodingProvider;

// src/lib/incidentSummaries.ts (Task 6)
export function incidentCountForPlace(summary: DashboardSummary | null, placeId: string, radiusM: number): number | null;
```

Component prop contracts (full code in their tasks):

```ts
BottomSheet:   { activeTab: TabKey; onTabChange: (t: TabKey) => void; sheetState: SheetState;
                 onSheetStateChange: (s: SheetState) => void; tabBadges?: Partial<Record<TabKey, number>>;
                 children: React.ReactNode }
MapLegend:     {}  // static
MapCanvas:     { places: Place[]; selectedIds: Set<string>; draft: DraftPin | null; addPinMode: boolean;
                 summary: DashboardSummary | null; radiusM: number; flyTo: LatLng | null;
                 tileConfig: TileConfig; onMapClick: (latlng: LatLng) => void;
                 onMarkerClick: (placeId: string) => void }
PinDraftPopover:{ draft: DraftPin; saving: boolean; error?: string;
                 onChange: (patch: Partial<DraftPin>) => void; onSave: () => void; onCancel: () => void }
PlaceSearch:   { provider: GeocodingProvider; onSelectResult: (r: GeocodeResult) => void }
PlacesTab:     { places: Place[]; selectedIds: Set<string>; summary: DashboardSummary | null; radiusM: number;
                 addPinMode: boolean; draftPopover: React.ReactNode; search: React.ReactNode;
                 onStartAddPin: () => void; onToggleSelect: (id: string) => void; onDelete: (id: string) => void;
                 onManualSubmit: (p: PlaceCreate) => Promise<void>; onImportSubmit: (csv: string) => Promise<void> }
AnalyzeTab:    { selected: Place[]; analysis: AnalysisSettings; availableRadii: number[];
                 running: boolean; onChange: (patch: Partial<AnalysisSettings>) => void; onRun: () => void }
CompareTab:    { selected: Place[]; analysis: AnalysisSettings; summary: DashboardSummary | null;
                 comparison: Record<string, unknown> | null; running: boolean; onRun: () => void }
ExportTab:     { href: string }
```

## File structure

```
frontend/
  index.html                         (modify: Google Fonts <link>s)
  src/
    main.tsx                         (modify: import leaflet css + mapWorkspace.css)
    App.tsx                          (rewrite: render <MapWorkspace/>)
    App.test.tsx                     (rewrite: shell smoke over MapWorkspace)
    types.ts                         (modify: add UI types)
    styles.css                       (keep: still styles reused PlaceForm/BulkPlaceEntry/Notice in modal)
    styles/mapWorkspace.css          (create: ported from mockup + overrides)
    lib/
      analysisDefaults.ts            (reuse unchanged)
      mapTiles.ts (+ test)           (create)
      geocoding.ts (+ test)          (create)
      incidentSummaries.ts (+ test)  (create)
    components/
      MapWorkspace.tsx (+ test)      (create) — state owner
      MapCanvas.tsx (+ test)         (create)
      MapLegend.tsx (+ test)         (create)
      BottomSheet.tsx (+ test)       (create)
      PinDraftPopover.tsx (+ test)   (create)
      PlaceSearch.tsx (+ test)       (create)
      PlacesTab.tsx (+ test)         (create)
      AnalyzeTab.tsx (+ test)        (create)
      CompareTab.tsx (+ test)        (create)
      ExportTab.tsx (+ test)         (create)
      PlaceForm.tsx                  (reuse: manual-entry modal)
      BulkPlaceEntry.tsx             (reuse: import modal)
      Notice.tsx                     (reuse: data caveat in Places tab)
      PlaceTable.tsx                 (delete in Task 19)
      ResultsSummary.tsx             (delete in Task 19)
      AnalysisControls.tsx (+ test)  (delete in Task 19)
      ComparisonPanel.tsx            (delete in Task 19)
      ExportPanel.tsx                (delete in Task 19)
```

---

## Phase 0 — Setup

### Task 1: Add Leaflet dependencies

**Files:**
- Modify: `frontend/package.json` (via npm)

- [ ] **Step 1: Install runtime + types**

Run (from `frontend/`):

```bash
npm install leaflet@^1.9.4 react-leaflet@^5.0.0
npm install -D @types/leaflet@^1.9.12
```

- [ ] **Step 2: Verify versions installed**

Run: `npm ls leaflet react-leaflet @types/leaflet`
Expected: `leaflet@1.9.x`, `react-leaflet@5.x`, `@types/leaflet@1.9.x` with no peer-dependency errors (react-leaflet 5 supports React 19).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add leaflet and react-leaflet"
```

### Task 2: Styling foundation (fonts, Leaflet CSS, ported mockup CSS)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.tsx`
- Create: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Add Google Fonts to `index.html`**

Insert into `<head>` (after the `<meta name="viewport" ...>` line):

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 2: Create `src/styles/mapWorkspace.css` from the mockup**

Copy the **entire contents of the `<style>` block** in `docs/superpowers/specs/2026-06-24-map-first-dashboard-mockup.html` into `src/styles/mapWorkspace.css`, with these exact changes:

1. **Omit** the first line `@import url('https://fonts.googleapis.com/...');` (fonts now load via `index.html`).
2. **Omit** the `body{ ... }` rule (the mock's centered backdrop).
3. **Omit** the `.mc-stage{ ... }` rule (the mock's centered card wrapper).
4. **Keep** every other rule unchanged (`.mc-scope`, `.mc-topbar`, `.mc-controls`, `.mc-legend`, `.mc-pins`, `.pin`, `.ring`, `.halo`, `.badge`, `.mc-sheet`, `.mc-tabs`, `.mc-panel`, `.mc-card`, `.mc-field`, `.mc-chips`, `.mc-compare`, `.mc-caveat`, `.mc-exp`, all `@keyframes`, and the `@media` queries).

Then **append** this block to the end of the file (full-viewport frame + modal + reduced-motion):

```css
.mc-scope{display:block;width:100%;height:100%;}
.mc-frame{position:relative;width:100vw;height:100vh;overflow:hidden;background:var(--paper);border-radius:0;box-shadow:none;}

.mc-modal-scrim{position:fixed;inset:0;z-index:80;background:rgba(20,24,28,.45);display:grid;place-items:center;padding:20px;}
.mc-modal{width:min(560px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:18px;}
.mc-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.mc-modal-head h3{margin:0;font-size:16px;}
.mc-modal-tabs{display:flex;gap:8px;margin-bottom:14px;}
.mc-modal-tab{font-size:13px;font-weight:600;color:#3A3F46;background:#F0EEE8;border:1px solid #e1ded5;border-radius:8px;padding:7px 12px;cursor:pointer;}
.mc-modal-tab.on{color:#fff;background:#B5512F;border-color:#B5512F;}
.mc-iconbtn{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:8px;border:1px solid #e1ded5;background:#fff;cursor:pointer;color:#3A3F46;}

.mc-pins .leaflet-marker-icon{background:transparent;border:0;}
.mc-empty{position:absolute;left:50%;top:42%;z-index:36;transform:translate(-50%,-50%);text-align:center;
  background:rgba(255,255,255,.94);border:1px solid rgba(20,24,28,.08);border-radius:14px;padding:18px 22px;
  box-shadow:0 14px 30px -16px rgba(18,22,26,.42);max-width:320px;}
.mc-empty h3{margin:0 0 6px;font-size:16px;color:#1C1F23;}
.mc-empty p{margin:0;font-size:13px;color:#3A3F46;line-height:1.5;}

@media (prefers-reduced-motion: reduce){
  .pin .body,.halo,.mc-sheet,.mc-panel.is-active,.mc-addpin.is-armed{animation:none !important;}
}
```

- [ ] **Step 3: Import Leaflet + workspace CSS in `main.tsx`**

Replace the import line `import "./styles.css";` with:

```tsx
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./styles/mapWorkspace.css";
```

- [ ] **Step 4: Verify build**

Run: `npm run lint`
Expected: no TypeScript errors. (CSS is not type-checked; visual check happens once `MapWorkspace` renders in Task 17.)

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.tsx src/styles/mapWorkspace.css
git commit -m "feat: add map-first styling foundation and fonts"
```

### Task 3: Add UI types

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Append the UI types**

Append to the end of `src/types.ts`:

```ts
export type TabKey = "places" | "analyze" | "compare" | "export";

export type SheetState = "peek" | "half" | "full";

export type LatLng = { lat: number; lng: number };

export type DraftPin = {
  latitude: number;
  longitude: number;
  display_label: string;
  visit_count: number;
  source: "map" | "search";
};

export type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
  source: string;
};

export type AnalysisSettings = {
  startDate: string;
  endDate: string;
  radiusM: number;
  offenseCategory: string;
};
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add map workspace UI types"
```

---

## Phase 1 — Provider modules & helpers

### Task 4: Map tile provider

**Files:**
- Create: `frontend/src/lib/mapTiles.ts`
- Test: `frontend/src/lib/mapTiles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { defaultTileConfig } from "./mapTiles";

describe("defaultTileConfig", () => {
  it("uses the muted Carto Positron basemap with attribution", () => {
    expect(defaultTileConfig.url).toContain("basemaps.cartocdn.com/light_all");
    expect(defaultTileConfig.attribution).toContain("OpenStreetMap");
    expect(defaultTileConfig.attribution).toContain("CARTO");
    expect(defaultTileConfig.maxZoom).toBeGreaterThanOrEqual(18);
    expect(defaultTileConfig.provider).toBe("carto-positron");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mapTiles.test.ts`
Expected: FAIL — cannot find module `./mapTiles`.

- [ ] **Step 3: Implement**

Create `src/lib/mapTiles.ts`:

```ts
export type TileConfig = {
  url: string;
  attribution: string;
  maxZoom: number;
  provider: string;
};

// Muted "Positron" basemap so the data layer (pins, rings) reads clearly.
// Carto's usage policy covers light public web traffic; swap `defaultTileConfig`
// for a keyed provider (MapTiler / Stadia) before high-volume production use.
export const defaultTileConfig: TileConfig = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 19,
  provider: "carto-positron",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mapTiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mapTiles.ts src/lib/mapTiles.test.ts
git commit -m "feat: add map tile provider config"
```

### Task 5: Geocoding provider

**Files:**
- Create: `frontend/src/lib/geocoding.ts`
- Test: `frontend/src/lib/geocoding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNominatimProvider } from "./geocoding";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createNominatimProvider", () => {
  it("maps search rows to GeocodeResult and queries the endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { display_name: "Pike Place Market, Seattle", lat: "47.6097", lon: "-122.3331" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createNominatimProvider();
    const results = await provider.search("pike place");

    expect(results).toEqual([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("format=jsonv2");
    expect(calledUrl).toContain("q=pike%20place");
  });

  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = createNominatimProvider();

    expect(await provider.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the endpoint responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const provider = createNominatimProvider();

    await expect(provider.search("x")).rejects.toThrow("Search failed with status 500");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geocoding.test.ts`
Expected: FAIL — cannot find module `./geocoding`.

- [ ] **Step 3: Implement**

Create `src/lib/geocoding.ts`:

```ts
import type { GeocodeResult } from "../types";

export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
}

type NominatimRow = { display_name: string; lat: string; lon: string };

// Nominatim is fine for local/dev (max ~1 req/s, no autocomplete-style use).
// Public production must move to a provider that permits browser traffic at volume.
export function createNominatimProvider(
  endpoint = "https://nominatim.openstreetmap.org/search",
): GeocodingProvider {
  return {
    async search(query, signal) {
      const trimmed = query.trim();
      if (!trimmed) {
        return [];
      }
      const url = `${endpoint}?format=jsonv2&limit=5&q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }
      const rows = (await response.json()) as NominatimRow[];
      return rows.map((row) => ({
        label: row.display_name,
        latitude: Number(row.lat),
        longitude: Number(row.lon),
        source: "nominatim",
      }));
    },
  };
}

export const geocodingProvider = createNominatimProvider();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geocoding.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geocoding.ts src/lib/geocoding.test.ts
git commit -m "feat: add geocoding provider behind an interface"
```

### Task 6: Incident-count helper

**Files:**
- Create: `frontend/src/lib/incidentSummaries.ts`
- Test: `frontend/src/lib/incidentSummaries.test.ts`

> **Assumption to verify against a live summary:** `crime_summaries[].place_cluster_id` matches `Place.id`. If the backend clusters places under a different id, update the match in `incidentCountForPlace` (single place to change).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { incidentCountForPlace } from "./incidentSummaries";
import type { DashboardSummary } from "../types";

function summaryWith(count: number, radiusM: number): DashboardSummary {
  return {
    totals: { place_count: 1, visit_count: 0, incident_count: count },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [],
    crime_summaries: [
      {
        place_cluster_id: "p1",
        radius_m: radiusM,
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-24",
        offense_category: null,
        offense_subcategory: null,
        nibrs_group: null,
        incident_count: count,
        nearest_incident_m: null,
        incidents_per_visit: null,
        incidents_per_hour_dwell: null,
      },
    ],
    analysis: { available_radii_m: [radiusM] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  };
}

describe("incidentCountForPlace", () => {
  it("returns the matching count for place + radius", () => {
    expect(incidentCountForPlace(summaryWith(7, 250), "p1", 250)).toBe(7);
  });

  it("returns null when no summary matches the radius", () => {
    expect(incidentCountForPlace(summaryWith(7, 250), "p1", 500)).toBeNull();
  });

  it("returns null when summary is null", () => {
    expect(incidentCountForPlace(null, "p1", 250)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/incidentSummaries.test.ts`
Expected: FAIL — cannot find module `./incidentSummaries`.

- [ ] **Step 3: Implement**

Create `src/lib/incidentSummaries.ts`:

```ts
import type { DashboardSummary } from "../types";

export function incidentCountForPlace(
  summary: DashboardSummary | null,
  placeId: string,
  radiusM: number,
): number | null {
  if (!summary) {
    return null;
  }
  const match = summary.crime_summaries.find(
    (entry) => entry.place_cluster_id === placeId && entry.radius_m === radiusM,
  );
  return match ? match.incident_count : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/incidentSummaries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/incidentSummaries.ts src/lib/incidentSummaries.test.ts
git commit -m "feat: add incident-count lookup helper"
```

---

## Phase 2 — Presentational shell pieces

### Task 7: BottomSheet (tabs + snap states)

**Files:**
- Create: `frontend/src/components/BottomSheet.tsx`
- Test: `frontend/src/components/BottomSheet.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./BottomSheet";

afterEach(cleanup);

describe("BottomSheet", () => {
  it("renders four tabs and marks the active one", () => {
    render(
      <BottomSheet activeTab="places" onTabChange={vi.fn()} sheetState="half" onSheetStateChange={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /places/i })).toHaveAttribute("aria-selected", "true");
  });

  it("calls onTabChange when another tab is clicked", () => {
    const onTabChange = vi.fn();
    render(
      <BottomSheet activeTab="places" onTabChange={onTabChange} sheetState="half" onSheetStateChange={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    expect(onTabChange).toHaveBeenCalledWith("analyze");
  });

  it("exposes snap controls and reflects the state class", () => {
    const onSheetStateChange = vi.fn();
    const { container } = render(
      <BottomSheet activeTab="places" onTabChange={vi.fn()} sheetState="half" onSheetStateChange={onSheetStateChange}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(container.querySelector(".mc-sheet")).toHaveClass("is-half");
    fireEvent.click(screen.getByRole("button", { name: /full/i }));
    expect(onSheetStateChange).toHaveBeenCalledWith("full");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BottomSheet.test.tsx`
Expected: FAIL — cannot find module `./BottomSheet`.

- [ ] **Step 3: Implement the component**

Create `src/components/BottomSheet.tsx`:

```tsx
import type { ReactNode } from "react";

import type { SheetState, TabKey } from "../types";

type Props = {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  sheetState: SheetState;
  onSheetStateChange: (state: SheetState) => void;
  tabBadges?: Partial<Record<TabKey, number>>;
  children: ReactNode;
};

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  {
    key: "places",
    label: "Places",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ),
  },
  {
    key: "analyze",
    label: "Analyze",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
        <circle cx="16" cy="8" r="2.4" />
        <circle cx="8" cy="16" r="2.4" />
      </svg>
    ),
  },
  {
    key: "compare",
    label: "Compare",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 20V10M12 20V4M19 20v-7" />
      </svg>
    ),
  },
  {
    key: "export",
    label: "Export",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
      </svg>
    ),
  },
];

const SNAPS: SheetState[] = ["full", "half", "peek"];

export function BottomSheet({
  activeTab,
  onTabChange,
  sheetState,
  onSheetStateChange,
  tabBadges,
  children,
}: Props) {
  function cycle() {
    const order: SheetState[] = ["peek", "half", "full"];
    onSheetStateChange(order[(order.indexOf(sheetState) + 1) % order.length]);
  }

  return (
    <section className={`mc-sheet is-${sheetState}`} aria-label="Workspace panel">
      <button type="button" className="mc-handle" aria-label="Cycle panel height" onClick={cycle} />
      <div className="mc-snaps" role="group" aria-label="Panel height">
        {SNAPS.map((snap) => (
          <button
            key={snap}
            type="button"
            className={snap === sheetState ? "on" : undefined}
            aria-pressed={snap === sheetState}
            onClick={() => onSheetStateChange(snap)}
          >
            <span>{snap}</span>
            <b />
          </button>
        ))}
      </div>
      <nav className="mc-tabs" role="tablist" aria-label="Workspace sections">
        {TABS.map((tab) => {
          const badge = tabBadges?.[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`mc-tab${activeTab === tab.key ? " is-active" : ""}`}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.icon}
              {tab.label}
              {badge ? <span className="pill">{badge}</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="mc-panels">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/BottomSheet.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add sheet-state + snap CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.mc-sheet.is-peek{height:92px;}
.mc-sheet.is-half{height:56%;}
.mc-sheet.is-full{height:90%;}
button.mc-handle{appearance:none;border:0;padding:0;cursor:pointer;}
.mc-snaps button{appearance:none;background:transparent;border:0;cursor:pointer;font:inherit;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);display:flex;align-items:center;gap:6px;padding:2px;}
.mc-snaps button b{width:14px;height:3px;border-radius:2px;background:rgba(255,255,255,.18);display:inline-block;}
.mc-snaps button.on{color:var(--clay);}
.mc-snaps button.on b{background:var(--clay);width:20px;}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/BottomSheet.tsx src/components/BottomSheet.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add bottom sheet with tabs and snap states"
```

### Task 8: MapLegend

**Files:**
- Create: `frontend/src/components/MapLegend.tsx`
- Test: `frontend/src/components/MapLegend.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MapLegend } from "./MapLegend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("documents every marker state", () => {
    render(<MapLegend />);
    expect(screen.getByText("Map key")).toBeInTheDocument();
    expect(screen.getByText("Saved place")).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText(/Analyzed radius/i)).toBeInTheDocument();
    expect(screen.getByText("Low data")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MapLegend.test.tsx`
Expected: FAIL — cannot find module `./MapLegend`.

- [ ] **Step 3: Implement the component**

Create `src/components/MapLegend.tsx` (markup ported from the mockup's `.mc-legend`):

```tsx
export function MapLegend() {
  return (
    <div className="mc-legend" aria-label="Map key">
      <h3>Map key</h3>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="15" height="19" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#3A3F46" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
        </span>
        <span>Saved place</span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="16" height="20" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
        </span>
        <span>Selected</span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--clay-soft)", border: "1.5px solid rgba(205,106,69,.5)", display: "block" }} />
        </span>
        <span>Analyzed radius<small>incident count</small></span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="15" height="19" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#74858E" /><text x="12" y="16" fontSize="13" fill="#fff" textAnchor="middle" fontFamily="Archivo">?</text></svg>
        </span>
        <span>Low data<small>needs review</small></span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MapLegend.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MapLegend.tsx src/components/MapLegend.test.tsx
git commit -m "feat: add map legend"
```

### Task 9: MapCanvas (Leaflet tiles, markers, rings)

**Files:**
- Create: `frontend/src/components/MapCanvas.tsx`
- Test: `frontend/src/components/MapCanvas.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

> Markers are Leaflet `divIcon`s (HTML strings), not the mock's absolutely-positioned `.pin` divs, because Leaflet renders them in its own marker pane. The SVGs/colors match the mockup; the positioning classes are Leaflet-specific (`mc-pin-icon`, `mc-pin-badge`, `mc-pin-tag`, `mc-pin-halo`). Radius rings are react-leaflet `<Circle>` styled with `pathOptions`. jsdom can't run Leaflet, so the test mocks `react-leaflet`. Map-click → draft is verified later in `MapWorkspace.test` (which mocks this component).

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, className }: any) => (
    <div data-testid="map" className={className}>{children}</div>
  ),
  TileLayer: ({ url }: any) => <div data-testid="tile" data-url={url} />,
  Marker: ({ position, eventHandlers }: any) => (
    <button data-testid="marker" data-pos={(position as number[]).join(",")} onClick={eventHandlers?.click} />
  ),
  Circle: ({ radius }: any) => <div data-testid="ring" data-radius={radius} />,
  useMap: () => ({ flyTo: vi.fn(), getZoom: () => 12 }),
  useMapEvents: () => null,
}));

import { MapCanvas } from "./MapCanvas";
import { defaultTileConfig } from "../lib/mapTiles";
import type { DashboardSummary, Place } from "../types";

const place: Place = {
  id: "p1",
  display_label: "Home",
  latitude: 47.61,
  longitude: -122.33,
  visit_count: 5,
  total_dwell_minutes: null,
  inferred_place_type: "manual_place",
  sensitivity_class: "normal",
};

function summaryWithCount(): DashboardSummary {
  return {
    totals: { place_count: 1, visit_count: 5, incident_count: 9 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [place],
    crime_summaries: [
      {
        place_cluster_id: "p1",
        radius_m: 250,
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-24",
        offense_category: null,
        offense_subcategory: null,
        nibrs_group: null,
        incident_count: 9,
        nearest_incident_m: null,
        incidents_per_visit: null,
        incidents_per_hour_dwell: null,
      },
    ],
    analysis: { available_radii_m: [250] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  };
}

afterEach(cleanup);
const noop = () => {};

describe("MapCanvas", () => {
  it("renders the configured tile layer", () => {
    render(
      <MapCanvas places={[]} selectedIds={new Set()} draft={null} addPinMode={false} summary={null}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={noop} />,
    );
    expect(screen.getByTestId("tile")).toHaveAttribute("data-url", defaultTileConfig.url);
  });

  it("renders one marker per place and reports clicks by id", () => {
    const onMarkerClick = vi.fn();
    render(
      <MapCanvas places={[place]} selectedIds={new Set()} draft={null} addPinMode={false} summary={null}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={onMarkerClick} />,
    );
    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(1);
    fireEvent.click(markers[0]);
    expect(onMarkerClick).toHaveBeenCalledWith("p1");
  });

  it("draws a radius ring for analyzed places", () => {
    render(
      <MapCanvas places={[place]} selectedIds={new Set(["p1"])} draft={null} addPinMode={false} summary={summaryWithCount()}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={noop} />,
    );
    expect(screen.getByTestId("ring")).toHaveAttribute("data-radius", "250");
  });

  it("renders a draft marker in addition to place markers", () => {
    render(
      <MapCanvas
        places={[place]}
        selectedIds={new Set()}
        draft={{ latitude: 47.6, longitude: -122.3, display_label: "", visit_count: 1, source: "map" }}
        addPinMode
        summary={null}
        radiusM={250}
        flyTo={null}
        tileConfig={defaultTileConfig}
        onMapClick={noop}
        onMarkerClick={noop}
      />,
    );
    expect(screen.getAllByTestId("marker")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MapCanvas.test.tsx`
Expected: FAIL — cannot find module `./MapCanvas`.

- [ ] **Step 3: Implement the component**

Create `src/components/MapCanvas.tsx`:

```tsx
import * as L from "leaflet";
import { Fragment, useEffect } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { incidentCountForPlace } from "../lib/incidentSummaries";
import type { TileConfig } from "../lib/mapTiles";
import type { DashboardSummary, DraftPin, LatLng, Place } from "../types";

const SEATTLE: [number, number] = [47.6062, -122.3321];

type MarkerKind = "default" | "selected" | "analyzed" | "low";

const DOT = '<circle cx="12" cy="11.5" r="4.4" fill="#fff"/>';
const QGLYPH = '<text x="12" y="16" font-size="13" fill="#fff" text-anchor="middle" font-family="Archivo" font-weight="700">?</text>';

function teardrop(fill: string, glyph: string): string {
  return `<svg width="28" height="36" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="${fill}"/>${glyph}</svg>`;
}

function iconHtml(kind: MarkerKind, opts: { count?: number | null; label?: string }): string {
  if (kind === "selected") {
    return `<span class="mc-pin-halo"></span>${teardrop("#CD6A45", DOT)}<span class="mc-pin-tag">${opts.label ?? ""}</span>`;
  }
  if (kind === "analyzed") {
    return `${teardrop("#3A3F46", DOT)}<span class="mc-pin-badge"><b>${opts.count ?? 0}</b><i>inc.</i></span>`;
  }
  if (kind === "low") {
    return teardrop("#74858E", QGLYPH);
  }
  return teardrop("#3A3F46", DOT);
}

function makeIcon(kind: MarkerKind, opts: { count?: number | null; label?: string } = {}): L.DivIcon {
  return L.divIcon({ className: "mc-pin-icon", html: iconHtml(kind, opts), iconSize: [28, 36], iconAnchor: [14, 36] });
}

const DRAFT_ICON = L.divIcon({
  className: "mc-pin-icon mc-pin-draft",
  html: teardrop("#B5512F", DOT),
  iconSize: [28, 36],
  iconAnchor: [14, 36],
});

function MapClickHandler({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15));
    }
  }, [target, map]);
  return null;
}

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  draft: DraftPin | null;
  addPinMode: boolean;
  summary: DashboardSummary | null;
  radiusM: number;
  flyTo: LatLng | null;
  tileConfig: TileConfig;
  onMapClick: (latlng: LatLng) => void;
  onMarkerClick: (placeId: string) => void;
};

export function MapCanvas({
  places,
  selectedIds,
  draft,
  addPinMode,
  summary,
  radiusM,
  flyTo,
  tileConfig,
  onMapClick,
  onMarkerClick,
}: Props) {
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;

  function kindFor(place: Place): MarkerKind {
    if (incidentCountForPlace(summary, place.id, radiusM) !== null) {
      return "analyzed";
    }
    if (analyzedAtRadius && selectedIds.has(place.id)) {
      return "low";
    }
    if (selectedIds.has(place.id)) {
      return "selected";
    }
    return "default";
  }

  return (
    <MapContainer
      center={SEATTLE}
      zoom={12}
      className={`mc-map${addPinMode ? " is-adding" : ""}`}
      zoomControl={false}
      attributionControl
    >
      <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} maxZoom={tileConfig.maxZoom} />
      <MapClickHandler onMapClick={onMapClick} />
      <FlyTo target={flyTo} />
      {places.map((place) => {
        if (place.latitude === null || place.longitude === null) {
          return null;
        }
        const position: [number, number] = [place.latitude, place.longitude];
        const kind = kindFor(place);
        const count = incidentCountForPlace(summary, place.id, radiusM);
        return (
          <Fragment key={place.id}>
            {kind === "analyzed" ? (
              <Circle center={position} radius={radiusM} pathOptions={{ color: "#CD6A45", weight: 1.5, fillColor: "#CD6A45", fillOpacity: 0.15 }} />
            ) : null}
            {kind === "low" ? (
              <Circle center={position} radius={radiusM} pathOptions={{ color: "#74858E", weight: 1.5, dashArray: "4 4", fillColor: "#74858E", fillOpacity: 0.12 }} />
            ) : null}
            <Marker
              position={position}
              icon={makeIcon(kind, { count, label: place.display_label })}
              eventHandlers={{ click: () => onMarkerClick(place.id) }}
            />
          </Fragment>
        );
      })}
      {draft ? <Marker position={[draft.latitude, draft.longitude]} icon={DRAFT_ICON} /> : null}
    </MapContainer>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MapCanvas.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add Leaflet-context CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.leaflet-container.mc-map{height:100%;width:100%;background:var(--paper);font-family:var(--f-ui);}
.mc-map.is-adding{cursor:crosshair;}
.mc-pin-icon{background:transparent;border:0;overflow:visible;}
.mc-pin-icon svg{display:block;filter:drop-shadow(0 6px 7px rgba(20,24,28,.28));animation:pindrop .5s cubic-bezier(.2,.9,.25,1.1) both;transform-origin:bottom center;}
.mc-pin-badge{position:absolute;left:100%;top:0;transform:translate(-8px,-55%);display:inline-flex;align-items:baseline;gap:4px;background:#fff;border:1px solid rgba(20,24,28,.09);border-radius:999px;padding:4px 9px;box-shadow:0 8px 18px -10px rgba(18,22,26,.45);white-space:nowrap;}
.mc-pin-badge b{font-family:var(--f-mono);font-weight:500;font-size:12px;color:var(--clay-deep);line-height:1;}
.mc-pin-badge i{font-style:normal;font-size:10px;color:#9aa0a6;}
.mc-pin-tag{position:absolute;left:50%;bottom:100%;transform:translate(-50%,-4px);white-space:nowrap;font-family:var(--f-ui);font-size:12px;font-weight:600;color:#fff;background:var(--ink);padding:5px 10px;border-radius:9px;box-shadow:0 8px 16px -8px rgba(0,0,0,.5);}
.mc-pin-halo{position:absolute;left:50%;top:100%;width:26px;height:26px;transform:translate(-50%,-22px);border-radius:50%;background:var(--clay-halo);animation:halo 2.3s ease-out infinite;}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add leaflet map canvas with marker states and rings"
```

---

## Phase 3 — Place entry

### Task 10: PinDraftPopover

**Files:**
- Create: `frontend/src/components/PinDraftPopover.tsx`
- Test: `frontend/src/components/PinDraftPopover.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PinDraftPopover } from "./PinDraftPopover";
import type { DraftPin } from "../types";

const draft: DraftPin = { latitude: 47.6097, longitude: -122.3331, display_label: "", visit_count: 1, source: "map" };

afterEach(cleanup);

describe("PinDraftPopover", () => {
  it("disables save until a label is entered and emits label changes", () => {
    const onChange = vi.fn();
    render(<PinDraftPopover draft={draft} saving={false} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: /save pin/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Home" } });
    expect(onChange).toHaveBeenCalledWith({ display_label: "Home" });
  });

  it("saves and cancels through their callbacks", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <PinDraftPopover draft={{ ...draft, display_label: "Home" }} saving={false} onChange={vi.fn()} onSave={onSave} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PinDraftPopover.test.tsx`
Expected: FAIL — cannot find module `./PinDraftPopover`.

- [ ] **Step 3: Implement the component**

Create `src/components/PinDraftPopover.tsx`:

```tsx
import type { FormEvent } from "react";

import type { DraftPin } from "../types";

type Props = {
  draft: DraftPin;
  saving: boolean;
  error?: string;
  onChange: (patch: Partial<DraftPin>) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function PinDraftPopover({ draft, saving, error, onChange, onSave, onCancel }: Props) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }

  return (
    <form className="mc-draft" aria-label="New pin details" onSubmit={handleSubmit}>
      <div className="mc-draft-head">
        <span className="mc-draft-title">New pin</span>
        <span className="mc-draft-coord">
          {draft.latitude.toFixed(4)}, {draft.longitude.toFixed(4)} · from {draft.source}
        </span>
      </div>
      <label htmlFor="draft-label">Label</label>
      <input
        id="draft-label"
        value={draft.display_label}
        placeholder="Home, Office, Gym…"
        onChange={(event) => onChange({ display_label: event.target.value })}
      />
      <label htmlFor="draft-visits">Visits per week</label>
      <input
        id="draft-visits"
        inputMode="numeric"
        value={String(draft.visit_count)}
        onChange={(event) => onChange({ visit_count: Number(event.target.value) || 0 })}
      />
      {error ? <p className="mc-draft-error" role="alert">{error}</p> : null}
      <div className="mc-draft-actions">
        <button type="button" className="mc-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="mc-cta" disabled={saving || !draft.display_label.trim()}>
          {saving ? "Saving…" : "Save pin"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PinDraftPopover.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add draft CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.mc-draft{background:rgba(205,106,69,.10);border:1px solid rgba(205,106,69,.4);border-radius:13px;padding:13px;margin-bottom:12px;display:grid;gap:8px;}
.mc-draft-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.mc-draft-title{font-size:13px;font-weight:600;color:var(--text);}
.mc-draft-coord{font-family:var(--f-mono);font-size:11px;color:var(--faint);}
.mc-draft label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dim);}
.mc-draft input{height:38px;border-radius:9px;background:var(--ink-raise);border:1px solid var(--line);color:var(--text);font-family:var(--f-ui);font-size:13.5px;padding:0 11px;}
.mc-draft input:focus{outline:2px solid var(--clay-soft);outline-offset:1px;}
.mc-draft-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;}
.mc-draft-error{margin:0;color:#E8A98F;font-size:12px;}
.mc-ghost{height:40px;padding:0 14px;border-radius:10px;background:transparent;border:1px solid var(--line);color:var(--dim);font-family:var(--f-ui);font-weight:500;font-size:13px;cursor:pointer;}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/PinDraftPopover.tsx src/components/PinDraftPopover.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add pin draft popover"
```

### Task 11: PlaceSearch

**Files:**
- Create: `frontend/src/components/PlaceSearch.tsx`
- Test: `frontend/src/components/PlaceSearch.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

> Search runs on submit (button or Enter), not on every keystroke — keeps it within Nominatim's rate policy and avoids debounce flakiness in tests.

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceSearch } from "./PlaceSearch";
import type { GeocodingProvider } from "../lib/geocoding";

afterEach(cleanup);

function providerReturning(): GeocodingProvider {
  return {
    search: vi.fn().mockResolvedValue([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]),
  };
}

describe("PlaceSearch", () => {
  it("searches on submit and emits the chosen result", async () => {
    const onSelectResult = vi.fn();
    render(<PlaceSearch provider={providerReturning()} onSelectResult={onSelectResult} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "pike place" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const result = await screen.findByText("Pike Place Market, Seattle");
    fireEvent.click(result);
    expect(onSelectResult).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Pike Place Market, Seattle", latitude: 47.6097 }),
    );
  });

  it("shows a fallback message when search fails", async () => {
    const provider: GeocodingProvider = { search: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<PlaceSearch provider={provider} onSelectResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/drop a pin/i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PlaceSearch.test.tsx`
Expected: FAIL — cannot find module `./PlaceSearch`.

- [ ] **Step 3: Implement the component**

Create `src/components/PlaceSearch.tsx`:

```tsx
import { useState } from "react";
import type { FormEvent } from "react";

import type { GeocodingProvider } from "../lib/geocoding";
import type { GeocodeResult } from "../types";

type Props = {
  provider: GeocodingProvider;
  onSelectResult: (result: GeocodeResult) => void;
};

type Status = "idle" | "loading" | "done" | "error";

export function PlaceSearch({ provider, onSelectResult }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }
    setStatus("loading");
    try {
      const found = await provider.search(query);
      setResults(found);
      setStatus("done");
    } catch {
      setResults([]);
      setStatus("error");
    }
  }

  return (
    <div className="mc-search-wrap">
      <form className="mc-search mc-search--sheet" onSubmit={runSearch} role="search">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search an address or place"
          aria-label="Search an address or place"
        />
        <button type="submit" className="mc-search-go">Search</button>
      </form>
      {status === "error" ? (
        <p className="mc-search-msg" role="alert">Search is unavailable. Drop a pin on the map instead.</p>
      ) : null}
      {status === "done" && results.length === 0 ? (
        <p className="mc-search-msg">No matches. Drop a pin on the map instead.</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mc-results" aria-label="Search results">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button type="button" onClick={() => onSelectResult(result)}>
                <span className="mc-result-label">{result.label}</span>
                <span className="mc-result-coord">{result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PlaceSearch.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add search/results CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.mc-search-wrap{display:grid;gap:8px;margin-bottom:12px;}
.mc-search--sheet{background:var(--ink-raise);border:1px solid var(--line);box-shadow:none;color:var(--dim);}
.mc-search--sheet input{color:var(--text);}
.mc-search--sheet input::placeholder{color:var(--faint);}
.mc-search-go{height:32px;padding:0 12px;border-radius:8px;border:0;background:var(--clay-deep);color:#fff;font-family:var(--f-ui);font-weight:600;font-size:12.5px;cursor:pointer;}
.mc-search-msg{margin:0;font-size:12px;color:var(--dim);}
.mc-results{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:180px;overflow:auto;}
.mc-results button{width:100%;text-align:left;display:grid;gap:2px;padding:9px 11px;border-radius:10px;background:var(--ink-raise);border:1px solid var(--line);color:var(--text);cursor:pointer;}
.mc-results button:hover{border-color:rgba(205,106,69,.5);}
.mc-result-label{font-size:13px;}
.mc-result-coord{font-family:var(--f-mono);font-size:11px;color:var(--faint);}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/PlaceSearch.tsx src/components/PlaceSearch.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add place search"
```

### Task 12: PlacesTab (list, selection, manual/import modal)

**Files:**
- Create: `frontend/src/components/PlacesTab.tsx`
- Test: `frontend/src/components/PlacesTab.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

> Reuses the existing `PlaceForm`, `BulkPlaceEntry`, and `Notice` components unchanged. Manual/import live in a modal so their light styling does not fight the dark sheet; the `Notice` caveat is recolored for the sheet via CSS only.

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlacesTab } from "./PlacesTab";
import type { DashboardSummary, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};

const summary: DashboardSummary = {
  totals: { place_count: 1, visit_count: 5, incident_count: 9 },
  privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [home],
  crime_summaries: [
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
      offense_category: null, offense_subcategory: null, nibrs_group: null, incident_count: 9,
      nearest_incident_m: null, incidents_per_visit: null, incidents_per_hour_dwell: null },
  ],
  analysis: { available_radii_m: [250] },
  exports: { tableau_place_summary_csv: "/x.csv" },
};

function renderTab(overrides: Partial<React.ComponentProps<typeof PlacesTab>> = {}) {
  const props = {
    places: [home],
    selectedIds: new Set<string>(),
    summary,
    radiusM: 250,
    addPinMode: false,
    draftPopover: null,
    search: <div data-testid="search-slot" />,
    onStartAddPin: vi.fn(),
    onToggleSelect: vi.fn(),
    onDelete: vi.fn(),
    onManualSubmit: vi.fn().mockResolvedValue(undefined),
    onImportSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<PlacesTab {...props} />);
  return props;
}

afterEach(cleanup);

describe("PlacesTab", () => {
  it("lists saved places with an analyzed count badge", () => {
    renderTab();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("9 inc.")).toBeInTheDocument();
  });

  it("toggles selection and deletion through callbacks", () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Home" }));
    expect(props.onToggleSelect).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "Remove Home" }));
    expect(props.onDelete).toHaveBeenCalledWith("p1");
  });

  it("opens the manual-entry modal", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PlacesTab.test.tsx`
Expected: FAIL — cannot find module `./PlacesTab`.

- [ ] **Step 3: Implement the component**

Create `src/components/PlacesTab.tsx`:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";

import { BulkPlaceEntry } from "./BulkPlaceEntry";
import { Notice } from "./Notice";
import { PlaceForm } from "./PlaceForm";
import { incidentCountForPlace } from "../lib/incidentSummaries";
import type { DashboardSummary, Place, PlaceCreate } from "../types";

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  summary: DashboardSummary | null;
  radiusM: number;
  addPinMode: boolean;
  draftPopover: ReactNode;
  search: ReactNode;
  onStartAddPin: () => void;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onManualSubmit: (place: PlaceCreate) => Promise<void>;
  onImportSubmit: (csv: string) => Promise<void>;
};

function coords(place: Place): string {
  if (place.latitude === null || place.longitude === null) {
    return "No coordinates";
  }
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
}

function pinSvg(selected: boolean) {
  return (
    <svg width="15" height="20" viewBox="0 0 24 32">
      <path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill={selected ? "#CD6A45" : "#3A3F46"} />
      <circle cx="12" cy="11.5" r="4.4" fill="#fff" />
    </svg>
  );
}

export function PlacesTab({
  places,
  selectedIds,
  summary,
  radiusM,
  addPinMode,
  draftPopover,
  search,
  onStartAddPin,
  onToggleSelect,
  onDelete,
  onManualSubmit,
  onImportSubmit,
}: Props) {
  const [modal, setModal] = useState<null | "manual" | "import">(null);
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Places">
      <div className="mc-panel-head">
        <h4>Saved places <b>{places.length}</b></h4>
        <div className="mc-head-actions">
          <button type="button" className={`mc-tinybtn${addPinMode ? " on" : ""}`} onClick={onStartAddPin}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {addPinMode ? "Click map…" : "Drop pin"}
          </button>
          <button type="button" className="mc-tinybtn" onClick={() => setModal("manual")}>Add manually</button>
          <button type="button" className="mc-tinybtn" onClick={() => setModal("import")}>Import</button>
        </div>
      </div>

      {search}
      {draftPopover}

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
                  <div className="sub">{coords(place)} · {place.visit_count} visits</div>
                </div>
                <div className="right">
                  {count !== null ? <span className="cnt">{count} inc.</span> : null}
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

      {modal ? (
        <div className="mc-modal-scrim" role="dialog" aria-modal="true" aria-label={modal === "manual" ? "Add a place manually" : "Import places"}>
          <div className="mc-modal">
            <div className="mc-modal-head">
              <h3>{modal === "manual" ? "Add a place manually" : "Import places"}</h3>
              <button type="button" className="mc-iconbtn" aria-label="Close" onClick={() => setModal(null)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="mc-modal-tabs">
              <button type="button" className={`mc-modal-tab${modal === "manual" ? " on" : ""}`} onClick={() => setModal("manual")}>Manual</button>
              <button type="button" className={`mc-modal-tab${modal === "import" ? " on" : ""}`} onClick={() => setModal("import")}>Bulk CSV</button>
            </div>
            {modal === "manual" ? (
              <PlaceForm onSubmit={async (place) => { await onManualSubmit(place); setModal(null); }} />
            ) : (
              <BulkPlaceEntry onSubmit={async (csv) => { await onImportSubmit(csv); setModal(null); }} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PlacesTab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add list/checkbox/notice CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.mc-head-actions{display:flex;gap:8px;flex-wrap:wrap;}
.mc-tinybtn.on{color:#fff;background:rgba(205,106,69,.18);border-color:rgba(205,106,69,.55);}
.mc-card .chk{background:transparent;appearance:none;}
button.chk{padding:0;cursor:pointer;}
.mc-empty-list{font-size:13px;color:var(--dim);line-height:1.6;padding:10px 2px;}
.mc-empty-list strong{color:var(--text);}
.mc-places-note{margin-top:14px;}
.mc-sheet .notice{background:rgba(116,133,142,.12);border-left-color:var(--slate);color:var(--dim);}
.mc-sheet .notice strong{color:var(--text);}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/PlacesTab.tsx src/components/PlacesTab.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add places tab with selection and import modal"
```

---

## Phase 4 — Analyze, Compare, Export tabs

### Task 13: AnalyzeTab

**Files:**
- Create: `frontend/src/components/AnalyzeTab.tsx`
- Test: `frontend/src/components/AnalyzeTab.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

> Radius is a **segmented control** bound to `availableRadii` (not the mock's slider) so only supported radii are requestable. Categories are the real backend values (`""`, `PROPERTY`, `PERSON`, `SOCIETY`).

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzeTab } from "./AnalyzeTab";
import type { AnalysisSettings, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};

const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY" };

afterEach(cleanup);

describe("AnalyzeTab", () => {
  it("emits control changes and runs when a place is selected", () => {
    const onChange = vi.fn();
    const onRun = vi.fn();
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250, 500, 1000]} running={false} onChange={onChange} onRun={onRun} />);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-02-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-02-01" });

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });

    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("disables run when nothing is selected", () => {
    render(<AnalyzeTab selected={[]} analysis={analysis} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/AnalyzeTab.test.tsx`
Expected: FAIL — cannot find module `./AnalyzeTab`.

- [ ] **Step 3: Implement the component**

Create `src/components/AnalyzeTab.tsx`:

```tsx
import type { AnalysisSettings, Place } from "../types";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  availableRadii: number[];
  running: boolean;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

export function AnalyzeTab({ selected, analysis, availableRadii, running, onChange, onRun }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const canRun = selected.length >= 1 && !running;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Analyze">
      <div className="mc-field">
        <label htmlFor="analysis-start-date">Date range</label>
        <div className="mc-inputs">
          <input id="analysis-start-date" type="date" className="mc-inp" value={analysis.startDate} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
          <input id="analysis-end-date" type="date" className="mc-inp" value={analysis.endDate} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
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

      <div style={{ height: 60 }} />
      <div className="mc-footer">
        <span className="note">{selected.length} place{selected.length === 1 ? "" : "s"} · {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Running…" : "Run analysis"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/AnalyzeTab.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add date-input CSS**

Append to `src/styles/mapWorkspace.css`:

```css
input.mc-inp{display:block;color-scheme:dark;}
input.mc-inp:focus{outline:2px solid var(--clay-soft);outline-offset:1px;}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/AnalyzeTab.tsx src/components/AnalyzeTab.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add analyze tab"
```

### Task 14: CompareTab

**Files:**
- Create: `frontend/src/components/CompareTab.tsx`
- Test: `frontend/src/components/CompareTab.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

> Renders the spec's revised caveat as static copy (does not echo the backend's old `caveat_text`). Renders the backend `overview.summary_text` if present, plus per-place counts from `crime_summaries`.

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { AnalysisSettings, DashboardSummary, Place } from "../types";

const home: Place = { id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5, total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal" };
const office: Place = { ...home, id: "p2", display_label: "Office" };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY" };

const summary: DashboardSummary = {
  totals: { place_count: 2, visit_count: 10, incident_count: 180 },
  privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [home, office],
  crime_summaries: [
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: null, offense_subcategory: null, nibrs_group: null, incident_count: 38, nearest_incident_m: null, incidents_per_visit: null, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: null, offense_subcategory: null, nibrs_group: null, incident_count: 142, nearest_incident_m: null, incidents_per_visit: null, incidents_per_hour_dwell: null },
  ],
  analysis: { available_radii_m: [250] },
  exports: { tableau_place_summary_csv: "/x.csv" },
};

afterEach(cleanup);

describe("CompareTab", () => {
  it("prompts to select two places when fewer are chosen", () => {
    render(<CompareTab selected={[home]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/select at least two places/i)).toBeInTheDocument();
  });

  it("shows per-place counts and the revised caveat, and runs", () => {
    const onRun = vi.fn();
    render(<CompareTab selected={[home, office]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={onRun} />);

    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText(/does not identify one as statistically lower-incident/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));
    expect(onRun).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CompareTab.test.tsx`
Expected: FAIL — cannot find module `./CompareTab`.

- [ ] **Step 3: Implement the component**

Create `src/components/CompareTab.tsx`:

```tsx
import { incidentCountForPlace } from "../lib/incidentSummaries";
import type { AnalysisSettings, DashboardSummary, Place } from "../types";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  summary: DashboardSummary | null;
  comparison: Record<string, unknown> | null;
  running: boolean;
  onRun: () => void;
};

const REVISED_CAVEAT =
  "The app still compares the selected places, but it does not identify one as statistically lower-incident. Reported incidents can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ selected, analysis, summary, comparison, running, onRun }: Props) {
  const overview = (comparison?.overview ?? null) as { summary_text?: string } | null;
  const canRun = selected.length >= 2 && !running;

  if (selected.length < 2) {
    return (
      <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
        <div className="mc-panel-head"><h4>Compare places</h4></div>
        <p className="mc-empty-list">Select at least two places to compare reported-incident context.</p>
      </div>
    );
  }

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
      <div className="mc-panel-head"><h4>Comparing {selected.length} places <b>{analysis.radiusM} m</b></h4></div>

      <div className="mc-compare">
        {selected.slice(0, 2).map((place) => {
          const count = incidentCountForPlace(summary, place.id, analysis.radiusM);
          return (
            <div className="mc-cmpcard" key={place.id}>
              <div className="lbl">
                <svg width="13" height="17" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /></svg>
                {place.display_label}
              </div>
              <div className="big">{count ?? "—"}</div>
              <div className="cap">{count === null ? "not analyzed yet" : "reported incidents in range"}</div>
            </div>
          );
        })}
      </div>

      {overview?.summary_text ? <p className="mc-compare-summary">{overview.summary_text}</p> : null}

      <div className="mc-caveat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        {REVISED_CAVEAT}
      </div>

      <div style={{ height: 56 }} />
      <div className="mc-footer">
        <span className="note">{selected.length} selected · {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing…" : "Compare places"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CompareTab.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add compare-summary CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.mc-compare-summary{font-size:13px;color:var(--text);line-height:1.5;margin:0 0 12px;}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/CompareTab.tsx src/components/CompareTab.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add compare tab with revised copy"
```

### Task 15: ExportTab

**Files:**
- Create: `frontend/src/components/ExportTab.tsx`
- Test: `frontend/src/components/ExportTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExportTab } from "./ExportTab";

afterEach(cleanup);

describe("ExportTab", () => {
  it("links to the CSV and states data limitations", () => {
    render(<ExportTab href="/exports/current.csv" />);
    expect(screen.getByRole("link", { name: /download tableau-ready csv/i })).toHaveAttribute("href", "/exports/current.csv");
    expect(screen.getByText(/does not claim safety, risk, or recommended places/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ExportTab.test.tsx`
Expected: FAIL — cannot find module `./ExportTab`.

- [ ] **Step 3: Implement the component**

Create `src/components/ExportTab.tsx`:

```tsx
type Props = { href: string };

const NOTES = [
  "Counts reflect reported incidents only, within the chosen radius and date range.",
  "Reported incidents can be incomplete, delayed, corrected, or geographically generalized.",
  "This export does not claim safety, risk, or recommended places.",
];

export function ExportTab({ href }: Props) {
  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Export">
      <div className="mc-panel-head"><h4>Export session</h4></div>
      <div className="mc-exp">
        <a className="mc-cta" href={href} style={{ alignSelf: "flex-start", textDecoration: "none" }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>
          Download Tableau-ready CSV
        </a>
        <ul className="mc-explist">
          {NOTES.map((note) => (
            <li key={note}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
              {note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ExportTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExportTab.tsx src/components/ExportTab.test.tsx
git commit -m "feat: add export tab"
```

---

## Phase 5 — Integration & cleanup

### Task 16: MapWorkspace (state owner that composes everything)

**Files:**
- Create: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/components/MapWorkspace.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

> This lifts today's `App.tsx` orchestration (session init, summary refresh, selection set, stale-comparison guard) and adds map/sheet/draft/analysis state. The test mocks `./MapCanvas` (to fire map/marker clicks) and `../api/client` (same pattern as the current `App.test.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ places, onMapClick, onMarkerClick }: any) => (
    <div data-testid="mapcanvas">
      <button data-testid="fire-map-click" onClick={() => onMapClick({ lat: 47.6, lng: -122.3 })} />
      {places.map((place: any) => (
        <button key={place.id} data-testid={`marker-${place.id}`} onClick={() => onMarkerClick(place.id)} />
      ))}
    </div>
  ),
}));

vi.mock("../api/client", () => ({
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn(),
  deletePlace: vi.fn(),
  getDashboardSummary: vi.fn(),
}));

import { MapWorkspace } from "./MapWorkspace";
import { analyzePlaces, createPlace, createSession, getDashboardSummary } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import type { DashboardSummary, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};

function makeSummary(places: Place[] = []): DashboardSummary {
  return {
    totals: { place_count: places.length, visit_count: 0, incident_count: 0 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places,
    crime_summaries: [],
    analysis: { available_radii_m: [250, 500, 1000] },
    exports: { tableau_place_summary_csv: "/exports/current.csv" },
  };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MapWorkspace", () => {
  it("starts a session and lists returned places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Mobility Context")).toBeInTheDocument();
  });

  it("drops a pin from a map click and saves it", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValueOnce(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);

    render(<MapWorkspace />);
    await screen.findByText(/Map your places/i);

    fireEvent.click(screen.getByRole("button", { name: /add pin/i }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "Home",
        latitude: 47.6,
        longitude: -122.3,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
  });

  it("runs analysis for a selected place", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Home" }));
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith({
        place_ids: ["p1"],
        analysis_start_date: window.analysis_start_date,
        analysis_end_date: window.analysis_end_date,
        radii_m: [250],
        offense_category: "PROPERTY",
      });
    });
  });

  it("shows an error when the session cannot start", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error("no session"));
    render(<MapWorkspace />);
    expect(await screen.findByText(/unable to start a dashboard session/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MapWorkspace.test.tsx`
Expected: FAIL — cannot find module `./MapWorkspace`.

- [ ] **Step 3: Implement the component**

Create `src/components/MapWorkspace.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";

import { analyzePlaces, comparePlaces, createBulkPlaces, createPlace, createSession, deletePlace, getDashboardSummary } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { geocodingProvider } from "../lib/geocoding";
import { defaultTileConfig } from "../lib/mapTiles";
import { AnalyzeTab } from "./AnalyzeTab";
import { BottomSheet } from "./BottomSheet";
import { CompareTab } from "./CompareTab";
import { ExportTab } from "./ExportTab";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
import { PinDraftPopover } from "./PinDraftPopover";
import { PlaceSearch } from "./PlaceSearch";
import { PlacesTab } from "./PlacesTab";
import type { AnalysisSettings, DashboardSummary, DraftPin, GeocodeResult, LatLng, Place, PlaceCreate, SheetState, TabKey } from "../types";

const DEFAULT_EXPORT = "/exports/tableau/place-summary.csv";

export function MapWorkspace() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("places");
  const [sheetState, setSheetState] = useState<SheetState>("half");
  const [addPinMode, setAddPinMode] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisSettings>(() => {
    const window = currentYearAnalysisWindow();
    return { startDate: window.analysis_start_date, endDate: window.analysis_end_date, radiusM: 250, offenseCategory: "PROPERTY" };
  });
  const comparisonVersionRef = useRef(0);

  const refresh = async () => {
    setSummary(await getDashboardSummary());
  };
  const refreshWithFallback = async (fallbackMessage: string) => {
    try {
      await refresh();
    } catch {
      setError(fallbackMessage);
    }
  };

  useEffect(() => {
    let isMounted = true;
    setError("");
    createSession()
      .then(() => getDashboardSummary())
      .then((next) => { if (isMounted) { setError(""); setSummary(next); } })
      .catch(() => { if (isMounted) { setError("Unable to start a dashboard session. Try again shortly."); } });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setAddPinMode(false); setDraft(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const places: Place[] = useMemo(() => summary?.places ?? [], [summary]);
  const selected = useMemo(() => places.filter((place) => selectedIds.has(place.id)), [places, selectedIds]);
  const availableRadii = summary?.analysis.available_radii_m ?? [];
  const exportHref = summary?.exports.tableau_place_summary_csv || DEFAULT_EXPORT;

  function invalidateComparison() {
    comparisonVersionRef.current += 1;
    setComparison(null);
  }

  function handleStartAddPin() {
    setAddPinMode(true);
    setActiveTab("places");
    if (sheetState === "peek") setSheetState("half");
  }

  function handleMapClick(latlng: LatLng) {
    if (!addPinMode) return;
    setDraft({ latitude: latlng.lat, longitude: latlng.lng, display_label: "", visit_count: 1, source: "map" });
    setDraftError("");
    setAddPinMode(false);
    setActiveTab("places");
    if (sheetState === "peek") setSheetState("half");
  }

  function handleSearchSelect(result: GeocodeResult) {
    setDraft({ latitude: result.latitude, longitude: result.longitude, display_label: result.label, visit_count: 1, source: "search" });
    setFlyTo({ lat: result.latitude, lng: result.longitude });
    setDraftError("");
    setActiveTab("places");
  }

  async function handleSaveDraft() {
    if (!draft || !draft.display_label.trim()) return;
    setDraftSaving(true);
    setDraftError("");
    try {
      await createPlace({
        display_label: draft.display_label.trim(),
        latitude: draft.latitude,
        longitude: draft.longitude,
        visit_count: draft.visit_count >= 1 ? draft.visit_count : 1,
        sensitivity_class: "normal",
      });
      setDraft(null);
      await refreshWithFallback("Saved, but dashboard totals could not refresh.");
    } catch {
      setDraftError("Unable to save pin. Try again.");
    } finally {
      setDraftSaving(false);
    }
  }

  function handleToggleSelect(id: string) {
    invalidateComparison();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    setError("");
    invalidateComparison();
    try {
      await deletePlace(id);
      setSelectedIds((current) => { const next = new Set(current); next.delete(id); return next; });
      await refreshWithFallback("Removed place, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to remove place. Try again.");
    }
  }

  async function handleManualSubmit(place: PlaceCreate) {
    setError("");
    await createPlace(place);
    await refreshWithFallback("Saved, but dashboard totals could not refresh.");
  }

  async function handleImport(csv: string) {
    setError("");
    await createBulkPlaces(csv);
    await refreshWithFallback("Imported rows, but dashboard totals could not refresh.");
  }

  async function handleAnalyze() {
    if (selectedIds.size < 1) return;
    setError("");
    setAnalyzing(true);
    try {
      await analyzePlaces({
        place_ids: Array.from(selectedIds),
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radii_m: [analysis.radiusM],
        offense_category: analysis.offenseCategory || null,
      });
      await refreshWithFallback("Analysis ran, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to run analysis. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCompare() {
    if (selectedIds.size < 2) return;
    setError("");
    setComparing(true);
    const version = comparisonVersionRef.current + 1;
    comparisonVersionRef.current = version;
    try {
      const result = await comparePlaces({
        place_ids: Array.from(selectedIds),
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radius_m: analysis.radiusM,
        offense_category: analysis.offenseCategory || null,
      });
      if (comparisonVersionRef.current === version) setComparison(result);
    } catch {
      if (comparisonVersionRef.current === version) setError("Unable to compare places. Try again.");
    } finally {
      setComparing(false);
    }
  }

  return (
    <div className="mc-scope">
      <div className="mc-frame">
        <MapCanvas
          places={places}
          selectedIds={selectedIds}
          draft={draft}
          addPinMode={addPinMode}
          summary={summary}
          radiusM={analysis.radiusM}
          flyTo={flyTo}
          tileConfig={defaultTileConfig}
          onMapClick={handleMapClick}
          onMarkerClick={handleToggleSelect}
        />

        <header className="mc-topbar">
          <div className="mc-brand">
            <span className="mc-logo">
              <svg width="16" height="16" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
            </span>
            <span className="mc-wordmark">Mobility&nbsp;Context</span>
          </div>
          <div className="mc-status"><span className="dot" />Public session · Seattle</div>
        </header>

        <div className="mc-controls">
          <div className="mc-actionrow">
            <button
              type="button"
              className={`mc-addpin${addPinMode ? " is-armed" : ""}`}
              aria-pressed={addPinMode}
              onClick={() => (addPinMode ? setAddPinMode(false) : handleStartAddPin())}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Add pin
            </button>
          </div>
          {addPinMode ? (
            <div className="mc-helper" role="status"><span className="cross" />Click the map to drop a pin · Esc to cancel</div>
          ) : null}
        </div>

        <MapLegend />

        {error ? <p className="mc-error" role="status">{error}</p> : null}

        {places.length === 0 && !draft ? (
          <div className="mc-empty">
            <h3>Map your places</h3>
            <p>Choose <strong>Add pin</strong> then click the map, or search for an address in the Places tab.</p>
          </div>
        ) : null}

        <BottomSheet
          activeTab={activeTab}
          onTabChange={setActiveTab}
          sheetState={sheetState}
          onSheetStateChange={setSheetState}
          tabBadges={{ places: places.length, compare: selectedIds.size }}
        >
          {activeTab === "places" ? (
            <PlacesTab
              places={places}
              selectedIds={selectedIds}
              summary={summary}
              radiusM={analysis.radiusM}
              addPinMode={addPinMode}
              search={<PlaceSearch provider={geocodingProvider} onSelectResult={handleSearchSelect} />}
              draftPopover={draft ? (
                <PinDraftPopover
                  draft={draft}
                  saving={draftSaving}
                  error={draftError}
                  onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
                  onSave={handleSaveDraft}
                  onCancel={() => setDraft(null)}
                />
              ) : null}
              onStartAddPin={handleStartAddPin}
              onToggleSelect={handleToggleSelect}
              onDelete={handleDelete}
              onManualSubmit={handleManualSubmit}
              onImportSubmit={handleImport}
            />
          ) : null}
          {activeTab === "analyze" ? (
            <AnalyzeTab
              selected={selected}
              analysis={analysis}
              availableRadii={availableRadii}
              running={analyzing}
              onChange={(patch) => setAnalysis((current) => ({ ...current, ...patch }))}
              onRun={handleAnalyze}
            />
          ) : null}
          {activeTab === "compare" ? (
            <CompareTab selected={selected} analysis={analysis} summary={summary} comparison={comparison} running={comparing} onRun={handleCompare} />
          ) : null}
          {activeTab === "export" ? <ExportTab href={exportHref} /> : null}
        </BottomSheet>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MapWorkspace.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add error-toast CSS**

Append to `src/styles/mapWorkspace.css`:

```css
.mc-error{position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:60;background:#fff;color:#a33a33;border:1px solid #f0c1c1;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;box-shadow:0 10px 26px -14px rgba(18,22,26,.4);}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/MapWorkspace.tsx src/components/MapWorkspace.test.tsx src/styles/mapWorkspace.css
git commit -m "feat: add map workspace state owner"
```

### Task 17: Wire App to MapWorkspace (and migrate App.test)

**Files:**
- Modify: `frontend/src/App.tsx`
- Rewrite: `frontend/src/App.test.tsx`

- [ ] **Step 1: Replace `App.test.tsx` with a shell smoke test**

Replace the entire contents of `src/App.test.tsx` with:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/MapCanvas", () => ({
  MapCanvas: () => <div data-testid="mapcanvas" />,
}));

vi.mock("./api/client", () => ({
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ session_state: "ready" }),
  deletePlace: vi.fn(),
  getDashboardSummary: vi.fn().mockResolvedValue({
    totals: { place_count: 0, visit_count: 0, incident_count: 0 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [],
    crime_summaries: [],
    analysis: { available_radii_m: [250] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  }),
}));

import App from "./App";

afterEach(cleanup);

describe("App", () => {
  it("renders the map-first workspace shell", async () => {
    render(<App />);
    expect(await screen.findByText("Mobility Context")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — the old `App` renders the legacy shell, so "Mobility Context" is not found.

- [ ] **Step 3: Replace `App.tsx`**

Replace the entire contents of `src/App.tsx` with:

```tsx
import { MapWorkspace } from "./components/MapWorkspace";

export default function App() {
  return <MapWorkspace />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: render map workspace as the app shell"
```

### Task 18: Remove retired components

**Files:**
- Delete: `frontend/src/components/PlaceTable.tsx`, `frontend/src/components/PlaceTable.test.tsx`
- Delete: `frontend/src/components/ResultsSummary.tsx`
- Delete: `frontend/src/components/AnalysisControls.tsx`, `frontend/src/components/AnalysisControls.test.tsx`
- Delete: `frontend/src/components/ComparisonPanel.tsx`
- Delete: `frontend/src/components/ExportPanel.tsx`

> Keep `PlaceForm.tsx` (+ test), `BulkPlaceEntry.tsx`, and `Notice.tsx` — they are reused by `PlacesTab`.

- [ ] **Step 1: Delete the files**

Run (from `frontend/`):

```bash
git rm src/components/PlaceTable.tsx src/components/PlaceTable.test.tsx \
       src/components/ResultsSummary.tsx \
       src/components/AnalysisControls.tsx src/components/AnalysisControls.test.tsx \
       src/components/ComparisonPanel.tsx \
       src/components/ExportPanel.tsx
```

- [ ] **Step 2: Verify nothing imports them**

Run: `npm run lint`
Expected: no TypeScript errors (only `MapWorkspace`/`PlacesTab` reference the surviving components). If `tsc` reports an unresolved import, fix that import before continuing.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass (no references to deleted components remain).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove legacy dashboard panels"
```

### Task 19: Full verification & responsive/a11y pass

**Files:**
- Modify (if needed): `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Full automated gate**

Run, in order:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass; `tsc` clean; Vite build succeeds.

- [ ] **Step 2: Manual verification with the dev server**

Run: `npm run dev`, open `http://127.0.0.1:5173`, and confirm:
- Muted Carto basemap renders full-bleed with the wordmark, status pill, "Add pin" control, and "Map key" legend visible; attribution shows bottom-right.
- "Add pin" → cursor becomes a crosshair, helper toast appears → clicking the map opens the draft popover in the Places tab → saving adds a graphite marker and a Places list row.
- Search an address in the Places tab → selecting a result flies the map there and opens a draft.
- Select two places, set a radius in Analyze, Run analysis → clay rings + count badges appear on those markers; Compare tab shows the two counts and the revised caveat.
- Export tab → the CSV link points at the summary export.
- Keyboard only: Tab to the sheet tabs and snap controls and operate them; selection works from the Places list without touching the map.
- With OS "reduce motion" on, pins/halo/sheet do not animate.

- [ ] **Step 3: Capture a screenshot** of the running app and compare against `docs/superpowers/specs/2026-06-24-map-first-dashboard-mockup.html`. Adjust spacing/color only if something clearly drifts from the mock.

- [ ] **Step 4: Commit any tweaks**

```bash
git add -A
git commit -m "chore: responsive and accessibility polish for map workspace"
```

---

## Self-review (completed during planning)

**Spec coverage** — every spec section maps to a task:

| Spec area | Task(s) |
| --- | --- |
| Full map + bottom sheet shell | 7, 9, 16 |
| Click-to-drop default | 16 (handleMapClick), 9 (draft marker), 10 (popover) |
| Address/place search | 5, 11, 16 (handleSearchSelect + flyTo) |
| Tabbed bottom sheet (4 tabs) | 7, 12, 13, 14, 15, 16 |
| Markers: saved / selected / analyzed / low-data + rings + badges | 6, 9 |
| Legend | 8 |
| No individual incident dots | 9 (only markers + rings, by construction) |
| Revised comparison copy | 14 |
| Manual/bulk as secondary paths | 12 (modal reusing PlaceForm/BulkPlaceEntry) |
| Tile + geocoding provider boundaries | 4, 5 |
| Data flow (session/create/analyze/compare) | 16 |
| Copy & content rules | 12 (Notice), 14, 15 |
| Error handling (tile/search/save/analyze/compare/export) | 11, 16 |
| Accessibility & responsive | 7 (roles), 12 (labels/checkbox roles), 19, mockup `@media` |
| Visual design tokens | 2 (ported CSS), all component tasks |
| Testing strategy | one test per task; integration in 16 |

**Type consistency:** `AnalysisSettings`, `DraftPin`, `GeocodeResult`, `LatLng`, `TabKey`, `SheetState` are defined once (Task 3) and used with identical shapes in Tasks 9–16. API payloads match `src/api/client.ts` exactly (`radii_m: number[]` for analyze, `radius_m: number` for compare). `incidentCountForPlace(summary, id, radiusM)` is called with the same signature in Tasks 9, 12, 14.

**Known assumptions flagged in-plan:** `crime_summaries[].place_cluster_id === Place.id` (Task 6) and the low-data predicate (Task 9/12) — both isolated and documented for verification against a live summary.

## Notes for the implementer

- **Start clean:** commit or stash current working-tree changes first. `src/lib/analysisDefaults.ts` is reused by Tasks 13/16 but is currently untracked — `git add` it with the first task that imports it (or commit it up front).
- **External services in the browser:** Carto tiles and Nominatim search are cross-origin calls from the browser; no proxy needed. They are fine for dev. Before public production traffic, swap `defaultTileConfig` and `geocodingProvider` for keyed providers (the module boundaries exist precisely for this).
- **Leaflet default import:** the canvas uses `import * as L from "leaflet"`. If your tsconfig has `esModuleInterop`, `import L from "leaflet"` also works — keep the namespace import to be safe.

