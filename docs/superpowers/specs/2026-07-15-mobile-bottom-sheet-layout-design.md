# Mobile bottom-sheet layout (responsive) — design

**Date:** 2026-07-15
**Status:** Approved (brainstorm), pending implementation plan

## Problem

CompCat's workspace is built desktop-first and never adapted for a phone. On a
narrow viewport (and the iOS Capacitor shell in particular) this produces three
symptoms that all trace to one root cause:

1. **Side panel eats the screen.** The workspace panel (the `BottomSheet`
   component, despite its name) is a right-docked, width-driven side panel:
   `.mc-workspace-panel{position:absolute;top:0;right:0;bottom:0;width:var(--panel-width)}`
   (`frontend/src/styles/mapWorkspace.css:139`). `--panel-width` is
   `clamp(360px,34vw,420px)` (`:13`), and the existing mobile block clamps it to
   `min(320px,calc(100vw - 72px))` (`:406`). On a ~390px iPhone that leaves ~70px
   of map.

2. **Layer buttons can't be tapped.** `LayerToggle` (reported / arrests / 911
   calls) renders in the top bar (`frontend/src/components/MapWorkspace.tsx:429`).
   The top bar is `.mc-topbar{position:absolute;top:0;left:0;right:var(--panel-width);height:60px}`
   (`mapWorkspace.css:49`) — anchored at `top:0` with **no safe-area inset**, so on
   a notched device it sits under the status bar / Dynamic Island, and its right
   edge is truncated by the side panel. Between the notch overlap and the squeeze,
   the toggle is unreachable.

3. **Doesn't fit the device.** `.mc-frame{width:100vw;height:100vh}`
   (`mapWorkspace.css:300`), the viewport meta is
   `width=device-width, initial-scale=1.0` with no `viewport-fit=cover`
   (`frontend/index.html:5`), and there is no `env(safe-area-inset-*)` usage
   anywhere in the codebase. `100vh` on iOS WKWebView overflows the visible
   viewport, so bottom content (Run controls, assistant dock) falls under the home
   indicator.

## Goals

- Below a width breakpoint, the workspace panel becomes a **bottom sheet** with a
  two-state **Peek ↔ Full** expander.
- The layer toggle is always visible and tappable on mobile.
- The app fits the device: correct viewport height and safe-area insets on iOS.
- **Desktop layout is unchanged.** The CompCat reported-context product invariant
  is unchanged.

## Non-goals

- Any change to the desktop (≥ breakpoint) layout.
- Native-only gating (Capacitor platform detection). The split is by viewport
  width, so it also benefits mobile web and stays testable in a normal browser.
- A three-position sheet (peek/half/full). Two states only.
- Changes to analysis, data, API, or assistant logic.

## Decisions (from brainstorm)

- **Responsive by width**, reusing the existing `@media (max-width:760px)` block
  (`mapWorkspace.css:405`). No new breakpoint value.
- **Two-state sheet:** Peek (collapsed) ↔ Full (expanded).
- **Relocate the layer toggle** into the sheet's peek header on mobile (chosen over
  a floating segmented control), so it can't collide with the map or the notch.

## Design

### 1. Responsive split

All new mobile behavior lives inside the existing `@media (max-width:760px)` block.
At/above 760px the layout is byte-for-byte what it is today (the desktop
side panel, width presets, vertical resize handle). Below 760px the same
`BottomSheet` component and `useDrawer` state render as a bottom sheet via CSS
plus a small amount of mobile-aware drag logic.

### 2. Bottom sheet (mobile behavior of the `BottomSheet` component)

- **Dock:** `left:0; right:0; bottom:0; width:100%`, height-driven instead of
  width-driven. Rounded top corners; the map fills the area above it.
- **Peek (collapsed):** a short bar showing, top to bottom, a **grabber handle**,
  the **layer toggle + data-freshness row**, and the **tab row**
  (Analyze / Compare / Export). Enough to switch layer and tab without expanding.
- **Full (expanded):** grows upward to `100dvh` minus the top safe-area inset,
  revealing the active tab's panel and the assistant dock.
- **Expander control:** the grabber toggles Peek ↔ Full on tap; a vertical drag
  past a threshold (or a flick) snaps to the nearer state on release. This
  replaces the desktop vertical (ew-resize) handle on mobile. The drag math moves
  from horizontal (`right - clientX`, `BottomSheet.tsx:113`) to a vertical model
  driving sheet height/translate.
- **State reuse:** the sheet's Peek ↔ Full maps onto `useDrawer`'s existing
  `collapsed` boolean (collapsed = Peek). No new global state. The persisted key
  `compcat.drawer.collapsed` (`frontend/src/lib/drawerStorage.ts`) already exists,
  so the last state is remembered. Desktop-only width presets (peek/default/
  wide/focus) and the persisted width are ignored while in sheet mode.

### 3. Top bar + layer toggle (mobile)

- Move `LayerToggle` and `DataFreshness` out of `.mc-topbar-right` and into the
  bottom sheet's peek header (see §2). They read/write the same
  `analysis.layer` state via the existing `onChange` path — no behavior change,
  only placement. CSS can't reparent DOM, so MapWorkspace renders each control in
  a **single** location chosen by a width-derived flag (`isMobile`, viewport
  ≤ 760px), computed on the same resize-driven re-render the workspace already
  uses for `isFocus` (`MapWorkspace.tsx:370`): top bar at desktop width, sheet
  peek header below 760px. No component is rendered twice.
- Slim the mobile top bar to brand + theme toggle (+ the status dot), dropped
  below the notch by the top safe-area inset (§4). This keeps the map's top-left
  chrome (search pill, add-pin helper) usable.

### 4. Safe areas + viewport fit

- `frontend/index.html:5` — add `viewport-fit=cover` to the viewport meta so
  `env(safe-area-inset-*)` resolves to non-zero on iOS.
- `.mc-frame` — `height:100vh → 100dvh`, `width:100vw → 100%`.
- Apply insets (all `0` on desktop, so desktop is untouched):
  - `env(safe-area-inset-top)` → `.mc-topbar` padding.
  - `env(safe-area-inset-bottom)` → bottom sheet peek height and the assistant
    dock (`.mc-dock-slot`), so controls clear the home indicator.
  - `env(safe-area-inset-left/right)` → the floating search pill / legend where
    they hug the screen edge.

### 5. Files touched

- `frontend/index.html` — viewport meta.
- `frontend/src/styles/mapWorkspace.css` — mobile bottom-sheet layout, safe-area
  insets, `dvh`, moving the toggle row; all mobile rules scoped to the existing
  `@media (max-width:760px)` block.
- `frontend/src/components/BottomSheet.tsx` — vertical drag/snap model and peek
  header (layer toggle + freshness) on mobile; desktop path unchanged.
- `frontend/src/components/MapWorkspace.tsx` — derive `isMobile` (≤760px) and
  place `LayerToggle` / `DataFreshness` in the sheet's peek header on mobile vs.
  the top bar on desktop (single instance, per §3); slim the mobile top bar.
- Tests: `BottomSheet.test.tsx`, `MapWorkspace.test.tsx`, plus a narrow-viewport
  layout test.

### 6. State / data flow

No new state or props of consequence. The sheet is a presentation change over the
existing `useDrawer` (`collapsed`, width) and `analysis.layer` state. `collapsed`
gains a second meaning (Peek) only in the CSS/interaction layer; its value,
setter, and persistence are unchanged. `isMobile` (§3) is a derived value computed
from `window.innerWidth` on render — like the existing `isFocus` — not new state.

### 7. Testing

- **Unit (vitest/RTL):** Peek ↔ Full toggle via the grabber; `LayerToggle`
  renders inside the sheet and still drives `analysis.layer`; existing
  `MapWorkspace` tests updated for the moved elements.
- **Narrow-viewport:** render at ~390px and assert the sheet is bottom-docked and
  the toggle is present/interactive (jsdom has no real layout, so this asserts
  structure/class state, not pixels).
- **Device:** the safe-area / notch / home-indicator fixes can only be truly
  verified on a real iOS device; called out as a manual acceptance step.

### 8. Risks / open questions

- **Drag ergonomics** (threshold, flick velocity, rubber-banding) are a feel
  detail to tune during implementation; the two-state model keeps this bounded.
- **jsdom can't prove the pixel fixes** (`dvh`, `env()`), so the safe-area work
  leans on device verification. Acceptable and explicitly flagged.
- **`100dvh` support:** fine on the modern iOS WKWebView CompCat targets
  (deployment target iOS 14 in the Xcode project; `dvh` is supported on iOS 15.4+
  — if iOS 14 must be supported, fall back to a `-webkit-fill-available` height on
  `.mc-frame`). Confirm the real minimum iOS during planning.
