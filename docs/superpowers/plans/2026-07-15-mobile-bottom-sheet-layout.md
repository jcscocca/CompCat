# Mobile Bottom-Sheet Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below the existing 760px breakpoint, turn CompCat's right-docked side panel into a two-state (Peek/Full) bottom sheet, relocate the layer toggle into the sheet so it's tappable, and add `viewport-fit=cover` + safe-area insets + `100dvh` so the app fits an iOS device. Desktop layout and the reported-context product invariant are unchanged.

**Architecture:** The split is by viewport width. CSS in the existing `@media (max-width:760px)` block re-lays the `.mc-workspace-panel` as a bottom sheet; the `BottomSheet` component gains an `isMobile` prop that swaps its vertical resize handle for a tap/drag **grabber** and renders a `peekHeader` slot; `MapWorkspace` computes `isMobile` from `window.innerWidth` (the same way it already computes `isFocus`) and places the `LayerToggle` + `DataFreshness` controls in the sheet's peek header on mobile vs. the top bar on desktop. State reuses `useDrawer`'s existing `collapsed` flag (collapsed = Peek); no new global state.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library (jsdom), plain CSS. Reference spec: `docs/superpowers/specs/2026-07-15-mobile-bottom-sheet-layout-design.md`.

**Working directory / verification:** run all commands from `frontend/`. `npm test` = `vitest run --environment jsdom`; `npm run build` = `tsc -b && vite build`. Branch: `mobile-bottom-sheet-layout`.

**A note on testing layout:** jsdom has no layout engine, so the pixel-level effects (`dvh`, `env(safe-area-inset-*)`, bottom-docking) cannot be unit-tested. Those are verified by `npm run build` (valid CSS/TS) plus a narrow-viewport browser check and a real-device acceptance pass (Task 5). Unit tests cover the *structure and behavior*: the viewport meta, the grabber toggle, and where the layer controls mount.

---

### Task 1: Foundation — `viewport-fit=cover` + dynamic viewport height

**Files:**
- Modify: `frontend/index.html:5`
- Modify: `frontend/src/styles.css:26` and `:40`
- Modify: `frontend/src/styles/mapWorkspace.css:300`
- Test: `frontend/tests/indexHtml.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` block to the existing `describe("index.html privacy guard", …)` in `frontend/tests/indexHtml.test.ts` (it reuses the module-level `html` const already declared at the top of the file):

```ts
  it("opts into the safe-area viewport (viewport-fit=cover) for iOS insets", () => {
    const viewport = /<meta[^>]*name=["']viewport["'][^>]*>/i.exec(html)?.[0] ?? "";
    expect(viewport).toMatch(/viewport-fit=cover/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- indexHtml`
Expected: FAIL — the `viewport` string does not match `/viewport-fit=cover/`.

- [ ] **Step 3: Add `viewport-fit=cover` to the viewport meta**

In `frontend/index.html:5`, replace:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

with:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- indexHtml`
Expected: PASS (3 tests in the file).

- [ ] **Step 5: Switch the app viewport containers to `dvh`**

`dvh` (dynamic viewport height) tracks the *visible* viewport on iOS, where `100vh` overflows. Keep the `100vh` line first as a fallback for engines without `dvh` (they use the last value they understand).

In `frontend/src/styles.css`, change both occurrences:

```css
body {
  min-width: 320px;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
}
```

```css
#root {
  min-height: 100vh;
  min-height: 100dvh;
}
```

In `frontend/src/styles/mapWorkspace.css:300`, change the `.mc-frame` rule from:

```css
.mc-frame{position:relative;width:100vw;height:100vh;overflow:hidden;background:var(--surface-sunken);border-radius:0;box-shadow:none;}
```

to:

```css
.mc-frame{position:relative;width:100%;height:100vh;height:100dvh;overflow:hidden;background:var(--surface-sunken);border-radius:0;box-shadow:none;}
```

- [ ] **Step 6: Verify the build is clean**

Run: `npm run build`
Expected: `tsc -b` passes and `vite build` completes with no CSS errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/src/styles.css frontend/src/styles/mapWorkspace.css frontend/tests/indexHtml.test.ts
git commit -m "feat(ios): viewport-fit=cover + dvh viewport height"
```

---

### Task 2: `BottomSheet` — mobile grabber + peek-header slot

Adds an `isMobile` prop that, when true, renders a **grabber** (tap or vertical drag toggles Peek↔Full) and a `peekHeader` slot in place of the desktop vertical resize handle and size-preset snaps. Desktop behavior is untouched.

**Files:**
- Modify: `frontend/src/components/BottomSheet.tsx`
- Test: `frontend/src/components/BottomSheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/BottomSheet.test.tsx`. If the file has no shared render helper, add this one near the top of its `describe` block, then the four `it`s:

```tsx
  function renderSheet(overrides: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
    const props = {
      activeTab: "analyze" as const,
      onTabChange: vi.fn(),
      collapsed: false,
      widthPx: 400,
      onToggleCollapsed: vi.fn(),
      onResize: vi.fn(),
      onPreset: vi.fn(),
      children: <div>panel body</div>,
      ...overrides,
    };
    return { props, ...render(<BottomSheet {...props} />) };
  }

  it("mobile: renders a grabber and the peek header instead of the resize handle", () => {
    renderSheet({ isMobile: true, peekHeader: <div>LAYER SLOT</div> });
    expect(screen.getByRole("button", { name: /collapse panel/i })).toBeInTheDocument();
    expect(screen.getByText("LAYER SLOT")).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /resize workspace panel/i })).not.toBeInTheDocument();
  });

  it("desktop: keeps the vertical resize handle and no grabber", () => {
    renderSheet({ isMobile: false });
    expect(screen.getByRole("separator", { name: /resize workspace panel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /(collapse|expand) panel/i })).not.toBeInTheDocument();
  });

  it("mobile: a tap on the grabber toggles collapsed", () => {
    const { props } = renderSheet({ isMobile: true, collapsed: false });
    const grabber = screen.getByRole("button", { name: /collapse panel/i });
    fireEvent.pointerDown(grabber, { clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(grabber, { clientY: 122, pointerId: 1 });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("mobile: a downward drag collapses when open; an upward drag while open does nothing", () => {
    const { props } = renderSheet({ isMobile: true, collapsed: false });
    const grabber = screen.getByRole("button", { name: /collapse panel/i });
    // drag down 80px → collapse
    fireEvent.pointerDown(grabber, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(grabber, { clientY: 180, pointerId: 1 });
    // drag up 80px while still open → ignored
    fireEvent.pointerDown(grabber, { clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(grabber, { clientY: 100, pointerId: 1 });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
```

Ensure the file imports what these use (add any missing): `import { fireEvent, render, screen } from "@testing-library/react";` and `import { vi } from "vitest";` (or the file's existing test imports), plus `import { BottomSheet } from "./BottomSheet";`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- BottomSheet`
Expected: FAIL — `isMobile`/`peekHeader` props don't exist yet, so no grabber renders.

- [ ] **Step 3: Add the props, constants, and grabber handlers**

In `frontend/src/components/BottomSheet.tsx`:

(a) Extend the `Props` type (after the existing `dock?: ReactNode;` line):

```tsx
  dock?: ReactNode;
  isMobile?: boolean;
  peekHeader?: ReactNode;
  children: ReactNode;
```

(b) Add module-level constants just below the imports:

```tsx
const GRABBER_TAP_SLOP = 6;
const GRABBER_DRAG_THRESHOLD = 40;
```

(c) Add `isMobile = false` and `peekHeader` to the destructured parameters:

```tsx
export function BottomSheet({
  activeTab,
  onTabChange,
  collapsed,
  widthPx,
  onToggleCollapsed,
  onResize,
  onPreset,
  tabBadges,
  dock,
  isMobile = false,
  peekHeader,
  children,
}: Props) {
```

(d) Add a ref + two handlers next to the existing `dragging`/`moved` refs (below `const moved = useRef(false);`):

```tsx
  const grabStartY = useRef<number | null>(null);

  function onGrabberPointerDown(event: PointerEvent<HTMLDivElement>) {
    grabStartY.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onGrabberPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = grabStartY.current;
    grabStartY.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (start === null) return;
    const dy = event.clientY - start;
    if (Math.abs(dy) <= GRABBER_TAP_SLOP) {
      onToggleCollapsed();
    } else if (collapsed && dy <= -GRABBER_DRAG_THRESHOLD) {
      onToggleCollapsed(); // drag up to expand
    } else if (!collapsed && dy >= GRABBER_DRAG_THRESHOLD) {
      onToggleCollapsed(); // drag down to collapse
    }
  }
```

- [ ] **Step 4: Swap the handle/snaps for the grabber on mobile**

In the returned JSX, change the `<section>`'s opening tag so the width style is desktop-only:

```tsx
    <section
      ref={panelRef}
      className={`mc-workspace-panel ${collapsed ? "is-collapsed" : "is-open"}`}
      style={!isMobile && !collapsed ? { width: widthPx } : undefined}
      aria-label="Workspace panel"
    >
```

Then replace the existing `<div className="mc-handle" …/>` element and the `<div className="mc-snaps" …>…</div>` block with this conditional (the `.mc-tabs`, `.mc-panels`, and `.mc-dock-slot` below them stay exactly as they are):

```tsx
      {isMobile ? (
        <>
          <div
            className="mc-grabber"
            role="button"
            tabIndex={0}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            aria-expanded={!collapsed}
            onPointerDown={onGrabberPointerDown}
            onPointerUp={onGrabberPointerUp}
            onPointerCancel={() => { grabStartY.current = null; }}
            onKeyDown={(event) => activateWithKeyboard(event, onToggleCollapsed)}
          >
            <b />
          </div>
          {peekHeader ? <div className="mc-sheet-head">{peekHeader}</div> : null}
        </>
      ) : (
        <>
          <div
            className="mc-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workspace panel"
            aria-valuemin={DRAWER_PEEK}
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
        </>
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- BottomSheet`
Expected: PASS (all BottomSheet tests, including the four new ones).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/BottomSheet.tsx frontend/src/components/BottomSheet.test.tsx
git commit -m "feat(sheet): mobile grabber + peek-header slot on BottomSheet"
```

---

### Task 3: `MapWorkspace` — mount layer controls in the sheet on mobile

Compute `isMobile` and route `LayerToggle` + `DataFreshness` to the sheet's peek header (mobile) or the top bar (desktop). The controls are defined once and rendered in exactly one location per render.

**Files:**
- Modify: `frontend/src/lib/drawer.ts`
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Test: `frontend/src/components/MapWorkspace.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/MapWorkspace.test.tsx` inside the `describe("MapWorkspace", …)` block:

```tsx
  it("narrow viewport: the layer toggle mounts in the sheet, not the top bar", async () => {
    window.innerWidth = 375;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const group = screen.getByRole("group", { name: "Data layer" });
    expect(group.closest(".mc-workspace-panel")).not.toBeNull();
    expect(group.closest(".mc-topbar")).toBeNull();
  });

  it("wide viewport: the layer toggle mounts in the top bar", async () => {
    window.innerWidth = 1200;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const group = screen.getByRole("group", { name: "Data layer" });
    expect(group.closest(".mc-topbar")).not.toBeNull();
    expect(group.closest(".mc-workspace-panel")).toBeNull();
  });
```

Restore the viewport width after each test so width changes don't leak. In the file's existing `afterEach(() => { … })`, add:

```tsx
    window.innerWidth = 1024;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- MapWorkspace`
Expected: FAIL — the narrow-viewport test finds the "Data layer" group inside `.mc-topbar` (there is no `isMobile` split yet).

- [ ] **Step 3: Add the breakpoint constant**

In `frontend/src/lib/drawer.ts`, add below the existing constants (after `FOCUS_CHROME_MIN`):

```ts
// Viewports at/below this width render the workspace panel as a bottom sheet.
// Must match the `@media (max-width:760px)` breakpoint in styles/mapWorkspace.css.
export const MOBILE_MAX_WIDTH = 760;
```

- [ ] **Step 4: Compute `isMobile` and route the controls**

In `frontend/src/components/MapWorkspace.tsx`:

(a) Add `MOBILE_MAX_WIDTH` to the existing import from `../lib/drawer`:

```tsx
import { DRAWER_PEEK, FOCUS_CHROME_MIN, MOBILE_MAX_WIDTH } from "../lib/drawer";
```

(b) Just below the existing `isFocus` line (`const isFocus = !drawer.collapsed && window.innerWidth - drawer.widthPx < FOCUS_CHROME_MIN;`), add:

```tsx
  // Same window-width read as isFocus (re-evaluated on useDrawer's resize re-render):
  // below the breakpoint the panel is a bottom sheet and the layer controls live inside it.
  const isMobile = window.innerWidth <= MOBILE_MAX_WIDTH;
  const layerControls = (
    <>
      <LayerToggle layer={analysis.layer} onChange={(layer) => handleAnalysisChange({ layer })} />
      <DataFreshness freshness={data.freshness} layer={analysis.layer} />
    </>
  );
```

(c) In the `<header className="mc-topbar">` block, replace the current `mc-topbar-right` contents:

```tsx
          <div className="mc-topbar-right">
            <LayerToggle layer={analysis.layer} onChange={(layer) => handleAnalysisChange({ layer })} />
            <DataFreshness freshness={data.freshness} layer={analysis.layer} />
            <div className="mc-status"><span className="dot" />Public session - Seattle</div>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
```

with (layer controls + status are desktop-only; brand + theme stay on mobile):

```tsx
          <div className="mc-topbar-right">
            {!isMobile ? layerControls : null}
            {!isMobile ? <div className="mc-status"><span className="dot" />Public session - Seattle</div> : null}
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
```

(d) Pass the sheet props on the `<BottomSheet …>` element (add these two props alongside the existing ones, e.g. after `onPreset={onPreset}`):

```tsx
          isMobile={isMobile}
          peekHeader={isMobile ? layerControls : undefined}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- MapWorkspace`
Expected: PASS (both new tests and the existing MapWorkspace suite).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/drawer.ts frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(sheet): route layer controls into the sheet on mobile"
```

---

### Task 4: CSS — bottom-sheet layout + safe-area insets

Rewrite the `@media (max-width:760px)` block so the panel docks to the bottom as a flex column (grabber → peek header → tabs → panels → dock), the top bar spans full width below the notch, and the sheet/dock/floating chrome clear the safe-area insets. This is the change that makes the DOM from Tasks 2–3 *look* like a bottom sheet.

**Files:**
- Modify: `frontend/src/styles/mapWorkspace.css` (the `@media (max-width:760px){…}` block at lines ~405–435; add a `sheetin` keyframe)

- [ ] **Step 1: Replace the mobile media-query block**

Replace the entire existing `@media (max-width:760px){ … }` block (currently lines 405–435, the one that styles `.mc-workspace-panel` as a right side panel) with:

```css
@media (max-width:760px){
  .mc-topbar{right:0;height:auto;min-height:56px;padding:calc(env(safe-area-inset-top) + 8px) 20px 8px;gap:12px;}
  .mc-wordmark{font-size:20px;white-space:nowrap;}
  .mc-searchpill{top:calc(env(safe-area-inset-top) + 64px);left:calc(env(safe-area-inset-left) + 16px);width:auto;max-width:calc(100vw - 32px);}
  .mc-empty{top:34%;width:min(260px,calc(100% - 96px));padding:16px 18px;}

  /* Workspace panel becomes a bottom sheet: full width, height-driven, flex column. */
  .mc-workspace-panel{
    top:auto;left:0;right:0;bottom:0;
    width:100%;height:min(80dvh,620px);
    display:flex;flex-direction:column;
    border-left:0;border-top:1px solid var(--border);
    border-radius:16px 16px 0 0;
    background:var(--surface);
    box-shadow:0 -18px 40px -26px rgba(16,24,32,.4);
    padding-bottom:env(safe-area-inset-bottom);
    animation:sheetin .4s cubic-bezier(.2,.8,.2,1) both;
  }
  .mc-workspace-panel.is-collapsed{width:100%;height:auto;} /* Peek: grabber + head + tabs only */

  .mc-grabber{display:flex;align-items:center;justify-content:center;height:26px;flex:none;cursor:grab;touch-action:none;}
  .mc-grabber b{display:block;width:38px;height:5px;border-radius:3px;background:var(--border-strong);}

  .mc-sheet-head{display:flex;align-items:center;gap:10px;flex:none;padding:0 16px 8px;overflow-x:auto;scrollbar-width:none;}
  .mc-sheet-head::-webkit-scrollbar{display:none;}
  .mc-sheet-head .mc-freshness{white-space:nowrap;}

  .mc-tabs{grid-template-columns:repeat(3,minmax(0,1fr));flex:none;gap:4px;padding:0 14px 8px;border-bottom:1px solid var(--border);}
  .mc-tab{padding:9px 8px;font-size:13px;min-width:0;justify-content:center;}
  .mc-tab svg{width:15px;height:15px;}
  .mc-tab .pill{padding:1px 6px;}

  .mc-panels{flex:1;min-height:0;overflow:auto;}
  .mc-dock-slot{padding-bottom:env(safe-area-inset-bottom);}
  .mc-workspace-panel.is-collapsed .mc-panels,
  .mc-workspace-panel.is-collapsed .mc-dock-slot{display:none;}
  .mc-workspace-panel.is-collapsed .mc-tabs{border-bottom:0;}

  .mc-panel{padding:14px 18px;}
  .mc-panel-head{align-items:flex-start;gap:10px;}
  .mc-head-actions{justify-content:flex-start;}
  .mc-search{height:auto;min-height:44px;}
  .mc-search-go{height:34px;}
}
```

- [ ] **Step 2: Add the `sheetin` keyframe**

Immediately after the closing `}` of that media-query block, add:

```css
@keyframes sheetin{from{transform:translateY(100%);}to{transform:translateY(0);}}
```

(The existing `@media (prefers-reduced-motion: reduce)` rule already lists `.mc-workspace-panel` with `animation:none !important`, so this slide-up is disabled for reduced-motion users automatically.)

- [ ] **Step 3: Verify the build is clean**

Run: `npm run build`
Expected: `tsc -b` passes and `vite build` completes with no CSS parse errors.

- [ ] **Step 4: Manual narrow-viewport check**

Run the dev server and open the app in a browser at a narrow width (DevTools device toolbar, ~390px, or a 390px window):

Run: `npm run dev`
Verify:
- The workspace panel is docked to the **bottom**, full width, with a grabber pill on top.
- The reported / arrests / 911 toggle is visible in the sheet's peek header and switches layers.
- Tapping the grabber toggles Peek ↔ Full; dragging it down collapses, up expands.
- At ≥ 760px the layout is the unchanged desktop side panel.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/mapWorkspace.css
git commit -m "feat(sheet): bottom-sheet CSS + safe-area insets on mobile"
```

---

### Task 5: Full verification + device acceptance

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend gate**

Run: `npm test`
Expected: all suites PASS (includes the updated `indexHtml`, `BottomSheet`, and `MapWorkspace` tests).

Run: `npm run build`
Expected: clean `tsc -b` + `vite build`.

- [ ] **Step 2: Run lint (repo verification gate)**

From the repo root: `ruff check .` is backend-only and unaffected; the frontend has no separate lint step beyond `tsc`. Confirm `make test-all` still passes if you want the whole gate (it runs pytest + ruff + `npm test` + `npm run build`).

- [ ] **Step 3: Device acceptance (manual — the only true proof of the iOS fixes)**

Sync and run the iOS app on a physical notched device (`npm run ios:sync`, then run from Xcode). Confirm:
- The top bar (brand + theme) sits **below** the status bar / Dynamic Island — nothing is under the notch.
- The bottom sheet and its content clear the home indicator (safe-area-inset-bottom).
- The layer toggle is fully tappable.
- The map fills the screen with no clipped/overflowing edges.

- [ ] **Step 4: Final commit (only if Step 1–2 required a fix)**

```bash
git add -A
git commit -m "test(sheet): fixes from full verification pass"
```

---

## Self-Review

**Spec coverage:**
- Responsive split at 760px → Task 3 (`MOBILE_MAX_WIDTH`, `isMobile`) + Task 4 (media query).
- Two-state Peek↔Full sheet reusing `useDrawer.collapsed` → Task 2 (grabber toggles `onToggleCollapsed`) + Task 4 (`.is-collapsed` peek height).
- Layer toggle relocated into the sheet, single instance via `isMobile` → Task 3.
- Top bar slimmed + dropped below the notch → Task 3 (JS gating) + Task 4 (`env(safe-area-inset-top)`).
- `viewport-fit=cover` + `100dvh` + safe-area insets → Task 1 + Task 4.
- Desktop unchanged → Tasks 2–4 gate every change on `isMobile` / the `max-width:760px` media query.
- Product invariant untouched → no analysis/data/API changes in any task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. The two manual steps (Task 4 Step 4, Task 5 Step 3) are explicit device/browser checks, not code placeholders — required because jsdom can't verify layout.

**Type/name consistency:** `isMobile` and `peekHeader` props are defined in Task 2 and consumed in Task 3; `MOBILE_MAX_WIDTH` is defined in Task 3 Step 3 and imported in Step 4; the grabber's accessible name (`"Collapse panel"` when open / `"Expand panel"` when collapsed) matches every test query; `layerControls` is defined once and referenced in both the top-bar and `peekHeader` slots; CSS classes `.mc-grabber` / `.mc-sheet-head` created in Task 2's JSX are the ones styled in Task 4.
