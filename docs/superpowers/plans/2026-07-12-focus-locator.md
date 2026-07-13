# Focus Mode + Locator Chips + Identity Pins (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop focus mode (drawer preset that shrinks the map to a live strip), identity-colored lettered map pins with card↔pin hover-sync, and per-verdict-card MCPP locator mini-maps.

**Architecture:** Pure frontend slice — the `/dashboard/mcpp` endpoint (slice 1) and the `placeIdentity` lib + `--id-*` CSS tokens (slice 2) already exist. Focus mode replaces the drawer's max-width cap with "viewport minus a 96px map strip" so drag and the new Focus preset share one clamp. Identity flows from one source (`selected` array order in MapWorkspace) to both the AnalyzeTab cards and the MapLibre markers. Locator chips render a downsampled equirectangular SVG of the MCPP mosaic (computed once per fetch) with the place's neighborhood highlighted.

**Tech Stack:** React + TypeScript, MapLibre GL markers (DOM elements), vitest + @testing-library/react (jsdom), plain SVG (no map tiles in chips).

**Spec:** §1–§3 of `docs/superpowers/specs/2026-07-12-desktop-focus-multi-baseline-design.md` (as amended: city outline deferred to a mosaic-rendering decision — this plan renders the MCPP mosaic directly, no union asset).

Working directory: `/Users/jscocca/Repos/waypoint/.worktrees/focus-locator` (branch `focus-locator`). Frontend commands run from `frontend/`; `node_modules` is symlinked. This slice does not touch Python; do not run pytest except as part of the final `make test-all`.

---

### Task 1: Focus drawer preset

**Files:**
- Modify: `frontend/src/lib/drawer.ts`
- Modify: `frontend/src/lib/useDrawer.ts`
- Modify: `frontend/src/components/BottomSheet.tsx` (PRESETS array ~line 62, `presetPressed` ~line 91)
- Test: `frontend/src/lib/drawer.test.ts`, `frontend/src/components/BottomSheet.test.tsx` (both exist — follow their existing style/setup; read them before editing)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/drawer.test.ts` (jsdom default `window.innerWidth` is 1024; if the file already stubs `innerWidth`, reuse its helper):

```ts
describe("focus preset geometry", () => {
  it("drawerMax leaves a 96px map strip", () => {
    // jsdom window.innerWidth defaults to 1024
    expect(drawerMax()).toBe(1024 - 96);
  });

  it("clampWidth allows widths up to drawerMax", () => {
    expect(clampWidth(1024 - 96)).toBe(1024 - 96);
    expect(clampWidth(5000)).toBe(1024 - 96);
  });

  it("drawerMax never drops below DRAWER_MIN on narrow windows", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    expect(drawerMax()).toBe(DRAWER_MIN);
    Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
  });
});
```

Add the needed imports (`DRAWER_MIN` may already be imported). If the file's existing tests assert the OLD cap (`Math.min(720, vw * 0.72)`), UPDATE those assertions to the new formula — the cap change is intentional (see Step 3).

Append to `frontend/src/components/BottomSheet.test.tsx`, following the file's existing render/props helper:

```tsx
it("offers a Focus preset and forwards it", () => {
  const onPreset = vi.fn();
  renderSheet({ onPreset }); // adapt to the file's existing helper/props factory
  fireEvent.click(screen.getByRole("button", { name: "Focus" }));
  expect(onPreset).toHaveBeenCalledWith("focus");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/drawer.test.ts src/components/BottomSheet.test.tsx`
Expected: FAIL — `drawerMax()` returns `min(720, 737)` ≠ 928, and no "Focus" button exists.

- [ ] **Step 3: Implement**

`frontend/src/lib/drawer.ts` — full new content:

```ts
export const DRAWER_MIN = 340;
export const DRAWER_DEFAULT = 400;
export const DRAWER_WIDE = 640;
export const DRAWER_PEEK = 84;
export const DRAWER_RESIZE_STEP = 24;
// Focus mode (and manual drag) always leave this much live map at the left edge.
export const MAP_STRIP_MIN = 96;

export type DrawerPreset = "peek" | "default" | "wide" | "focus";

export function drawerMax(): number {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return Math.max(DRAWER_MIN, Math.round(vw) - MAP_STRIP_MIN);
}

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_DEFAULT;
  return Math.min(drawerMax(), Math.max(DRAWER_MIN, Math.round(px)));
}
```

(The old `min(720, 72vw)` cap is deliberately replaced: focus mode's whole point is a near-full-width panel, and one shared max for drag + presets is simpler than a preset-only exception. The 96px strip stays interactive — MapLibre's default ResizeObserver handles container shrink.)

`frontend/src/lib/useDrawer.ts` — extend the import to include `drawerMax`, and replace `onPreset` with:

```ts
    onPreset: (preset) =>
      setDrawer((current) => {
        if (preset === "peek") return { ...current, collapsed: true };
        if (preset === "focus") return { collapsed: false, widthPx: drawerMax() };
        return { collapsed: false, widthPx: clampWidth(preset === "wide" ? DRAWER_WIDE : DRAWER_DEFAULT) };
      }),
```

`frontend/src/components/BottomSheet.tsx` — add to PRESETS (after "wide"):

```ts
  { preset: "focus", label: "Focus" },
```

and replace `presetPressed` with (single-active-segment invariant: on narrow viewports `drawerMax()` can collide with the wide/default clamps; the smaller preset wins and focus/wide suppress themselves):

```ts
  function presetPressed(preset: DrawerPreset) {
    if (preset === "peek") return collapsed;
    if (collapsed) return false;
    if (preset === "default") return widthPx === clampWidth(DRAWER_DEFAULT);
    if (preset === "wide") {
      return widthPx === clampWidth(DRAWER_WIDE) && clampWidth(DRAWER_WIDE) !== clampWidth(DRAWER_DEFAULT);
    }
    return (
      widthPx === drawerMax() &&
      drawerMax() !== clampWidth(DRAWER_WIDE) &&
      drawerMax() !== clampWidth(DRAWER_DEFAULT)
    );
  }
```

No `drawerStorage.ts` change: focus persists as a plain width.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/drawer.test.ts src/lib/useDrawer.test.ts src/components/BottomSheet.test.tsx`
Expected: ALL PASS. If `useDrawer.test.ts` or `drawerStorage.test.ts` assert the old cap, update those assertions to the new formula and note it in your report.

- [ ] **Step 5: Full frontend sanity + commit**

Run: `cd frontend && npx tsc -b --pretty false && npm test` — all green (other suites don't depend on the cap value; if one does, fix its fixture and report it).

```bash
git add frontend/src/lib/drawer.ts frontend/src/lib/drawer.test.ts frontend/src/lib/useDrawer.ts frontend/src/components/BottomSheet.tsx frontend/src/components/BottomSheet.test.tsx
git commit -m "feat(frontend): Focus drawer preset — panel expands to viewport minus a 96px map strip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Include any other test files you had to update in the `git add`.)

---

### Task 2: Identity pins + hover-sync pulse

**Files:**
- Modify: `frontend/src/components/MapCanvas.tsx` (`iconHtml` ~line 41, marker effect ~line 250, Props ~line 111)
- Modify: `frontend/src/components/MapWorkspace.tsx` (identity map + hover state, prop threading)
- Modify: `frontend/src/components/AnalyzeTab.tsx` (`onHoverPlace` prop, VerdictCard hover/focus handlers)
- Modify: `frontend/src/lib/placeIdentity.ts` (export the identity type if not already exported)
- Modify: `frontend/src/styles/mapWorkspace.css` (pulse keyframes, next to the existing `.mc-pin-*` rules ~line 320)
- Test: `frontend/src/components/MapCanvas.test.tsx`, `frontend/src/components/AnalyzeTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/placeIdentity.ts`: check its exports first. It must export the return type of `placeIdentity` as `PlaceIdentity` (`{ letter: string; slot: string }`, whatever the actual field shape is — read the file). If only the function is exported, add `export type PlaceIdentity = ReturnType<typeof placeIdentity>;`.

Append to `frontend/src/components/MapCanvas.test.tsx` (pure-function tests; follow the file's existing `iconHtml`/`markerKindFor` test style):

```ts
import { placeIdentity } from "../lib/placeIdentity";

describe("iconHtml with identity", () => {
  it("uses the identity color token and letter glyph", () => {
    const html = iconHtml("selected", { label: "Cafe", identity: placeIdentity(0) });
    expect(html).toContain("var(--id-a)");
    expect(html).toContain(">A</text>");
    expect(html).toContain("mc-pin-halo"); // kind extras preserved
  });

  it("keeps the count badge for analyzed identity pins", () => {
    const html = iconHtml("analyzed", { count: 7, identity: placeIdentity(1) });
    expect(html).toContain("var(--id-b)");
    expect(html).toContain(">B</text>");
    expect(html).toContain("mc-pin-badge");
  });

  it("renders legacy colors when no identity is given", () => {
    expect(iconHtml("selected", { label: "x" })).toContain("var(--accent)");
    expect(iconHtml("default", {})).toContain("#3A3F46");
  });
});
```

Append to `frontend/src/components/AnalyzeTab.test.tsx` (reuse the existing populated-neighborhood fixture):

```tsx
it("reports card hover to onHoverPlace", () => {
  const onHoverPlace = vi.fn();
  renderAnalyze({ onHoverPlace }); // adapt to the file's existing render helper + fixtures
  const card = screen.getByLabelText(/Verdict for/);
  fireEvent.mouseEnter(card);
  expect(onHoverPlace).toHaveBeenCalledWith(expect.any(String));
  fireEvent.mouseLeave(card);
  expect(onHoverPlace).toHaveBeenLastCalledWith(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/MapCanvas.test.tsx src/components/AnalyzeTab.test.tsx`
Expected: FAIL — `iconHtml` ignores `identity` (tsc may also reject the option), and no hover callback fires.

- [ ] **Step 3: Implement MapCanvas**

In `frontend/src/components/MapCanvas.tsx`:

Add import: `import type { PlaceIdentity } from "../lib/placeIdentity";`

Add below `QGLYPH`:

```ts
function letterGlyph(letter: string): string {
  return `<text x="12" y="16" font-size="11" fill="#fff" text-anchor="middle" font-family="Archivo" font-weight="700">${escapeHtml(letter)}</text>`;
}
```

(`letterGlyph` is defined after `escapeHtml` or hoisting covers it — function declarations hoist; keep it adjacent to `teardrop` for readability.)

Replace `iconHtml` with:

```ts
export function iconHtml(
  kind: MarkerKind,
  opts: { count?: number | null; label?: string; identity?: PlaceIdentity },
): string {
  const fill = opts.identity
    ? `var(--id-${opts.identity.slot})`
    : kind === "low"
      ? "#74858E"
      : kind === "selected"
        ? "var(--accent)"
        : "#3A3F46";
  const glyph = opts.identity ? letterGlyph(opts.identity.letter) : kind === "low" ? QGLYPH : DOT;
  if (kind === "selected") {
    const label = opts.label ? escapeHtml(opts.label) : "";
    return `<span class="mc-pin-halo"></span>${teardrop(fill, glyph)}<span class="mc-pin-tag">${label}</span>`;
  }
  if (kind === "analyzed") {
    return `${teardrop(fill, glyph)}<span class="mc-pin-badge"><b>${opts.count ?? 0}</b><i>inc.</i></span>`;
  }
  return teardrop(fill, glyph);
}
```

Extend `Props`:

```ts
  identityByPlaceId?: Map<string, PlaceIdentity>;
  pulsePlaceId?: string | null;
```

(destructure both in the component signature).

In the marker-rebuild effect (~line 250): add a keyed element registry and identity. Above the component's other refs add:

```ts
  const markerElsRef = useRef(new Map<string, HTMLElement>());
```

Inside the effect, after `markersRef.current = [];` add `markerElsRef.current.clear();`. In the per-place loop, after `el.className = "mc-pin-icon";` change the `iconHtml` call to:

```ts
      el.innerHTML = iconHtml(kind, { count, label: place.display_label, identity: identityByPlaceId?.get(place.id) });
```

and after creating `el` register it: `markerElsRef.current.set(place.id, el);`. Add `identityByPlaceId` to the effect's dependency array.

Add a new effect after the marker effect (deps include the rebuild deps so the class re-applies after markers are recreated):

```ts
  useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      el.classList.toggle("is-pulsing", id === pulsePlaceId);
    }
  }, [pulsePlaceId, places, selectedIds, summary, radiusM, draft, mapReady]);
```

- [ ] **Step 4: Implement MapWorkspace + AnalyzeTab wiring**

`frontend/src/components/MapWorkspace.tsx`:

Add imports: `import { placeIdentity, type PlaceIdentity } from "../lib/placeIdentity";`

Below the `selected` memo add:

```ts
  // One identity source for cards AND pins: index within `selected` (AnalyzeTab letters
  // use the same array order, so the teal "B" card is always the teal "B" pin).
  const identityByPlaceId = useMemo(
    () => new Map<string, PlaceIdentity>(selected.map((place, index) => [place.id, placeIdentity(index)])),
    [selected],
  );
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
```

Pass to `<MapCanvas ... identityByPlaceId={identityByPlaceId} pulsePlaceId={hoveredPlaceId} />` and to `<AnalyzeTab ... onHoverPlace={setHoveredPlaceId} />`.

`frontend/src/components/AnalyzeTab.tsx`:

Props type: add `onHoverPlace?: (placeId: string | null) => void;` — destructure it in `AnalyzeTab` and thread it into each `<VerdictCard ... onHoverPlace={onHoverPlace} />`. In `VerdictCard` (add `onHoverPlace` to its props type) attach to the root `<section>`:

```tsx
    <section
      className="mc-verdict"
      aria-label={`Verdict for ${place.place_label}`}
      onMouseEnter={() => onHoverPlace?.(place.place_id)}
      onMouseLeave={() => onHoverPlace?.(null)}
      onFocus={() => onHoverPlace?.(place.place_id)}
      onBlur={() => onHoverPlace?.(null)}
    >
```

`frontend/src/styles/mapWorkspace.css` — next to the existing `.mc-pin-icon svg` rule (~line 321) add:

```css
.mc-pin-icon.is-pulsing svg{animation:pinpulse 1s ease-in-out infinite;}
@keyframes pinpulse{0%,100%{transform:scale(1);}50%{transform:scale(1.18);}}
```

(`transform-origin: bottom center` is already set on `.mc-pin-icon svg`; the pulse replaces the one-shot `pindrop` animation on the pulsing pin only.)

- [ ] **Step 5: Run tests, full sanity, commit**

Run: `cd frontend && npx vitest run src/components/MapCanvas.test.tsx src/components/AnalyzeTab.test.tsx src/components/MapWorkspace.test.tsx && npx tsc -b --pretty false && npm test`
Expected: ALL PASS (MapWorkspace's new props are threaded internally; its tests need no fixture change — if one breaks, fix honestly and report).

```bash
git add frontend/src/components/MapCanvas.tsx frontend/src/components/MapCanvas.test.tsx frontend/src/components/MapWorkspace.tsx frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx frontend/src/lib/placeIdentity.ts frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): identity-colored lettered pins + card-to-pin hover pulse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: MCPP polygon fetch + locator geometry lib

**Files:**
- Modify: `frontend/src/types.ts` (add `McppFeatureCollection` next to `BeatFeatureCollection` ~line 78)
- Modify: `frontend/src/api/client.ts` (add `getMcppPolygons` next to `getBeatPolygons` ~line 145)
- Create: `frontend/src/lib/locatorGeometry.ts`
- Test: `frontend/src/lib/locatorGeometry.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/locatorGeometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { McppFeatureCollection } from "../types";
import {
  CHIP_H,
  CHIP_W,
  collectionBox,
  downsample,
  featurePath,
  mosaicPath,
  project,
} from "./locatorGeometry";

const square = (x0: number, y0: number): [number, number][] => [
  [x0, y0], [x0 + 0.1, y0], [x0 + 0.1, y0 + 0.1], [x0, y0 + 0.1], [x0, y0],
];

const FC: McppFeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { mcpp: "ALPHA" }, geometry: { type: "Polygon", coordinates: [square(-122.4, 47.5)] } },
    {
      type: "Feature",
      properties: { mcpp: "BETA/GAMMA" },
      geometry: { type: "MultiPolygon", coordinates: [[square(-122.3, 47.7)], [square(-122.25, 47.72)]] },
    },
  ],
};

describe("locatorGeometry", () => {
  it("computes the collection bounding box", () => {
    const box = collectionBox(FC)!;
    expect(box.west).toBeCloseTo(-122.4);
    expect(box.east).toBeCloseTo(-122.15);
    expect(box.south).toBeCloseTo(47.5);
    expect(box.north).toBeCloseTo(47.82);
  });

  it("returns null for an empty collection", () => {
    expect(collectionBox({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("projects every vertex inside the chip viewBox", () => {
    const box = collectionBox(FC)!;
    for (const [lon, lat] of [[-122.4, 47.5], [-122.15, 47.82], [-122.3, 47.7]] as const) {
      const [x, y] = project(lon, lat, box);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CHIP_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CHIP_H);
    }
  });

  it("projects north to smaller y (SVG orientation)", () => {
    const box = collectionBox(FC)!;
    const [, yNorth] = project(-122.3, 47.82, box);
    const [, ySouth] = project(-122.3, 47.5, box);
    expect(yNorth).toBeLessThan(ySouth);
  });

  it("downsample keeps endpoints and leaves short rings alone", () => {
    const shortRing = square(0, 0);
    expect(downsample(shortRing)).toEqual(shortRing);
    const long: [number, number][] = Array.from({ length: 30 }, (_, i) => [i, i]);
    const sampled = downsample(long);
    expect(sampled.length).toBeLessThan(long.length);
    expect(sampled[0]).toEqual(long[0]);
    expect(sampled[sampled.length - 1]).toEqual(long[long.length - 1]);
  });

  it("featurePath finds a MultiPolygon feature by name and returns closed subpaths", () => {
    const box = collectionBox(FC)!;
    const path = featurePath(FC, "BETA/GAMMA", box);
    expect(path).toContain("M");
    expect((path.match(/Z/g) ?? []).length).toBe(2);
    expect(featurePath(FC, "NOWHERE", box)).toBe("");
  });

  it("mosaicPath covers every feature", () => {
    const box = collectionBox(FC)!;
    expect((mosaicPath(FC, box).match(/Z/g) ?? []).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/locatorGeometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`frontend/src/types.ts` — add directly below `BeatFeatureCollection`:

```ts
export type McppFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { mcpp: string };
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  }>;
};
```

`frontend/src/api/client.ts` — add directly below `getBeatPolygons` (extend the types import):

```ts
export function getMcppPolygons(): Promise<McppFeatureCollection> {
  return request<McppFeatureCollection>("/dashboard/mcpp");
}
```

Create `frontend/src/lib/locatorGeometry.ts`:

```ts
// Chip-scale geometry for the MCPP locator mini-map: equirectangular projection with a
// cos-latitude x-scale (adequate at city scale), ring downsampling for 64px rendering,
// and SVG path strings. Pure functions; callers compute the mosaic once per fetch.
import type { McppFeatureCollection } from "../types";

export const CHIP_W = 64;
export const CHIP_H = 72;

export type LocatorBox = { west: number; south: number; east: number; north: number; cosLat: number };

type Ring = [number, number][];

function rings(geometry: { type: string; coordinates: unknown }): Ring[] {
  if (geometry.type === "Polygon") return geometry.coordinates as Ring[];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as Ring[][]).flat();
  return [];
}

export function collectionBox(fc: McppFeatureCollection): LocatorBox | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const feature of fc.features) {
    for (const ring of rings(feature.geometry)) {
      for (const [x, y] of ring) {
        if (x < west) west = x;
        if (x > east) east = x;
        if (y < south) south = y;
        if (y > north) north = y;
      }
    }
  }
  if (!Number.isFinite(west) || east === west || north === south) return null;
  const cosLat = Math.cos(((south + north) / 2) * (Math.PI / 180));
  return { west, south, east, north, cosLat };
}

export function project(lon: number, lat: number, box: LocatorBox): [number, number] {
  const spanX = (box.east - box.west) * box.cosLat;
  const spanY = box.north - box.south;
  const scale = Math.min(CHIP_W / spanX, CHIP_H / spanY);
  const offsetX = (CHIP_W - spanX * scale) / 2;
  const offsetY = (CHIP_H - spanY * scale) / 2;
  return [offsetX + (lon - box.west) * box.cosLat * scale, offsetY + (box.north - lat) * scale];
}

export function downsample(ring: Ring, keepEvery = 3): Ring {
  if (ring.length <= 8) return ring;
  const out = ring.filter((_, i) => i % keepEvery === 0);
  const last = ring[ring.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function ringPath(ring: Ring, box: LocatorBox): string {
  const points = downsample(ring)
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat, box);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("");
  return `${points}Z`;
}

export function featurePath(fc: McppFeatureCollection, name: string, box: LocatorBox): string {
  const feature = fc.features.find((f) => f.properties.mcpp === name);
  if (!feature) return "";
  return rings(feature.geometry).map((ring) => ringPath(ring, box)).join("");
}

export function mosaicPath(fc: McppFeatureCollection, box: LocatorBox): string {
  return fc.features.map((f) => rings(f.geometry).map((ring) => ringPath(ring, box)).join("")).join("");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/locatorGeometry.test.ts && npx tsc -b --pretty false`
Expected: 8 tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/lib/locatorGeometry.ts frontend/src/lib/locatorGeometry.test.ts
git commit -m "feat(frontend): /dashboard/mcpp client + locator chip geometry lib

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: LocatorChip component + verdict-card integration

**Files:**
- Create: `frontend/src/components/LocatorChip.tsx`
- Modify: `frontend/src/components/AnalyzeTab.tsx` (Props, `locator` memo, VerdictCard head)
- Modify: `frontend/src/components/MapWorkspace.tsx` (fetch + thread `mcppPolygons`)
- Modify: `frontend/src/styles/mapWorkspace.css` (`.mc-locator` rules next to `.mc-idbadge`; `.mc-verdict-head` alignment)
- Test: `frontend/src/components/LocatorChip.test.tsx` (new), `frontend/src/components/AnalyzeTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/LocatorChip.test.tsx` (copy the jsdom pragma/cleanup header from `BaselineIntervalPlot.test.tsx`):

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { McppFeatureCollection } from "../types";
import { placeIdentity } from "../lib/placeIdentity";
import { collectionBox, mosaicPath } from "../lib/locatorGeometry";
import { LocatorChip } from "./LocatorChip";

const FC: McppFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { mcpp: "TEST HILL" },
      geometry: { type: "Polygon", coordinates: [[[-122.4, 47.5], [-122.3, 47.5], [-122.3, 47.6], [-122.4, 47.6], [-122.4, 47.5]]] },
    },
    {
      type: "Feature",
      properties: { mcpp: "OTHERTOWN" },
      geometry: { type: "Polygon", coordinates: [[[-122.3, 47.6], [-122.2, 47.6], [-122.2, 47.7], [-122.3, 47.7], [-122.3, 47.6]]] },
    },
  ],
};

const box = collectionBox(FC)!;
const locator = { polygons: FC, box, mosaic: mosaicPath(FC, box) };

afterEach(cleanup);

describe("LocatorChip", () => {
  it("highlights the place's neighborhood (display label round-trips to canonical name)", () => {
    render(
      <LocatorChip locator={locator} latitude={47.55} longitude={-122.35} mcppLabel="Test Hill" identity={placeIdentity(0)} />,
    );
    expect(screen.getByTestId("locator-highlight")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A is in Test Hill" })).toBeInTheDocument();
  });

  it("renders mosaic + pin without a highlight when the place has no neighborhood", () => {
    render(
      <LocatorChip locator={locator} latitude={47.55} longitude={-122.35} mcppLabel={null} identity={placeIdentity(1)} />,
    );
    expect(screen.queryByTestId("locator-highlight")).toBeNull();
    expect(screen.getByRole("img", { name: "Location of B in Seattle" })).toBeInTheDocument();
  });
});
```

Append to `frontend/src/components/AnalyzeTab.test.tsx` (extend the existing populated fixture render helper to pass `mcppPolygons`; build a small FC around the fixture's mcpp label — read the fixture first: its mcpp baseline entry label determines the canonical name to use, e.g. label `"Capitol Hill"` → polygon `properties.mcpp: "CAPITOL HILL"`; the fixture place must have coordinates via the `selected` prop for the pin dot):

```tsx
it("renders a locator chip on verdict cards when MCPP polygons are loaded", () => {
  renderAnalyze({ mcppPolygons: FIXTURE_FC }); // adapt: helper + a 1-feature FC matching the fixture's mcpp label
  expect(screen.getAllByTestId("locator-chip").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/LocatorChip.test.tsx src/components/AnalyzeTab.test.tsx`
Expected: FAIL — no `LocatorChip` module; no chip testid in AnalyzeTab.

- [ ] **Step 3: Implement LocatorChip**

Create `frontend/src/components/LocatorChip.tsx`:

```tsx
import { useMemo } from "react";

import { CHIP_H, CHIP_W, featurePath, project, type LocatorBox } from "../lib/locatorGeometry";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { McppFeatureCollection } from "../types";

export type LocatorData = { polygons: McppFeatureCollection; box: LocatorBox; mosaic: string };

type Props = {
  locator: LocatorData;
  latitude: number;
  longitude: number;
  /** Display label of the place's MCPP baseline entry (e.g. "Test Hill"); null when the
   * place resolved to no neighborhood. Uppercasing recovers the canonical polygon name —
   * every display label (title-cased or acronym override) round-trips. */
  mcppLabel: string | null;
  identity: PlaceIdentity;
};

export function LocatorChip({ locator, latitude, longitude, mcppLabel, identity }: Props) {
  const highlight = useMemo(
    () => (mcppLabel ? featurePath(locator.polygons, mcppLabel.toUpperCase(), locator.box) : ""),
    [locator, mcppLabel],
  );
  const [cx, cy] = project(longitude, latitude, locator.box);
  return (
    <svg
      className={`mc-locator id-${identity.slot}`}
      viewBox={`0 0 ${CHIP_W} ${CHIP_H}`}
      width={CHIP_W}
      height={CHIP_H}
      role="img"
      aria-label={mcppLabel ? `${identity.letter} is in ${mcppLabel}` : `Location of ${identity.letter} in Seattle`}
      data-testid="locator-chip"
    >
      <path className="mosaic" d={locator.mosaic} />
      {highlight ? <path className="hood" d={highlight} data-testid="locator-highlight" /> : null}
      <circle className="pin" cx={cx} cy={cy} r={3.5} />
    </svg>
  );
}
```

- [ ] **Step 4: Integrate into AnalyzeTab + MapWorkspace**

`frontend/src/components/MapWorkspace.tsx`:

- Extend the client import with `getMcppPolygons`; extend the types import with `McppFeatureCollection`.
- Below the beats fetch effect (~line 68) add:

```ts
  const [mcppPolygons, setMcppPolygons] = useState<McppFeatureCollection | null>(null);
  useEffect(() => {
    getMcppPolygons().then(setMcppPolygons).catch(() => setMcppPolygons(null)); // locator chips are optional chrome
  }, []);
```

- Pass `mcppPolygons={mcppPolygons}` to `<AnalyzeTab ... />`.

`frontend/src/components/AnalyzeTab.tsx`:

- Imports: `import { LocatorChip, type LocatorData } from "./LocatorChip";`, `import { collectionBox, mosaicPath } from "../lib/locatorGeometry";`, extend the types import with `McppFeatureCollection`.
- Props: add `mcppPolygons?: McppFeatureCollection | null;` (destructure it).
- In `AnalyzeTab`, compute once per fetch (NOT per card — the mosaic path is the heavy part):

```ts
  const locator = useMemo<LocatorData | null>(() => {
    if (!mcppPolygons) return null;
    const box = collectionBox(mcppPolygons);
    return box ? { polygons: mcppPolygons, box, mosaic: mosaicPath(mcppPolygons, box) } : null;
  }, [mcppPolygons]);
```

- Thread into each `<VerdictCard ... locator={locator} coords={coordsFor(place, index)} />` where `coordsFor` resolves the place's lat/lon from the `selected` prop — add near the top of `AnalyzeTab`:

```ts
  function coordsFor(place: NeighborhoodPlace, index: number): { latitude: number; longitude: number } | null {
    const match = selected.find((p) => p.id === place.place_id) ?? selected[index];
    return match && match.latitude != null && match.longitude != null
      ? { latitude: match.latitude, longitude: match.longitude }
      : null;
  }
```

(The neighborhood payload carries no coordinates; `selected` is the same set the run was issued for. Match by id, fall back to positional index for synthesized ids.)

- In `VerdictCard` (props: add `locator: LocatorData | null;` and `coords: { latitude: number; longitude: number } | null;`), render the chip as the FIRST child of `.mc-verdict-head`, before the badge:

```tsx
        {locator && coords ? (
          <LocatorChip
            locator={locator}
            latitude={coords.latitude}
            longitude={coords.longitude}
            mcppLabel={place.baselines.find((b) => b.kind === "mcpp")?.label ?? null}
            identity={identity}
          />
        ) : null}
```

`frontend/src/styles/mapWorkspace.css` — next to the `.mc-idbadge` rules add:

```css
.mc-locator{flex:none;background:var(--surface);border:0.5px solid var(--border);border-radius:6px;--idc:var(--id-x);}
.mc-locator.id-a{--idc:var(--id-a);}.mc-locator.id-b{--idc:var(--id-b);}.mc-locator.id-c{--idc:var(--id-c);}.mc-locator.id-d{--idc:var(--id-d);}
.mc-locator .mosaic{fill:none;stroke:var(--border);stroke-width:.6;}
.mc-locator .hood{fill:color-mix(in srgb,var(--idc) 18%,transparent);stroke:var(--idc);stroke-width:1;}
.mc-locator .pin{fill:var(--idc);stroke:var(--surface);stroke-width:1;}
```

and update the existing `.mc-verdict-head` rule to `align-items:flex-start;` with `gap:10px` (read the current rule first; change only alignment/gap so the 72px chip doesn't stretch the badge row).

- [ ] **Step 5: Run tests, full sanity, commit**

Run: `cd frontend && npx vitest run src/components/LocatorChip.test.tsx src/components/AnalyzeTab.test.tsx && npx tsc -b --pretty false && npm test`
Expected: ALL PASS (AnalyzeTab's other tests unaffected — `mcppPolygons` is optional and defaults to no chip).

```bash
git add frontend/src/components/LocatorChip.tsx frontend/src/components/LocatorChip.test.tsx frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx frontend/src/components/MapWorkspace.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): MCPP locator chips on verdict cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs + roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md` (the "Desktop focus mode & multi-baseline analysis" section)
- Modify: `docs/architecture/frontend.md` IF it exists and describes the drawer presets or map pins (run `grep -rln "preset\|drawer" docs/architecture/` first; update only sentences the slice made stale — if nothing matches, skip and say so)

- [ ] **Step 1: Roadmap**

In `docs/ROADMAP.md`, tick the slice-3 item `[x]` with `(2026-07-12)`, matching the slice-1/2 entries' style. In the same section, if there is no line for the calls-layer aggregation fast-follow, add (unchecked, matching style):

```markdown
- [ ] Sector/city baselines via month-grouped SQL COUNT(*) (calls layer materializes
  ~700k rows/yr per citywide request today — do before demoing the calls layer)
```

- [ ] **Step 2: Verify + commit**

Run: `git status` — only doc files changed.

```bash
git add docs/
git commit -m "docs: roadmap tick for slice 3 (focus mode + locator chips + identity pins)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verification gate + live visual check + PR (controller-run)

- [ ] Run `make test-all` from the worktree root — pytest + ruff + npm test + build ALL green.
- [ ] Live visual check in the browser preview (controller: `make run` via preview harness or vite dev): Focus preset expands the panel leaving a live map strip; selected pins show identity colors + letters; hovering a verdict card pulses its pin; locator chips render with the correct neighborhood highlighted in light AND dark themes. Screenshot proof.
- [ ] Fresh-context final review (whole diff vs origin/main, spec §1–§3 acceptance).
- [ ] Push branch, open PR.

---

## Self-Review Notes

- Spec coverage: §1 focus mode → Task 1 (preset, shared clamp, 96px strip; entry/exit via the existing segmented control — no auto-entry, per spec's "user-controlled preset" decision). §2 identity system → Task 2 (single source: `selected` order; pins + cards; letters beyond D fall to neutral slate via `placeIdentity`'s existing fallback). §3 locator chips → Tasks 3–4 (mosaic-direct rendering resolves the deferred city-outline decision — no union asset needed; per-card chip; hover-sync bonus from §3 → Task 2). Hover pulse + identity pins together close the "still identifier + map connection" requirement that motivated the slice.
- Placeholder scan: clean — every step has full code or an explicit read-first instruction with the exact change.
- Type consistency: `PlaceIdentity` export added in Task 2 and consumed in Tasks 2/4; `LocatorData` defined in LocatorChip and consumed by AnalyzeTab; `McppFeatureCollection` defined in Task 3 before its Task 4 uses; `coordsFor` returns the shape LocatorChip consumes.
- Known accepted trade-offs: manual drag can now reach focus width (deliberate cap change, tested); pulse class reapplies via effect deps after marker rebuilds; chips skip places with no resolvable coordinates.
