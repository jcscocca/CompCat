# Analyze Tab Redesign + Flexible Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Waypoint workspace drawer drag-resizable with Peek/Default/Wide presets, and rebuild the Analyze tab to fit any drawer width (configure→run→read order, a width-driven responsive incident table/cards switch, charts reflow, real loading/empty/error states), removing the absolute-footer + magic-spacer hack and rippling that removal to Compare.

**Architecture:** A new `lib/drawer.ts` owns width math/constants and `lib/drawerStorage.ts` owns `localStorage` persistence. `MapWorkspace` holds `DrawerState { collapsed, widthPx }`, persists it, plumbs the live width down as a `--panel-width` CSS var (for map attribution) and a `panelWidthPx` prop (for Analyze's responsive layout). `BottomSheet` renders a keyboard- and pointer-accessible resize handle plus three presets. `AnalyzeTab` derives its incident layout and chart columns from `panelWidthPx`, so all responsive decisions are deterministic under jsdom (which performs no layout).

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + Testing Library (jsdom), Leaflet/react-leaflet, plain CSS (`styles/mapWorkspace.css`). Test command: `cd frontend && npm test`. Build: `npm run build` (`tsc -b && vite build`).

**Working directory for all commands:** `frontend/` unless stated otherwise.

---

## File Structure

- `frontend/src/lib/drawer.ts` (new) — constants + `drawerMax()`, `clampWidth()`, `DrawerPreset`.
- `frontend/src/lib/drawer.test.ts` (new) — unit tests for the math.
- `frontend/src/lib/drawerStorage.ts` (new) — `loadDrawerState()` / `saveDrawerState()` with try/catch.
- `frontend/src/lib/drawerStorage.test.ts` (new) — round-trip + fallback tests.
- `frontend/src/types.ts` (modify) — replace `SheetState` with `DrawerState`.
- `frontend/src/components/BottomSheet.tsx` (rewrite) — new drawer props, resize handle, three presets.
- `frontend/src/components/BottomSheet.test.tsx` (rewrite) — new API expectations.
- `frontend/src/components/MapWorkspace.tsx` (modify) — own `DrawerState`, persistence, width plumbing, error pass-down, pin-placement collapse.
- `frontend/src/components/MapWorkspace.test.tsx` (modify) — update two class assertions.
- `frontend/src/components/AnalyzeTab.tsx` (modify) — sticky query bar, remove footer/spacer, `panelWidthPx`, cards/table switch, charts reflow, skeletons, inline error.
- `frontend/src/components/AnalyzeTab.test.tsx` (modify) — add cards/skeleton/error tests.
- `frontend/src/components/CompareTab.tsx` (modify) — sticky action area, remove footer/spacer.
- `frontend/src/styles/mapWorkspace.css` (modify) — drawer width/collapse, `.mc-querybar`, `.mc-inline-error`, `.mc-incident-cards`, `.mc-skeleton`, charts `.is-2up`, relax table `min-width`.

---

## Task 1: Drawer math + storage libs

**Files:**
- Create: `frontend/src/lib/drawer.ts`
- Create: `frontend/src/lib/drawer.test.ts`
- Create: `frontend/src/lib/drawerStorage.ts`
- Create: `frontend/src/lib/drawerStorage.test.ts`

- [ ] **Step 1: Write the failing test for the math**

Create `frontend/src/lib/drawer.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clampWidth, drawerMax, DRAWER_DEFAULT, DRAWER_MIN } from "./drawer";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

afterEach(() => setViewport(1024));

describe("drawer math", () => {
  it("exposes the expected default expanded width", () => {
    expect(DRAWER_DEFAULT).toBe(400);
    expect(DRAWER_MIN).toBe(340);
  });

  it("caps drawerMax at 72% of the viewport, never above 720", () => {
    setViewport(800);
    expect(drawerMax()).toBe(576);
    setViewport(2000);
    expect(drawerMax()).toBe(720);
  });

  it("clamps width into [DRAWER_MIN, drawerMax]", () => {
    setViewport(1200);
    expect(clampWidth(100)).toBe(DRAWER_MIN);
    expect(clampWidth(5000)).toBe(drawerMax());
    expect(clampWidth(512.6)).toBe(513);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- drawer.test`
Expected: FAIL — cannot resolve `./drawer`.

- [ ] **Step 3: Implement `lib/drawer.ts`**

Create `frontend/src/lib/drawer.ts`:

```ts
export const DRAWER_MIN = 340;
export const DRAWER_DEFAULT = 400;
export const DRAWER_WIDE = 640;
export const DRAWER_PEEK = 84;
export const DRAWER_RESIZE_STEP = 24;

export type DrawerPreset = "peek" | "default" | "wide";

export function drawerMax(): number {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return Math.max(DRAWER_MIN, Math.min(720, Math.round(vw * 0.72)));
}

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_DEFAULT;
  return Math.min(drawerMax(), Math.max(DRAWER_MIN, Math.round(px)));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- drawer.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for storage**

Create `frontend/src/lib/drawerStorage.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRAWER_DEFAULT } from "./drawer";
import { loadDrawerState, saveDrawerState } from "./drawerStorage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("drawer storage", () => {
  it("defaults to an open drawer at the default width when nothing is stored", () => {
    expect(loadDrawerState()).toEqual({ collapsed: false, widthPx: DRAWER_DEFAULT });
  });

  it("round-trips a saved state, clamping the width", () => {
    saveDrawerState({ collapsed: true, widthPx: 99999 });
    const loaded = loadDrawerState();
    expect(loaded.collapsed).toBe(true);
    expect(loaded.widthPx).toBeLessThanOrEqual(720);
    expect(loaded.widthPx).toBeGreaterThanOrEqual(340);
  });

  it("falls back to defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadDrawerState()).toEqual({ collapsed: false, widthPx: DRAWER_DEFAULT });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- drawerStorage.test`
Expected: FAIL — cannot resolve `./drawerStorage`.

- [ ] **Step 7: Implement `lib/drawerStorage.ts`**

Create `frontend/src/lib/drawerStorage.ts`:

```ts
import { clampWidth, DRAWER_DEFAULT } from "./drawer";

const WIDTH_KEY = "waypoint.drawer.width";
const COLLAPSED_KEY = "waypoint.drawer.collapsed";

export type StoredDrawer = { collapsed: boolean; widthPx: number };

export function loadDrawerState(): StoredDrawer {
  try {
    const rawWidth = localStorage.getItem(WIDTH_KEY);
    const rawCollapsed = localStorage.getItem(COLLAPSED_KEY);
    const widthPx = rawWidth === null ? DRAWER_DEFAULT : clampWidth(Number(rawWidth));
    return { collapsed: rawCollapsed === "true", widthPx };
  } catch {
    return { collapsed: false, widthPx: DRAWER_DEFAULT };
  }
}

export function saveDrawerState(state: StoredDrawer): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(state.widthPx));
    localStorage.setItem(COLLAPSED_KEY, String(state.collapsed));
  } catch {
    // ignore: private mode or disabled storage degrades to in-memory defaults
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm test -- drawerStorage.test`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/drawer.ts src/lib/drawer.test.ts src/lib/drawerStorage.ts src/lib/drawerStorage.test.ts
git commit -m "feat(frontend): drawer width math and persistence helpers"
```

---

## Task 2: Flexible drawer (BottomSheet + MapWorkspace + types + CSS)

This task changes the `BottomSheet`↔`MapWorkspace` props contract, so all of types, both
components, both test files, and the CSS move together to keep the build green.

**Files:**
- Modify: `frontend/src/types.ts`
- Rewrite: `frontend/src/components/BottomSheet.tsx`
- Rewrite: `frontend/src/components/BottomSheet.test.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Modify: `frontend/src/components/MapWorkspace.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Replace the `SheetState` type**

In `frontend/src/types.ts`, replace:

```ts
export type SheetState = "peek" | "half";
```

with:

```ts
export type DrawerState = { collapsed: boolean; widthPx: number };
```

- [ ] **Step 2: Write the new BottomSheet tests (failing)**

Replace the entire contents of `frontend/src/components/BottomSheet.test.tsx` with:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./BottomSheet";
import { DRAWER_DEFAULT } from "../lib/drawer";

afterEach(cleanup);

function renderSheet(overrides: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const props = {
    activeTab: "places" as const,
    onTabChange: vi.fn(),
    collapsed: false,
    widthPx: DRAWER_DEFAULT,
    onToggleCollapsed: vi.fn(),
    onResize: vi.fn(),
    onPreset: vi.fn(),
    ...overrides,
  };
  const result = render(<BottomSheet {...props}><div>panel</div></BottomSheet>);
  return { ...result, props };
}

describe("BottomSheet", () => {
  it("renders four tabs and marks the active one", () => {
    renderSheet({ activeTab: "places" });
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /places/i })).toHaveAttribute("aria-selected", "true");
  });

  it("calls onTabChange when another tab is clicked or activated by keyboard", () => {
    const { props } = renderSheet();
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    expect(props.onTabChange).toHaveBeenCalledWith("analyze");
    fireEvent.keyDown(screen.getByRole("tab", { name: /compare/i }), { key: "Enter" });
    expect(props.onTabChange).toHaveBeenCalledWith("compare");
  });

  it("exposes Peek, Default, and Wide presets and marks the active one pressed", () => {
    const { props } = renderSheet({ widthPx: DRAWER_DEFAULT });
    expect(screen.getByRole("button", { name: /default/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /peek/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /wide/i }));
    expect(props.onPreset).toHaveBeenCalledWith("wide");
  });

  it("marks Peek pressed when collapsed", () => {
    renderSheet({ collapsed: true });
    expect(screen.getByRole("button", { name: /peek/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("exposes the handle as a separator reflecting the current width", () => {
    renderSheet({ widthPx: 512 });
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    expect(handle).toHaveAttribute("aria-valuenow", "512");
  });

  it("resizes with arrow keys (open) by the resize step", () => {
    const { props } = renderSheet({ widthPx: 400 });
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(props.onResize).toHaveBeenCalledWith(424);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(props.onResize).toHaveBeenCalledWith(376);
  });

  it("toggles collapse with Enter and with a click that does not drag", () => {
    const { props } = renderSheet();
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it("resizes from a pointer drag using the panel's right edge", () => {
    const { props, container } = renderSheet({ widthPx: 400 });
    const panel = container.querySelector(".mc-workspace-panel") as HTMLElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ right: 1000, left: 600, top: 0, bottom: 0, width: 400, height: 0, x: 600, y: 0, toJSON: () => ({}) } as DOMRect);
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 520 });
    expect(props.onResize).toHaveBeenCalledWith(480);
  });

  it("renders the panel open with an inline width, collapsed without one", () => {
    const { container, rerender } = renderSheet({ collapsed: false, widthPx: 420 });
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;
    expect(panel()).toHaveClass("is-open");
    expect(panel().style.width).toBe("420px");
    rerender(
      <BottomSheet activeTab="places" onTabChange={vi.fn()} collapsed widthPx={420} onToggleCollapsed={vi.fn()} onResize={vi.fn()} onPreset={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(panel()).toHaveClass("is-collapsed");
    expect(panel().style.width).toBe("");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- BottomSheet.test`
Expected: FAIL — `BottomSheet` still uses the old `sheetState` props.

- [ ] **Step 4: Rewrite `BottomSheet.tsx`**

Replace the entire contents of `frontend/src/components/BottomSheet.tsx` with:

```tsx
import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { DRAWER_DEFAULT, DRAWER_MIN, DRAWER_PEEK, DRAWER_RESIZE_STEP, DRAWER_WIDE, drawerMax, type DrawerPreset } from "../lib/drawer";
import type { TabKey } from "../types";

type Props = {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  collapsed: boolean;
  widthPx: number;
  onToggleCollapsed: () => void;
  onResize: (px: number) => void;
  onPreset: (preset: DrawerPreset) => void;
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

const PRESETS: { preset: DrawerPreset; label: string }[] = [
  { preset: "peek", label: "Peek" },
  { preset: "default", label: "Default" },
  { preset: "wide", label: "Wide" },
];

function activateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export function BottomSheet({
  activeTab,
  onTabChange,
  collapsed,
  widthPx,
  onToggleCollapsed,
  onResize,
  onPreset,
  tabBadges,
  children,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);

  function presetPressed(preset: DrawerPreset) {
    if (preset === "peek") return collapsed;
    if (collapsed) return false;
    if (preset === "default") return widthPx === DRAWER_DEFAULT;
    return widthPx === DRAWER_WIDE;
  }

  function onHandlePointerDown(event: PointerEvent<HTMLDivElement>) {
    moved.current = false;
    if (collapsed) {
      dragging.current = false;
      return;
    }
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onHandlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !panelRef.current) return;
    moved.current = true;
    const right = panelRef.current.getBoundingClientRect().right;
    onResize(right - event.clientX);
  }

  function onHandlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const wasDragging = dragging.current;
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (collapsed) {
      onToggleCollapsed();
      return;
    }
    if (wasDragging && !moved.current) onToggleCollapsed();
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleCollapsed();
      return;
    }
    if (collapsed) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onResize(widthPx + DRAWER_RESIZE_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onResize(widthPx - DRAWER_RESIZE_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      onResize(drawerMax());
    } else if (event.key === "End") {
      event.preventDefault();
      onResize(0);
    }
  }

  return (
    <section
      ref={panelRef}
      className={`mc-workspace-panel ${collapsed ? "is-collapsed" : "is-open"}`}
      style={collapsed ? undefined : { width: widthPx }}
      aria-label="Workspace panel"
    >
      <div
        className="mc-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace panel"
        aria-valuemin={DRAWER_MIN}
        aria-valuemax={drawerMax()}
        aria-valuenow={collapsed ? DRAWER_PEEK : widthPx}
        tabIndex={0}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={onHandleKeyDown}
      />
      <div className="mc-snaps" role="group" aria-label="Panel size">
        {PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            className={presetPressed(preset) ? "on" : undefined}
            aria-pressed={presetPressed(preset)}
            onClick={() => onPreset(preset)}
            onKeyDown={(event) => activateWithKeyboard(event, () => onPreset(preset))}
          >
            <span>{label}</span>
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
              onKeyDown={(event) => activateWithKeyboard(event, () => onTabChange(tab.key))}
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

- [ ] **Step 5: Run BottomSheet tests to verify they pass**

Run: `npm test -- BottomSheet.test`
Expected: PASS (9 tests). MapWorkspace will not compile yet — that's fixed next.

- [ ] **Step 6: Update MapWorkspace state, persistence, and handlers**

In `frontend/src/components/MapWorkspace.tsx`:

Add imports near the existing `lib` imports:

```ts
import { clampWidth, DRAWER_DEFAULT, DRAWER_PEEK, DRAWER_WIDE, type DrawerPreset } from "../lib/drawer";
import { loadDrawerState, saveDrawerState } from "../lib/drawerStorage";
```

Update the type import line (`import type { ... } from "../types";`) to drop `SheetState` and add `DrawerState`.

Replace the sheet-state declaration:

```ts
const [sheetState, setSheetState] = useState<SheetState>("half");
```

with:

```ts
const [drawer, setDrawer] = useState<DrawerState>(() => loadDrawerState());
```

Add these effects right after the existing Escape-key `useEffect`:

```ts
  useEffect(() => {
    saveDrawerState(drawer);
  }, [drawer]);

  useEffect(() => {
    function onResize() {
      setDrawer((current) => ({ ...current, widthPx: clampWidth(current.widthPx) }));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function handleDrawerResize(px: number) {
    setDrawer((current) => ({ ...current, widthPx: clampWidth(px) }));
  }

  function handleToggleCollapsed() {
    setDrawer((current) => ({ ...current, collapsed: !current.collapsed }));
  }

  function handleDrawerPreset(preset: DrawerPreset) {
    setDrawer((current) => {
      if (preset === "peek") return { ...current, collapsed: true };
      return { collapsed: false, widthPx: preset === "wide" ? DRAWER_WIDE : DRAWER_DEFAULT };
    });
  }
```

Update the two pin-placement handlers to collapse/expand the drawer:

In `handleStartAddPin`, replace `setSheetState("peek");` with `setDrawer((current) => ({ ...current, collapsed: true }));`

In `handleMapClick`, replace `setSheetState("half");` with `setDrawer((current) => ({ ...current, collapsed: false }));`

- [ ] **Step 7: Set the `--panel-width` CSS var on the frame and wire BottomSheet**

In `MapWorkspace.tsx`, update the frame wrapper to publish the live width:

```tsx
      <div
        className={`mc-frame${addPinMode ? " is-placing-pin" : ""}`}
        style={{ "--panel-width": `${drawer.collapsed ? DRAWER_PEEK : drawer.widthPx}px` } as React.CSSProperties}
      >
```

(Add `import type React from "react";` at the top if not present, or use `as CSSProperties` with `import { type CSSProperties } from "react";`.)

Replace the `<BottomSheet ...>` opening props:

```tsx
        <BottomSheet
          activeTab={activeTab}
          onTabChange={setActiveTab}
          collapsed={drawer.collapsed}
          widthPx={drawer.widthPx}
          onToggleCollapsed={handleToggleCollapsed}
          onResize={handleDrawerResize}
          onPreset={handleDrawerPreset}
          tabBadges={{ places: places.length, compare: selectedIds.size }}
        >
```

- [ ] **Step 8: Update the two MapWorkspace class assertions**

In `frontend/src/components/MapWorkspace.test.tsx`, in the test "collapses the workspace panel while choosing where to drop a pin":

Replace `expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-peek");`
with `expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-collapsed");`

Replace `expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");`
with `expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-open");`

- [ ] **Step 9: Update the CSS for the flexible drawer**

In `frontend/src/styles/mapWorkspace.css`:

Replace the two width-state rules:

```css
.mc-workspace-panel.is-peek{width:var(--panel-rail);}
.mc-workspace-panel.is-half{width:var(--panel-width);}
```

with:

```css
.mc-workspace-panel.is-collapsed{width:var(--panel-rail);}
```

Rename every remaining `.mc-workspace-panel.is-peek` selector to `.mc-workspace-panel.is-collapsed` (the block at the "is-peek" rules: `.mc-snaps`, `.mc-snaps button span`, `.mc-panels`, `.mc-tabs`, `.mc-tab`, `.mc-tab svg`, `.mc-tab.is-active::after`, `.mc-tab .pill`), and in the `@media (max-width:760px)` block rename `.mc-workspace-panel.is-peek` → `.mc-workspace-panel.is-collapsed` and delete the now-redundant `.mc-workspace-panel.is-half{...}` mobile rule (width comes from the inline style).

Replace the resize handle rule:

```css
.mc-handle{position:absolute;left:-8px;top:50%;width:5px;height:46px;border-radius:99px;background:rgba(255,255,255,.26);margin:0;transform:translateY(-50%);}
```

with:

```css
.mc-handle{position:absolute;left:-6px;top:0;bottom:0;width:12px;display:flex;align-items:center;justify-content:center;cursor:ew-resize;z-index:60;}
.mc-handle::before{content:"";width:5px;height:46px;border-radius:99px;background:rgba(255,255,255,.26);}
.mc-handle:hover::before,.mc-handle:focus-visible::before{background:var(--clay);}
.mc-handle:focus-visible{outline:none;}
.mc-workspace-panel.is-collapsed .mc-handle{cursor:pointer;}
```

Delete the now-obsolete `button.mc-handle{appearance:none;border:0;padding:0;cursor:pointer;}` rule (the handle is a `div` now).

Simplify the Leaflet-attribution offset rules to read the live `--panel-width` (remove the `:has(.is-peek)` / `:has(.is-half)` variants). Replace:

```css
.mc-frame .leaflet-bottom.leaflet-right{right:calc(var(--panel-width) + 14px);bottom:18px;z-index:1100;}
.mc-frame:has(.mc-workspace-panel.is-peek) .leaflet-bottom.leaflet-right{right:calc(var(--panel-rail) + 14px);}
.mc-frame:has(.mc-workspace-panel.is-half) .leaflet-bottom.leaflet-right{right:calc(var(--panel-width) + 14px);}
```

with:

```css
.mc-frame .leaflet-bottom.leaflet-right{right:calc(var(--panel-width) + 14px);bottom:18px;z-index:1100;}
```

And inside `@media (max-width:760px)`, replace the three `.leaflet-bottom.leaflet-right` rules with the single:

```css
  .mc-frame .leaflet-bottom.leaflet-right{right:calc(var(--panel-width) + 14px);bottom:18px;z-index:1100;}
```

- [ ] **Step 10: Run the full suite and build**

Run: `npm test`
Expected: PASS (all files green, including the updated MapWorkspace and BottomSheet tests).

Run: `npm run build`
Expected: succeeds (no TypeScript errors).

- [ ] **Step 11: Commit**

```bash
git add src/types.ts src/components/BottomSheet.tsx src/components/BottomSheet.test.tsx src/components/MapWorkspace.tsx src/components/MapWorkspace.test.tsx src/styles/mapWorkspace.css
git commit -m "feat(frontend): drag-resizable workspace drawer with presets"
```

---

## Task 3: Analyze query bar (configure→run→read) + remove footer/spacer + inline error

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx`
- Modify: `frontend/src/components/AnalyzeTab.test.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write failing tests for the query bar and inline error**

Add these tests inside the `describe("AnalyzeTab", ...)` block in `frontend/src/components/AnalyzeTab.test.tsx`:

```tsx
  it("places the run controls in a sticky query bar above the findings, with no absolute footer", () => {
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-querybar")).toBeInTheDocument();
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    const queryBar = container.querySelector(".mc-querybar") as HTMLElement;
    expect(queryBar.contains(screen.getByRole("button", { name: /run analysis/i }))).toBe(true);
  });

  it("renders an inline error when one is provided", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} error="Unable to run analysis. Try again." onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText("Unable to run analysis. Try again.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- AnalyzeTab.test`
Expected: FAIL — no `.mc-querybar`, and `error` is not a valid prop.

- [ ] **Step 3: Restructure the AnalyzeTab render**

In `frontend/src/components/AnalyzeTab.tsx`, add `error` to the `Props` type:

```ts
type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  summary: DashboardSummary | null;
  availableRadii: number[];
  running: boolean;
  incidentDetails?: IncidentDetailsResponse | null;
  error?: string;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
};
```

Replace the entire `return (...)` of the `AnalyzeTab` function. Move the three `.mc-field`
control blocks into a sticky `.mc-querybar` at the top together with the run button, drop
the `<div style={{ height: 60 }} />` spacer and the `.mc-footer`, and render the inline
error. Use this exact JSX (note: `error`, `running`, `canRun` come from the function body):

```tsx
  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Analyze">
      <div className="mc-querybar">
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

        <div className="mc-querybar-run">
          <span className="note">{selected.length} place{selected.length === 1 ? "" : "s"} · {analysis.radiusM} m</span>
          <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Running…" : "Run analysis"}</button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="status">{error}</p> : null}

      <section className="mc-findings" aria-label="Findings summary">
        <div className="mc-findings-head">
          <h4>Findings summary</h4>
          <span>{analysis.radiusM} m</span>
        </div>
        <ul>
          {findings.map((finding) => <li key={finding}>{finding}</li>)}
        </ul>
        <p>Reported incident patterns do not predict personal risk.</p>
      </section>

      <IncidentCharts entries={entries} />

      <IncidentDetailsTable details={incidentDetails} />
    </div>
  );
```

Note: the `running ? "Running…" : "Run analysis"` text uses an ellipsis character; the
existing `disables run when nothing is selected` test matches `/run analysis/i`, which
still matches when `running` is false. Add `error` to the destructured params of
`AnalyzeTab({ ... })`.

- [ ] **Step 4: Pass `error` from MapWorkspace into AnalyzeTab and scope the toast**

In `frontend/src/components/MapWorkspace.tsx`, update the `<AnalyzeTab ... />` usage to pass the error:

```tsx
            <AnalyzeTab
              selected={selected}
              analysis={analysis}
              summary={summary}
              availableRadii={availableRadii}
              running={analyzing}
              incidentDetails={incidentDetails}
              error={error}
              onChange={handleAnalysisChange}
              onRun={handleAnalyze}
            />
```

Scope the floating toast so it does not double-display when the Analyze tab shows the error inline. Replace:

```tsx
        {error ? <p className="mc-error" role="status">{error}</p> : null}
```

with:

```tsx
        {error && activeTab !== "analyze" ? <p className="mc-error" role="status">{error}</p> : null}
```

(The session-start error test renders with the default `places` tab active, so the toast still appears for it.)

- [ ] **Step 5: Add the query-bar and inline-error CSS**

In `frontend/src/styles/mapWorkspace.css`, add:

```css
.mc-querybar{position:sticky;top:0;z-index:6;display:grid;gap:12px;margin:-16px -18px 16px;padding:14px 18px 12px;background:rgba(27,30,34,.94);border-bottom:1px solid var(--line);backdrop-filter:blur(8px);}
.mc-querybar .mc-field{margin-bottom:0;}
.mc-querybar-run{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.mc-querybar-run .note{font-size:12px;color:var(--dim);}
.mc-inline-error{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:rgba(205,106,69,.12);border:1px solid rgba(205,106,69,.42);color:#E8A98F;font-size:12.5px;line-height:1.45;}
```

- [ ] **Step 6: Run AnalyzeTab + MapWorkspace tests and build**

Run: `npm test -- AnalyzeTab.test MapWorkspace.test`
Expected: PASS (existing tests still green; the two new AnalyzeTab tests pass).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/AnalyzeTab.tsx src/components/AnalyzeTab.test.tsx src/components/MapWorkspace.tsx src/styles/mapWorkspace.css
git commit -m "feat(frontend): sticky Analyze query bar, inline error, drop footer hack"
```

---

## Task 4: Responsive incident table/cards + charts reflow + loading skeleton

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx`
- Modify: `frontend/src/components/AnalyzeTab.test.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write failing tests for cards, reflow, and skeleton**

Add these tests inside `describe("AnalyzeTab", ...)` in `frontend/src/components/AnalyzeTab.test.tsx`. The `incidentDetails` payload mirrors the existing table test:

```tsx
  const oneIncident = {
    incidents: [
      {
        place_id: "p1", place_label: "Home", incident_id: "incident-1", external_incident_id: "ext-1",
        report_number: "R-100", occurred_at: "2026-01-02T10:00:00Z", reported_at: null,
        offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A",
        block_address: "100 BLOCK MAIN ST", distance_m: 42.4,
      },
    ],
    returned_count: 1, total_count: 1, limit: 100, radius_m: 250,
  };

  it("renders incidents as cards (no table) when the panel is narrow", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} panelWidthPx={380} incidentDetails={oneIncident} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("100 BLOCK MAIN ST", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("42 m")).toBeInTheDocument();
  });

  it("renders incidents as a full table when the panel is wide", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} panelWidthPx={640} incidentDetails={oneIncident} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders 2-up charts only when the panel is wide enough", () => {
    const { container, rerender } = render(<AnalyzeTab selected={[home, office]} analysis={{ ...analysis, offenseCategory: "" }} summary={analyzedSummary} availableRadii={[250]} running={false} panelWidthPx={380} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-analysis-charts")).not.toHaveClass("is-2up");
    rerender(<AnalyzeTab selected={[home, office]} analysis={{ ...analysis, offenseCategory: "" }} summary={analyzedSummary} availableRadii={[250]} running={false} panelWidthPx={640} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-analysis-charts")).toHaveClass("is-2up");
  });

  it("shows loading skeletons while analysis is running", () => {
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={true} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText("Running analysis…")).toBeInTheDocument();
    expect(container.querySelector(".mc-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Findings summary")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- AnalyzeTab.test`
Expected: FAIL — `panelWidthPx` is not a prop; cards/skeleton not rendered.

- [ ] **Step 3: Add the cards component and breakpoint constants**

In `frontend/src/components/AnalyzeTab.tsx`, add module-level constants near the top (after the imports):

```ts
const INCIDENT_TABLE_MIN = 560;
const CHARTS_TWO_UP_MIN = 460;
```

Add `panelWidthPx?: number;` to the `Props` type (alongside the `error?` added in Task 3).

Add a new local component beside `IncidentDetailsTable` (it reuses the existing
`formatDistanceMeters`, `incidentCategoryLabel`, `incidentSubtypeLabel`,
`formatIncidentTime`, and `incidentIdentifier` helpers already defined in this file):

```tsx
function IncidentDetailsCards({ details }: { details: IncidentDetailsResponse | null | undefined }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching reported incidents.`
    : `${details.total_count} matching reported incident${details.total_count === 1 ? "" : "s"}.`;

  return (
    <section className="mc-incident-details" aria-label="Reported incident details">
      <div className="mc-breakdown-head">
        <h5>Reported incidents near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching reported incidents for the selected filters.</p>
      ) : (
        <>
          <p className="mc-incident-count">{countText}</p>
          <div className="mc-incident-cards">
            {details.incidents.map((incident) => (
              <article className="mc-icard" key={`${incident.place_id}-${incident.incident_id}`}>
                <div className="mc-icard-top">
                  <strong>{incident.place_label}</strong>
                  <em>{formatDistanceMeters(incident.distance_m)}</em>
                </div>
                <div className="mc-icard-tags">
                  <span>{incidentCategoryLabel(incident)}</span>
                  <span>{incidentSubtypeLabel(incident)}</span>
                  <span>{formatIncidentTime(incident.occurred_at || incident.reported_at)}</span>
                </div>
                <p className="mc-icard-addr">{incident.block_address || "Unavailable"} · {incidentIdentifier(incident)}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Drive layout from `panelWidthPx` in the render**

In `AnalyzeTab({ ... })`, add `panelWidthPx` to the destructured params, and compute the
layout flags at the top of the function body (after the existing `radii`/`canRun`/`entries`/`findings` lines):

```ts
  const width = panelWidthPx ?? Infinity;
  const incidentLayout = width >= INCIDENT_TABLE_MIN ? "table" : "cards";
  const chartsWide = width >= CHARTS_TWO_UP_MIN;
```

Change the `IncidentCharts` section header to accept the reflow class. Update the
`IncidentCharts` component's opening `<section>` to take a `wide` prop:

```tsx
function IncidentCharts({ entries, wide }: { entries: CrimeSummary[]; wide: boolean }) {
  if (entries.length === 0) return null;

  const offenseRows = buildOffenseRows(entries);

  return (
    <section className={`mc-analysis-charts${wide ? " is-2up" : ""}`} aria-label="Reported incident charts">
```

In the main return, replace the results region (everything after the inline-error line)
so it shows skeletons while running and otherwise picks the table or cards layout:

```tsx
      {error ? <p className="mc-inline-error" role="status">{error}</p> : null}

      {running ? (
        <div className="mc-analysis-loading" aria-live="polite" aria-busy="true">
          <span className="mc-sr">Running analysis…</span>
          <div className="mc-skeleton" style={{ height: 84 }} />
          <div className="mc-skeleton" style={{ height: 132 }} />
          <div className="mc-skeleton" style={{ height: 168 }} />
        </div>
      ) : (
        <>
          <section className="mc-findings" aria-label="Findings summary">
            <div className="mc-findings-head">
              <h4>Findings summary</h4>
              <span>{analysis.radiusM} m</span>
            </div>
            <ul>
              {findings.map((finding) => <li key={finding}>{finding}</li>)}
            </ul>
            <p>Reported incident patterns do not predict personal risk.</p>
          </section>

          <IncidentCharts entries={entries} wide={chartsWide} />

          {incidentLayout === "table" ? (
            <IncidentDetailsTable details={incidentDetails} />
          ) : (
            <IncidentDetailsCards details={incidentDetails} />
          )}
        </>
      )}
    </div>
  );
```

Note: `Running analysis…` lives in an `mc-sr` (visually hidden) span; Testing Library's
`getByText` still finds it in the DOM.

- [ ] **Step 5: Pass `panelWidthPx` from MapWorkspace**

In `frontend/src/components/MapWorkspace.tsx`, add `panelWidthPx={drawer.widthPx}` to the `<AnalyzeTab ... />` props (next to `error={error}`).

- [ ] **Step 6: Add CSS for cards, skeleton, and the charts default**

In `frontend/src/styles/mapWorkspace.css`:

Change the charts grid to default 1-up with a 2-up modifier. Replace:

```css
.mc-analysis-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 16px;}
```

with:

```css
.mc-analysis-charts{display:grid;grid-template-columns:1fr;gap:10px;margin:0 0 16px;}
.mc-analysis-charts.is-2up{grid-template-columns:repeat(2,minmax(0,1fr));}
```

Relax the incident table minimum width. Replace `min-width:680px;` in the
`.mc-incident-table{...}` rule with `min-width:560px;` (keep `font-size:13px;color:var(--text);` intact — `mapWorkspaceStyle.test.ts` asserts them).

Add the cards, skeleton, and loading styles:

```css
.mc-incident-cards{display:grid;gap:8px;}
.mc-icard{display:grid;gap:6px;padding:11px 12px;border-radius:12px;background:var(--ink-raise);border:1px solid var(--line);}
.mc-icard-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.mc-icard-top strong{font-size:13.5px;font-weight:600;color:var(--text);}
.mc-icard-top em{font-style:normal;font-family:var(--f-mono);font-size:11.5px;color:var(--clay);}
.mc-icard-tags{display:flex;flex-wrap:wrap;gap:6px;font-size:11.5px;color:var(--dim);}
.mc-icard-tags span{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:7px;padding:2px 8px;}
.mc-icard-addr{margin:0;font-size:11.5px;color:var(--faint);overflow-wrap:anywhere;}
.mc-analysis-loading{display:grid;gap:12px;margin-bottom:16px;}
.mc-skeleton{border-radius:12px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.09),rgba(255,255,255,.04));background-size:200% 100%;animation:mcshimmer 1.3s ease-in-out infinite;}
@keyframes mcshimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
```

Add `.mc-skeleton` to the existing `@media (prefers-reduced-motion: reduce)` block's
animation-disable list:

```css
@media (prefers-reduced-motion: reduce){
  .pin .body,.halo,.mc-workspace-panel,.mc-panel.is-active,.mc-addpin.is-armed,.mc-skeleton{animation:none !important;}
}
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test`
Expected: PASS (all files green, including the four new AnalyzeTab tests and the unchanged table test, which renders the table because it passes no `panelWidthPx`).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/components/AnalyzeTab.tsx src/components/AnalyzeTab.test.tsx src/components/MapWorkspace.tsx src/styles/mapWorkspace.css
git commit -m "feat(frontend): width-responsive incidents, chart reflow, loading skeletons"
```

---

## Task 5: Ripple the footer-hack removal to Compare

**Files:**
- Modify: `frontend/src/components/CompareTab.tsx`
- Modify: `frontend/src/components/CompareTab.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Write a failing test asserting no absolute footer**

Add this test inside `describe("CompareTab", ...)` in `frontend/src/components/CompareTab.test.tsx`:

```tsx
  it("keeps the compare action in a sticky bar, not an absolute footer or spacer", () => {
    const { container } = render(<CompareTab selected={[home, office]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-compare-actions")).toBeInTheDocument();
    expect(container.querySelector(".mc-compare-actions")?.contains(screen.getByRole("button", { name: /compare places/i }))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- CompareTab.test`
Expected: FAIL — still renders `.mc-footer` and the spacer.

- [ ] **Step 3: Replace the footer + spacer with a sticky action bar**

In `frontend/src/components/CompareTab.tsx`, replace:

```tsx
      <div style={{ height: 56 }} />
      <div className="mc-footer">
        <span className="note">{selected.length} selected - {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing..." : "Compare places"}</button>
      </div>
```

with:

```tsx
      <div className="mc-compare-actions">
        <span className="note">{selected.length} selected · {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing…" : "Compare places"}</button>
      </div>
```

- [ ] **Step 4: Add the sticky action-bar CSS**

In `frontend/src/styles/mapWorkspace.css`, add:

```css
.mc-compare-actions{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px -18px 0;padding:13px 18px;background:linear-gradient(180deg,rgba(27,30,34,0),var(--ink) 42%);}
.mc-compare-actions .note{font-size:12px;color:var(--dim);}
```

- [ ] **Step 5: Run CompareTab tests and build**

Run: `npm test -- CompareTab.test`
Expected: PASS (existing four tests still green — the "compare places" button name and all strings are unchanged — plus the new one).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/CompareTab.tsx src/components/CompareTab.test.tsx src/styles/mapWorkspace.css
git commit -m "refactor(frontend): sticky Compare action bar, drop footer spacer hack"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Frontend suite + build**

Run (in `frontend/`): `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 2: Lint (typecheck)**

Run (in `frontend/`): `npm run lint`
Expected: `tsc -b --pretty false` reports no errors.

- [ ] **Step 3: Backend gate (confirm no regressions)**

Run (in repo root): `make test && make lint`
Expected: pass (no backend files changed; this is a guard).

- [ ] **Step 4: Manual run — verify the drawer + Analyze in a real browser**

Use the `run` (or `verify`) skill to launch the app and exercise:
1. Start the API: `make run` (SQLite default).
2. Seed data: `curl -X POST http://127.0.0.1:8000/crime/ingest/sample`.
3. Start the frontend: `cd frontend && npm run dev`, open `http://127.0.0.1:5173`.
4. Add 2 pins, select them, open Analyze.
5. Drag the drawer handle: confirm it resizes smoothly between the floor and ceiling,
   the incidents switch from cards (narrow) to the full table (wide ≥560px), charts go
   1-up→2-up (≥460px), and the map attribution stays clear of the panel.
6. Click Peek / Default / Wide: confirm the presets snap and the active one is marked.
7. Reload the page: confirm the last drawer width/collapse state is restored.
8. Click Run analysis: confirm skeletons show while running, then findings/charts/incidents.

Take a screenshot of the Wide-drawer Analyze view for the PR.

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to open a PR (or merge), summarizing the drawer + Analyze redesign.

---

## Self-Review Notes

- **Spec coverage:** flexible drawer (Task 2) ✓; persistence (Tasks 1–2) ✓; keyboard +
  pointer a11y handle (Task 2) ✓; mobile presets / no drag width via inline style (Task 2
  CSS) ✓; configure→run→read + footer/spacer removal (Task 3) ✓; responsive table/cards +
  charts reflow (Task 4) ✓; loading skeleton + empty states preserved (Task 4) ✓; inline
  error (Task 3) ✓; ripple to Compare (Task 5) ✓; non-goals untouched (no palette/map/API
  changes) ✓.
- **Determinism:** every responsive decision keys off the `panelWidthPx` prop /
  `DrawerState`, never measured DOM size, so jsdom tests are stable. `panelWidthPx`
  defaults to `Infinity` → table, keeping the pre-existing `getByRole("table")` test green.
- **Preserved strings/roles:** findings copy, chart labels/`aria-label`, control names
  ("Start date", "500 m", "Person", "Run analysis"), incident table headers, the
  "No matching reported incidents…" and "Run analysis to summarize…" empty texts, and the
  Compare "Compare places" button + caveat — all unchanged.
- **Type consistency:** `DrawerState { collapsed, widthPx }`, `DrawerPreset`,
  `clampWidth`, `drawerMax`, `loadDrawerState`/`saveDrawerState` names are used
  identically across Tasks 1–4. `INCIDENT_TABLE_MIN`/`CHARTS_TWO_UP_MIN` constants live in
  `AnalyzeTab.tsx`; `DRAWER_*` constants live in `lib/drawer.ts`.
- **Style test safety:** `mapWorkspaceStyle.test.ts` only asserts color/font rules on
  `.mc-incident-table*` and `.mc-findings*`; Task 4 changes only `min-width`, so it stays
  green.
