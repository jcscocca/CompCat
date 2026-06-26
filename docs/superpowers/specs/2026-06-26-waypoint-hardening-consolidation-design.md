# Waypoint Hardening & Consolidation — Next-Steps Design

**Status:** Approved in brainstorming — pending spec review
**Date:** 2026-06-26
**Supersedes:** `docs/superpowers/plans/2026-06-26-waypoint-next-steps-roadmap.md` (untracked, now stale — its WS1–WS3 are already shipped)

## Goal

Take Waypoint from "strong local/demo dashboard" to "safe to put in front of more
testers" by closing the real security gaps, removing a duplicate analysis surface, and
making the codebase legible to the several agents working it concurrently. Feature depth
(live routing, deeper statistics) is explicitly deferred.

## Current state (verified 2026-06-26)

The prior 6-workstream roadmap is **three workstreams stale**:

- **Done** — WS1 Assistant reliability (JSON tolerance in `app/assistant/agent.py`,
  `scripts/live_smoke.py`); WS2 Analysis-run provenance (`AnalysisRun` model, migration
  `0006`, summaries scoped to latest run); WS3 Neighborhood-relative Analyze (beat
  baselines, place-vs-beat stats, Methods appendix, verdict blocks).
- **Done** — LLM repoint: the assistant now calls an OpenAI-compatible endpoint directly
  (`OpenAiLlmClient`), retiring the LocalAgent SSE gateway.

### In-flight — out of scope for this design

The `claude/assistant-failover` worktree is actively building **automatic LLM failover
across nodes**, with uncommitted edits to `app/assistant/localagent_client.py`,
`app/api/routes_assistant.py`, `app/config.py`, `docs/DEPLOY.md`, `.env.deploy.example`,
and failover tests. The entire LLM-client / endpoint / model-routing / streaming surface
is owned by that agent. This design does not modify those files and only records
coordination constraints (below).

## Key finding: the legacy analysis surface is built-but-unwired

The frontend API client (`frontend/src/api/client.ts`) calls **only**: `/sessions`,
`/places*`, `/dashboard/{summary,analyze,incidents,compare,neighborhood}`, and
`/assistant/chat`.

It never calls `/analysis/*`, `/routes/*`, `/imports/*`, or `/crime/summarize`. Those
endpoints still have backend tests (route alternatives, statistical comparison, parsers),
so they are not dead code — they are **features behind a parallel API surface that the
map-first dashboard redesign left unwired**. They also still accept an anonymous
**demo-identity fallback** (`current_user_hash` in `app/api/deps.py`), which
`docs/DEPLOY.md` flags as a public-exposure blocker, and the `/analysis/*` path is the one
that loads the entire incident table into Python (`app/services/analysis_service.py`
`_incident_rows` → `select(CrimeIncident).all()`, filtered in `app/analysis/exposure.py`).

This single fact collapses two of the three chosen thrusts (hardening + scale/consolidate)
into one move.

## Decision: internal-gate the unwired surface (Approach A)

**Considered:**

- **A — Internal-gate (chosen).** Mount `/analysis/*`, `/routes/*`, `/imports/*`, and the
  superseded `/crime/*` endpoints under an `/internal/...` prefix, exclude them from the
  OpenAPI schema, and allow the demo-identity fallback *only* there. Retarget their tests.
  → Closes the demo-identity exposure, removes the endpoints from the public attack
  surface, **preserves the features and their tests** for future UI wiring, and confines
  the full-table-load perf cliff to a non-public path. Lowest risk.
- **B — Harden in place.** Require real sessions, keep them public, and do the full
  `exposure.py` SQL-filter rewrite now. → Most work; only justified if these features are
  being wired into the UI imminently, which they are not (feature depth is deferred).
- **C — Delete.** → Destroys the route-alternatives and statistical-comparison work
  (specs, tests, the deferred-not-cancelled live-routing direction). Premature and hard to
  reverse.

Approach A makes hardening, consolidation, and the perf concern the **same change** rather
than three separate efforts, and is exactly what the original WS5 prescribed ("keep demo
identity fallback only under `/internal` endpoints hidden from OpenAPI").

## Resequenced roadmap

### Phase 0 — Foundation (no overlap with the failover agent)

- Confirm a green baseline: `make test-all` on `main`.
- **Branch/worktree prune — done during this brainstorming.** Removed merged worktrees and
  branches `codex/map-first-dashboard-exec`, `frontend-analyze-flexible-drawer`,
  `codex/weekly-visit-denominator`, `docs/map-first-dashboard-redesign`, and the stale
  detached `docker-origin-main` worktree. Left `claude/assistant-failover` (active) and
  `pr-3-review` (one unmerged commit — pending user decision).
- Add a committed **`CLAUDE.md`** capturing the non-obvious project knowledge that
  currently lives only in agent memory: the product invariant ("reports reported incident
  context; never scores or labels safety"), the LLM endpoint env vars
  (`MCA_LLM_BASE_URL` / `MCA_LLM_MODEL`), worktree discipline for concurrent agents, and
  the `make test-all` verification gate.
- Replace the stale `plans/` roadmap with the implementation plan produced from this spec.

### Phase 1 — Consolidate + harden (WS5 + the legacy-surface decision)

**Purpose:** make the public API surface match the privacy/session story in the README and
`DEPLOY.md`.

- Internal-gate the unwired surface (Approach A): move `routes_analysis.py`,
  `routes_routes.py`, `routes_imports.py`, and the superseded `/crime` endpoints behind an
  `/internal` prefix with `include_in_schema=False`; update router registration in
  `app/main.py`; retarget the affected tests to the internal paths.
- Keep `current_user_hash` (demo fallback) **only** on internal endpoints; require
  `required_public_user_hash` on every browser-facing endpoint. Internal-gate
  `/crime/ingest/sample` (currently unauthenticated): it stays unauthenticated but hidden
  under `/internal/`, since it only seeds bundled sample data for dev/test and production
  ingests real data via the token-protected admin endpoint.
- Add a geocoder-provider config path so production does not depend on public Nominatim.
  (Plan must first confirm whether geocoding is server-side or lives in
  `frontend/src/lib/geocoding.ts`, which determines where the provider seam goes.)
- Add user-facing consent/caveat copy gating personal-upload mode.

### Phase 2 — Scale the public path (WS4, now small)

**Purpose:** keep the *public* analysis path fast on a realistic 2018+ SPD window.

- Confirm the dashboard path (`app/services/dashboard_analysis_service.py`) filters by
  date/offense/bounding-box in SQL before materializing rows; add any missing indexes
  (review `alembic/versions/0005_crime_filter_idx.py`); add a perf-regression test on a
  bounded fixture. The internal `/analysis` full-table path is optimized only if/when it
  is wired into the UI.

### Phase 3 — Deferred cleanup (after the failover work merges)

- Remove the vestigial gateway code once `claude/assistant-failover` lands:
  `LocalAgentClient`, the `/api/llm/stream` path, the `localagent_base_url` /
  `assistant_role` config fields (note `assistant_role` is still read in
  `app/assistant/agent.py`, so that reference is cleaned up here too), and the
  `MCA_LOCALAGENT_BASE_URL` compose/env entries. Coordinate — do not pre-empt those files.

### Deferred (feature depth — user's explicit call)

- WS6 live OpenTripPlanner routing provider (mock remains the default).
- Neighborhood-statistics QA: overdispersion, small-sample, and multiple-comparison review
  of the just-landed place-vs-beat methodology.

## Coordination constraints

- **File contention with the failover agent:** Phase 1's edits to `app/config.py`,
  `docs/DEPLOY.md`, and `.env.deploy.example` overlap files the failover agent is editing.
  Land Phase 1's route/auth changes (which touch none of those) first, then rebase the
  config additions after the failover branch merges.
- **Concurrent-agent hygiene:** new work goes in a dedicated worktree, not the main
  checkout, per existing project practice.

## Release strategy

Each phase ships as its own branch/PR, matching the repo's established
workstream-per-PR discipline. Each PR states user-facing behavior change, tests run,
privacy/caveat review if product language changed, and migration/rollback notes if schema
or config changed.

## Risks / open questions

- Internal-gating changes public API paths. The plan must confirm the only consumers of
  `/analysis|/routes|/imports|/crime/summarize` are the test suite (the UI provably does
  not call them; `DEPLOY.md` states the same).
- Geocoding location (frontend vs backend) is unconfirmed and changes the Phase 1
  geocoder-provider scope.
- `pr-3-review` branch is left in place pending a user decision.
