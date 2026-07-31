# CompCat documentation

Canonical, current-state reference for **maintainers and AI agents working this repo**. Each
architecture doc states the commit it was last verified against; when you change a subsystem,
update its doc in the same PR.

## Canonical docs

| Doc | What it covers |
|---|---|
| [Architecture overview](architecture/overview.md) | System map: layers, the public/internal/admin API tiers, the subsystem index, an end-to-end request walkthrough, and the backend↔frontend boundary. **Start here.** |
| [Data model](architecture/data-model.md) | The 11 SQLAlchemy entities, the upload→stop→cluster lifecycle, coordinate generalization, and the Alembic migration approach. |
| [API contract](architecture/api.md) | Auth model (session cookie, demo identity, admin token), the three-tier endpoint reference, the internal-surface invariant, and upload/SSE transport notes. |
| [Assistant / agent design](architecture/assistant.md) | The CompCat Analyst: the single-LLM-call decision-tree turn, the tool toolbox + frontend bridge, deterministic summaries, and the safety-refusal guard. |
| [Run modes](RUN-MODES.md) | Which personal, public-ThinkPad, VPS, or Mac launcher to use; their databases, ports, update behavior, and stop commands. |
| [Roadmap](ROADMAP.md) | Where CompCat is going: a subsystem maturity snapshot and phased work, refreshed against current `main`. |
| [Write-ups](writeups/statistical-methods.md) | The two long-form capstone essays: [statistical methods](writeups/statistical-methods.md) and [product ethics](writeups/product-ethics.md) — the narrative layer over `analysis/`. |

## Also under `docs/`

- **`analysis/`** — durable methodology references for the statistical choices:
  [overdispersion & the per-address rate interval](analysis/overdispersion-and-rate-intervals.md),
  [anchored indexing for the trend overlay](analysis/trend-indexing-method.md),
  [the pairwise/verdict comparison engine](analysis/pairwise-comparison-engine.md),
  [the exposure (denominator) model](analysis/exposure-model.md), the implemented
  [empirical reference-circle comparison](analysis/empirical-reference-circles.md), and the
  [statistical-methods audit (2026-07)](analysis/statistical-methods-audit-2026-07.md).
- **`superpowers/specs/` and `superpowers/plans/`** — point-in-time design specs and
  implementation plans, one pair per feature. A historical record of *how* things were built;
  not a description of current state.
- **`reference/`** — background and source material (the SPD crime-analysis suite).
- **`DEPLOY.md`** — deployment guide for the single-host stack.
- **`DEPLOY-TUNNEL.md`** — public-instance runbook, zero-cost path: compcat.app served from the
  ThinkPad through a named Cloudflare tunnel (no VPS, no published port), with the Cloudflare
  account/zone/tunnel user steps, launch checklist, and an honest account of what it trades.
- **`DEPLOY-VPS.md`** — public-instance runbook, rented-box path: provisioning, hardening, TLS,
  nightly ingest/backup, restore rehearsal, launch checklist and teardown for compcat.app.
- **`IOS.md`** — CompCat on iOS — personal build runbook (Tailscale + Capacitor shell).
