# Public capstone (Phase 7) — design

**Date:** 2026-07-09 · **Status:** approved direction, pre-plan.
**Scope:** one strategic direction, three sequenced slices. This is a *phase* design in the
Phase-5 sense: it fixes the goal, the slices, and the cross-cutting decisions; each slice
still gets its own `docs/superpowers/` spec → plan → PR before implementation.

## Why

Phase 6 closed with a clean slate: no open PRs, no open issues, no unchecked roadmap work
beyond two explicitly-deferred items. The next chapter is a strategic choice, not backlog
grooming. Brainstormed 2026-07-09; the decision trail:

| Question | Answer |
|---|---|
| Planning horizon | Strategic direction, not the next work slate |
| Audience a year out | **Portfolio / showcase** — evaluators and readers, not operated-for users |
| Who evaluates it | **Both**: hiring managers (3-minute skim) and technical peers (deep dive) |
| Repo visibility | **Fully public, real history** (subject to the audit contingency below) |
| Sequencing | **Repo-first** (approach A): audit → public repo → hosted demo → write-up |

The showcase framing *replaces* the roadmap's deliberately-unqueued "eventual public
release" pile. Operating a real multi-tenant service (auth, encryption at rest, tenant
isolation, accounts, onboarding) stays unplanned. The capstone's user is a reader/evaluator;
the work is different and mostly smaller.

**Why repo-first:** publishing history is the one irreversible move on the table, so the
audit gets done first and unhurried. Everything later links to the repo, and a demo link is
strictly more impressive when the repo behind it is already open. The trade-off (the flashy
artifact lands last) was weighed against demo-first (audit becomes the rushed final step —
exactly the step not to rush) and write-up-first (risks stalling on prose); both rejected.

## Decisions (brainstormed & approved 2026-07-09)

| Decision | Choice | Rationale |
|---|---|---|
| License | **MIT** | Conventional, zero-friction for a portfolio repo. |
| Public name | **`waypoint`** (GitHub rename from `crime-map-tool`; the repo has already been renamed once from `crime-commute-safety-tool`) | The working names describe the data, not the product, and the original contradicted the invariant ("Safety Tool"). GitHub redirects old URLs. |
| Demo assistant | **Hosted OpenAI-compatible API** via the existing `MCA_LLM_BASE_URL`/`MCA_LLM_MODEL`, with the built-in "analyst offline" state as fallback | The assistant (decision-tree router + deterministic guard) is a differentiator; a demo where the flagship AI feature is permanently offline undercuts the showcase. Cost is dollars/month at demo traffic once rate-limited. No code change — it's config. |
| Demo hosting | **Small VPS running the existing compose stack**, domain + TLS in front | The stack is already proven single-host (healthchecks, backups, Postgres image); no replatforming. |
| History contingency | If the audit finds secrets or personal data, **rewrite history (`git filter-repo`) to redact those blobs**, then publish | Accepted up front: "real history minus redactions" beats a squashed mirror; a clean-copy mirror remains the fallback only if rewrite proves impractical. |

## Slice 1 — Repo goes public

**Goal:** the repo, history and all, is public under `waypoint`, with a README built as the
front door for both evaluator types.

- **History audit (gating item, do first).** Sweep the full git history for:
  (a) **secrets** — committed `.env` files, real values of `MCA_ADMIN_INGEST_TOKEN`,
  session salts/secrets, any API keys; (b) **personal data** — real home/work addresses in
  test fixtures, seed data, docs, soak logs, screenshots, spec/plan prose (this product's
  nature makes the user's own places uniquely sensitive); (c) accidental large/binary
  artifacts. Output: an audit report + a redaction list. Apply the history contingency
  above if the list is non-empty.
- **License:** add MIT `LICENSE`.
- **Rename:** GitHub repo → `waypoint` (old name auto-redirects; local checkouts unaffected).
- **README rebuilt as the front door:** what Waypoint is, the product invariant up top
  (the no-safety-scoring stance is the identity, not a disclaimer), screenshots (light +
  night mode), quickstart, and pointers into `docs/`. This doubles as the first half of the
  slice-3 write-up.
- **Data-terms check:** verify Seattle Open Data / Socrata terms permit redistributing the
  committed seed dataset; adjust or attribute as required.
- **Public CI green:** GitHub Actions lanes (SQLite + Postgres) run and pass publicly;
  badge in the README.

**Invariant checkpoint:** the README and all public-facing copy describe reported-incident
context; no safety language, no rankings.

## Slice 2 — Hosted live demo

**Goal:** a public URL where an evaluator gets the real product in under a minute, at
hobby-tier cost, without operating a user service.

- **Host:** small VPS, existing `docker-compose` stack (backend + Postgres + tiles volume),
  domain + TLS (Caddy or equivalent — decided at spec time).
- **Demo posture:** anonymous sessions as-is; seeded with **fictional/landmark demo places**
  (never the user's real ones); personal uploads stay off (already the flag default);
  `MCA_ADMIN_INGEST_TOKEN` and secrets set properly (prod boot validator already enforces).
- **Rate limiting becomes required work.** The deliberately-deferred limiter (sessions +
  request rates + LLM-call caps) is the one genuinely new backend surface this phase; it
  protects both the box and the hosted-LLM bill. Scoped at slice-spec time.
- **Assistant:** wired to the hosted LLM per the decision above; the existing friendly
  offline state + Retry is the degradation path.
- **Data freshness:** a cron on the box hitting the existing admin-token-gated
  `/admin/crime/ingest/socrata` endpoint; the "Data through <date>" pill keeps staleness
  honest. (The fuller ingest-scheduler + row-correction-upsert item stays deferred.)

**Invariant checkpoint:** demo seed places must not be arranged to imply a ranking or
comparison verdict; demo copy stays in the reported-incident lexicon.

## Slice 3 — The write-up

**Goal:** the deep-dive artifacts for the technical-peer audience.

- **Methodology story:** quasi-Poisson vs. negative binomial settled empirically on real
  SPD data (`docs/analysis/overdispersion-and-rate-intervals.md` is the seed), rest-of-beat
  and multi-beat pooled baselines, BH correction and the selective-inference review, the
  data floors. Publishable as a blog post or long-form repo doc.
- **Product-ethics story:** the invariant (what the product refuses to do and why), the
  deterministic safety-refusal guard (EN/ES, context-scoped), the routes removal decision,
  the arrests de-merge (enforcement ≠ incidence on redacted public data), the privacy
  posture (self-hosted tiles/geocoding — zero external calls). This narrative is rare in
  portfolio projects and is the differentiator.
- README (slice 1) already carries the short version; these are the long versions, linked
  from it. Venue (blog vs. `docs/`) decided at slice-spec time.

**Invariant checkpoint:** the essays *about* refusing to score must themselves never score
— no "which neighborhood won" framing in examples.

## Non-goals (this phase)

- Real authentication, encryption at rest, tenant isolation, user accounts, onboarding —
  the operated-service pile stays unplanned.
- New analytical capabilities (comparative temporal, per-category significance) — candidate
  work for a later slate; the showcase ships on current capability.
- A second city; mobile apps.

## Risks & contingencies

- **Audit findings force a history rewrite** — accepted (decision above); the rewrite is
  done before the repo is ever public, so nothing sensitive is exposed even transiently.
- **SPD/Socrata data terms** — if redistribution of the seed dataset is restricted, ship a
  fetch script instead of committed data (precedent: `fetch_tiles.py`).
- **Demo abuse / cost runaway** — rate limiter is required work in slice 2; payload caps
  already exist; the LLM key is capped at the provider.
- **Public issues/PRs arriving** — a public repo invites drive-by traffic; a CONTRIBUTING
  note setting expectations (showcase project, not seeking contributions) is cheap
  insurance, added in slice 1.

## Sequencing & cadence

Slices land in order (1 → 2 → 3), each via the established cadence: its own spec → plan →
worktree + TDD where code is involved → `make test-all` → PR. Slice 1 and slice 3 are
mostly docs/ops; slice 2 contains the phase's only substantial new code (the rate limiter).
