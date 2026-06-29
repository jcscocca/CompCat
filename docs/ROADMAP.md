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
*The brand and legal core. Partially progressed but key items remain open.*

- [ ] **Harden the safety-refusal guard — finish the job.** The guard was substantially broadened: it is now a broad `re` pattern scanning recent turns (last 8 user messages), not just the latest message. It catches "which block is more dangerous", "how risky", "safest", "unsafe", etc. **However**, a regex gap remains: the `(?:these|those|them|the\s+)?` group is missing a trailing `\s+`, so "rank these places" / "score these areas" (object-before-verb order) bypass it. Fix the `_SAFETY_SCORE_PATTERN` in `app/assistant/agent.py` and add the **output-side guard test** asserting the engine and assistant never emit `safe/unsafe/dangerous/risk` language. (`test_statistical_comparison_service.py` has an output check for compare summaries; there is no analogous test for the assistant response token stream.)
- [ ] **Close the rigor asymmetry — verify route path.** The compare path now applies `MIN_PLACE_COUNT` per-option (verified in `app/analysis/comparison.py` line 231). The route-comparison path (`/internal/routes/requests/{request_id}/comparison`) calls `get_route_comparison` whose implementation needs verification that it also applies the floor before declaring a winner on combined count.
- [ ] **Deferred neighborhood-stats QA:** The `benjamini_hochberg` correction runs *after* candidate pairs are assembled and tests run — the uncorrected p-value selects the lowest-rate candidate *before* BH adjustment. This means the winner is chosen on pre-correction signal; review whether this is the intended design or an uncorrected candidate-selection step. Also: overdispersion is modeled (φ stored, correction applied when finite); small-sample behavior and multiple-comparison edge cases remain unreviewed.
- [x] **Point-in-polygon beat assignment** — `assign_beat` + `load_beat_polygons` (pure-Python ray-casting) implemented in `app/analysis/beat_baselines.py` and wired into `app/services/neighborhood_service.py` (the main analyze path). Also used by assistant tools. Shipped.

## Phase 2 — Data & ops durability
*All items verified shipped as of d30235b.*

- [x] **Crime-data pipeline:** incremental Socrata backfill with paging loop + retry/backoff + watermark (#37); data-freshness/coverage endpoint (ingested snapshot_at, #36); realistic seed dataset + `make seed-crime` (#38). `snapshot_at=2024-01-01` hardcode removed.
- [x] **Query perf (epic C):** `summarize_for_user` replaced with SQL-filtered path (#33). Residual: other full-table paths outside this function are out of scope for this item.
- [x] **Prod-DB confidence:** Postgres CI lane (migrate-to-head + parity smoke, #35); ops hardening (ca-certs, right-sized postgres image, `/health` readiness probe, compose healthcheck, backups, schema ownership, #34); `init_db`/`alembic` race reconciled.
- [x] **Decouple OTP bring-up from Windows** — bash script + compose profile (#39).

## Phase 3 — Product breadth
*Mostly shipped. Two items fully done; one (MapWorkspace split) not yet done.*

- [x] **Routes UX to parity:** `mc-` components throughout RoutesTab (#40); per-leg corridor breakdown (#40); route Tableau export links surfaced in ExportTab (#40). Note: `PlaceSearch` (`frontend/src/components/PlaceSearch.tsx`) is used by Places (via MapWorkspace); RoutesTab still uses its own inline `geocodeSearch` prop — the "extract one shared address-search component" sub-item is **not yet done** but the other Routes UX items are shipped.
- [x] **Sensitivity-class UI:** `PlaceForm.tsx` includes a sensitivity selector backed by `SENSITIVITY_OPTIONS`; exports respect the class. This is the "classify/suppress affordance" — v1 scoped to exports (#44).
- [x] **Assistant:** token streaming (SSE via `StreamingResponse`), friendly "analyst offline" degraded state + Retry button, markdown rendering (#42). Failover LLM client also shipped.
- [x] **Frontend cleanup:** ~322 lines trimmed from dead `styles.css` (#41); Analyst panel clamped on mobile (#41). MapWorkspace is still 497 lines — the "split into per-tab hooks" sub-item is **not yet done**.
- [x] **Personal-upload disposition decided:** enabled on single-host ThinkPad trial (`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` in `.env.deploy.example` with explicit "keep OFF for shared/public" guardrail), with consent/retention copy in `docs/DEPLOY.md` (#43).

## Phase 4 — Path to public
*The big gate — prerequisite to move from a ~5-tester internal trial to any public exposure.*

- [ ] **Production authentication, encryption-at-rest, per-user tenant isolation** — explicitly deferred today (identity is a hashed `X-Demo-User-Id`); the single largest gap between trial and product.
- [ ] **Lock down / delete the internal duplicate surface** (~6 mirror routers in `routes_analysis.py`, `routes_routes.py`, `routes_imports.py`, `routes_exports.py`, `routes_dashboard.py`, `routes_places.py`, `routes_crime.py`) and the demo-identity fallback.
- [ ] **Productionize the edge:** TLS/reverse-proxy, HA, backups, observability (metrics/tracing/structured logs), multi-worker serving.

---

## If you pick five things first

Phases 0 and 2 are fully done. Phase 3 is mostly done. The next five, ordered by invariant risk and leverage:

1. **Fix the safety-guard regex gap** (`rank these places` / `score these areas` bypass) + add output-side guard test — `app/assistant/agent.py`. The `(?:these|those|them|the\s+)?` group needs a trailing `\s+`; one-line fix, high invariant value.
2. **Verify route-path `MIN_PLACE_COUNT` floor** — confirm `get_route_comparison` (via `analysis_service.py` → `comparison.py`) applies the per-option incident-count floor before a winner can be declared. The compare path has it; the route path needs confirmation.
3. **Review candidate-selection-before-BH in neighborhood stats** — `comparison.py` selects the lowest-rate candidate before running BH correction; verify this is intentional and document it.
4. **Extract shared address-search component for Routes** — `RoutesTab` still has its own inline `geocodeSearch` prop; `PlaceSearch` component exists but is only used by Places via MapWorkspace.
5. **Data-freshness surface in the UI** — the freshness endpoint exists; expose the "data through <date>" indicator in the dashboard so users know what window they're looking at.

## Conventions
- Each unchecked box above is a candidate unit of work; large ones get their own `docs/superpowers/` spec → plan → PR (the established cadence).
- Keep this file current as phases land — it is the one roadmap concurrent agents should read.
