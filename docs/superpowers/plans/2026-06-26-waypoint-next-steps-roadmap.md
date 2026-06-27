# Waypoint Next Steps Roadmap

> **Status — reconciled to `main` 2026-06-27 (post-PR #18).** This supersedes the earlier
> stale drafts (which predated PRs #15–#18). The verbose per-task checklists for the
> *shipped* workstreams have been dropped — the code and the linked PRs are the source of
> truth — leaving an accurate snapshot plus the remaining work.

**Goal:** Take Waypoint from a strong local/demo dashboard to a trustworthy analyst product:
robust assistant, durable analysis provenance, neighborhood-relative statistics, scalable
real-data analysis, clear public-beta boundaries, and (later) live routing.

**Tech stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, SQLite/Postgres+PostGIS, React,
TypeScript, Vite, Vitest, pytest, ruff, and a direct OpenAI-compatible LLM endpoint with
multi-node failover (the LocalAgent SSE gateway is retired).

---

## Progress snapshot

| # | Workstream | Status | Evidence on `main` |
|---|------------|--------|--------------------|
| 1 | Assistant reliability | ✅ Shipped | JSON tolerance in `app/assistant/agent.py`; multi-node failover + thinking control ([PR #12](https://github.com/jcscocca/crime-commute-safety-tool/pull/12)); "interpret, don't restate" ([PR #14](https://github.com/jcscocca/crime-commute-safety-tool/pull/14)). Live smoke is covered by `scripts/live_smoke.py` (Step 9 hits `/assistant/chat`); the separate `live_test_assistant.sh` was never needed. |
| 2 | Analysis run provenance | ✅ Shipped | `AnalysisRun` + migration `0006_analysis_runs.py` |
| 3 | Neighborhood-relative Analyze | ✅ Shipped | `app/analysis/beat_baselines.py`, beats CSV, `MethodsAppendix.tsx`, `POST /dashboard/neighborhood`, `get_neighborhood_analysis` tool ([PR #14](https://github.com/jcscocca/crime-commute-safety-tool/pull/14)). Verdict-methodology QA all fixed: #1/#5 ([PR #17](https://github.com/jcscocca/crime-commute-safety-tool/pull/17)), #2/#3 ([PR #18](https://github.com/jcscocca/crime-commute-safety-tool/pull/18)). |
| 4 | Real-data performance | 🟡 Partial | Public dashboard path filters in SQL (`dashboard_analysis_service.py`); the legacy `_incident_rows` full-table load (`app/services/analysis_service.py`) remains but is internal-gated. |
| 5 | Public-beta hardening | 🟡 Almost done | Legacy surface internal-gated ([PR #13](https://github.com/jcscocca/crime-commute-safety-tool/pull/13)); session required on public routers; geocode proxy ([PR #15](https://github.com/jcscocca/crime-commute-safety-tool/pull/15)); 401-without-session guard ([PR #16](https://github.com/jcscocca/crime-commute-safety-tool/pull/16)). **Only remaining item:** personal-upload consent/caveat copy — bundled with epic A below. |
| 6 | Live routing provider | ⬜ Not started | Only `app/routing/mock_provider.py`; no OpenTripPlanner, no `MCA_ROUTING_PROVIDER`. |

The v1 lean public beta (saved places + neighborhood analysis + Tableau exports on read-only
SPD data) is effectively shippable.

---

## v2 epics (2026-06-26 backlog review)

The remaining work, reframed as epics. A is the headline new feature; B–E harden what shipped.

- **A — Personal data upload.** Google Timeline / CSV / GeoJSON / GPX ingest + consent &
  caveat copy (this absorbs WS5's last item), privacy/retention review, then flip
  `public_enable_personal_uploads`. Scaffolding exists (`app/input_modes.py`
  `personal_timeline` stub behind the flag). **Deferred by the user** — do not build for v1.
- **B — Live routing provider** (= WS6). OpenTripPlanner behind the existing provider
  interface + `MCA_ROUTING_PROVIDER`; keep the mock as the test/local default; wire the
  built-but-unwired route-alternatives surface into the UI.
- **C — Real-data performance** (= WS4). Replace `_incident_rows`' full-table load with
  date/offense/bbox-filtered queries; Python distance checks only on the narrowed set.
  Couples to B — most valuable once B re-surfaces that path.
- **D — Neighborhood verdict methodology** (WS3 follow-up). ✅ **SHIPPED, [PR #18](https://github.com/jcscocca/crime-commute-safety-tool/pull/18)** —
  rest-of-beat baseline (#2) + coherent dual CI/p-value with supplementary exact p (#3),
  engine-wide. Spec: `docs/superpowers/specs/2026-06-26-neighborhood-verdict-methodology-design.md`.
- **E — Roadmap hygiene.** ✅ This document (reconciled to post-#18 `main`).

**Recommended sequence:** D (done) → E (done) → **B + C together** → A (when the user is ready).

---

## Remaining work detail

### B — Live routing provider
- Add `MCA_ROUTING_PROVIDER=mock|opentripplanner` and `MCA_OPENTRIPPLANNER_BASE_URL` to
  `app/config.py` / `.env.example`.
- Implement OpenTripPlanner behind the provider interface in `app/routing/providers.py`
  (new `app/routing/opentripplanner_provider.py`); keep `mock_provider.py` as the default.
- Wire the route-alternatives + statistical route-comparison surface (currently internal-only)
  into the React UI.
- Provider contract tests with mocked HTTP responses.

### C — Real-data performance (do with B)
- Replace `_incident_rows(session)` full-table loading in `app/services/analysis_service.py`
  with query helpers taking date range, offense filters, bounding boxes, optional beat.
- Tests asserting SQL-filtered counts match the current Python implementation for place
  buffers and route corridors. Check/extend indexes (`alembic/versions/0005_crime_filter_idx.py`).

### A — Personal upload (deferred)
- Parsers for Google Timeline JSON, point CSV, GeoJSON, GPX → place clusters.
- User-facing consent + caveat copy before the mode can be enabled (WS5's last item).
- Privacy/retention review; then enable `public_enable_personal_uploads`.

---

## Verification gate

`make test-all` = `pytest` + `ruff check .` + frontend `npm test` + `npm run build`. Run it
before claiming any workstream complete. Work in a dedicated git worktree (concurrent agents).
