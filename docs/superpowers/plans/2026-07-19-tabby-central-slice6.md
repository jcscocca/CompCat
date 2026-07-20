# Tabby-Central Slice 6: Mobile Sheet Mechanics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile sheet gets three snap heights (bar / half / full) with live grabber dragging and velocity-aware release, keyboard-safe composer via visualViewport, contained scrolling, and snap-aware camera padding.

**Architecture:** `DrawerState` gains a mobile-only `snap` (persisted; `collapsed ⇔ snap === "bar"` keeps every existing boolean call site meaningful). BottomSheet's mobile branch swaps the binary classes for `is-bar/is-half/is-full` CSS heights, adds pointermove live-drag (inline height while dragging) and a velocity-biased nearest-snap release, keeps tap-toggle (bar ↔ last expanded snap). A visualViewport listener sets a `--kb-inset` var so the composer rides above the keyboard. Scroll chaining to the map is stopped with `overscroll-behavior: contain` (the rail already has a single real scroller; the legacy-view nested case is contained, not restructured). Consumers become snap-aware: offers/badges/draft raise to half, add-pin drops to bar, card expand goes full (restoring half on collapse), and `fitTo`'s bottom inset tracks the actual snap.

**Tech Stack:** React 18 + Vitest; CSS only for heights/transitions. No backend changes.

**Spec:** `docs/superpowers/specs/2026-07-19-tabby-central-redesign-design.md` (Slice 6: "three snap heights with handle-only dragging, nearest-snap + velocity release logic, visualViewport-based keyboard handling, a single scroll owner, focus restoration, sheet-aware fitBounds padding").

**Worktree:** from `main`; usual setup + gates. Baselines expected: backend 682 (untouched), frontend 516.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/src/types.ts` | modify | `SheetSnap` + `DrawerState.snap` |
| `frontend/src/lib/drawer.ts` | modify | snap constants + `snapHeightPx()` |
| `frontend/src/lib/drawerStorage.ts` (+test) | modify | persist/validate `compcat.drawer.snap` |
| `frontend/src/lib/useDrawer.ts` (+test) | modify | `onSnap`; collapsed⇔bar mapping |
| `frontend/src/components/BottomSheet.tsx` (+test) | modify | snap classes, live drag, velocity release, kb inset |
| `frontend/src/styles/mapWorkspace.css` | modify | `is-bar/is-half/is-full`, transition, overscroll, kb inset |
| `frontend/src/components/MapWorkspace.tsx` (+test) | modify | snap-aware consumers + fitTo inset |
| `frontend/src/lib/usePinDraft.ts` | modify | snap-aware dep calls |

---

### Task 1: Snap state model

**Files:** `frontend/src/types.ts`, `frontend/src/lib/drawer.ts`, `frontend/src/lib/drawerStorage.ts` (+test), `frontend/src/lib/useDrawer.ts` (+test).

- [ ] **Step 1 (types + constants):**

```ts
// types.ts
export type SheetSnap = "bar" | "half" | "full";
export type DrawerState = { collapsed: boolean; widthPx: number; snap: SheetSnap };
```

```ts
// drawer.ts additions
export const SHEET_SNAPS = ["bar", "half", "full"] as const;
/** Fraction of the viewport height each snap occupies (bar is content-height CSS). */
export function snapHeightPx(snap: SheetSnap, viewportH: number): number {
  if (snap === "full") return Math.round(viewportH * 0.92);
  if (snap === "half") return Math.round(viewportH * 0.5);
  return 120; // bar: approx grabber + peek header; used for map padding only
}
```

- [ ] **Step 2 (TDD, storage):** `drawerStorage` gains `compcat.drawer.snap` load/save with validation (unknown value → `"half"`); `loadDrawerState()` returns the snap; saving writes it. Keep collapsed/width keys byte-compatible. Tests: round-trip, bad-value fallback, absent key default `"half"`.

- [ ] **Step 3 (TDD, useDrawer):** `DrawerController` gains `onSnap(snap: SheetSnap): void`. Invariants (enforced in one reducer-style setter): `onSnap("bar")` sets `collapsed: true`; `onSnap("half"|"full")` sets `collapsed: false`; `setCollapsed(true)` sets `snap: "bar"`; `setCollapsed(false)` sets `snap: "half"` ONLY if currently `"bar"` (an already-full sheet stays full); `onToggleCollapsed()` toggles bar ↔ the last expanded snap (store `lastExpandedRef`, default `"half"`). Tests for each invariant + persistence write-through.

- [ ] **Step 4:** suites + tsc; commit `feat(sheet): three-snap drawer state with collapsed compatibility`.

---

### Task 2: BottomSheet mechanics + CSS

**Files:** `frontend/src/components/BottomSheet.tsx` (+test), `frontend/src/styles/mapWorkspace.css`.

- [ ] **Step 1 (props):** BottomSheet gains `snap: SheetSnap` and `onSnap: (snap: SheetSnap) => void` (passed only meaningfully on mobile; desktop branch ignores them). Mobile section class becomes `mc-workspace-panel is-${snap}` (keep `is-collapsed`/`is-open` also applied per the collapsed boolean for one slice — legacy CSS still keys on them; remove in slice 7).

- [ ] **Step 2 (TDD, grabber):** replace the binary handlers:

```ts
const dragState = useRef<{ startY: number; startT: number; startHeight: number } | null>(null);

function onGrabberPointerDown(event: PointerEvent<HTMLDivElement>) {
  const panel = panelRef.current;
  if (!panel) return;
  dragState.current = { startY: event.clientY, startT: performance.now(), startHeight: panel.getBoundingClientRect().height };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onGrabberPointerMove(event: PointerEvent<HTMLDivElement>) {
  const drag = dragState.current;
  const panel = panelRef.current;
  if (!drag || !panel) return;
  const dy = event.clientY - drag.startY;
  if (Math.abs(dy) <= GRABBER_TAP_SLOP) return;
  const height = Math.max(80, Math.min(window.innerHeight * 0.95, drag.startHeight - dy));
  panel.style.height = `${height}px`; // live drag, uncommitted
}

function onGrabberPointerUp(event: PointerEvent<HTMLDivElement>) {
  const drag = dragState.current;
  const panel = panelRef.current;
  dragState.current = null;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
  if (!drag || !panel) return;
  panel.style.height = ""; // hand height back to the snap class
  const dy = event.clientY - drag.startY;
  if (Math.abs(dy) <= GRABBER_TAP_SLOP) {
    onToggleCollapsed(); // tap: bar ↔ last expanded (useDrawer owns the memory)
    return;
  }
  const dt = Math.max(1, performance.now() - drag.startT);
  const velocity = dy / dt; // px/ms; positive = downward
  const endHeight = drag.startHeight - dy;
  const half = window.innerHeight * 0.5;
  const candidates: { snap: SheetSnap; h: number }[] = [
    { snap: "bar", h: 120 },
    { snap: "half", h: half },
    { snap: "full", h: window.innerHeight * 0.92 },
  ];
  let nearest = candidates.reduce((a, b) => (Math.abs(b.h - endHeight) < Math.abs(a.h - endHeight) ? b : a));
  const FLICK = 0.5; // px/ms
  if (velocity > FLICK) {
    // fast downward flick: next snap below current nearest
    const index = candidates.findIndex((c) => c.snap === nearest.snap);
    nearest = candidates[Math.max(0, index - 1)];
  } else if (velocity < -FLICK) {
    const index = candidates.findIndex((c) => c.snap === nearest.snap);
    nearest = candidates[Math.min(candidates.length - 1, index + 1)];
  }
  onSnap(nearest.snap);
}
```

(Adapt to the file's existing ref names; keep the desktop handle branch untouched. `GRABBER_DRAG_THRESHOLD` is superseded by the tap-slop + nearest-snap model — remove it and its uses in the mobile branch only.)

Tests (extend the existing `fireEvent.pointerDown/Up` + `clientY` idiom; mock `performance.now` via `vi.spyOn` to control velocity, and stub `panelRef` heights via `getBoundingClientRect` mock): tap toggles; slow drag to ~40% viewport height snaps half; slow drag near-top snaps full; slow small drag stays nearest; fast downward flick from half lands bar even when displacement is small; fast upward flick from half lands full; pointer capture released; live-drag inline height cleared on release.

- [ ] **Step 3 (keyboard inset):** mobile-only effect in BottomSheet:

```ts
useEffect(() => {
  if (!isMobile || typeof window === "undefined" || !window.visualViewport) return;
  const vv = window.visualViewport;
  const panel = panelRef.current;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    panel?.style.setProperty("--kb-inset", `${inset}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    panel?.style.removeProperty("--kb-inset");
  };
}, [isMobile]);
```

Test: with a stubbed `window.visualViewport` (EventTarget with height/offsetTop), the panel gets `--kb-inset` set on resize events and cleaned up on unmount.

- [ ] **Step 4 (CSS):** in the `@media (max-width:760px)` block: replace the height rules with

```css
  .mc-workspace-panel{height:min(50dvh,620px);transition:height .22s cubic-bezier(.2,.8,.2,1);padding-bottom:var(--kb-inset,0px);}
  .mc-workspace-panel.is-full{height:min(92dvh,100%);}
  .mc-workspace-panel.is-bar{height:auto;transition:none;}
  .mc-panels{overscroll-behavior:contain;}
```

(Keep the existing `is-collapsed` rule working during the transition slice — `is-bar` and `is-collapsed` co-apply. Add `overscroll-behavior:contain` to BOTH `.mc-panels` (mobile block) and the base `.mc-dock-log` rule so sheet scrolling never chains to the map. Verify against the real current rules — the survey pinned them at mapWorkspace.css:483-494/510 — and adjust selectors to reality rather than pasting blind.)

- [ ] **Step 5:** suites + tsc + build; commit `feat(sheet): live-drag grabber with velocity snaps and keyboard inset`.

---

### Task 3: Snap-aware consumers

**Files:** `frontend/src/components/MapWorkspace.tsx` (+test), `frontend/src/lib/usePinDraft.ts`.

- [ ] **Step 1:** thread `snap`/`onSnap` from `useDrawer` into BottomSheet. Consumer mapping (each currently a `setDrawerCollapsed` call — replace on the MOBILE-relevant paths; desktop keeps the boolean):
  - offer minted (`selectPlaceIds`): `onSnap("half")` when mobile, `setDrawerCollapsed(false)` desktop (or call both — `onSnap` already un-collapses; simplest: `isMobile ? onSnap("half") : setDrawerCollapsed(false)`).
  - `handleBadgeClick`: same half-raise.
  - `handleCardExpandChange`: expand → mobile `onSnap("full")`; collapse → mobile `onSnap("half")`; desktop width logic unchanged.
  - `usePinDraft`: widen the injected dep from `setDrawerCollapsed` to also accept a snap fn, or simpler: MapWorkspace passes wrapper callbacks — `startAddPin`'s collapse → `onSnap("bar")` on mobile; `handleMapClick`'s raise → `onSnap("half")` on mobile. Keep usePinDraft's injected signature `(collapsed: boolean) => void` and let the WRAPPER in MapWorkspace translate (no usePinDraft change needed if the wrapper maps true→bar/false→half on mobile — do it that way; usePinDraft file untouched then, remove it from the file list in your report if so).
  - focus-mode effect's mobile branch: `onSnap("half")`.
  - `fitTo` bottom inset: `isMobile ? snapHeightPx(drawer.snap === "bar" ? "bar" : "half", window.innerHeight) : 40` — frame for the half state even when full (the user lowers to see the map); bar uses the bar height.
- [ ] **Step 2 (tests):** MapWorkspace: offer on a mobile viewport (mock `window.innerWidth` per the file's existing isMobile test idiom — check how other mobile tests set it; if none exist, set `window.innerWidth` + resize event in the test) raises snap to half (assert via the BottomSheet-mock props or the drawer state); card expand on mobile → full, collapse → half; fitTo bottom inset reflects snap (bar vs half). Extend the MapCanvas/BottomSheet mocks as needed following the established capture conventions.
- [ ] **Step 3:** full suites + tsc + build; commit `feat(sheet): snap-aware raises, card expansion, and camera padding`.

---

### Task 4: Gate + E2E + merge (coordinator)

- [ ] Full gate; E2E with the browser pane's MOBILE preset (375x812): sheet at half by default with the rail; grabber drag between snaps; onboarding→add→offer raises the sheet; card expand → full with expanded content scrollable; composer focus keeps the input visible (best-effort in the pane); map padding sensible at bar vs half; invariant sweep. Fresh-context final review; squash-merge.

## Out of scope
- Removing the legacy `is-collapsed` CSS coupling (slice 7, with the tabs)
- Focus restoration beyond the existing focus behavior (spec mentions it; the composer/chips already manage focus natively — note any gap found during E2E as a slice-7 item rather than building speculative focus machinery)
