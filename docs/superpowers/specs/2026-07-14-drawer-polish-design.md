# Drawer polish — design

**Date:** 2026-07-14
**Status:** Approved
**Scope:** Three follow-ups from the CompCat resurface (#137/#138), bundled into one
frontend-only slice: analysis on load, the shared-view chip seam, and place rename.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Default selection on load | **Last session's selection**, persisted to localStorage; filtered to places that still exist; falls back to ALL saved places when nothing valid is stored |
| Bundling | All three items in one slice / one PR |
| Rename UX | Inline edit in the ManagePlacesModal list row (pencil icon → text input; Enter saves, Escape cancels, empty rejected); label only |
| Shared-view chip behavior | Chip click exits the shared view and toggles the place into a fresh selection (mirrors the existing lookup-chip behavior) |

## 1. Analysis greets you on load

- New hook `usePersistedSelection` (frontend/src/lib/) wrapping the `selectedIds`
  state currently at `MapWorkspace.tsx:50`:
  - Writes the id set to localStorage key **`compcat.selection`** on every change.
  - On the initial places load, restores the stored set filtered to existing place
    ids; when the filtered set is empty (nothing stored, or all stored ids stale),
    falls back to all saved places.
- A one-shot effect fires `analyze.runAnalyze()` after restore when: the restored
  selection is non-empty AND the session has no `lookupPoint`/`sharedPoints` AND the
  landing is not showing. The existing lookup/shared auto-run effect
  (`MapWorkspace.tsx:190`) is untouched.
- First paint on a returning session: chips checked, verdicts rendering, no click.
- Errors surface exactly as a manual Run would (no special handling).
- Cost note: one `analyzePlaces` call per load — identical to the user clicking Run.

## 2. Shared-view chip seam

Today a chip click during a shared view invalidates the shared analysis without
re-running, and the chip's checked state (identity-keyed) never changes — the chip
looks dead and the pane blanks (pre-existing seam relocated from the old list).

Fix: in a shared session, chip click calls `setSharedPoints(null)` (same as the
banner's Exit) and toggles the clicked place into a fresh selection; the item-1
auto-run effect then analyzes it. No disabled states, coherent with lookup behavior.

## 3. Place rename

- `frontend/src/api/client.ts`: add `updatePlace(placeId, {display_label})` calling
  the EXISTING `PATCH /places/{place_id}` (`app/api/routes_public_places.py:49`) —
  zero backend changes.
- ManagePlacesModal list rows: pencil icon button (aria-label `Rename <label>`)
  swaps the label for a text input; Enter saves (PATCH then refresh places), Escape
  cancels, empty/whitespace-only input rejected (input stays, no call).
- Label only — no sensitivity or coordinate editing.

## Scope guards

- Frontend-only; zero backend/API/schema changes.
- New localStorage keys use the `compcat.` prefix. Existing `waypoint.*` / `wp-*`
  keys stay (identifier-rename remains out of scope).
- No changes to compare-set behavior, tab structure, or theme.

## Testing

- `usePersistedSelection` unit tests: persist on change; restore; filter stale ids;
  fallback-to-all; empty-places no-op.
- MapWorkspace: auto-run-on-load (mocked `analyzePlaces` called once with restored
  ids); NOT called when no places / lookup session / shared session.
- Shared view: chip click exits shared mode, selects the place, re-runs.
- Rename: pencil → input → Enter fires PATCH + refresh; Escape cancels without a
  call; empty input rejected.
- Gate: `make test-all` + live browser check (per house cadence) before the PR.

## Slicing

Single slice, single PR: (1) hook + auto-run, (2) shared-chip fix, (3) rename,
(4) gate + PR. Dedicated worktree; user squash-merges.
