# Waypoint — Roadmap

**Last updated:** 2026-06-30 · **Status:** canonical, living document.
**Verified against:** base commit `237e603` (Seattle 911 Call Data edition — two-layer incident context, #76).

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
repo-wide marker sweep found **essentially zero in-code TODO/FIXME debt**. All of the
planned Phase 0–3 work has now landed — the sharp edges, the analytical-invariant hardening,
the data/ops durability, and the product-breadth items are all closed. No queued work remains.

## Maturity snapshot

| State | What's here |
|---|---|
| **Production** | Analytical engine + neighborhood stats (overdispersion, BH correction, point-in-polygon beat assignment), places CRUD/bulk/geocoding (Seattle-region-locked), dashboard analyze/compare/incidents, Tableau place-summary + route exports, sessions/tiers, config/secrets validators (salt/secret/admin-token all gated in prod boot), CI (SQLite + Postgres lanes), migrations |
| **Beta-ready** | Assistant (decision-tree router, streaming SSE, friendly offline state + Retry, markdown), Routes/OTP (live OTP + mock fallback, per-leg breakdown, export links), single-host ThinkPad deploy stack, Socrata incremental backfill + data-freshness endpoint, sensitivity-class UI (place creation + exports), personal-upload (enabled on single-host trial, flag-gated elsewhere), seed dataset |
| **Half-baked** | Real-data query perf still has residual full-table paths outside the main summarize path; Postgres-in-prod (CI-proven but not long-run validated) |
| **Open — invariant risk** | Safety-refusal guard hardened (object-first regex gap fixed #59; output-side guard + broadened ranking/determiner detection #63; English colloquial lexicon + Spanish arm added, H4; H4 follow-up: context-scoped into unambiguous + ambiguous + place-context patterns — closes proper-noun colloquial false-positives, Spanish colloquials, `mal barrio` both word orders, avoid/evitar, rank-verb punctuation, `centro`/`esquina` EN/ES parity). Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching); accepted fail-safe over-refusal on Spanish "estoy seguro de X + place" (regex can't separate epistemic from physical *seguro*) — deferred/accepted |
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
*The brand and legal core — all items resolved: safety-guard hardening, the route-path floor, and the full neighborhood-stats QA.*

- [x] **Harden the safety-refusal guard** — shipped: the object-first regex gap was fixed (#59), and an output-side guard on the model's answer plus broadened ranking/determiner detection landed in #63 (closing #60). Residual synonym-lexicon and non-English breadth is lower-priority follow-up. _(Original analysis, retained for context:)_ The guard was substantially broadened: it is now a broad `re` pattern scanning recent turns (last 8 user messages), not just the latest message. It catches "which block is more dangerous", "how risky", "safest", "unsafe", etc. **However**, a regex gap remains: the `(?:these|those|them|the\s+)?` group is missing a trailing `\s+`, so "rank these places" / "score these areas" (object-before-verb order) bypass it. Fix the `_SAFETY_SCORE_PATTERN` in `app/assistant/agent.py` and add the **output-side guard test** asserting the engine and assistant never emit `safe/unsafe/dangerous/risk` language. (`test_statistical_comparison_service.py` has an output check for compare summaries; there is no analogous test for the assistant response token stream.)
- [x] **Close the rigor asymmetry — route path verified.** `MIN_PLACE_COUNT` / `MIN_COMBINED_COUNT` live in the shared `build_statistical_comparison` engine (`app/analysis/comparison.py`), which **both** `compare_site_options` and `compare_route_request` funnel through — so the route path applies the per-option floor identically; there was no asymmetry. Locked in end-to-end by `tests/test_statistical_comparison_service.py::test_compare_route_request_floors_near_empty_candidate` (a 1-incident candidate corridor is not declared the winner despite a high combined count).
- [x] **Neighborhood-stats QA — complete:** The candidate-selection-before-BH question is reviewed and resolved (#65) — selecting the lowest-rate candidate before BH is a real selective-inference effect, but the decision is conservative by design (must be statistically lower than every alternative, an effect-size floor, and the data floors), so selection alone cannot crown a winner. The overdispersion/small-sample handling and the multiple-comparison edge cases are now resolved too (#69): the small-sample dispersion limitation is documented in `docs/analysis/statistical-route-place-comparison.md`, and tests pin the single-period `model_warning` guard, single/empty BH (no over-correction), and the multi-place BH-adjusted-p alignment.
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

## Phase 4 — Harden & polish + new capabilities
*The next slate, chosen 2026-06-29. Worked one item at a time per Conventions.*

**Harden & polish**
- [x] **H1 · Query-perf sweep** — shipped (lean): a query audit found the main public incident paths already bbox+date+category SQL-filtered (the audit's `_beat_incidents` flag was a false positive — its whole-beat load is the rest-of-beat baseline). The one genuine full-table-on-every-load path, `crime_data_freshness`, is now TTL-cached in-process (#73). Deferred: ingest stats-row/watermark; real spatial index (R*Tree/PostGIS).
- [ ] **H2 · Long-run Postgres validation** — exercise the prod stack on Postgres under sustained/load conditions beyond the CI parity smoke.
- [x] **H3 · Address-search polish** — shipped (#72): debounced type-ahead with stale-request abort, first-class empty/error states with shared copy, a shared localStorage recent-places history (Places dropdown + Routes From/To options), and a client-side Seattle-bbox guard. Result ranking dropped (no relevance metadata). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-29-address-search-polish*`.
- [x] **H4 · Assistant guard breadth** — shipped: broadened the deterministic guard's English lexicon with colloquial place-character terms (`sketchy`/`shady`/`dodgy`/`seedy`/`scary`/`frightening`/`ghetto`, plus their comparative/superlative forms) and English rank-verb inflections (`ranking`/`rated`/`scoring`), and added a Spanish mirror of both arms — safety lexicon (`seguro`/`peligroso`/`riesgo`/… + the `-idad` nouns `seguridad`/`inseguridad`/`peligrosidad`) + rank-verb→place-noun including Latin-American place nouns (`colonia`/`vecindario`/`sector`/`distrito`/`manzana`/`avenida`), accent-tolerant. Event/offense descriptors (`violent`/`threatening`/`menacing`) stay excluded as legitimate incident context. **Follow-up (context-scoping) shipped:** the single regex was split into three cooperating patterns (`_UNAMBIGUOUS_SAFETY_PATTERN`, `_AMBIGUOUS_TERM_PATTERN`, `_PLACE_CONTEXT_PATTERN`) gated by `_contains_safety_ranking` — ambiguous terms trip only when a place-context word co-occurs. Closes: proper-noun colloquial false-positives (`Shady Grove Ave`, `Warsaw Ghetto`), Spanish colloquials (`tranquilo`/`conflictivo`/`problemático`), `mal barrio`/`barrio malo` (both word orders), `avoid`/`evitar` + place (both word orders, all `evitar` inflections), rank-verb-then-punctuation, and `centro`/`esquina` EN/ES parity. Regex can't reliably separate epistemic Spanish "estoy seguro de X" from physical "seguro en X", so an epistemic-strip was attempted then reverted; the guard accepts a fail-safe over-refusal on "estoy seguro de X + place" (bare epistemic without a place word still reaches the model). _Deferred candidates (not scheduled): (a) reverse H4's English `bad`/`good`/`worst`/`rough` exclusion so English "bad neighborhood" is caught symmetrically with Spanish `mal barrio` (needs a false-positive review — `worst`/`best` collide with "which route is best"); (b) extend the rank-arm place nouns beyond the current list (`zip code`/`district`/`precinct`/`town`/`county`/`park`)._ Spec/plan: `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-breadth*` and `…/2026-07-01-assistant-guard-context-scoping*`.

**New capabilities**
- [x] **C1 · Temporal analysis** — descriptive hour-of-day + day-of-week incident profiles around a place, with a travel-window highlight, on the Analyze tab. Pure `app/analysis/temporal.py` wired into the analyze path; `offense_start_utc` read as naive Seattle local. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-29-temporal-analysis*`.
- [x] **C2 · Incident category breakdown** — shipped: `_category_breakdown` replaces `type_mix`; each subcategory shows place-share vs rest-of-beat share (null when no baseline), top-6 + "Other"; descriptive (no per-category significance — deferred); renders on the Analyze tab for baseline-available and degraded places alike. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-29-category-breakdown*`.
- [x] **C3 · Saved views** — increment 1 shipped (#78): durable, shareable `?view=` links
  for **Analyze & Compare** that recompute on open and store nothing new server-side. Enabled by
  making analyze/compare/incidents/neighborhood accept inline `points` (Seattle-bbox-validated,
  ≤10) as an alternative to identity-bound `place_ids`; the points path is stateless (no
  `AnalysisRun`/`PlaceCrimeSummary` write). Links carry only generalized (~110 m) coordinates; no
  account. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-30-saved-views*`. _Increment 2
  shipped: **Routes saved views** — the shareable `?view=` link now covers the Routes corridor
  tab. A routes view carries generalized (~110 m) origin/destination coordinates + mode + settings
  and recomputes the corridor comparison once on open. Frontend-only (the routes backend already
  accepts inline coordinate endpoints); saved-place endpoints are resolved to generalized
  coordinates so no `place_id` enters the link. Unlike inc 1's stateless points path, a shared
  routes view recomputes via `/routes/alternatives` and persists a `RouteRequest` under the
  opener's session — accepted, since that is normal Routes usage. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-02-routes-saved-views*`._
- [x] **C4 · Second data source** — shipped across two increments. **Inc 1 (#75):** a
  source-aware crime layer (queries / freshness / backfill watermark all default to SPD
  reports, so existing analyses are unchanged) plus SPD **Arrest Data** (`9bjs-7a7w`) ingest
  tagged `source_dataset="seattle_spd_arrests"` — backend only, demographics not ingested.
  **Inc 2 (#76):** SPD **911 Call Data** (`33kz-ixgy`) as a **two-layer** model — a *Reported
  incidents* layer (crime + arrests, unioned) vs a *911 calls* layer (calls for service),
  mutually exclusive, chosen with a global top-bar toggle that every incident-context surface
  (Analyze / Compare / Routes / Assistant / exports / freshness) follows; `AnalysisRun` /
  `PlaceCrimeSummary` / `RouteRequest` carry a `layer` column (migrations `0009`/`0010`). Calls
  are framed everywhere as *requests for service, not confirmed incidents* (LLM prompt +
  semantic layer + UI, test-pinned), and the safety-refusal guard is untouched / layer-independent.
  Spec/plan (inc 1): `docs/superpowers/{specs,plans}/2026-06-29-second-source-arrests-foundation*`.
  _Arrests enforcement-lens **shipped** as a de-merged third layer: `reported` is now SPD
  crime reports only, and arrests are a disjoint, clearly-labeled `arrests` layer (Reported /
  Arrests / Calls) framed everywhere as *enforcement activity, not reported incidents*
  (assistant prompt + caveats, toggle, Analyze note + "Charge" column, freshness/copy). This
  fixes the prior reported-layer double-count (a crime report and its resulting arrest — which
  may share a `report_number` — were both counted) and the enforcement-vs-incidence conflation;
  on the public (redacted) data an arrest can't be linked back to its crime, so the union was
  never sound there. One-line `LAYERS` change (validation/freshness/queries auto-propagate) +
  framing copy; no DB migration. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-02-arrests-third-layer*`. The `CALLS_DATA_FLOOR`
  fixed-date drift is **fixed**: the 911 floor is now a rolling first-of-month, 24-month window
  computed per ingest run (`calls_data_floor`, `app/crime/seattle_socrata.py`), so it no longer
  drifts past 24 months (spec/plan `…/2026-07-02-calls-floor-rolling*`). Still deferred: the
  arrest↔crime **taxonomy crosswalk** (unify arrest NIBRS descriptions with crime categories)
  and arrest demographics (not ingested)._

> Deferred temporal follow-ups (after C1): comparative/baseline temporal (rate-ratio per bucket), route corridor-temporal, an assistant temporal tool, and renaming the misnamed `offense_start_utc` column (holds local time) — a separate migration.

## Conventions
- Each unchecked box above is a candidate unit of work; large ones get their own `docs/superpowers/` spec → plan → PR (the established cadence).
- Keep this file current as phases land — it is the one roadmap concurrent agents should read.

---

> **Eventual public release — a note, not planned work.** A public release is the intended
> *final* step for Waypoint, but it is **not on the roadmap as planned work** and has **no
> date**. If it is ever pursued it would require substantial work that is deliberately *not*
> queued above: production hardening (real authentication, encryption at rest, per-user tenant
> isolation, a locked-down edge surface) and product polish (real OTP routing in place of the
> mock, user accounts with cross-session persistence, first-run onboarding, automated SPD data
> refresh, address-search polish). None of this is scheduled. Until then — and for the
> foreseeable future — Waypoint stays a disciplined, low-debt internal-trial v1.
