# Compare-first flagship — slice A: richer side-by-side verdicts — design

**Date:** 2026-07-03
**Status:** Approved pending user spec review
**Roadmap:** Phase 5 (compare-first flagship — pivot phase 2 of the 2026-07 address-first
pivot). This spec is **slice A of three**; B and C are deferred (see Non-goals).

## Why

With routes removed, the flagship experience is comparing candidate addresses — primary
scenario *choosing where to live*, secondary *knowing your own area*. The exploration
found that the hard part already exists: `build_statistical_comparison`
(`app/analysis/comparison.py`) is an **N-way** engine (lowest-rate candidate vs every
other option, Benjamini–Hochberg corrected, 2–10 addresses) that returns decision class,
a recommendation, and per-pair rate-ratios / 95% CIs / adjusted p-values. The Compare tab
**fetches all of it and renders almost none** — one sentence (`overview.summary_text`)
plus count cards pulled from a *different* source (the persisted Analyze summary). So the
gap is a UI gap, and slice A closes it with **no backend change**.

## Goal

Rebuild the Compare tab to present the statistical richness the compare payload already
carries, as a **ranked, sorted, plain-to-read verdict** driven entirely by that payload.

## Non-goals (deferred, each its own spec later)

- **Slice B — multi-address compare UX:** a Compare-owned add/remove-address control and
  N-way selection independent of the Places tab. Slice A uses the *existing* selection
  mechanism (Places-tab selection / inline `points`).
- **Slice C — comparison-first landing:** leading the app with the compare flow. Slice A
  leaves the default landing (Places tab) unchanged.
- **Cross-address category breakdown**, **per-card sparkline**, **nearest-incident
  distance.** All three need the compare payload extended with data it does not currently
  return (per-category counts, per-option monthly series, nearest distance) — i.e. backend
  work. Deferred as a fast-follow; today's faked breakdown (sourced from the Analyze
  summary) is dropped, not reproduced.
- **No backend change of any kind** in slice A. No new/changed endpoints, schemas, or
  migrations.
- **Shared verdict-kit extraction** (unifying Analyze's and Compare's verdict components)
  — reconsidered *after* this ships, when there are two real consumers to design against.

## Product invariant (the thread)

Waypoint reports *reported incident context*; it MUST NOT score safety or rank places
safe/unsafe/dangerous. This tab ranks addresses **by observed reported-incident rate** —
a descriptive statistic, the same quantity the engine already computes — and states only
what the statistics support. Checkpoints:

- All copy is bounded to "reported-incident rate" / "reported incidents" (layer-aware:
  "calls for service" for the calls layer, "enforcement activity" for arrests). Never
  "safe / safer / dangerous / risk."
- Chips encode **statistical clarity and rate ordering only** (lowest · similar · clearly
  higher), never a safety judgement — same principle as `verdictCopy.ts`.
- The verdict callout's strength strictly follows the payload's decision classes; it never
  asserts beyond them. When the data is inconclusive the tab says so and highlights
  nothing (it refuses to manufacture a winner).
- A new test asserts the rendered compare output never contains safety-ranking language,
  mirroring the existing output-side guard for compare summaries.

## Design decisions (settled in brainstorm)

1. **Hybrid framing.** Equal peer rows always; a statistically-clear callout appears only
   when the payload supports it. Renders the engine's own conservative decision — the UI
   adds no independent judgement.
2. **Ranked, lowest-first, with rank numbers and bars.** Rows are sorted ascending by
   `incident_rate`, numbered 1..N, each with a horizontal bar proportional to its rate and
   a "×the lowest" multiple. Ordering and gap-size read at a glance — the fix for "which is
   lowest / what's the order."
3. **Honest N-of-M framing at scale.** At many addresses the lowest is rarely lower than
   *everything*; usually a cluster is statistically indistinguishable from it. So:
   - the **callout summarizes the pairwise results** — "lower than N of the M others" —
     rather than collapsing to a single all-or-nothing verdict;
   - each **row chip states its relationship to the lowest** — *lowest · similar to lowest
     · clearly higher · limited data* — derived from that row's pairwise decision class.
   Both are pure frontend aggregation of pairwise results already in the payload.
4. **Progressive disclosure.** Rate-ratio, 95% CI, adjusted p, exact p, method, dispersion,
   and data-adequacy sit behind a per-row "How we know" — same move as Analyze.
5. **Single source of truth = the compare payload.** Everything renders from
   `/dashboard/compare`'s response. The tab stops reading the Analyze `summary`, which
   fixes the shared-view (`?view=` inline `points`) case where that summary is absent.

## Payload the design consumes (already returned today)

From `_comparison_model_payload` (`app/services/analysis_service.py`), no change:

- `overview`: `decision_class`, `recommendation_option_id`, `recommendation_label`,
  `summary_text`, `caveat_text`, `options[]`
- `analytical`: `source_dataset`, `exposure_unit`, `full_caveat_text`, `options[]`,
  `pairwise_results[]`
- each **option** (`AnalysisOptionResult`): `option_id`, `option_label`, `geometry_type`,
  `radius_m`, `incident_count`, `exposure`, `exposure_unit`, `incident_rate`
- each **pairwise** (`PairwiseComparisonResult`, candidate-vs-one-other, k−1 of them):
  option ids/labels, `winner_option_id/label`, `decision_class`, `method`, counts,
  exposures, `rate_a`, `rate_b`, `rate_ratio`, `ci_lower`, `ci_upper`, `p_value`,
  `adjusted_p_value`, dispersion fields, `minimum_data_status`, `caveat_text`

`decision_class` ∈ `statistically_lower | not_statistically_clear | insufficient_data |
model_warning` (`app/analysis/schemas.py`). Exact field names are pinned by the new
`SiteComparison` type against the live payload during implementation.

## Architecture

Compare-owned components; Analyze untouched; reuse pure helpers and existing CSS.

**Derivation (pure, the testable core)** — `frontend/src/lib/compareVerdict.ts`:
`toCompareVerdict(comparison: SiteComparison): CompareVerdictModel`. Maps the payload to a
view model:
- `rows`: options sorted ascending by `incident_rate`, each `{ rank, optionId, label,
  incidentCount, rate, barFraction (rate ÷ maxRate), multipleOfLowest, relationship }`
  where `relationship ∈ 'lowest' | 'similar' | 'higher' | 'limited'` comes from that
  option's pairwise entry vs the candidate (`statistically_lower` → `higher`;
  `not_statistically_clear` → `similar`; `insufficient_data | model_warning` → `limited`).
- `callout`: `{ kind: 'clear' | 'partial' | 'none' | 'inconclusive', loweredCount N,
  otherCount M, lowestLabel }` — the component builds the sentence from these fields.
  `kind` is decided by a fixed precedence on the **overview** `decision_class` first, so
  the cases can't collide: `statistically_lower` → `clear` (candidate beats all);
  `insufficient_data | model_warning` → `inconclusive` (caveat-led, from `caveat_text` /
  `full_caveat_text`); `not_statistically_clear` → `partial` if N≥1 else `none`. N = count
  of pairwise entries whose `decision_class` is `statistically_lower`; M = total others.
  In `inconclusive`, per-row chips still reflect each pairwise result, so no clear pair is
  hidden — only the headline leads with the caveat.
- Ties in `incident_rate`: stable sort, candidate = first minimum; documented and tested.

**View components** (`frontend/src/components/`):
- `CompareTab.tsx` (rebuilt) — orchestrates: gating (`selected < 2` → existing empty
  state), calls `toCompareVerdict`, renders `CompareVerdict` + `CompareRankedList`, keeps
  the caveat block, MethodsAppendix, copy-link, and layer-aware noun. **Stops reading the
  Analyze `summary` prop** — today's count cards and offense breakdown are derived from it
  (`summary.crime_summaries`); the rebuild drives every number from `comparison` instead.
- `CompareVerdict.tsx` — the callout; renders `clear | partial | none | inconclusive` with
  bounded, layer-aware copy and the neutral/accent tone.
- `CompareRankedList.tsx` — the ranked rows (rank badge, label, bar, rate, `×lowest`,
  relationship chip) with a per-row "How we know" `<details>` exposing the pairwise
  analytics for non-lowest rows and the option stats for the lowest.

**Copy/labels:** reuse `verdictCopy.ts` tone conventions and existing `mc-verdict*` /
`mc-vchip` CSS; add ranked-row classes (`mc-cmp-rank`, `mc-cmp-bar`, …) to the existing
stylesheet. Compare-specific chip labels live in `compareVerdict.ts`.

**Types** (`frontend/src/types.ts`): `SiteComparison`, `SiteComparisonOverview`,
`SiteComparisonOption`, `SitePairwiseResult`, `SiteDecisionClass` — replacing the current
`Record<string, unknown>`.

**Wiring:**
- `frontend/src/api/client.ts` — `comparePlaces` returns `Promise<SiteComparison>`.
- `frontend/src/lib/useCompare.ts` — `comparison: SiteComparison | null` (types today's
  `Record<string, unknown>`). The `versionRef` stale-guard and `applyAssistant` injection
  are preserved unchanged.

## Data flow

`useCompare` POSTs to `/dashboard/compare` (place_ids or inline points, ≥2, layer + offense
filters threaded as today) → response typed as `SiteComparison` → `CompareTab` runs
`toCompareVerdict` → `CompareVerdict` + `CompareRankedList` render. No new network calls.

## States & edge cases

- **< 2 selected:** existing empty state ("Select at least two places to compare…").
- **inconclusive** (`insufficient_data` / `model_warning` overall): caveat-led callout from
  `caveat_text` / `full_caveat_text`; rows still shown ranked, chips `limited` where the
  pairwise says so; nothing highlighted.
- **none** (adequate data, no pair clears the bar): muted "no statistically clear
  difference" callout; ranked rows, all chips `similar`; no "lowest rate" emphasis beyond
  the descriptive rank-1 position.
- **Layer:** nouns follow the global layer via existing `layerCopy` / `incidentNoun`
  (reported / arrests-enforcement / calls-for-service).
- **Shared view (inline points):** works unchanged — the payload is self-contained, so the
  tab no longer depends on a persisted Analyze summary that a `?view=` link doesn't have.

## Testing

- `compareVerdict.test.ts` (pure): clean-sweep → `clear` callout + all-higher chips;
  partial → `partial` N-of-M + mixed chips; none → `none`; insufficient / model_warning →
  `inconclusive`; ascending sort; bar fractions; tie handling; single pairwise (N=2).
- `CompareTab.test.tsx` (rebuilt): renders each callout kind; `< 2` gating; layer-aware
  nouns; per-row "How we know" reveals analytics; copy-link present with a comparison.
- **Invariant test:** rendered compare output across all states contains none of
  `safe|safer|unsafe|dangerous|danger|risk` (case-insensitive), mirroring the compare-summary
  output guard.
- `make test-all` green (pytest + ruff + `npm test` + `npm run build`).

## File structure

- **Create:** `frontend/src/lib/compareVerdict.ts` (+ `.test.ts`),
  `frontend/src/components/CompareVerdict.tsx`,
  `frontend/src/components/CompareRankedList.tsx`.
- **Modify:** `frontend/src/components/CompareTab.tsx` (rebuild) + `CompareTab.test.tsx`,
  `frontend/src/lib/useCompare.ts` (+ test), `frontend/src/api/client.ts`,
  `frontend/src/types.ts`, the Compare CSS block in the existing stylesheet.
- **Docs:** `docs/ROADMAP.md` Phase 5 — record the A→B→C decomposition and mark slice A as
  specced/in-progress.
- **No backend or `app/` changes.**

## Sequencing

Single PR from the `compare-first-flagship` worktree, gated on `make test-all`. Frontend
only. The pure `compareVerdict.ts` is built TDD-first (it holds all the interpretation),
then the components, then the CompareTab rebuild and wiring.

## Follow-ups (out of scope, tracked)

- Fast-follow: cross-address category breakdown (needs a compare-payload extension for
  per-category counts).
- Slice B (compare-owned add/remove-address UX) and slice C (comparison-first landing).
- Per-card sparkline + nearest-incident distance (payload extension).
- Extract a shared verdict kit across Analyze + Compare once this is the second consumer.
