# Unified Compare surface — design

**Date:** 2026-07-16
**Status:** approved (brainstorm with product owner, 2026-07-16)
**Supersedes:** the Analyze/Compare two-tab split (Phase 5 slices A–C remain the foundation)

## Problem

The Analyze and Compare tabs are conceptually distinct (place vs its neighborhood
baseline; candidates vs each other) but the UI expresses the distinction nowhere, and the
boundary leaks:

- Analyze grows a pairwise place-to-place section at 2+ selected places — Compare's job,
  rendered differently in a different tab.
- Compare has no controls of its own; it silently inherits radius/dates/category set on
  the Analyze query bar.
- Each tab keeps its own address list (selected saved places vs the compare set), joined
  only by a one-way "+ Compare with another address" bridge.
- Compare — the roadmap's flagship — is the shallow tab: a ranking with no depth under
  it, while all the holistic context lives in Analyze.

## Decision

One surface, named **Compare**, replaces both tabs. A single address list (1–10 entries)
drives one results view that scales with count:

- **1 address** → the full per-address context module, wide open (today's Analyze
  output for one place).
- **2–10 addresses** → the compare verdict callout + a ranked, lowest-first spine
  ("Shape B"): each row shows rank, label, rate bar, rate, multiple-of-lowest, and
  relationship chip; expanding a row reveals the same per-address context module inline.

Both statistical frames stay visible in one place: the spine ranks candidates against
each other; each expansion judges that address against its own neighborhood (beat +
MCPP baselines). Navigation collapses to **Compare + Export**.

Rejected alternatives: full-depth side-by-side columns as the primary view ("Shape A" —
strains past 3 candidates and on mobile collapses to an unaligned stack; may return
later as a pin-to-compare enhancement for 2–3 candidates), and keeping two tabs split
by job ("My places" vs "Compare" — cheaper but leaves two lists, a bridge, and naming
doing the differentiation work).

## The surface

- **One address list, 1–10 entries.** Fed by the landing lookup, map-pin drafts, the
  address search, or picking from saved places. Entries keep index-based letter
  identities shared with map pins. Save stays per-entry opt-in; candidates never hit the
  DB unasked.
- **One query bar.** Date range, radius, incident category (plus the existing map-side
  layer toggle). One run CTA whose label adapts to count ("Run analysis" at 1,
  "Compare N addresses" at 2+).
- **Per-address context module** (extracted from `AnalyzeTab`): baseline verdict
  headline, baseline interval plot, monthly sparkline, "How we know" analytics table,
  category breakdown, temporal profile with travel window. Rendered full-width at N=1
  and inside each expanded spine row at N≥2.
- **Combined incident disclosure** ("See the N incidents", table/cards by panel width)
  stays a single section below the results, spanning the whole list.
- **Landing flow unchanged:** fresh session → single-address lookup → the address
  becomes entry #1 and auto-runs. "Add another address" grows the same list.
- **Layer notes** (911 calls / arrests caveats), the "reported incident context, not a
  personal risk prediction" caveat, and the `MethodsAppendix` render once at surface
  level (not per expansion), as today.

## State and data flow

- **One list hook.** `useCompareSet` generalizes into the single list: entries
  `{ label, latitude, longitude, savedPlaceId? }`, 1–10 (`MAX_COMPARE_POINTS` stays 10,
  matching the backend `_MAX_POINTS`), in-memory with share-link round-tripping as
  today. The saved-places modal keeps its place CRUD (add pin, create manual, edit,
  delete); its selection action changes from toggling `selected` to appending list
  entries. `selected`/`selectedIds` disappear from the workspace surface; Export keeps
  reading the saved-places store unchanged.
- **Everything ships as inline `points`.** `DashboardAnalyzeRequest` and
  `DashboardCompareRequest` accept exactly one of `place_ids` | `points`; a mixed list
  (saved + ad-hoc) can't use `place_ids`. Saved places carry coords client-side, so the
  surface always sends `points` — no backend change, and the constraint never bites.
  Nothing downstream depends on server place ids: hover-linking and letters work by
  index within one response; Save/Export live off the saved-places store.
- **Run = 2–4 parallel calls** (see the recorded deltas): neighborhood analysis +
  incident details always; `/dashboard/compare` at N≥2; a `place_ids` summary refresh
  when saved entries exist. One loading state; results render when all settle (spine
  from the compare payload; expansions and the incident disclosure from the analysis
  payload). Only the primary payload's failure (compare at N≥2, neighborhood at N=1)
  surfaces the inline error; secondary failures degrade their sections silently.
- **Share links.** One `points`-based format without the `tab=` discriminator. Legacy
  `tab=analyze` and `tab=compare` links keep decoding onto the unified surface and
  auto-run.
- **Assistant bridge.** Tool effects that switched tabs or injected a comparison now set
  the list and apply payloads to the one surface; `AssistantPanel` itself is untouched.

## Retirements

- `PairwiseSection` in Analyze (the spine is the pairwise view).
- The "+ Compare with another address" bridge button.
- The two-address minimum on the compare input (the list accepts 1).
- The `AnalyzeTab` / `CompareTab` pair merges into one panel component.
- The `analyze` tab key; nav = Compare + Export.

## Phasing

Three shippable slices, each its own PR gated on `make test-all`:

1. **Extract + enrich.** Pull the per-address context module out of `AnalyzeTab` into a
   reusable component; give today's Compare tab expandable rows that run the
   points-based analysis call and render the module. No structural change. This alone
   fixes "Compare offers much less."
2. **Unify.** One list hook, one panel component, tabs collapse to Compare + Export;
   retire the pairwise section and the bridge; share-link + assistant-bridge migration;
   landing unchanged.
3. **Polish.** Adaptive CTA label, mobile control-collapse behavior tuning. Later,
   optional: pin-to-compare side-by-side columns (Shape A for 2–3 candidates) and
   progressive spine-first rendering.

## Invariants

- **Product invariant untouched:** no safety scoring or safe/unsafe/danger/risk
  vocabulary anywhere in dynamic verdict regions. Existing banned-words tests extend to
  the module and spine.
- Frontend keeps calling only the public API tier (`frontend/src/api/client.ts`).
- Candidates stay ephemeral unless explicitly saved (privacy-first).

## Testing

- `AnalyzeTab` tests split into module tests + unified-panel tests: N=1 renders the
  module full-width; N≥2 renders callout + spine; expanding a row reveals the module.
- Legacy share-link fixtures (`tab=analyze`, `tab=compare`) decode onto the unified
  surface and auto-run.
- Existing `compareVerdict` / `CompareRankedList` / `CompareVerdict` tests carry over
  unmodified.
- Banned-vocabulary sweeps cover the new dynamic regions.

## Implementation deltas (slice 2, recorded 2026-07-16)

- **Saved-place summaries:** the unified run additionally fires `analyzePlaces({ place_ids })`
  for the list's saved entries — the points path never persists `crime_summaries`, and the
  map's per-place rings read them from the summary payload.
- **Auto-run policy:** seeding events auto-run (persisted-selection restore, share link,
  landing lookup); manual list edits and control changes invalidate and wait for Run. The
  old "points-subject re-runs on control change" special case is retired.
- **Adaptive CTA** shipped in slice 2 (querybar rebuild made it free).
- The module's landmark reads "Context for X" (was "Verdict for X").
- **Assistant selection edits invalidate results** like user edits do; payload-bearing
  assistant effects re-apply their panes after the invalidate.
- **Deleting a saved place also removes its list entry** (a dangling saved id would
  poison the run's `place_ids` summary refresh).

## Out of scope

- Any backend/`app/` change, new endpoint, schema, or migration.
- Shape A pinned side-by-side columns and progressive spine-first rendering (slice-3
  "later, optional" items).
- Export flow changes beyond nav position.
- Changing analysis statistics or payloads.
