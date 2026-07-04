# Compare-first flagship — slice B: multi-address compare UX — design

**Date:** 2026-07-03
**Status:** Approved pending user spec review
**Roadmap:** Phase 5 (compare-first flagship) — **slice B of three**. Slice A (richer
payload-driven verdicts) shipped in #94/#95. Slice C (comparison-first landing) is later.

## Why

Slice A made the compare *result* strong. But to compare, you still assemble the set on the
**Places tab** (add pins / search there, select ≥2), then switch to Compare. Slice B closes
that gap: a Compare-owned control to **build and edit the comparison set in place** — the
natural "I have three candidate apartments, line them up" flow — so Compare stops depending
on a detour through Places.

The engine and the verdict UI are already N-way (slice A), so this slice is **frontend
only, no backend change**: it reuses the existing stateless inline-`points` compare path
(`/dashboard/compare` accepts `points`, ≤10, Seattle-bbox validated) that slice A already
proved out for shared views.

## Goal

Two parts, one PR, built in order:
- **Part 1 (first):** give the Compare tab an editable, ephemeral **compare set** — add an
  address via search, remove a row, re-run — driving the slice-A verdict, without touching
  saved Places.
- **Part 2 (after Part 1):** add an **honest rate-ratio interval plot** to the verdict — the
  payload-ready, frontend-only visualization that gives the "how big is the gap / is it real"
  intuition the two-bell-curves idea was reaching for, without its statistical trap.

## Design decisions (settled in brainstorm)

1. **Ephemeral scratchpad, not saved Places.** Addresses added in Compare are candidates
   you're evaluating. They geocode into an in-memory set of `points`
   (`{latitude, longitude, label}`) and run through the inline-points compare path. They are
   **not** persisted as Place entities and do not appear in the Places list.
2. **Seeded from the current selection.** Opening Compare with places already selected (from
   Places / the map) or from a shared `?view=` link pre-fills the set, so the existing
   "select then Compare" flow still works. From there the user edits freely.
3. **Decoupled.** Add/remove in Compare does **not** change the Places-tab selection
   (`selectedIds`) or saved Places — the compare set is Compare-local once seeded. (Rejected
   alternative: coupling the set to the workspace selection so edits ripple to map markers —
   entangles the tabs and muddies the throwaway-candidate model.)
4. **Explicit re-run.** Editing the set marks the current verdict stale; the user clicks
   Compare to recompute (matches today's button; no request per keystroke).
5. **Bounds.** 2–10 addresses (the inline-points cap `_MAX_POINTS`), each Seattle-bbox
   guarded — same limits slice A already enforces.

## Product invariant

Unchanged and unaffected: the rendered verdict is slice A's (ranked by reported-incident
rate, callout bounded to statistical clarity, guard test in place). Slice B only changes how
the *input set* is assembled; it adds no ranking or safety language.

## Architecture

Frontend only. New/edited units:

- **`useCompareSet` (new hook, `frontend/src/lib/`)** — owns the editable compare set:
  `points: ComparePoint[]`, `add(point)`, `removeAt(index)` / `remove(id)`, and a
  `seed(selected)` that initializes the set from the current `selected` places (converting
  each to `{latitude, longitude, label}`). Since MapWorkspace already synthesizes `selected`
  from a shared `?view=` when one is present, seeding from `selected` covers both normal
  selection and shared links — no separate shared-view branch. Tracks a "user-edited"
  flag so re-seeding on selection change only happens before the user's first manual edit
  (after that the set is theirs). Enforces the ≤10 cap and de-dupes by rounded coordinate.
  This is the testable core of the slice.
- **`CompareAddressInput` (new component)** — the add control. Wraps the existing
  `useAddressSearch` hook (the shared geocode/type-ahead/Seattle-guard/recent-history hook
  that Places search already uses); on selecting a result it calls `add(point)`. Disabled at
  10. Surfaces geocode-not-found / out-of-Seattle errors inline via the hook's existing
  states.
- **`CompareTab` (edited)** — renders, above the slice-A verdict: the "Addresses to compare ·
  N of 10" label, the `CompareAddressInput`, and the removable numbered rows; keeps the
  Compare button (now runs the current set). When the set is stale-since-last-run, the button
  reads "Compare N addresses" and a subtle "edited — re-run to update" note shows.
- **`useCompare` (edited, minimal)** — already accepts a `points` override and runs it when
  `length ≥ 2`; slice B feeds it the `useCompareSet` points instead of only the shared-view
  points. `versionRef` stale-guard and `applyAssistant` preserved.
- **`MapWorkspace` (edited, wiring)** — owns/holds `useCompareSet` (seeded from `selected` /
  `sharedPoints`), passes its points to `useCompare` and the set + add/remove callbacks to
  `CompareTab`.
- **Shareability** — the set is `points`, so the existing `buildShareUrl("compare")` /
  `savedView` encoding continues to capture it unchanged; a shared link still round-trips.

`ComparePoint` = `{ latitude: number; longitude: number; label: string }` (the existing
inline-point shape used by `useCompare`/`client.ts`/`savedView`).

## Data flow

address search (`useAddressSearch`) → selected result → `useCompareSet.add(point)` → set
updates, verdict marked stale → user clicks Compare → `useCompare.runCompare()` POSTs the
`points` to `/dashboard/compare` → `SiteComparison` → slice-A verdict renders on the set. No
new network shape; no persistence writes.

Because the set is always `points`, Compare runs the inline-points path uniformly — even for
addresses seeded from saved places (their coords become points). For the same coordinates the
returned `SiteComparison` is identical to the persisted `place_ids` path, and slice A renders
purely from that payload, so nothing is lost by dropping the `place_ids` path from Compare.

## States & edge cases

- **< 2 in set:** verdict area shows the existing "add at least two addresses to compare"
  prompt; Compare disabled.
- **At 10:** the add input is disabled with a "10 max" hint.
- **Geocode miss / outside Seattle:** inline error from `useAddressSearch`; the set is
  unchanged.
- **Duplicate address:** de-duped by rounded coordinate (no-op add, brief hint).
- **Edited-since-run:** verdict kept but marked stale; re-run refreshes it. Removing a row
  below 2 disables Compare until another is added.
- **Seeded set, then selection changes:** re-seeds only if the user hasn't manually edited
  (the "user-edited" flag); otherwise the user's set stands.

## Part 2 — rate-ratio interval plot (bundled in this PR, built after Part 1)

An honest visualization of the comparison, added to the verdict area. It gives the "magnitude
+ is-the-gap-real" intuition without the overlapping-bell-curve fallacy — two 95% CIs
overlapping is **not** the same as "no significant difference" (overlap ≈ p 0.006, not 0.05,
and it misleads hardest at the high incident counts this tool sees), and the payload has no
per-address spread to draw a bell from, only the ratio's CI. (A design exploration weighed
five idioms; the rate-ratio interval plot won on honesty + payload-feasibility. Overlapping
bell curves were rejected as statistically dishonest here.)

**What it shows.** For each non-lowest address, a dot at its rate **relative to the lowest
address** ("× the lowest") with its 95% interval as a horizontal bar, on a shared axis with a
dashed reference line at 1× (= same rate as the lowest). Interval entirely clear of the line
→ clearly higher; interval crossing the line → not distinguishable. The lowest address is the
reference at 1×.

**Payload mapping — all fields exist today; frontend-only, no backend.** Each non-lowest
address's pairwise-vs-candidate row carries `rate_ratio` and `ci_lower`/`ci_upper`. The
engine's candidate is the lowest-rate address, so `rate_ratio` = lowest/other ≤ 1; the plot
shows the **inverse** so higher-rate addresses read ≥ 1×: `multiple = 1/rate_ratio`, interval
inverts-and-swaps to `[1/ci_upper, 1/ci_lower]`. This derivation lives in the pure
`compareVerdict.ts` (extended to expose, per row, the plotted `multipleOfLowest` + its
interval bounds), so it is unit-tested.

**Two honesty rules baked in (both flagged by the design exploration):**
1. **Orientation to the real payload.** Code to the actual ≤ 1 `rate_ratio` and invert as
   above — do not assume a ≥ 1 ratio. The effect-size floor (0.80 on the ratio) sits at 1.25×
   on the displayed multiple axis.
2. **Raw bar, corrected label.** The bar is the raw 95% interval; the "clearly higher /
   similar" color+label is the Benjamini–Hochberg-corrected `decision_class`, which can
   disagree with the raw bar at scale. The **label/color is authoritative**; a one-line
   footnote discloses this so the disagreement is not hidden.

**Placement & states.** A distinct panel in the verdict area (below the ranked list). Clear
case: intervals right of the line. No-clear / inconclusive: intervals straddle the line, no
address highlighted — the chart refuses to manufacture a winner, matching the words. One row
at 2 addresses; nine rows on the shared axis at 10 — legible.

**Invariant.** Neutral palette only (no red/green safety coding); it visualizes
reported-incident *rate* comparison, never a safety judgement. Slice A's guard-test
banned-word scan extends to cover the plot's labels.

## Testing

- `useCompareSet.test.ts` (pure): add / remove / seed-from-selected / seed-from-points; the
  user-edited flag gating re-seed; ≤10 cap; coordinate de-dupe; ordering.
- `CompareAddressInput.test.tsx`: selecting a search result adds a point; disabled at 10;
  surfaces the geocode/out-of-bbox error state.
- `CompareTab.test.tsx` (extended): renders the editor + rows; remove drops a row; the "N of
  10" count; the stale/re-run affordance; < 2 gating; slice-A verdict still renders for a set
  of ≥ 2. Invariant guard from slice A stays green (verdict copy unchanged).
- `compareVerdict.test.ts` (extended, Part 2): the `multipleOfLowest` + interval derivation —
  the `1/rate_ratio` inversion and the `[1/ci_upper, 1/ci_lower]` swap; the effect-floor
  mapping (0.80 → 1.25×); a case where the raw interval clears 1× but the corrected
  `decision_class` says "similar" (so the plot's label stays authoritative).
- `CompareRatioPlot.test.tsx` (Part 2): dot/interval positions for a clear case and a
  no-clear (straddling) case; the raw-bar/corrected-label footnote present; the invariant
  banned-word scan over the plot's labels; legible row-per-address at N=2 and N=10.
- `make test-all` green.

## File structure

- **Create (Part 1):** `frontend/src/lib/useCompareSet.ts` (+ `.test.ts`),
  `frontend/src/components/CompareAddressInput.tsx` (+ `.test.tsx`).
- **Create (Part 2):** `frontend/src/components/CompareRatioPlot.tsx` (+ `.test.tsx`).
- **Modify:** `frontend/src/components/CompareTab.tsx` (+ its test), `frontend/src/lib/useCompare.ts`
  (feed the editable points), `frontend/src/components/MapWorkspace.tsx` (own/seed the set,
  wire it), `frontend/src/lib/compareVerdict.ts` (+ its test — expose per-row plotted
  `multipleOfLowest` + interval bounds for Part 2), and the Compare CSS block (editor rows/input
  + the plot).
- **No backend / `app/` change.** No new endpoint, schema, or migration.

## Out of scope (deferred / tracked)

- **Rendering the ephemeral compare set on the map.** Nice for spatial context and the
  shared-view points path already renders points, so it's a cheap follow-up — but not a goal
  here; slice B keeps the set in the Compare panel to hold the decoupled-scratchpad model
  clean.
- **Persisting a compare address to Places** (a "save this candidate" affordance) — possible
  later; the ephemeral default stands.
- **Auto-run on edit** (vs the explicit re-run chosen here).
- **Overlapping bell curves** — rejected: statistically dishonest for this model (no
  per-address spread in the payload; overlap ≠ non-significance; symmetric Gaussian is the
  wrong shape for a Poisson rate). The rate-ratio interval plot (Part 2) delivers the same
  intuition honestly.
- **Per-address "rate ± margin of error" number-line** — the most intuitive cousin, but it
  needs the backend to emit a per-address Poisson rate CI; deferred to a fast-follow.
- **Slice C** (comparison-first landing).

## Sequencing

**One PR**, from the `compare-multi-address` worktree, gated on `make test-all`, built in two
ordered parts:
- **Part 1 (first):** TDD `useCompareSet` (the editable-set logic), then `CompareAddressInput`,
  then the `CompareTab` integration + wiring.
- **Part 2 (after Part 1 lands green):** extend `compareVerdict.ts` (the plotted multiple +
  inverted interval) TDD-first, then `CompareRatioPlot`, then mount it in the verdict.
- Finish with the ROADMAP slice-B tick.
