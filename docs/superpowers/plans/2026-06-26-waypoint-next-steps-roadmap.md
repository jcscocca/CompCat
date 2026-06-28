# Waypoint Next Steps Roadmap

> **Status — reconciled to `main` 2026-06-28 (post-PR #44).** The original v2 program
> (WS1–WS6 / epics A–E) is fully shipped, and personal uploads are now **enabled** on the
> single-host trial (PR #43). The verbose per-task checklists for the *shipped* workstreams
> have been dropped — the code and the linked PRs are the source of truth. (This pass covers
> the epic/status reconciliation; the broader phase2/phase3 changes — DB image, ops hardening,
> assistant/UI polish — live in their own PRs and aren't itemized here.)

**Goal:** Take Waypoint from a strong local/demo dashboard to a trustworthy analyst product:
robust assistant, durable analysis provenance, neighborhood-relative statistics, scalable
real-data analysis, clear public-beta boundaries, and live routing.

**Tech stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, SQLite/Postgres, React,
TypeScript, Vite, Vitest, pytest, ruff, and a direct OpenAI-compatible LLM endpoint with
multi-node failover (the LocalAgent SSE gateway is retired).

---

## Progress snapshot

| # | Workstream | Status | Evidence on `main` |
|---|------------|--------|--------------------|
| 1 | Assistant reliability | ✅ Shipped | JSON tolerance in `app/assistant/agent.py`; multi-node failover + thinking control ([PR #12](https://github.com/jcscocca/crime-commute-safety-tool/pull/12)); "interpret, don't restate" ([PR #14](https://github.com/jcscocca/crime-commute-safety-tool/pull/14)). Live smoke is covered by `scripts/live_smoke.py` (Step 9 hits `/assistant/chat`); the separate `live_test_assistant.sh` was never needed. |
| 2 | Analysis run provenance | ✅ Shipped | `AnalysisRun` + migration `0006_analysis_runs.py` |
| 3 | Neighborhood-relative Analyze | ✅ Shipped | `app/analysis/beat_baselines.py`, beats CSV, `MethodsAppendix.tsx`, `POST /dashboard/neighborhood`, `get_neighborhood_analysis` tool ([PR #14](https://github.com/jcscocca/crime-commute-safety-tool/pull/14)). Verdict-methodology QA all fixed: #1/#5 ([PR #17](https://github.com/jcscocca/crime-commute-safety-tool/pull/17)), #2/#3 ([PR #18](https://github.com/jcscocca/crime-commute-safety-tool/pull/18)). |
| 4 | Real-data performance | ✅ Shipped | `app/services/incident_query_service.py` (bbox + SQL date/offense prefilter) replaced the full-table `CrimeIncident` loads — site, route-corridor, route-context — so the legacy `_incident_rows` load is gone; `exposure.py`/`context.py` unchanged ([PR #20](https://github.com/jcscocca/crime-commute-safety-tool/pull/20)). |
| 5 | Public-beta hardening | ✅ Shipped | Legacy surface internal-gated ([PR #13](https://github.com/jcscocca/crime-commute-safety-tool/pull/13)); session required on public routers; geocode proxy ([PR #15](https://github.com/jcscocca/crime-commute-safety-tool/pull/15)); 401-without-session guard ([PR #16](https://github.com/jcscocca/crime-commute-safety-tool/pull/16)). The last item — personal-upload consent/caveat copy — shipped with epic A ([PR #21](https://github.com/jcscocca/crime-commute-safety-tool/pull/21)). |
| 6 | Live routing provider | ✅ Shipped | OTP2 GTFS GraphQL provider (`app/routing/opentripplanner_provider.py`), `MCA_ROUTING_PROVIDER`/`MCA_OPENTRIPPLANNER_BASE_URL` config (mock stays default), route UI (`RoutesTab.tsx` + map polylines + public `/routes/*`) — [PR #20](https://github.com/jcscocca/crime-commute-safety-tool/pull/20)→[#26](https://github.com/jcscocca/crime-commute-safety-tool/pull/26), [#22](https://github.com/jcscocca/crime-commute-safety-tool/pull/22). Phase 2 added an optional `otp` compose service + `scripts/otp_setup.sh`. Not yet run against a live OTP server. |

The v1 lean public beta (saved places + neighborhood analysis + Tableau exports on read-only
SPD data) is complete, and the v2 epics below have since shipped on top of it.

---

## v2 epics (2026-06-26 backlog review)

The work, reframed as epics — **all now shipped**. A was the headline new feature; B–E hardened
what shipped.

- **A — Personal data upload.** Google Timeline / CSV / GeoJSON / GPX ingest + consent &
  caveat copy (this absorbs WS5's last item), privacy/retention review, then flip
  `public_enable_personal_uploads`. **Update (2026-06-28): SHIPPED + merged** — real parsers,
  consent/caveat copy, retention (discard-raw), delete control, UI gating, and tests all
  exist behind `public_enable_personal_uploads` (the anti-rot CI guard is
  `tests/test_uploads_api.py`). Disposition decided: **enabled on the single-host ThinkPad
  trial** (see `.env.deploy.example` / docs/DEPLOY.md), kept OFF for any multi-user/public
  deploy pending production auth + encryption-at-rest + tenant isolation.
- **B — Live routing provider** (= WS6). ✅ **Shipped.** OTP2 GTFS GraphQL provider behind the
  interface + `MCA_ROUTING_PROVIDER` (mock stays default), route-alternatives surface wired into
  the UI ([PR #20](https://github.com/jcscocca/crime-commute-safety-tool/pull/20)→[#26](https://github.com/jcscocca/crime-commute-safety-tool/pull/26), [#22](https://github.com/jcscocca/crime-commute-safety-tool/pull/22)). Phase 2 added an optional `otp` compose service +
  `scripts/otp_setup.sh`. **Open:** stand up a live OTP2 instance and smoke-test the provider
  (fixture-validated only so far).
- **C — Real-data performance** (= WS4). ✅ **Shipped, [PR #20](https://github.com/jcscocca/crime-commute-safety-tool/pull/20).** `incident_query_service.py`
  replaced `_incident_rows`' full-table load with bbox + SQL date/offense-filtered queries;
  Python distance checks run only on the narrowed set, and `exposure.py`/`context.py` are
  unchanged so results match.
- **D — Neighborhood verdict methodology** (WS3 follow-up). ✅ **SHIPPED, [PR #18](https://github.com/jcscocca/crime-commute-safety-tool/pull/18)** —
  rest-of-beat baseline (#2) + coherent dual CI/p-value with supplementary exact p (#3),
  engine-wide. Spec: `docs/superpowers/specs/2026-06-26-neighborhood-verdict-methodology-design.md`.
- **E — Roadmap hygiene.** ✅ This document (first reconciled post-#18 in [PR #19](https://github.com/jcscocca/crime-commute-safety-tool/pull/19); refreshed 2026-06-28 to post-#44 — B/C/WS rows + uploads-enabled).

**Sequence (all delivered):** D → E → **B + C together** → A (shipped, and enabled on the
single-host trial). The build is complete; the one open item is standing up a live OTP2
instance for epic B.

---

## Epic detail (all shipped — kept as the build record)

### B — Live routing provider ✅ shipped
- `MCA_ROUTING_PROVIDER` (default `mock`) + `MCA_OPENTRIPPLANNER_BASE_URL` /
  `MCA_OPENTRIPPLANNER_TIMEOUT_S` in `app/config.py` / `.env.example`.
- `app/routing/opentripplanner_provider.py` behind the provider interface in
  `app/routing/providers.py`; `mock_provider.py` stays the default. OTP2 GTFS GraphQL
  ([PR #26](https://github.com/jcscocca/crime-commute-safety-tool/pull/26)).
- Route-alternatives + statistical route-comparison surface wired into the React UI
  (`RoutesTab.tsx`, map polylines) over public `/routes/*` ([PR #22](https://github.com/jcscocca/crime-commute-safety-tool/pull/22)).
- Provider contract tests with mocked httpx. Phase 2 added an optional `otp` compose service +
  `scripts/otp_setup.sh`. **Not yet run against a live OTP2 server** — that (plus a smoke test)
  is the one open item.

### C — Real-data performance ✅ shipped ([PR #20](https://github.com/jcscocca/crime-commute-safety-tool/pull/20))
- `app/services/incident_query_service.py` replaced the `_incident_rows` full-table load with
  bbox + SQL date/offense-filtered queries across all three call sites; `_incident_rows` is gone.
- Python distance checks run only on the narrowed set; `exposure.py`/`context.py` unchanged, so
  results are identical. Filter indexes in `alembic/versions/0005_crime_filter_idx.py`.

### A — Personal upload (SHIPPED 2026-06-28; enabled on the single-host trial)
- ✅ Parsers for Google Timeline JSON, point CSV, GeoJSON, GPX → place clusters.
- ✅ User-facing consent + caveat copy.
- ✅ Privacy/retention (discard-raw default) + delete control.
- ✅ `public_enable_personal_uploads` enabled for the ThinkPad single-host trial only; stays
  off for multi-user/public until production auth + encryption-at-rest + tenant isolation.

---

## Verification gate

`make test-all` = `pytest` + `ruff check .` + frontend `npm test` + `npm run build`. Run it
before claiming any workstream complete. Work in a dedicated git worktree (concurrent agents).
