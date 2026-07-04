# Compare-first flagship — slice C: single-address entry → context → optional compare — design

**Date:** 2026-07-03
**Status:** Approved pending user spec review
**Roadmap:** Phase 5 (compare-first flagship) — **slice C of three**. Slice A (richer
payload-driven verdicts) shipped in #94/#95; slice B (editable multi-address compare set +
rate-ratio interval plot) shipped in #96. Slice C is the front-door reframe.

## Why

Slices A and B made the compare *result* and the compare *set* strong — but you only reach
them after the app opens on the **Places** tab with a "Map your places" empty state, which
frames Waypoint as a place-management tool. The address-first pivot wants the opposite first
impression: **look up one address, see its reported-incident context, and only then decide to
compare.** That single-address moment also serves the secondary "know your own area"
scenario, and it lowers the cost of entry from "assemble a set" to "type one address."

This is **frontend only, no backend change.** Both moving parts already exist: `useAnalyze`
runs on an ephemeral inline-`points` array (used today for shared `?view=` links,
[`useAnalyze.ts:50`](frontend/src/lib/useAnalyze.ts)), and `useCompareSet` already seeds the
compare set from the current selection and carries it into Compare
([`useCompareSet.ts:48`](frontend/src/lib/useCompareSet.ts)). `PlaceSearch` is already a
self-contained, debounced, Seattle-bbox address searcher. Slice C wires these into a new
entry path.

## Goal

One PR, built in order:

- **Part 1 — entry view.** A single-address lookup (`AddressLookup`) becomes the drawer's
  landing on a fresh session, replacing the "Map your places" empty state. Picking an address
  flies the map there and lands the user on the **Analyze** tab for that address, computed via
  the ephemeral points path (nothing persisted).
- **Part 2 — the compare bridge.** A "＋ Compare with another address" affordance on the
  single-address Analyze view switches to the **Compare** tab with the looked-up address
  already seeded as the anchor. Compare (slice A/B) then runs unchanged.

## Design decisions (settled in brainstorm)

1. **Map stays the centerpiece; the flow lives in the side drawer.** No pre-map landing
   screen (the boldest option was explicitly rejected). The full-screen map, "Add pin," and
   manual pinning are untouched.

2. **Ephemeral point, not a saved Place (the key decision).** A looked-up address is held as
   an in-memory `lookupPoint` (`{latitude, longitude, label}`) and analyzed through the
   inline-points path — **no DB write**, consistent with slice B's throwaway-candidate model
   and the app's privacy-first stance. The map shows it as the existing **draft pin**
   (`MapCanvas` already renders `draft`), so the map stays coherent for free. Rejected
   alternative: auto-persisting every lookup as a `Place` — it clutters the Places list and
   breaks today's deliberate "draft → save" contract. A **"Save to my places"** affordance
   stays available for when the user *does* want to keep the address (reuses `createPlace`).

3. **No new tab; no hidden navigation.** The four tabs (Analyze · Compare · Places · Export)
   stay visible the whole time (this is Approach #1 from the brainstorm; the tabs-recede
   "guided mode" was rejected for re-gating return users). `AddressLookup` renders as the
   drawer's **landing state**, not a fifth `TabKey`.

4. **Landing is gated to a fresh session.** The `AddressLookup` landing shows exactly when
   today's empty-state condition holds — no saved places, no active `lookupPoint`, no shared
   view (`data.places.length === 0 && !lookupPoint && !sharedPoints`). Return users with saved
   places get the normal workspace (they already have addresses); they still look up new
   addresses via the existing Places search. This deliberately does **not** force the landing
   on return users — that was the rejected con of the guided approach.

5. **Single subject at a time.** `lookupPoint` and the saved-place selection (`selectedIds`)
   are mutually exclusive as the analysis subject: looking up an address clears `selectedIds`,
   and explicitly selecting/toggling a saved place clears `lookupPoint`. `sharedPoints` (a
   `?view=` link) still takes precedence over both, unchanged.

6. **Reuse Analyze whole for the single-address context.** No new context view — the looked-up
   address renders through the existing `AnalyzeTab` (verdict card, temporal, categories,
   incident list), driven by a 1-element `points` payload and a synthesized `selected` shaped
   exactly like the existing `sharedPoints` synthesis in `MapWorkspace`.

7. **Auto-run on select.** Picking an address runs the analysis immediately (mirrors the
   existing shared-view auto-run), so the user sees context without a second click.

## Product invariant

Unchanged and unaffected. The flow reports **reported incident context** only: the entry copy
is "look up an address — see the reported-incident context around it," and the compare invite
is "compare with another address," never "find the safer place." The rendered verdict is slice
A's neutral ranked language; no ranking or safety wording is added, and the safety-refusal
guard (`app/assistant/agent.py`) is untouched and layer-independent.

## Architecture

Frontend only. New and edited units:

- **`AddressLookup` (new component, `frontend/src/components/`)** — the drawer landing. Thin
  composition: reuses `PlaceSearch` (`provider` + `onSelectResult`), renders the existing
  `searchHistory` recent list (pick-to-look-up), framing copy, and a secondary "manage saved
  places →" link that calls `setActiveTab("places")`. Props:
  `{ provider, onSelect(result), recent, onPickRecent(entry) }`. No new fetch logic.

- **`MapWorkspace.tsx` (edited)** — the coordinating changes:
  - New state `lookupPoint: ComparePoint | null`.
  - `handleLookup(result)`: set `lookupPoint`, clear `selectedIds`, fly the map to it (reuse
    the `flyTo` mechanism), `setActiveTab("analyze")`, and auto-run analyze.
  - Extend the `selected` synthesis to cover the lookup point:
    `sharedPoints ? synth(sharedPoints) : lookupPoint ? synth([lookupPoint]) : data.places.filter(selectedIds)`.
  - Extend the analyze points source:
    `points: sharedPoints ?? (lookupPoint ? [lookupPoint] : undefined)`.
  - Clear `lookupPoint` when a saved place is selected/toggled (decision 5).
  - Render `AddressLookup` as the drawer body when the fresh-session gate holds (decision 4).
    **Remove** the map `mc-empty` "Map your places" overlay — the drawer's `AddressLookup`
    landing is now the single, unambiguous entry affordance, so keeping the map overlay too
    would double up the same prompt.
  - `handleCompareWith()`: `setActiveTab("compare")` (the compare set is already seeded from
    the synthesized `selected`, so the anchor carries over — no explicit seeding needed).
  - `handleSaveLookup()`: persist the `lookupPoint` via `createPlace`, select the new place,
    and clear `lookupPoint` (the subject becomes a real Place).

- **`AnalyzeTab.tsx` (edited)** — add an optional `onCompareWith?: () => void` prop; when it
  is passed and a `neighborhood` result is present, render the **"＋ Compare with another
  address"** button next to the existing "Copy link to this view" control. `MapWorkspace`
  passes the handler whenever there is an analysis subject (lookup or selection), so the gating
  lives in one place. Add an optional `onSave?: () => void` for the "Save to my places"
  affordance, passed only when the subject is an ephemeral lookup. Both are additive and
  optional — existing callers/tests are unaffected.

Nothing else changes: `useAnalyze`, `useCompare`, `useCompareSet`, `PlaceSearch`, `MapCanvas`,
`CompareTab`, and the whole backend are reused as-is.

## Data flow

```
Fresh session (no places)         Look up "123 Main St"            Click "＋ Compare"
┌─────────────────────┐           ┌──────────────────────┐        ┌─────────────────────┐
│ drawer: AddressLookup│  select  │ lookupPoint set       │  bridge│ activeTab: compare   │
│ map: empty           │ ───────► │ selectedIds cleared   │ ─────► │ compareSet seeded    │
│                      │          │ map: draft pin + flyTo│        │ from lookupPoint      │
│                      │          │ activeTab: analyze    │        │ (anchor) — add 2nd    │
│                      │          │ auto-run via points   │        │ → slice A/B verdict   │
└─────────────────────┘          └──────────────────────┘        └─────────────────────┘
                                            │ optional
                                            ▼  "Save to my places" → createPlace → selected
```

## Testing

- **`AddressLookup.test.tsx` (new)** — renders the search + recent list; selecting a result
  calls `onSelect`; picking a recent entry calls `onPickRecent`; the "manage saved places"
  link is present.
- **`MapWorkspace.test.tsx` (edited)** — add:
  - Fresh session (no places) renders the `AddressLookup` landing, not "Map your places."
  - Looking up an address renders the Analyze tab for that point via the **points path** and
    **persists no Place** (assert `createPlace` not called; assert analyze fetch carries
    `points`).
  - The "＋ Compare with another address" bridge switches to the Compare tab with the
    looked-up address present in the set.
  - Update existing tests that assert the old empty-state copy.
- **Full gate:** `make test-all` (pytest + ruff + `npm test` + `npm run build`).

## Out of scope

- **No backend change.** Reuses the existing inline-points analyze/compare paths.
- **Per-address CI number-line visualization** — still deferred (needs a backend per-address
  confidence interval; noted in slice B).
- **Pre-map landing screen** — rejected in brainstorm.
- **Forcing the lookup landing on return users** — deliberately gated to fresh sessions
  (decision 4); a persistent "look up another address" entry point for users who already have
  saved places is a possible later polish, not this slice.
- **Slice A/B compare internals** — untouched.
```
