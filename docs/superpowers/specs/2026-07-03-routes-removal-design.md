# Routes removal & address-first reframe — design

**Date:** 2026-07-03
**Status:** Approved pending user spec review
**Decision:** Kill the routes feature entirely (hard delete) and reframe Waypoint as an
address-first product: look up an address, compare addresses. This is Phase 1 of a
two-phase pivot; Phase 2 (making address comparison the flagship — richer side-by-side
verdicts, multi-address compare, comparison-first landing) gets its own brainstorm and
spec after this lands.

## Why

The commute/route premise has not yielded results proportional to the investment. The
product's real scenarios are (primary) choosing where to live — comparing candidate
addresses before a lease/purchase — and (secondary) knowing your own area over time.
Places, Analyze, Compare, and exports already serve those; routes does not.

All route work through PR #90 is merged on origin/main, so removal deletes complete,
working code with full git-history recoverability — nothing in flight is orphaned.

## Goals

1. Remove all routes code, tables, tests, infra, and docs.
2. Reframe README, ROADMAP, and architecture docs around the address-first product.
3. Leave the shared statistical engine and all places/dashboard behavior untouched.

## Non-goals

- Any new compare/analysis features (Phase 2).
- Renaming the repo or product.
- Assistant architecture changes. The safety-guard lexicon KEEPS its route wording —
  "what's the safest route" must still be refused, and that copy stays correct.

## Backend

**Delete outright:**
- `app/api/routes_routes.py`, `app/api/routes_public_routes.py` (and their
  registrations in `app/main.py`)
- `app/routing/` — entire package (providers, mock, OTP, place resolver, corridor
  context, schemas)
- `app/services/route_service.py`, `app/services/route_export_service.py`
- `app/exports/routes.py`
- `app/data/seattle_route_places.py`
- `config.py`: `routing_provider`, `opentripplanner_base_url`, `opentripplanner_timeout_s`

**Surgical edits (shared files):**
- `app/api/routes_exports.py` — drop the three route CSV endpoints; keep
  `place-summary.csv`.
- `app/api/routes_analysis.py` — drop `POST /internal/analysis/routes/compare`; keep
  `sites/compare` and `comparisons/{id}`.
- `app/services/analysis_service.py` — remove `compare_route_request` and route-corridor
  imports; keep `compare_site_options`, `get_comparison_payload`, `_persist_comparison`.
- `app/analysis/exposure.py` — remove the route-only functions
  (`parse_route_geometry`, `route_length_km`, `route_corridor_exposure_square_km_days`,
  `point_to_route_distance_m`, `_point_to_segment_distance_m`,
  `count_incidents_in_route_corridor`, `_require_route_corridor_points`); keep
  place-buffer functions and shared helpers.
- `app/analysis/schemas.py` — remove `GeometryType.ROUTE_CORRIDOR` and
  `RouteComparisonRequest`.
- `app/analysis/comparison.py` — remove the route-only divergent-corridor symbols added
  by #87–#90 (`build_route_divergent_comparison` and its `_route_*`/`_divergent_*`
  helpers); `build_statistical_comparison` and all shared helpers stay — places still
  funnel through them. The route-only `app/analysis/divergence.py` module (also from
  #87) is deleted outright.

**Models & migration (ordering constraint):**
- Delete models `RouteRequest`, `RouteAlternative`, `RouteSegment`,
  `RouteContextSummary`; remove `StatisticalComparison.source_route_request_id`.
- One new Alembic migration (revision id ≤32 chars, SQLite + Postgres):
  1. delete `statistical_comparisons` rows where `source_route_request_id IS NOT NULL`
     (route-sourced comparisons belong to the dead feature);
  2. drop the `source_route_request_id` column and its index — batch mode on SQLite;
  3. drop `route_context_summaries`, `route_segments`, `route_alternatives`,
     `route_requests` (FK-safe order).
- Migrations `0002_route_alternatives` and `0010_route_layer` stay in the chain
  untouched; history remains valid and the full chain still runs in tests.

## Frontend

**Delete outright:** `RoutesTab.tsx`, `useRoutes.ts`, `routeGeometry.ts` + their tests.

**Surgical edits:**
- `MapWorkspace.tsx` — remove routes tab wiring, `useRoutes` usage, `routeLines`,
  `buildRoutesShareUrl`, routes saved-view restore branch.
- `MapCanvas.tsx` — remove `RouteLine`, `routeLines` prop, `FitRouteBounds`, polyline
  rendering.
- `BottomSheet.tsx` — remove the routes tab entry.
- `ExportTab.tsx` — remove `ROUTE_EXPORTS`.
- `savedView.ts` — remove `RoutesSavedView`, `decodeRoutesView`, `ROUTE_MODES`, and
  `"routes"` from `ViewTab`. **Old shared corridor URLs must degrade gracefully:**
  an unrecognized/routes view decodes to the default tab, no error surface.
- `client.ts` — remove `createRouteAlternatives` and route type imports.
- `types.ts` — remove `"routes"` from `TabKey` and the route-only types.
- `useAddressSearch.ts` stays (shared with PlaceSearch); stale RoutesTab comment trimmed.

## Docs, deploy & reframe

- **README.md** — rewrite framing address-first; remove routing provider config, route
  endpoints, route export rows.
- **docs/ROADMAP.md** — rewrite around the address-first product; short "routes removed
  2026-07 — see git history (#29, #81, #87–#90)" note; add a Phase 2 placeholder for the
  compare-flagship investment.
- **docs/architecture/** (`overview.md`, `api.md`, `data-model.md`, `assistant.md`) —
  prune route sections; the shared statistical engine remains documented.
- **Delete** `docs/analysis/statistical-route-place-comparison.md` +
  `docs/analysis/img/route-divergence-corridors.svg`.
- **Keep** dated historical specs/plans under `docs/superpowers/`.
- **docs/DEPLOY.md** + `docs/reference/spd-crime-analysis-suite/README.md` — remove
  route/OTP mentions.
- **Deploy artifacts:** remove the `otp` service (profile `otp`) and
  `MCA_OPENTRIPPLANNER_*` passthrough from `docker-compose.yml`; delete
  `scripts/otp_setup.sh` and `scripts/otp_thinkpad_setup.ps1`; remove routing/OTP vars
  from `.env.example` and `.env.deploy.example`.

## Tests

- **Delete (10):** `test_route_alternatives_api.py`, `test_route_context.py`,
  `test_route_endpoints.py`, `test_route_models_migration.py`,
  `test_route_place_resolver.py`, `test_route_tableau_exports.py`,
  `test_routes_public_api.py`, `test_mock_routing_provider.py`,
  `test_opentripplanner_provider.py`, `tests/fixtures/otp_plan_response.json`.
- **Edit (4):** `test_statistical_comparison_service.py` and
  `test_statistical_comparison_api.py` (drop route-compare tests, keep site-compare),
  `test_analysis_exposure.py` (drop route-corridor tests), `test_internal_surface.py`
  (remove route endpoints from the expected surface list).
- New migration covered by the existing full-chain migration test path; verified
  upgrade on both SQLite and Postgres, plus a fresh-DB `make migrate`.

## Sequencing & verification

Three PRs from the `routes-removal` worktree, each gated on `make test-all`, merged
promptly (concurrent agents work this repo):

1. **PR 1 — frontend excision.** The Routes tab disappears before its API does; no
   window where the UI calls a missing backend.
2. **PR 2 — backend excision + migration + test edits.**
3. **PR 3 — docs/deploy/reframe.**

Final acceptance: repo-wide grep shows "route" surviving only in assistant guardrail
copy and HTTP-routing vocabulary; `make test-all` green; migration chain runs clean on
a fresh SQLite DB and on Postgres.

## Follow-ups (out of scope, tracked)

- Phase 2 brainstorm: compare-first product investment.
- Prune the four stale merged `route-*` worktrees/branches.
