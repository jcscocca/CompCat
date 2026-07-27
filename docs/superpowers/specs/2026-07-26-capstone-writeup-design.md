# Capstone write-up (Phase 7, Slice 3) — design

**Date:** 2026-07-26 · **Status:** approved design, pre-plan.
**Parent:** `2026-07-09-public-capstone-design.md` (Slice 3). Closing this slice closes Phase 7.

## Why

Phase 7 built the showcase: the repo is public (Slice 1), the demo is spin-uppable on demand
(Slice 2, revised), and the README carries the short version of both stories. Slice 3 is the
deep-dive layer for the technical-peer audience — the long-form pieces the README links to.
The capstone spec deferred venue and shape to this spec.

## Decisions (brainstormed & approved 2026-07-26)

| Decision | Choice | Rationale |
|---|---|---|
| Venue | **Repo `docs/writeups/`** (new directory) | Zero external infrastructure; PR-reviewable; evaluators already arrive at the repo. Written so either essay can be cross-posted to a blog later without rework. |
| Structure | **Two essays** | Matches the parent spec's two stories; each targets a different reader mood; both linked from the README. |
| Voice | **First person** | The essays are the author's decision trail; evaluators are assessing the author. The ethics narrative especially reads better as personal conviction than corporate policy. |
| Evidence | **Prose + existing numbers** | Reuse the tables/numbers already pinned in `docs/analysis/` and the existing dashboard screenshots. No new figures, scripts, or data-pipeline work. |
| Length | **~2,000–3,000 words each** | A 10–15 minute read a technical peer will finish. Deep detail stays in the linked `docs/analysis/` references; the essay is the narrative layer. |
| Architecture | **Decision-trail spine + question headings** | Each essay is a chronological chain of decisions with the evidence that forced them; each section is headed by the skeptical-peer question it answers (skimmability without Q&A fragmentation). Chosen over pure Q&A (fragments the argument) and a systems tour (duplicates `docs/analysis/`, reads as documentation). |

## Deliverables

Two files under a new `docs/writeups/`. Filenames are plain; each essay's H1 title is
evocative and chosen at drafting time (reviewed with the essay itself).

### `docs/writeups/statistical-methods.md` — the methodology story

Decision-trail outline (question headings; each section links its `docs/analysis/` reference):

1. **Why can't you just count incidents?** — the exposure/denominator problem
   (`docs/analysis/exposure-model.md`).
2. **Compared to what?** — rest-of-beat as the honest local baseline, then the multi-baseline
   ladder (MCPP / beat / sector / city).
3. **Is Poisson enough?** — overdispersion in real SPD data; quasi-Poisson vs. negative
   binomial settled empirically — the mean–variance relationship is linear, not quadratic
   (`docs/analysis/overdispersion-and-rate-intervals.md`).
4. **How do you avoid crowning a winner by chance?** — BH correction and the
   selective-inference review; why the decision rule is conservative by design
   (`docs/analysis/pairwise-comparison-engine.md`).
5. **When should the answer be "not enough data"?** — data floors, model warnings,
   t-quantile intervals, suppression rules.
6. **Close:** what the numbers still can't say — hands off to the ethics essay.

### `docs/writeups/product-ethics.md` — the product-ethics story

1. **Why refuse the thing users most want?** — the no-safety-scoring invariant as product
   identity, not disclaimer.
2. **How do you make an LLM refuse reliably?** — the deterministic EN/ES context-scoped
   guard, the output-side guard, the streamed-narration holdback; accepted fail-safe
   over-refusals.
3. **Why delete a shipped feature?** — the routes removal and the address-first pivot.
4. **Why split arrests from crime reports?** — enforcement ≠ incidence on redacted public
   data; the de-merge and the double-count fix.
5. **What does privacy-first mean concretely?** — zero third-party requests (self-hosted
   tiles/fonts, proxied geocoding), generalized coordinates in exports and share links,
   personal uploads off by default with delete-everything.
6. **Close:** what refusing buys — context a reader can trust.

## Integration (same PR)

- **README:** links to both essays adjacent to the invariant callout.
- **`docs/README.md`:** a Write-ups row in the canonical-docs table.
- **`docs/ROADMAP.md`:** Slice 3 checked; Phase 7 noted closed.

## Invariant checkpoint

The essays *about* refusing to score must themselves never score: no safe/unsafe/dangerous
language applied to any real place, no "which neighborhood won" framing in examples. Examples
use the reported-incident lexicon (rates, intervals, counts) or fictional placeholders. This
is checked explicitly in review before the PR merges.

## Process & verification

- Established cadence: this spec → implementation plan → worktree (`phase7-writeup`, cut from
  `origin/main`) → subagent-drafted essays → review → PR.
- Docs-only slice: `make test-all` must stay green (unchanged code), plus a manual pass over
  every added link and an invariant read of both essays.
- The essays' factual claims (numbers, dataset ids, migration history, guard behavior) must
  be checked against the current code and `docs/analysis/` — no claims from memory.

## Non-goals

- Blog cross-posting (essays are written to permit it later; not done in this slice).
- New figures, plots, scripts, or analytical work.
- Any product or code change beyond the three integration edits above.
