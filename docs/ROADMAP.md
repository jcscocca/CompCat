# CompCat — Roadmap

**Last updated:** 2026-07-09 · **Status:** canonical, living document.
**Verified against:** base commit `5fe1da0` (routes removal — backend excision + migration 0012).

This is the single source of truth for *where CompCat is going*. It supersedes the dated
drafts under `docs/superpowers/` (`2026-06-26-waypoint-next-steps-roadmap.md`,
`2026-06-26-waypoint-hardening-consolidation-design.md`), which are retained for history.
It was produced from a subsystem-by-subsystem maturity survey of the repo; per-area evidence
lives in the code and the spec/plan pairs under `docs/superpowers/`.

> **Product invariant (the thread through everything below):** CompCat reports *reported
> incident context*. It MUST NOT score safety or rank places safe/unsafe/dangerous. Every
> phase here has an invariant checkpoint — it is the thing most worth defending as the
> surface grows.

> **Removed: Routes (2026-07).** The routes/commute feature (shipped #29, saved views #81,
> divergent corridors #87–#90) was removed in 2026-07. Its premise — comparing routes between
> areas — was retired in favor of the address-first product: look up an address, compare
> candidate addresses. Shipped-history entries below are kept and marked `(removed 2026-07)`
> rather than deleted; see git history and
> `docs/superpowers/specs/2026-07-03-routes-removal-design.md`.

## Where it stands

CompCat is a **disciplined, low-debt, near-shipped v1**. The analytical core (rate-ratio
engine, neighborhood baselines, exposure model) is genuinely production-grade and well-tested;
the public dashboard, places, geocoding, exports, and the Analyst are all real and wired. A
repo-wide marker sweep found **essentially zero in-code TODO/FIXME debt**. All of the
planned Phase 0–3 work has now landed — the sharp edges, the analytical-invariant hardening,
the data/ops durability, and the product-breadth items are all closed. No queued work remains.

## Maturity snapshot

| State | What's here |
|---|---|
| **Production** | Analytical engine + neighborhood stats (overdispersion, BH correction, point-in-polygon beat assignment), places CRUD/bulk/geocoding (Seattle-region-locked), dashboard analyze/compare/incidents, Tableau place-summary export, sessions/tiers, config/secrets validators (salt/secret/admin-token all gated in prod boot), CI (SQLite + Postgres lanes), migrations |
| **Beta-ready** | Assistant (decision-tree router, streaming SSE, friendly offline state + Retry, markdown), single-host ThinkPad deploy stack, Socrata incremental backfill + data-freshness endpoint, sensitivity-class UI (place creation + exports), personal-upload (enabled on single-host trial, flag-gated elsewhere), seed dataset |
| **Half-baked** | Real-data query perf still has residual full-table paths outside the main summarize path; Postgres-in-prod (CI-proven; soak harness now available — H2, `docs/soak-testing.md` — but the multi-hour run itself is still pending) |
| **Open — invariant risk** | Safety-refusal guard hardened (object-first regex gap fixed #59; output-side guard + broadened ranking/determiner detection #63; English colloquial lexicon + Spanish arm added, H4; H4 follow-up: context-scoped into unambiguous + ambiguous + place-context patterns — closes proper-noun colloquial false-positives, Spanish colloquials, `mal barrio` both word orders, avoid/evitar, rank-verb punctuation, `centro`/`esquina` EN/ES parity). Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching); accepted fail-safe over-refusal on Spanish "estoy seguro de X + place" (regex can't separate epistemic from physical *seguro*) — deferred/accepted |
| **Deprecated / dead** | LocalAgent gateway + `MCA_LOCALAGENT_BASE_URL`, `statistical-comparisons.csv` public export (removed — was dead surface), ~6 internal duplicate routers (internal-gated, still present) |

---

## Phase 0 — Land the in-flight work & fix the sharp edges
*All items verified shipped as of d30235b.*

- [x] **Merge Routes (PR #29)** — shipped, then **removed 2026-07** (see the removal note above). (#29, #39, #49, #52)
- [x] **Fix the half-exposed `statistical-comparisons.csv` export.** Removed entirely (not wired, not discoverable — dead public surface). The `StatisticalComparison` models and `/dashboard/compare` writer still power the live compare feature. (Phase 0 sharp-edges commit, pre-9a654bc)
- [x] **`PlaceForm.test.tsx` jsdom pragma.** `// @vitest-environment jsdom` present on line 1. (Phase 0 sharp-edges commit)
- [x] **Retire the LocalAgent gateway & fix the Analyst docs.** `MCA_LOCALAGENT_BASE_URL`/`LocalAgentClient` absent from `app/` and `README.md`; `app/assistant/llm_client.py` present; `MCA_LLM_BASE_URL` in README. (#50, Phase 0 sharp-edges commit)
- [x] **Gate `MCA_ADMIN_INGEST_TOKEN` in the prod boot validator.** `app/config.py` rejects `DEFAULT_ADMIN_INGEST_TOKEN` (`local-admin-token`) in production via `require_production_secret_overrides`. (Phase 0 sharp-edges commit)

## Phase 1 — Protect the invariant & analytical credibility
*The brand and legal core — all items resolved: safety-guard hardening and the full neighborhood-stats QA.*

- [x] **Harden the safety-refusal guard** — shipped: the object-first regex gap was fixed (#59), and an output-side guard on the model's answer plus broadened ranking/determiner detection landed in #63 (closing #60). Residual synonym-lexicon and non-English breadth is lower-priority follow-up. _(Original analysis, retained for context:)_ The guard was substantially broadened: it is now a broad `re` pattern scanning recent turns (last 8 user messages), not just the latest message. It catches "which block is more dangerous", "how risky", "safest", "unsafe", etc. **However**, a regex gap remains: the `(?:these|those|them|the\s+)?` group is missing a trailing `\s+`, so "rank these places" / "score these areas" (object-before-verb order) bypass it. Fix the `_SAFETY_SCORE_PATTERN` in `app/assistant/agent.py` and add the **output-side guard test** asserting the engine and assistant never emit `safe/unsafe/dangerous/risk` language. (`test_statistical_comparison_service.py` has an output check for compare summaries; there is no analogous test for the assistant response token stream.)
- [x] **Close the rigor asymmetry.** `MIN_PLACE_COUNT` / `MIN_COMBINED_COUNT` live in the shared `build_statistical_comparison` engine (`app/analysis/comparison.py`), which `compare_site_options` funnels through, so the per-option data floor applies uniformly; there was no asymmetry. _(The route path that also funneled through this engine was removed 2026-07.)_
- [x] **Neighborhood-stats QA — complete:** The candidate-selection-before-BH question is reviewed and resolved (#65) — selecting the lowest-rate candidate before BH is a real selective-inference effect, but the decision is conservative by design (must be statistically lower than every alternative, an effect-size floor, and the data floors), so selection alone cannot crown a winner. The overdispersion/small-sample handling and the multiple-comparison edge cases are now resolved too (#69): the small-sample dispersion limitation is documented inline in `app/analysis/comparison.py` (the doc that formerly covered it was removed with the routes feature — 2026-07), and tests pin the single-period `model_warning` guard, single/empty BH (no over-correction), and the multi-place BH-adjusted-p alignment.
- [x] **Point-in-polygon beat assignment** — `assign_beat` + `load_beat_polygons` (pure-Python ray-casting) implemented in `app/analysis/beat_baselines.py` and wired into `app/services/neighborhood_service.py` (the main analyze path). Also used by assistant tools. Shipped.

## Phase 2 — Data & ops durability
*All items verified shipped as of d30235b.*

- [x] **Crime-data pipeline:** incremental Socrata backfill with paging loop + retry/backoff + watermark (#37); data-freshness/coverage endpoint (ingested snapshot_at, #36); realistic seed dataset + `make seed-crime` (#38). `snapshot_at=2024-01-01` hardcode removed.
- [x] **Query perf (epic C):** `summarize_for_user` replaced with SQL-filtered path (#33). Residual: other full-table paths outside this function are out of scope for this item.
- [x] **Prod-DB confidence:** Postgres CI lane (migrate-to-head + parity smoke, #35); ops hardening (ca-certs, right-sized postgres image, `/health` readiness probe, compose healthcheck, backups, schema ownership, #34); `init_db`/`alembic` race reconciled.
- [x] **Decouple OTP bring-up from Windows** — bash script + compose profile (#39). _(removed 2026-07)_

## Phase 3 — Product breadth
*Shipped — including the `MapWorkspace` per-tab-hooks split.*

- [x] **Routes UX to parity** (#40). _(removed 2026-07)_ The shared `useAddressSearch` hook (`frontend/src/lib/useAddressSearch.ts`) extracted for it — deduplicating the geocode state machine behind Places' search — remains in use.
- [x] **Sensitivity-class UI:** `PlaceForm.tsx` includes a sensitivity selector backed by `SENSITIVITY_OPTIONS`; exports respect the class. This is the "classify/suppress affordance" — v1 scoped to exports (#44).
- [x] **Assistant:** token streaming (SSE via `StreamingResponse`), friendly "analyst offline" degraded state + Retry button, markdown rendering (#42). Failover LLM client also shipped.
- [x] **Frontend cleanup:** ~322 lines trimmed from dead `styles.css` (#41); Analyst panel clamped on mobile (#41); `MapWorkspace` split into per-tab hooks — `useDrawer` / `useDashboardData` / `usePinDraft` / `useAnalyze` / `useCompare` under `frontend/src/lib/` (the `useRoutes` hook was removed 2026-07), leaving the component a thin coordinating shell (the cross-cutting selection / analysis-context-invalidation / assistant-fan-out glue stays central); behavior-preserving against the existing 12 `MapWorkspace` tests, plus new unit tests for the isolated hooks (#68).
- [x] **Personal-upload disposition decided:** enabled on single-host ThinkPad trial (`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` in `.env.deploy.example` with explicit "keep OFF for shared/public" guardrail), with consent/retention copy in `docs/DEPLOY.md` (#43).
- [x] **Data-freshness indicator:** the dashboard topbar shows a "Data through <date>" pill sourced from `GET /dashboard/freshness` (`frontend/src/components/DataFreshness.tsx`), so users know the shared SPD dataset isn't live.

## Phase 4 — Harden & polish + new capabilities
*The next slate, chosen 2026-06-29. Worked one item at a time per Conventions.*

**Harden & polish**
- [x] **H1 · Query-perf sweep** — shipped (lean): a query audit found the main public incident paths already bbox+date+category SQL-filtered (the audit's `_beat_incidents` flag was a false positive — its whole-beat load is the rest-of-beat baseline). The one genuine full-table-on-every-load path, `crime_data_freshness`, is now TTL-cached in-process (#73). Deferred: ingest stats-row/watermark; real spatial index (R*Tree/PostGIS).
- [x] **H2 · Long-run Postgres validation** — soak harness shipped (tooling + runbook, not yet the multi-hour run itself, which is an on-demand ops step on the ThinkPad). `scripts/soak/soak_driver.py` drives N threaded virtual users over the perf-sensitive public dashboard endpoints (incl. the whole-beat `neighborhood` load) and reports per-endpoint p50/p95/p99 + first-vs-last-hour latency drift; `scripts/soak/pg_observer.py` samples `pg_stat_activity`/`pg_stat_database`/`pg_locks` and diffs `pg_stat_statements` by shelling `docker compose exec db psql --csv` (no host psycopg). `docker-compose.yml` now preloads `pg_stat_statements`; `make soak-load`/`make soak-observe` + `docs/soak-testing.md` (prereqs, first-run recipe, threshold table, pass criteria). Pure logic is unit-tested; the soak itself is out of `make test-all`. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-02-postgres-soak-harness*`.
- [x] **H3 · Address-search polish** — shipped (#72): debounced type-ahead with stale-request abort, first-class empty/error states with shared copy, a shared localStorage recent-places history (Places dropdown), and a client-side Seattle-bbox guard. Result ranking dropped (no relevance metadata). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-29-address-search-polish*`.
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
  (Routes saved views, #81) removed 2026-07._
- [x] **C4 · Second data source** — shipped across two increments. **Inc 1 (#75):** a
  source-aware crime layer (queries / freshness / backfill watermark all default to SPD
  reports, so existing analyses are unchanged) plus SPD **Arrest Data** (`9bjs-7a7w`) ingest
  tagged `source_dataset="seattle_spd_arrests"` — backend only, demographics not ingested.
  **Inc 2 (#76):** SPD **911 Call Data** (`33kz-ixgy`) as a **two-layer** model — a *Reported
  incidents* layer (crime + arrests, unioned) vs a *911 calls* layer (calls for service),
  mutually exclusive, chosen with a global top-bar toggle that every incident-context surface
  (Analyze / Compare / Assistant / exports / freshness) follows; `AnalysisRun` /
  `PlaceCrimeSummary` carry a `layer` column (migrations `0009`/`0010`). Calls
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
  `docs/superpowers/{specs,plans}/2026-07-02-arrests-third-layer*`. Two follow-ups now **shipped**:
  (1) the arrest↔crime **taxonomy crosswalk** — arrests carry a best-effort NIBRS-crosswalked
  `offense_category` (PROPERTY/PERSON/SOCIETY) + `nibrs_group`, mapped at ingest
  (`app/crime/nibrs_crosswalk.py`, full NIBRS Group A + B; Group A authoritative, Group B
  best-effort) and backfilled on existing rows (migration `0011`), so the category filter and
  arrest-vs-crime category comparison work on the arrests layer (spec/plan
  `…/2026-07-02-arrest-taxonomy-crosswalk*`); and (2) the `CALLS_DATA_FLOOR` fixed-date drift —
  the 911 floor is now a rolling first-of-month, 24-month window computed per ingest run
  (`calls_data_floor`, `app/crime/seattle_socrata.py`), so it no longer drifts past 24 months
  (spec/plan `…/2026-07-02-calls-floor-rolling*`). Still deferred: arrest demographics (not
  ingested)._
- [x] **C5 · Routes verdict on divergent corridors** (#87–#90) — _(removed 2026-07)_. Spec/plan
  retained: `docs/superpowers/{specs,plans}/2026-07-03-route-divergent-comparison*`.

> Deferred temporal follow-ups (after C1): comparative/baseline temporal (rate-ratio per bucket), an assistant temporal tool, and renaming the misnamed `offense_start_utc` column (holds local time) — a separate migration.

## Phase 5 — Compare-first flagship (pivot phase 2 — to be brainstormed)
*Placeholder for the address-first product's next chapter — not yet spec'd. This is phase 2 of
the 2026-07 address-first pivot (the routes removal — see the note at the top): with routes
removed, the flagship experience is comparing candidate addresses.*

- **Primary scenario:** choosing where to live — compare candidate addresses side by side.
- **Secondary scenario:** knowing your own area — understand the reported-incident context
  around where you already are.
- **Directions to explore:** richer side-by-side verdicts, multi-address compare (beyond the
  current pairwise view), and a comparison-first landing experience that leads with the compare
  flow rather than single-place analysis.

Each of these needs its own `docs/superpowers/` brainstorm → spec → plan before implementation.

**Decomposition (2026-07-03):** worked as three slices, A→B→C, so the compare experience is
strong before it becomes the front door.
- [x] **Slice A — richer side-by-side verdicts** — specced & built: rebuild the Compare tab
  on the statistical richness the `/dashboard/compare` payload already returns (hybrid
  callout + ranked lowest-first list + per-pair analytics), frontend-only. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-03-compare-first-flagship*`.
- [x] **Slice B — multi-address compare UX** — shipped: a Compare-owned editable address set
  (add via the reused address search, remove, seeded-from-selection, decoupled, 2–10) driving
  the verdict, plus an honest rate-ratio interval plot in the verdict (the payload-ready
  visualization; overlapping bell curves were rejected as statistically dishonest here).
  Frontend-only. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-03-compare-multi-address*`.
- [x] **Slice C — single-address entry → context → optional compare** — shipped: a fresh
  session leads with a single-address lookup (ephemeral inline-`points` path, no DB write)
  that flies the map and shows the address's reported-incident context on the reused Analyze
  tab, plus a one-click compare bridge that carries the looked-up address in as the anchor and
  an optional "Save to my places". Frontend-only; invariant untouched. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-03-compare-single-address-entry*`.

**Unified Compare surface (2026-07-16):** the tabs converge on one surface named Compare
(spec: `docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md`), in three
slices.
- [x] **Slice 1 — extract + enrich** — `PlaceContextCard` extracted from Analyze; Compare
  fetches the points-based neighborhood analysis in parallel and ranked rows expand into
  full per-address context. Plan: `docs/superpowers/plans/2026-07-16-unified-compare-slice1.md`.
- [ ] **Slice 2 — unify** — one list + one panel, tabs collapse to Compare + Export,
  pairwise section and bridge retire, share-link + assistant-bridge migration.
- [ ] **Slice 3 — polish** — adaptive CTA label, mobile tuning; later optional:
  pin-to-compare columns, progressive spine-first rendering.

- [x] **Per-address rate interval (backend)** — every compared address now carries its own
  quasi-Poisson rate confidence interval (`rate_confidence_interval`), surfaced on the
  `/dashboard/compare` options payload (persisted via migration `0013`). Empirically chosen
  over negative binomial — the mean–variance relationship in real SPD data is linear, not
  quadratic: `docs/analysis/overdispersion-and-rate-intervals.md`. The intuitive
  "rate ± margin of error" number-line viz (`CompareRateNumberLine`) ships alongside it,
  reading each address's absolute rate with its 95% interval on one shared axis.

## Phase 6 — Map & UI overhaul (2026-07-04)
*Three slices; spec: `docs/superpowers/specs/2026-07-04-map-ui-overhaul-design.md`. Driven by
three user goals: visible geography + beat transparency, incidents on the map, and a
thoughtful shell redesign (Civic Clear + night mode, Evolved Workspace layout).*

- [x] **Slice 1 — Map foundation:** maplibre-gl over a self-hosted Seattle PMTiles vector
  basemap (privacy: no third-party tile server sees viewports), light/dark civic style
  builders, 206-range `/tiles` + `/basemaps-assets` serving, hardened `fetch_tiles.py`
  (`make fetch-tiles`), Leaflet removed, deploy wired (compose ro volume + ps1 fetch).
  Plan: `docs/superpowers/plans/2026-07-04-map-foundation.md`.
- [x] **Slice 2 — Transparency layers:** `/dashboard/beats` (slimmed `{beat}`-only GeoJSON,
  gzip-negotiated + `Vary`, cached) + `/dashboard/incident-points` (bbox-gated + Seattle-clamped,
  5,000-row cap, arrests −1/−1 sentinel excluded structurally, `unmappable_citywide_count`); beat
  outlines with static labels (≥z12) + assigned-beat highlight from the neighborhood payload;
  clustered→individual incident dots at z14 (no heatmap, one neutral palette — invariant); XSS-safe
  click card with canonical incident formatting; debounced+abortable viewport hook; redacted-locations
  disclosure chip. Live-verified end-to-end. Plan:
  `docs/superpowers/plans/2026-07-04-transparency-layers.md`.
- [x] **Slice 3 — Shell overhaul:** Evolved Workspace layout (SearchPill absorbs pin-drop,
  in-panel Analyst dock, theme toggle), Civic Clear tokens + night mode, self-hosted webfonts
  (zero external requests — dropped the app's last external call), legend/zoom moved bottom-right.
  Both slice-2 carry-ins landed: (a) `setStyle()` layer re-registration via `style.load`; (b) the
  `mapLayers.ts` extraction (`addBeatLayers`/`addIncidentLayers`/`incidentCardElement` out of
  `MapCanvas.tsx`). Deviations logged in the spec's _Shipped deviations_ section.
  (#113; css hygiene follow-up #114)
- [ ] **Deferred (slice 2, non-blocking):** `/dashboard/incident-points` filters + sorts on the
  unindexed `coalesce(offense_start_utc, report_utc)` expression; a Postgres expression index is
  the mitigation when incident volume grows (needs a migration — out of scope for the no-migration
  slices). Bounded today by the 5,000-row cap + Seattle bbox clamp.

## Phase 7 — Public capstone (2026-07-09)
*Strategic direction chosen 2026-07-09: CompCat's next chapter is a **portfolio/showcase
capstone** — public repo (real history), hosted live demo, deep write-up — for both the
3-minute hiring skim and the technical-peer deep dive. This deliberately replaces the
"eventual public release" service pile (auth/tenancy/accounts stay unplanned). Sequenced
repo-first because publishing history is the irreversible step. Spec:
`docs/superpowers/specs/2026-07-09-public-capstone-design.md`; each slice gets its own
spec → plan → PR.*

- [x] **Slice 1 — Repo goes public:** full-history audit shipped clean — secrets, personal
  data, GitHub surface (PR/issue/review text), and dangling objects all clear; **no history
  rewrite needed** (the `git filter-repo` contingency went unused). Discovery: the repo had
  been public since 2026-06-22 already — the audit became confirmation, not precondition. MIT
  license + metadata, GitHub rename → `waypoint`, README front door (badges, invariant
  callout, light/night screenshots), CONTRIBUTING note, example LAN IPs genericized, City of
  Seattle open-data terms verified sufficient (2026-07-10), 14 stale merged branches pruned.
  Audit report kept private outside the repo. Plan:
  `docs/superpowers/plans/2026-07-10-repo-public.md`.
- [x] **Slice 2 — Demo-on-demand (revised 2026-07-10):** SHIPPED #118/#119 + live-verified through the quick tunnel 2026-07-10 (dashboard end-to-end, Analyst on Groq, 429s w/ Retry-After). ThinkPad + ephemeral Cloudflare
  quick tunnel (VPS/domain/durable link deferred to a future "for-real" launch); isolated
  second compose project (own env/volume/port — the personal instance is never exposed);
  **rate limiter (the phase's one substantial new backend surface**, incl. the Groq-quota
  global cap and the long-open free-sessions cap**)**; `MCA_LLM_API_KEY` auth patch;
  Analyst on Groq free tier (offline state as fallback); refresh-on-start instead of an
  ingest cron. Spec: `docs/superpowers/specs/2026-07-10-demo-on-demand-design.md`.
- [x] **Follow-up — Analyst knob control (from slice-2 live testing):** SHIPPED #123 + live-verified (explicit "radius to 500" extracted exactly; vague ask stepped 250→1000 — adjacent-step prompt tweak is a known minor). the Analyst can
  adjust radius / dates / category / layer conversationally ("increase radius to 500")
  and re-run; changes sync the dashboard controls so they stick across turns. Spec:
  `docs/superpowers/specs/2026-07-10-analyst-knob-control-design.md`.
- [x] **Follow-up — Analyst persona "Copper" + upgraded dock:** the Analyst presents as
  Copper, a fictional case-desk basset hound (noir bust; no SPD insignia, never claims
  official status) — avatar header + in-voice status, greeting empty state with a third
  deictic chip, one-time first-visit pulse (reduced-motion safe), reworded safety redirect,
  and a "From the reports:" lead-in on analyze/compare summaries. Chrome + framing copy
  only; guards, data content, and the planning prompt untouched. Spec:
  `docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md`.
- [ ] **Slice 3 — Write-up:** the methodology story (QP-vs-NB settled empirically,
  baselines, BH) and the product-ethics story (the invariant, routes removal, arrests
  de-merge, privacy posture) as long-form pieces linked from the README.
- [x] **Copper streamed finals + turn progress:** model-authored replies in Copper's
  voice streamed token-by-token (second, streamed narration call grounded on the tool
  result + deterministic template), honest `status` phase events during the planning,
  tool, and narration waits, and a holdback stream guard that keeps the
  no-safety-scoring invariant absolute mid-stream. Kill switch
  `MCA_ASSISTANT_NARRATION_ENABLED`. Spec:
  `docs/superpowers/specs/2026-07-12-assistant-token-streaming-design.md`.

## CompCat on iOS (2026-07-10)
*Personal device + demos target (no App Store). Decomposed A/B/C; spec:
`docs/superpowers/specs/2026-07-10-ios-shell-design.md`.*

- [x] **Slice A — iOS shell + Tailscale reachability:** Capacitor 7 remote-URL shell
  (SPM, no CocoaPods) loading the frontend from the backend's tailnet HTTPS origin;
  env-driven server URL keeps the hostname out of the repo (the synced native config
  is gitignored); Copper bust app icon + splash; `docs/IOS.md` runbook. First device
  run tracked as its own item below.
- [ ] **First device run (Slice A acceptance):** one-time environment setup — Xcode on
  the Mac (full app from the App Store, then `xcode-select`), Tailscale on ThinkPad +
  iPhone, `tailscale serve --bg 8000` with MagicDNS/HTTPS certs enabled — then
  `docs/IOS.md` Build & run (pick signing: free Apple ID = 7-day re-sign vs $99
  account) and the 6-item on-device checklist. Item 4 is the empirical unknown:
  Tabby's SSE must stream token-by-token through `tailscale serve`, not buffer.
- [ ] **Slice B — phone-first redesign:** first-class phone layout for the React app
  (navigation model, per-tab layouts, safe areas, keyboard) — own brainstorm → spec →
  plan; also upgrades mobile web for the public demo.
- [ ] **Slice C — niceties:** friendly offline screen, haptics, share-sheet exports,
  app shortcuts.

## Desktop focus mode & multi-baseline analysis (2026-07-12)
*Three connected desktop changes — a focus drawer preset, a place identity/locator system, and
multi-baseline (MCPP/beat/sector/city) neighborhood comparison — decomposed into three
independently-shippable slices. Spec:
`docs/superpowers/specs/2026-07-12-desktop-focus-multi-baseline-design.md`.*

- [x] **Slice 1 — Backend geography + API:** Multi-baseline neighborhood API — MCPP assets +
  `baselines[]` (mcpp/beat/sector/city) + `/dashboard/mcpp` (2026-07-12)
- [x] **Slice 2 — Analyze tab plot:** `BaselineIntervalPlot`, headline aggregation, How-we-know
  table, identity badges on cards; removes `ComparisonBars` + the legacy top-level beat fields.
  (2026-07-12)
- [x] **Slice 3 — Focus mode + locators:** drawer preset (spec's `min(vw−96, 0.9·vw)` clamp shared
  with drag, focus-width chrome treatment), MCPP locator chips on verdict cards, card→pin
  hover pulse, identity-colored lettered pins. Pure frontend. (2026-07-12)
- [x] Sector/city baselines via month-grouped SQL COUNT(*) (calls layer materializes ~700k
  rows/yr per citywide request today — do before demoing the calls layer) (2026-07-12)

## Conventions
- Each unchecked box above is a candidate unit of work; large ones get their own `docs/superpowers/` spec → plan → PR (the established cadence).
- Keep this file current as phases land — it is the one roadmap concurrent agents should read.

---

> **Eventual public release — superseded by Phase 7 (2026-07-09).** The open question this
> note held ("does CompCat ever go public, and as what?") is now answered: CompCat goes
> public as a **showcase** (Phase 7 — public repo, hosted demo, write-up), not as an
> operated multi-user service. The service pile this note enumerated (real authentication,
> encryption at rest, per-user tenant isolation, user accounts, onboarding) remains
> deliberately unplanned with no date.
