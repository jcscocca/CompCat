# Waypoint — Roadmap

**Last updated:** 2026-06-29 · **Status:** canonical, living document.
**Verified against:** base commit `d30235b` (feat(frontend): Analyze tab clarity redesign, phase 2, tab 1).

This is the single source of truth for *where Waypoint is going*. It supersedes the dated
drafts under `docs/superpowers/` (`2026-06-26-waypoint-next-steps-roadmap.md`,
`2026-06-26-waypoint-hardening-consolidation-design.md`), which are retained for history.
It was produced from a subsystem-by-subsystem maturity survey of the repo; per-area evidence
lives in the code and the spec/plan pairs under `docs/superpowers/`.

> **Product invariant (the thread through everything below):** Waypoint reports *reported
> incident context*. It MUST NOT score safety or rank places safe/unsafe/dangerous. Every
> phase here has an invariant checkpoint — it is the thing most worth defending as the
> surface grows.

## Where it stands

Waypoint is a **disciplined, low-debt, near-shipped v1**. The analytical core (rate-ratio
engine, neighborhood baselines, exposure model) is genuinely production-grade and well-tested;
the public dashboard, places, geocoding, exports, and the Analyst are all real and wired. A
repo-wide marker sweep found **essentially zero in-code TODO/FIXME debt**. The substantial
Phase 0–3 work has landed: Phase 0 sharp edges are all closed, Phase 2 data and ops items
are shipped, Phase 3 product breadth is mostly done. The remaining work is **Phase 1 invariant
hardening and the Phase 4 public-launch gate**.

## Maturity snapshot

| State | What's here |
|---|---|
| **Production** | Analytical engine + neighborhood stats (overdispersion, BH correction, point-in-polygon beat assignment), places CRUD/bulk/geocoding (Seattle-region-locked), dashboard analyze/compare/incidents, Tableau place-summary + route exports, sessions/tiers, config/secrets validators (salt/secret/admin-token all gated in prod boot), CI (SQLite + Postgres lanes), migrations |
| **Beta-ready** | Assistant (decision-tree router, streaming SSE, friendly offline state + Retry, markdown), Routes/OTP (live OTP + mock fallback, per-leg breakdown, export links), single-host ThinkPad deploy stack, Socrata incremental backfill + data-freshness endpoint, sensitivity-class UI (place creation + exports), personal-upload (enabled on single-host trial, flag-gated elsewhere), seed dataset |
| **Half-baked** | Real-data query perf still has residual full-table paths outside the main summarize path; data-freshness surface exposed via API but not surfaced in the UI; Postgres-in-prod (CI-proven but not long-run validated); MapWorkspace still a 497-line hub (not split into per-tab hooks) |
| **Open — invariant risk** | Safety-refusal guard substantially broadened (broad regex, scans last 8 user turns) but a regex gap lets "rank these places" / "score these areas" bypass it (missing `\s+` inside optional noun clause); no output-side guard test on the assistant response token stream |
| **Deferred** | Production auth / encryption-at-rest / tenant isolation (the public-launch gate) |
| **Deprecated / dead** | LocalAgent gateway + `MCA_LOCALAGENT_BASE_URL`, `statistical-comparisons.csv` public export (removed — was dead surface), ~6 internal duplicate routers (internal-gated, still present) |

---

## Phase 0 — Land the in-flight work & fix the sharp edges
*All items verified shipped as of d30235b.*

- [x] **Merge Routes (PR #29)** + re-validate OTP on the ThinkPad. Shipped in the pre-d30235b history; OTP validated on ThinkPad (per commit 26affce / handoff docs); `MCA_ROUTING_PROVIDER=opentripplanner` live, default remains `mock`. (#29, #39, #49, #52)
- [x] **Fix the half-exposed `statistical-comparisons.csv` export.** Removed entirely (not wired, not discoverable — dead public surface). The `StatisticalComparison` models and `/dashboard/compare` writer still power the live compare feature. (Phase 0 sharp-edges commit, pre-9a654bc)
- [x] **`PlaceForm.test.tsx` jsdom pragma.** `// @vitest-environment jsdom` present on line 1. (Phase 0 sharp-edges commit)
- [x] **Retire the LocalAgent gateway & fix the Analyst docs.** `MCA_LOCALAGENT_BASE_URL`/`LocalAgentClient` absent from `app/` and `README.md`; `app/assistant/llm_client.py` present; `MCA_LLM_BASE_URL` in README. (#50, Phase 0 sharp-edges commit)
- [x] **Gate `MCA_ADMIN_INGEST_TOKEN` in the prod boot validator.** `app/config.py` rejects `DEFAULT_ADMIN_INGEST_TOKEN` (`local-admin-token`) in production via `require_production_secret_overrides`. (Phase 0 sharp-edges commit)

## Phase 1 — Protect the invariant & analytical credibility
*The brand and legal core. Safety-guard hardening and the route-path floor are resolved; the BH candidate-selection review remains.*

- [x] **Harden the safety-refusal guard** — shipped: the object-first regex gap was fixed (#59), and an output-side guard on the model's answer plus broadened ranking/determiner detection landed in #63 (closing #60). Residual synonym-lexicon and non-English breadth is lower-priority follow-up. _(Original analysis, retained for context:)_ The guard was substantially broadened: it is now a broad `re` pattern scanning recent turns (last 8 user messages), not just the latest message. It catches "which block is more dangerous", "how risky", "safest", "unsafe", etc. **However**, a regex gap remains: the `(?:these|those|them|the\s+)?` group is missing a trailing `\s+`, so "rank these places" / "score these areas" (object-before-verb order) bypass it. Fix the `_SAFETY_SCORE_PATTERN` in `app/assistant/agent.py` and add the **output-side guard test** asserting the engine and assistant never emit `safe/unsafe/dangerous/risk` language. (`test_statistical_comparison_service.py` has an output check for compare summaries; there is no analogous test for the assistant response token stream.)
- [x] **Close the rigor asymmetry — route path verified.** `MIN_PLACE_COUNT` / `MIN_COMBINED_COUNT` live in the shared `build_statistical_comparison` engine (`app/analysis/comparison.py`), which **both** `compare_site_options` and `compare_route_request` funnel through — so the route path applies the per-option floor identically; there was no asymmetry. Locked in end-to-end by `tests/test_statistical_comparison_service.py::test_compare_route_request_floors_near_empty_candidate` (a 1-incident candidate corridor is not declared the winner despite a high combined count).
- [ ] **Deferred neighborhood-stats QA:** The candidate-selection-before-BH question is **reviewed and resolved** (#65) — selecting the lowest-rate candidate before BH is a real selective-inference effect, but the decision is conservative by design (must be statistically lower than every alternative, an effect-size floor, and the data floors), so selection alone cannot crown a winner. Documented in `docs/analysis/statistical-route-place-comparison.md` and pinned by a test. Still open: overdispersion small-sample behavior and the multiple-comparison edge cases.
- [x] **Point-in-polygon beat assignment** — `assign_beat` + `load_beat_polygons` (pure-Python ray-casting) implemented in `app/analysis/beat_baselines.py` and wired into `app/services/neighborhood_service.py` (the main analyze path). Also used by assistant tools. Shipped.

## Phase 2 — Data & ops durability
*All items verified shipped as of d30235b.*

- [x] **Crime-data pipeline:** incremental Socrata backfill with paging loop + retry/backoff + watermark (#37); data-freshness/coverage endpoint (ingested snapshot_at, #36); realistic seed dataset + `make seed-crime` (#38). `snapshot_at=2024-01-01` hardcode removed.
- [x] **Query perf (epic C):** `summarize_for_user` replaced with SQL-filtered path (#33). Residual: other full-table paths outside this function are out of scope for this item.
- [x] **Prod-DB confidence:** Postgres CI lane (migrate-to-head + parity smoke, #35); ops hardening (ca-certs, right-sized postgres image, `/health` readiness probe, compose healthcheck, backups, schema ownership, #34); `init_db`/`alembic` race reconciled.
- [x] **Decouple OTP bring-up from Windows** — bash script + compose profile (#39).

## Phase 3 — Product breadth
*Shipped — including the `MapWorkspace` per-tab-hooks split.*

- [x] **Routes UX to parity:** `mc-` components throughout RoutesTab (#40); per-leg corridor breakdown (#40); route Tableau export links surfaced in ExportTab (#40); shared address-search extracted — both `PlaceSearch` (Places) and `RoutesTab` now share the `useAddressSearch` hook (`frontend/src/lib/useAddressSearch.ts`), removing the duplicated geocode state machine (their result rendering legitimately differs — a clickable list vs From/To endpoint options — so only the search state machine is shared).
- [x] **Sensitivity-class UI:** `PlaceForm.tsx` includes a sensitivity selector backed by `SENSITIVITY_OPTIONS`; exports respect the class. This is the "classify/suppress affordance" — v1 scoped to exports (#44).
- [x] **Assistant:** token streaming (SSE via `StreamingResponse`), friendly "analyst offline" degraded state + Retry button, markdown rendering (#42). Failover LLM client also shipped.
- [x] **Frontend cleanup:** ~322 lines trimmed from dead `styles.css` (#41); Analyst panel clamped on mobile (#41); `MapWorkspace` split into per-tab hooks — `useDrawer` / `useDashboardData` / `usePinDraft` / `useAnalyze` / `useCompare` / `useRoutes` under `frontend/src/lib/`, leaving the component a thin coordinating shell (the cross-cutting selection / analysis-context-invalidation / assistant-fan-out glue stays central); behavior-preserving against the existing 12 `MapWorkspace` tests, plus new unit tests for the isolated hooks (#68).
- [x] **Personal-upload disposition decided:** enabled on single-host ThinkPad trial (`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` in `.env.deploy.example` with explicit "keep OFF for shared/public" guardrail), with consent/retention copy in `docs/DEPLOY.md` (#43).
- [x] **Data-freshness indicator:** the dashboard topbar shows a "Data through <date>" pill sourced from `GET /dashboard/freshness` (`frontend/src/components/DataFreshness.tsx`), so users know the shared SPD dataset isn't live.

## Phase 4 — Path to public
*The big gate — prerequisite to move from a ~5-tester internal trial to any public exposure.*

- [ ] **Production authentication, encryption-at-rest, per-user tenant isolation** — explicitly deferred today (identity is a hashed `X-Demo-User-Id`); the single largest gap between trial and product.
- [ ] **Lock down / delete the internal duplicate surface** (~6 mirror routers in `routes_analysis.py`, `routes_routes.py`, `routes_imports.py`, `routes_exports.py`, `routes_dashboard.py`, `routes_places.py`, `routes_crime.py`) and the demo-identity fallback.
- [ ] **Productionize the edge:** TLS/reverse-proxy, HA, backups, observability (metrics/tracing/structured logs), multi-worker serving.

---

## If you pick five things first

Phases 0, 2, and 3 are now done; the safety-guard hardening (#59, #63), the route-path floor, the candidate-selection-before-BH review (#65), the shared address-search extraction, the data-freshness indicator, and the `MapWorkspace` per-tab-hooks split (#68) are all resolved. The remaining work is the Phase 1 stats tail plus the Phase 4 public-launch gate, ordered by invariant risk and leverage:

1. **Neighborhood-stats QA — overdispersion & small-sample review** (the remaining Phase 1 analytical item): confirm the quasi-Poisson behavior and small-period-count handling are sound.
2. **Neighborhood-stats QA — multiple-comparison edge cases**: review the BH behavior at the boundaries (few options, ties, all-insufficient).
3. **Phase 4: production auth / encryption-at-rest / tenant isolation** — the public-launch foundation and the largest trial→product gap.
4. **Phase 4: lock down / delete the internal duplicate surface** (~6 mirror routers) and the demo-identity fallback.
5. **Phase 4: productionize the edge** — TLS/reverse-proxy, backups, and observability (metrics/tracing/structured logs).

## Conventions
- Each unchecked box above is a candidate unit of work; large ones get their own `docs/superpowers/` spec → plan → PR (the established cadence).
- Keep this file current as phases land — it is the one roadmap concurrent agents should read.
