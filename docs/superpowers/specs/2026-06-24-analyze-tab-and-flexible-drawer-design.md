# Analyze Tab Redesign + Flexible Workspace Drawer — Design

Date: 2026-06-24
Status: Approved (design), pending spec review
Area: `frontend/` (Waypoint dashboard)

## Problem

The map-first dashboard's right-docked workspace panel and its Analyze tab feel low
quality:

1. **The drawer ("menu") is not flexible.** `BottomSheet` only supports two fixed
   widths — an 84px icon rail (`is-peek`) and a fixed `clamp(360px,34vw,420px)`
   (`is-half`). The edge handle only toggles between those two; it cannot drag. There
   is no way to widen the panel, which is the root cause of point 2.
2. **The Analyze tab does not fit the panel.** Its incident table is hard-set to
   `min-width:680px` inside a ~400px panel, so it is *permanently* horizontally
   scrolling with 7 columns crammed in. The charts are forced 2-up in ~400px. The
   information order is inverted: results (findings, charts, table) render *first*,
   and the controls (date, radius, category) plus the **Run analysis** button sit at
   the very bottom in an absolutely-positioned footer that requires a magic
   `<div style={{ height: 60 }} />` spacer to avoid overlapping content.
3. **It feels unfinished.** Weak empty states, no loading feedback during analysis,
   and errors surface as a floating toast over the map rather than near the action.

## Goals

- Make the workspace drawer a true **flexible drawer**: drag-to-resize between a floor
  and ceiling, plus Peek / Default / Wide quick presets, with the last size persisted.
- Rebuild the Analyze tab so it **fits gracefully at any drawer width**: a
  configure → run → read order, a responsive incident list that never forces a
  horizontal scroll, and charts that reflow.
- Replace the footer + spacer hack with a sticky action area.
- Add real empty / loading / error states.
- Ripple the footer-hack removal to the Compare tab without restyling it.

## Non-goals

- No change to the color palette, typography, map, or overall aesthetic — these work.
- No backend / API changes. This is purely `frontend/`.
- No change to the analysis math, the findings copy, or the chart computations.
- Personal-upload / internal-demo flows are untouched.

## Design

### 1. Flexible drawer

**State model (owned by `MapWorkspace`):**

Replace the two-value `SheetState = "peek" | "half"` with an explicit model:

```ts
// types.ts
export type DrawerState = {
  collapsed: boolean;   // true = peek (icon rail)
  widthPx: number;      // expanded width, clamped to [DRAWER_MIN, drawerMax()]
};
```

Constants (new `frontend/src/lib/drawer.ts`):

- `DRAWER_MIN = 340`
- `DRAWER_DEFAULT = 400`
- `DRAWER_WIDE = 640`
- `DRAWER_PEEK = 84` (rail width; presentational only, not stored in `widthPx`)
- `drawerMax()` = `min(720, round(window.innerWidth * 0.72))`, floored at `DRAWER_MIN`
- `clampWidth(px)` = `min(drawerMax(), max(DRAWER_MIN, round(px)))`

**Persistence:** `widthPx` and `collapsed` persist to `localStorage`
(`waypoint.drawer.width`, `waypoint.drawer.collapsed`). On mount, hydrate from storage
through `clampWidth` (guards against a stored width wider than the current viewport).
A tiny module (`lib/drawerStorage.ts`) wraps `localStorage` with try/catch so private
mode / disabled storage degrades to in-memory defaults.

**`BottomSheet` prop changes:**

```ts
// before: sheetState, onSheetStateChange
// after:
collapsed: boolean;
widthPx: number;
onToggleCollapsed: () => void;          // handle click / Enter / Space
onResize: (px: number) => void;         // drag + arrow keys (expanded only)
onPreset: (preset: "peek" | "default" | "wide") => void;  // preset buttons
```

`MapWorkspace` maps presets to state: `peek` → `{collapsed:true}`; `default` →
`{collapsed:false, widthPx:DRAWER_DEFAULT}`; `wide` → `{collapsed:false,
widthPx:DRAWER_WIDE}`.

**Rendering:** the panel root is `.mc-workspace-panel` with
`class={collapsed ? "is-collapsed" : "is-open"}` and an inline
`style={{ width: collapsed ? undefined : widthPx }}` (collapsed width comes from CSS).
Drop the fixed `is-peek` / `is-half` width rules; keep `.is-collapsed` for the
icon-rail styling (reuse the existing `is-peek` rules, renamed).

**The drag handle** (`.mc-handle`) becomes an accessible resizer:

- `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize workspace
  panel"`, `aria-valuemin={DRAWER_MIN}`, `aria-valuemax={drawerMax()}`,
  `aria-valuenow={widthPx}`, `tabIndex={0}`.
- Pointer: `pointerdown` → `setPointerCapture` + dragging flag; `pointermove` →
  `onResize(clampWidth(frameRight - clientX))`; `pointerup` → clear flag. The panel is
  right-docked, so width = distance from the frame's right edge to the cursor.
- Keyboard: `ArrowLeft` grows / `ArrowRight` shrinks by a 24px step; `Home` →
  `DRAWER_MIN`, `End` → `drawerMax()`; `Enter` / `Space` → `onToggleCollapsed()`.
- When `collapsed`, the handle still toggles back open (Enter/Space/click); drag is a
  no-op while collapsed.

**Presets UI:** the existing `.mc-snaps` group becomes three buttons — `Peek`,
`Default`, `Wide` — each `aria-pressed` reflecting the active state (`Peek` pressed when
collapsed; `Default`/`Wide` pressed when `widthPx` equals that preset and not
collapsed). Buttons call `onPreset`.

**Map attribution / overlays:** `MapWorkspace` sets `--panel-width` as an inline CSS
var on `.mc-frame` equal to the live expanded width (or the rail width when collapsed),
so the existing Leaflet-attribution offset rules that read `--panel-width` keep the
control clear of the panel. The `:has(.is-peek)` / `:has(.is-half)` attribution rules
are replaced by reading the live `--panel-width`.

**Mobile (`max-width:760px`):** drag is disabled (the handle only toggles
collapse); the panel stays an overlay using the preset widths. Presets remain usable.

**Reduced motion:** unchanged — existing `prefers-reduced-motion` block already
disables panel animation.

### 2. Analyze tab restructure

New top-to-bottom order inside the scrollable `.mc-panel`:

1. **Sticky query bar** (`.mc-querybar`, `position: sticky; top: 0`): holds the Date
   range inputs, Radius chips, Category chips, a compact status note (`{n} places ·
   {radius} m`), and the **Run analysis** button — all together at the top where the
   user starts. This removes `.mc-footer` and the `<div style={{ height: 60 }} />`
   spacer from the Analyze tab entirely.
2. **Findings summary** (`.mc-findings`) — unchanged copy/logic.
3. **Charts** (`.mc-analysis-charts`) — reflow 1-up below the charts breakpoint, 2-up
   at/above it.
4. **Incident list** — responsive table/cards (see below).
5. **Caveat** line.

**Control labels and roles are preserved verbatim** so the existing AnalyzeTab control
tests pass unchanged: date inputs keep `aria-label` "Start date" / "End date"; radius
chips keep names like "500 m"; category chips keep "Person" etc.; the run button keeps
the accessible name "Run analysis" and stays disabled when `selected.length < 1`.

**Responsive incident list (the core fit fix):**

The layout switch is **prop-driven, not CSS-only**, so it is deterministic under jsdom
(which performs no layout). `MapWorkspace` already knows the live panel width, so it
passes it down:

```ts
// AnalyzeTab gains:
panelWidthPx?: number;   // live expanded drawer width; undefined in isolation tests
```

Derive `incidentLayout = (panelWidthPx ?? Infinity) >= INCIDENT_TABLE_MIN ? "table"
: "cards"` with `INCIDENT_TABLE_MIN = 560`. Because the prop defaults to `undefined`
→ `Infinity` → `"table"`, the existing `getByRole("table")` test passes with no change.

- `"table"`: render the current `.mc-incident-table` (kept intact — preserves the
  `mapWorkspaceStyle.test.ts` selector assertions). Its `min-width` is reduced so it
  fills the wider panel without overflow; horizontal scroll remains only as a safety
  net at the narrow end of the table range.
- `"cards"`: render `.mc-incident-cards` — one card per incident with place label +
  distance, category/subcategory tags, date/time, and block/address + ID. No
  horizontal scroll.

Both share one heading (`Reported incidents near selected places`), the count text,
and the empty-state text — the existing strings are preserved so those tests pass.
Only one of table/cards is in the DOM at a time (chosen by `incidentLayout`), so there
is no duplicate-text ambiguity for Testing Library.

**Charts reflow:** `chartsWide = (panelWidthPx ?? Infinity) >= CHARTS_TWO_UP_MIN`
(`= 460`) toggles a `.is-2up` class controlling `grid-template-columns`. DOM and labels
are unchanged, so chart tests pass regardless.

**States:**

- **No places selected:** existing findings empty string is kept; query bar shows but
  Run is disabled.
- **Selected, not yet run:** keep the existing "Run analysis to summarize…" prompt.
- **Running:** when `running` is true, the findings / charts / incident regions render
  skeleton placeholders (`.mc-skeleton`) instead of stale content; the Run button shows
  "Running…" (existing behavior).
- **Zero results:** keep the existing "No matching reported incidents…" message.
- **Error:** `MapWorkspace` passes an optional `error` string into the active tab so it
  renders inline near the query bar (an `.mc-inline-error`) instead of (only) the
  floating map toast. The floating toast may remain for session-level errors.

### 3. Ripple to Compare

`CompareTab` uses the same `.mc-footer` + `<div style={{ height: 56 }} />` hack. Apply
the same treatment: move the **Compare places** button into a sticky action area and
remove the spacer. Preserve the button's accessible name ("Compare places") and all
existing empty / guidance strings so `CompareTab.test.tsx` passes. No visual restyle
beyond removing the hack. The Places tab keeps its own layout; only adopt the sticky
pattern there if it shares the footer hack (it does not today).

## Interface / file change summary

- `types.ts`: replace `SheetState` with `DrawerState` (`collapsed`, `widthPx`).
- `lib/drawer.ts` (new): constants + `drawerMax`, `clampWidth`, preset→state mapping.
- `lib/drawerStorage.ts` (new): persistence with try/catch.
- `components/BottomSheet.tsx`: new props (`collapsed`, `widthPx`, `onToggleCollapsed`,
  `onResize`, `onPreset`); draggable/keyboard-accessible handle; three presets.
- `components/AnalyzeTab.tsx`: query bar to top (sticky); remove footer + spacer; add
  `panelWidthPx` prop; responsive incident table/cards; charts reflow class; skeletons;
  inline error. The cards layout is a new local component (`IncidentDetailsCards`)
  living beside the existing local `IncidentDetailsTable` in this same file, mirroring
  its structure; `AnalyzeTab` renders one or the other based on `incidentLayout`.
- `components/CompareTab.tsx`: sticky action area; remove footer + spacer.
- `components/MapWorkspace.tsx`: own `DrawerState`, persistence, width plumbing
  (`panelWidthPx` to tabs, `--panel-width` to frame), pass `error` into active tab.
- `styles/mapWorkspace.css`: drawer width via inline style + `.is-collapsed`; new
  `.mc-querybar`, `.mc-incident-cards`, `.mc-skeleton`, `.mc-inline-error`; reflow
  classes; remove/relax `.mc-incident-table{min-width:680px}`; keep the table color
  rules the style test asserts.

## Testing strategy

- **Preserve (no change expected):** AnalyzeTab control-emits, run-disabled, findings
  copy, charts, "run analysis to summarize", incident *table* render, zero-results
  message — all pass because labels/strings/roles are preserved and `panelWidthPx`
  defaults to the table layout.
- **`mapWorkspaceStyle.test.ts`:** keep the asserted `.mc-incident-table*` /
  `.mc-findings*` rules intact; the test stays green. Extend it only if we want to lock
  in new selectors.
- **Update:** `BottomSheet.test.tsx` and `MapWorkspace.test.tsx` for the new drawer API
  (presets Peek/Default/Wide, draggable handle, `collapsed`/`widthPx`). These are
  rewritten as part of the work (TDD: write the new expectations first).
- **Add:**
  - Drawer: preset buttons call `onPreset`; handle Enter/Space toggles collapse; Arrow
    keys call `onResize` with a clamped value; `aria-valuenow` reflects width;
    persistence round-trips through `lib/drawerStorage`.
  - `lib/drawer.ts`: `clampWidth` bounds; `drawerMax` respects viewport; preset mapping.
  - AnalyzeTab: passing a narrow `panelWidthPx` (e.g. 380) renders incident **cards**
    (no `table` role) with the same fields; a wide width renders the table; `running`
    renders skeletons; inline error renders when `error` is set.
- Full gate before done: `cd frontend && npm test && npm run build`; plus `make test`
  / `make lint` to confirm no backend regressions (none expected).

## Edge cases & risks

- **Stored width > viewport** (resized window / smaller screen): hydrate through
  `clampWidth`; also re-clamp on `window.resize` so a maximized→restored window keeps
  the panel valid and attribution clear.
- **Drag precision / capture loss:** use Pointer Events + `setPointerCapture`; clear the
  dragging flag on `pointerup`/`pointercancel`.
- **jsdom has no layout:** all responsive decisions are driven by the `panelWidthPx`
  prop / explicit state, never by measured DOM size, so tests are deterministic.
- **Min readable width:** `DRAWER_MIN = 340` keeps the query bar and cards legible; the
  incident table only appears at ≥560px where 7 columns fit without cramming.
- **Compare/Places parity:** only Compare shares the footer hack today; scope the ripple
  to it to avoid unrelated churn.

## Out of scope

- Re-theming, new color/typography systems, or map restyling.
- New analysis features, columns, or chart types.
- Touch-drag resize on mobile (presets cover mobile resizing).
- Backend, exports, and personal-upload flows.
