# Routes Removal & Address-First Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-delete Waypoint's routes feature (code, 4 DB tables, OTP infra, docs) and reframe the product address-first, per `docs/superpowers/specs/2026-07-03-routes-removal-design.md`.

**Architecture:** Pure excision in three PRs — frontend first (tab disappears before its API), then backend + one new Alembic migration (drop the `statistical_comparisons.source_route_request_id` FK/index/rows *before* dropping the four route tables), then docs/deploy/reframe. The shared statistical engine (`build_statistical_comparison` + its non-route helpers) and all places/dashboard behavior are untouched.

**Tech Stack:** FastAPI + SQLAlchemy/Alembic (SQLite dev / Postgres deploy), React + TypeScript + Vite (Vitest, `tsc -b`), pytest + ruff.

**Working context:** Worktree `/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/routes-removal`, branch `jcscocca/claude/routes-removal` (baseline `make test-all` green). All commands below run from the worktree root unless stated. All line numbers were verified at worktree tip `fec166e`; treat them as anchors — re-check with grep if a file has drifted.

**PR structure:** PR 1 is the current branch. PR 2 branches off PR 1's head, PR 3 off PR 2's (stacked). After the user squash-merges each PR, rebase the next branch onto `origin/main` before it's reviewed (`git rebase --onto origin/main <old-base> <branch>`).

**Two standing warnings for every task:**
1. Many *place-engine* tests use `comparison_type="route"` or labels like `"Route A"` as plain string data — they exercise the kept place engine. NEVER delete a test merely because it contains the string "route"; only delete tests that call route-path code (`compare_route_request`, `build_route_divergent_comparison`, route endpoints, corridor exposure functions).
2. The FastAPI router modules are *named* `routes_*.py` by convention (`routes_places.py`, `routes_analysis.py`, …). That naming stays. "Routes feature" ≠ "routes_ filename".

---

## PR 1 — Frontend excision (branch `jcscocca/claude/routes-removal`)

### Task 1: savedView.ts — old route links degrade to null (TDD)

**Files:**
- Modify: `frontend/src/lib/savedView.ts`
- Test: `frontend/src/lib/savedView.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/savedView.test.ts` (match the file's existing import style — it already imports `decodeView`; reuse its base64url helper if one exists, otherwise this self-contained version):

```typescript
describe("legacy routes links", () => {
  it("decodes a v1 routes-tab link to null instead of a view", () => {
    const wire = {
      v: 1,
      t: "routes",
      m: "transit",
      o: { q: "Pike Place Market", lat: 47.6097, lon: -122.3422 },
      d: { q: "Seattle Center", lat: 47.6205, lon: -122.3493 },
    };
    const param = btoa(JSON.stringify(wire))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeView(param)).toBeNull();
  });
});
```

Before writing, read `decodeRoutesView` (savedView.ts:71–88) and the existing routes-view tests in `savedView.test.ts` to copy the *actual* wire shape (`v`, `t`, mode/endpoint field names) — the object above must be a wire that decodes successfully TODAY, so the test fails now and passes after removal. If the existing tests build wires differently, mirror them exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/savedView.test.ts --environment jsdom`
Expected: the new test FAILS (decodeView returns a routes view object, not null). Pre-existing routes-view tests still pass.

- [ ] **Step 3: Remove routes code from savedView.ts**

In `frontend/src/lib/savedView.ts`:
- Line 4: `ViewTab` union → `"analyze" | "compare"` (drop `"routes"`).
- Lines 5–6: delete `RouteMode` type and `ROUTE_MODES` const.
- Lines 27–32: delete `RoutesSavedView` interface.
- Line 34: `SavedView` union → `PointsSavedView` only (drop `| RoutesSavedView`).
- Lines 53–56: in `encodeView`, remove the `view.tab === "routes"` ternary branch — keep only the points encoding.
- Lines 71–88: delete `decodeRoutesView`.
- Line 95 (inside `decodeView`): delete `if (wire.t === "routes") return decodeRoutesView(wire);`. The next guard (`if (wire.t !== "analyze" && wire.t !== "compare") return null;`) now catches `t:"routes"` — that IS the graceful degradation.
- Check lines 60–69: `readWirePoint`'s `bbox` parameter was only exercised by routes decode. If no remaining caller passes `bbox: true`, remove the parameter and its branch; if analyze/compare use it, leave it.

- [ ] **Step 4: Delete the routes-view test cases**

In `frontend/src/lib/savedView.test.ts`, delete the pre-existing tests that encode/decode routes views (they test deleted behavior). Keep the new legacy-link test and all analyze/compare tests.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/savedView.test.ts --environment jsdom`
Expected: PASS, including the new legacy-link test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/savedView.ts frontend/src/lib/savedView.test.ts
git commit -m "feat(frontend): legacy routes share-links decode to null"
```

(TypeScript may not compile repo-wide yet — MapWorkspace still imports routes types until Task 3. That's fine; PR 1 is gated as a whole in Task 4.)

### Task 2: Delete routes-only frontend files

**Files:**
- Delete: `frontend/src/components/RoutesTab.tsx`, `frontend/src/components/RoutesTab.test.tsx`, `frontend/src/lib/useRoutes.ts`, `frontend/src/lib/useRoutes.test.ts`, `frontend/src/lib/routeGeometry.ts`, `frontend/src/lib/routeGeometry.test.ts`

- [ ] **Step 1: Delete the files**

```bash
git rm frontend/src/components/RoutesTab.tsx frontend/src/components/RoutesTab.test.tsx \
       frontend/src/lib/useRoutes.ts frontend/src/lib/useRoutes.test.ts \
       frontend/src/lib/routeGeometry.ts frontend/src/lib/routeGeometry.test.ts
```

(If a listed test file doesn't exist under that exact name, find it with `ls frontend/src/**/*oute*` — do not skip it.)

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(frontend): delete RoutesTab, useRoutes, routeGeometry"
```

### Task 3: Unpick routes from shared frontend files

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx`, `frontend/src/components/MapCanvas.tsx`, `frontend/src/components/BottomSheet.tsx`, `frontend/src/components/ExportTab.tsx`, `frontend/src/components/LayerToggle.tsx`, `frontend/src/types.ts`, `frontend/src/api/client.ts`

- [ ] **Step 1: types.ts**

- Line 99: `TabKey` → `"places" | "analyze" | "compare" | "export"` (drop `"routes"`).
- Delete route-only types: `RouteAlternative` (101–111), `RouteContextSummaryItem` (113–122), `RouteComparison` (124–137), `RouteLine` (139), `RouteEndpointInput` (141–143).

- [ ] **Step 2: client.ts**

- Delete `createRouteAlternatives` (lines 117–127).
- Remove `RouteComparison` (line 11) and `RouteEndpointInput` (line 12) from the type imports.

- [ ] **Step 3: MapCanvas.tsx**

- Line 3: remove `Polyline` from the react-leaflet import (verify nothing else uses it first: `grep -n Polyline frontend/src/components/MapCanvas.tsx`).
- Line 7: remove the `RouteLine` type import.
- Line 86: remove the `routeLines?: RouteLine[]` prop from the props type.
- Lines 89–~108: delete the `FitRouteBounds` component.
- Line 111: remove `routeLines` from destructured props.
- Lines 163–173: delete the `routeLines?.map(...)` polyline render block.
- Line 174: delete the `<FitRouteBounds ... />` render.

- [ ] **Step 4: MapWorkspace.tsx**

- Line 15: remove `useRoutes` import; line 28: remove `RoutesTab` import; line 29: remove `RouteEndpointInput` from type imports.
- Line 38: simplify the `sharedPoints` init — drop the `initialView.tab !== "routes"` guard (all remaining saved views are point views).
- Line 41: delete `initialRoute`.
- Line 51: remove the routes branch from the `offenseCategory` init.
- Line 63: delete `const routes = useRoutes(analysis)`.
- In the run-on-load `useEffect` (~line 72): delete the `initialView.tab === "routes"` dispatch branch.
- Lines 207–235: delete the `buildRoutesShareUrl` useCallback.
- Line 271: remove `routeLines={routes.routeLines}` from `<MapCanvas>`.
- Line 318: simplify the `sharedPoints || initialRoute` expression to just `sharedPoints`.
- Lines 385–398: delete the `{activeTab === "routes" ? <RoutesTab .../> : ...}` render branch.

- [ ] **Step 5: BottomSheet.tsx and ExportTab.tsx and LayerToggle.tsx**

- BottomSheet.tsx lines 50–58: delete the routes tab entry object (key/label/icon).
- ExportTab.tsx lines 9–14: delete `ROUTE_EXPORTS` (with its comment); line 24: `const links = [{ label: "Place summary CSV", href }]` (drop the spread).
- LayerToggle.tsx line 11: trim "and Routes" from the doc comment.

- [ ] **Step 6: Typecheck until clean**

Run: `cd frontend && npm run lint`   (this is `tsc -b`)
Expected: errors point at any route reference you missed — fix each (deleting, not stubbing) and re-run until clean.

- [ ] **Step 7: Grep sweep**

Run: `grep -rniE "route" frontend/src/ --include='*.ts' --include='*.tsx'`
Expected: no hits (or only clearly non-feature words; investigate every hit).

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src
git commit -m "feat(frontend): unpick routes tab from shared workspace, map, exports"
```

### Task 4: PR 1 gate

- [ ] **Step 1: Full verification**

Run: `make test-all`
Expected: pytest green (backend untouched so far), ruff clean, Vitest green, `vite build` succeeds.

- [ ] **Step 2: Push and open PR 1**

```bash
git push -u origin jcscocca/claude/routes-removal
gh pr create --title "feat(frontend): remove the Routes tab (routes removal 1/3)" --body "$(cat <<'EOF'
Phase 1 of the routes removal (spec: docs/superpowers/specs/2026-07-03-routes-removal-design.md).

Deletes RoutesTab/useRoutes/routeGeometry, unpicks routes from MapWorkspace/MapCanvas/BottomSheet/ExportTab/savedView/types/client. Old shared corridor links decode to null (default view) instead of erroring. Backend untouched — the UI stops calling /routes* before PR 2 deletes it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 2 — Backend excision + migration (branch `jcscocca/claude/routes-removal-backend`)

### Task 5: Branch, delete routes-only backend files

**Files:**
- Delete: `app/api/routes_routes.py`, `app/api/routes_public_routes.py`, `app/routing/` (entire dir), `app/services/route_service.py`, `app/services/route_export_service.py`, `app/exports/routes.py`, `app/data/seattle_route_places.py`, `app/analysis/divergence.py`
- Modify: `app/main.py`, `app/config.py`

- [ ] **Step 1: Branch off PR 1's head**

```bash
git switch -c jcscocca/claude/routes-removal-backend
```

- [ ] **Step 2: Delete files**

```bash
git rm app/api/routes_routes.py app/api/routes_public_routes.py \
       app/services/route_service.py app/services/route_export_service.py \
       app/exports/routes.py app/data/seattle_route_places.py app/analysis/divergence.py
git rm -r app/routing
```

- [ ] **Step 3: main.py and config.py**

- `app/main.py`: delete import lines 21–22 (`routes_public_routes`, `routes_routes` routers) and include lines 62 and 66.
- `app/config.py`: delete lines 63–65 (`routing_provider`, `opentripplanner_base_url`, `opentripplanner_timeout_s`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(crime): delete routes-only backend modules"
```

(Imports are now broken in the entangled files — fixed next. Don't run pytest yet.)

### Task 6: Surgical edits — API and analysis modules

**Files:**
- Modify: `app/api/routes_analysis.py`, `app/api/routes_exports.py`, `app/services/analysis_service.py`, `app/analysis/exposure.py`, `app/analysis/schemas.py`, `app/analysis/comparison.py`

- [ ] **Step 1: routes_analysis.py**

Delete `compare_routes` (lines 41–57, the `POST /internal/analysis/routes/compare` handler); remove `RouteComparisonRequest` from the line-8 import and `compare_route_request` from the lines 11–15 import. Keep `compare_sites` and `get_comparison`.

- [ ] **Step 2: routes_exports.py**

Delete `export_route_alternatives` (44–53), `export_route_segments` (56–65), `export_route_context` (68–77) and the whole `route_export_service` import block (lines 11–15). Keep `export_place_summary`, `export_internal_place_summary`, `_place_summary_response`.

- [ ] **Step 3: analysis_service.py**

- Delete functions: `compare_route_request` (138–241), `_route_pair_divergence_inputs` (244–307), `_incidents_near_spans` (310–327), `latest_route_comparison_payload` (341–357).
- `_persist_and_payload` (360–445): remove the `source_route_request_id` parameter (line 363) and the line that writes it onto the model (line 371). Verify the sole remaining caller (`compare_site_options`, line ~131) doesn't pass it.
- Prune imports: `build_route_divergent_comparison` (line 11); the whole `app.analysis.divergence` block (12–19); `count_incidents_in_route_corridor`, `parse_route_geometry`, `route_corridor_exposure_square_km_days` from the exposure block (20–26); `PairDivergenceInput`, `RouteComparisonRequest` from schemas (27–34); `RouteAlternative`, `RouteRequest` from models (35–41).

- [ ] **Step 4: exposure.py**

Delete: `parse_route_geometry` (32–39), `route_length_km` (42–48), `route_corridor_exposure_square_km_days` (51–62), `point_to_route_distance_m` (65–77), `_point_to_segment_distance_m` (80–107), `count_incidents_in_route_corridor` (110–139), `_require_route_corridor_points` (196–200). Keep `analysis_days`, `place_exposure_square_km_days`, `count_incidents_in_place_buffer`, `_incident_matches_filters`, `_matches_optional_filter`.

- [ ] **Step 5: schemas.py**

Delete `RouteComparisonRequest` (78–84), `PairDivergenceInput` (87–97), and the `ROUTE_CORRIDOR` (14) + `ROUTE_DIVERGENT_CORRIDOR` (15) members of `GeometryType`. Keep everything else.

- [ ] **Step 6: comparison.py**

Delete route-only symbols: `_ROUTE_NOT_TESTED_STATUSES` (177), `build_route_divergent_comparison` (180–343), `_divergent_candidate` (346–374), `_candidate_pair_sides` (377–387), `_flip_pair` (390–402), `_route_minimum_data_status` (405–427), `_route_pairwise_caveat` (430–453), `_route_overview_summary` (456–481). Prune imports: `IDENTICAL_DIVERGENT_SHARE` from `app.analysis.divergence` (line 5) and `PairDivergenceInput` (line 20).
KEEP (shared, verified callers): `build_statistical_comparison`, `_combined_dispersion`, `_not_tested_pairwise_values`, `_not_tested_pairwise`, `_minimum_data_status`, `_overall_decision`, `_overview_summary`, `_overview_caveat`, `_full_caveat`, `_pairwise_caveat`, and the `benjamini_hochberg` import.

- [ ] **Step 7: Commit**

```bash
git add -A app
git commit -m "feat(crime): excise route paths from shared analysis modules"
```

### Task 7: Models + drop migration (TDD via migration chain test)

**Files:**
- Modify: `app/models.py`
- Create: `alembic/versions/0012_drop_route_tables.py`
- Test: existing full-chain migration coverage under pytest

- [ ] **Step 1: models.py**

Delete the four models: `RouteRequest` (195–226), `RouteAlternative` (229–246), `RouteSegment` (249–270), `RouteContextSummary` (273–298). In `StatisticalComparison`, delete the `source_route_request_id` mapped column (307–311).

- [ ] **Step 2: Write the migration**

Create `alembic/versions/0012_drop_route_tables.py` (revision id `0012_drop_route_tables`, 21 chars — under the 32-char limit):

```python
"""Drop route tables and the statistical_comparisons route FK.

Routes feature removed 2026-07 (spec: docs/superpowers/specs/
2026-07-03-routes-removal-design.md). Route-sourced comparison rows are
deleted; place comparisons are untouched.
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_drop_route_tables"
down_revision = "0011_arrest_category_backfill"
branch_labels = None
depends_on = None

ROUTE_TABLES = (
    "route_context_summaries",
    "route_segments",
    "route_alternatives",
    "route_requests",
)


def upgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM statistical_comparisons "
            "WHERE source_route_request_id IS NOT NULL"
        )
    )
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("statistical_comparisons") as batch_op:
            batch_op.drop_index("ix_statistical_comparisons_source_route_request_id")
            batch_op.drop_column("source_route_request_id")
    else:
        op.drop_index(
            "ix_statistical_comparisons_source_route_request_id",
            table_name="statistical_comparisons",
        )
        op.drop_column("statistical_comparisons", "source_route_request_id")
    for table in ROUTE_TABLES:
        op.drop_table(table)
```

For `downgrade()`: recreate the schema (not the data) by copying, in this order:
1. the four `op.create_table`/`op.create_index` blocks from `alembic/versions/0002_route_alternatives.py` `upgrade()` (lines 20–159), **plus** the `layer` column that `0010_route_layer.py` later adds to `route_requests` (copy its `sa.Column(...)` definition into the recreated `route_requests` table so a downgrade below 0012 doesn't collide with 0010's expectations — check 0010's downgrade drops it, so include it here);
2. re-add the column and index on `statistical_comparisons` (SQLite batch / Postgres plain, mirroring `upgrade()`):

```python
def downgrade() -> None:
    # Recreate route tables (schema only; data is not restored).
    # --- paste the create_table/create_index ops from 0002 here, with the
    # --- 0010 `layer` column folded into route_requests.
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("statistical_comparisons") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "source_route_request_id",
                    sa.String(length=36),
                    sa.ForeignKey("route_requests.id"),
                    nullable=True,
                )
            )
            batch_op.create_index(
                "ix_statistical_comparisons_source_route_request_id",
                ["source_route_request_id"],
            )
    else:
        op.add_column(
            "statistical_comparisons",
            sa.Column(
                "source_route_request_id",
                sa.String(length=36),
                sa.ForeignKey("route_requests.id"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_statistical_comparisons_source_route_request_id",
            "statistical_comparisons",
            ["source_route_request_id"],
        )
```

- [ ] **Step 3: Exercise the chain on SQLite**

```bash
rm -f /tmp/routes_drop_check.db
MCA_DATABASE_URL=sqlite:////tmp/routes_drop_check.db .venv/bin/alembic upgrade head
MCA_DATABASE_URL=sqlite:////tmp/routes_drop_check.db .venv/bin/alembic downgrade 0011_arrest_category_backfill
MCA_DATABASE_URL=sqlite:////tmp/routes_drop_check.db .venv/bin/alembic upgrade head
```

(Check `alembic/env.py` first for the env var it actually reads — if it uses the app settings' database URL under a different name, use that name.)
Expected: all three commands succeed; after the final upgrade, `sqlite3 /tmp/routes_drop_check.db ".tables"` shows no `route_*` tables and `pragma table_info(statistical_comparisons)` has no `source_route_request_id`.

- [ ] **Step 4: Postgres chain check**

If a local Postgres is available (it was used for the H2 soak):

```bash
createdb waypoint_mig_check
MCA_DATABASE_URL=postgresql+psycopg://localhost/waypoint_mig_check .venv/bin/alembic upgrade head
MCA_DATABASE_URL=postgresql+psycopg://localhost/waypoint_mig_check .venv/bin/alembic downgrade 0011_arrest_category_backfill
MCA_DATABASE_URL=postgresql+psycopg://localhost/waypoint_mig_check .venv/bin/alembic upgrade head
dropdb waypoint_mig_check
```

(Adjust the driver/URL to match `.env.deploy.example`'s format.) If Postgres is not running locally, SAY SO in the PR description — it must be validated before the next ThinkPad deploy, not silently assumed.

- [ ] **Step 5: Commit**

```bash
git add app/models.py alembic/versions/0012_drop_route_tables.py
git commit -m "feat(crime): drop route tables and comparison route FK (migration 0012)"
```

### Task 8: Test suite excision

**Files:**
- Delete: `tests/test_route_alternatives_api.py`, `tests/test_route_comparison_payload_filter.py`, `tests/test_route_context.py`, `tests/test_route_divergent_comparison.py`, `tests/test_route_endpoints.py`, `tests/test_route_models_migration.py`, `tests/test_route_place_resolver.py`, `tests/test_route_tableau_exports.py`, `tests/test_routes_public_api.py`, `tests/test_mock_routing_provider.py`, `tests/test_opentripplanner_provider.py`, `tests/fixtures/otp_plan_response.json`
- Modify: `tests/test_statistical_comparison_service.py`, `tests/test_statistical_comparison_api.py`, `tests/test_analysis_exposure.py`, `tests/test_internal_surface.py`

- [ ] **Step 1: Delete the 11 routes-only test files + fixture**

```bash
git rm tests/test_route_alternatives_api.py tests/test_route_comparison_payload_filter.py \
       tests/test_route_context.py tests/test_route_divergent_comparison.py \
       tests/test_route_endpoints.py tests/test_route_models_migration.py \
       tests/test_route_place_resolver.py tests/test_route_tableau_exports.py \
       tests/test_routes_public_api.py tests/test_mock_routing_provider.py \
       tests/test_opentripplanner_provider.py tests/fixtures/otp_plan_response.json
```

- [ ] **Step 2: test_statistical_comparison_service.py**

Delete these test functions ONLY (they call route-path code): `test_compare_route_request_returns_none_without_analysis_dates` (477), `test_compare_route_request_floors_near_empty_candidate` (533), `test_compare_route_request_tests_divergent_corridors_only` (706), `test_route_pair_divergence_excludes_flank_incidents_on_shared_stretch` (834), `test_compare_route_request_ignores_flank_incidents_when_routes_run_parallel` (882), `test_compare_route_request_reports_effectively_identical_corridors` (997), `test_compare_route_request_short_window_identical_corridors_do_not_raise` (1067).
Prune imports: `RouteComparisonRequest` (line 8), `RouteAlternative, RouteRequest` from line 12 (KEEP `CrimeIncident`), `_route_pair_divergence_inputs` and `compare_route_request` (lines 16–17).
KEEP all `test_build_statistical_comparison_*` and `test_compare_site_options_*` tests even where they use `comparison_type="route"` / `"Route A"` as string data.

- [ ] **Step 3: test_statistical_comparison_api.py**

Delete `test_route_comparison_api_returns_404_without_analysis_dates` (138). Prune `RouteRequest` from the line-7 import (keep `CrimeIncident`). Keep all `test_site_comparison_*` tests.

- [ ] **Step 4: test_analysis_exposure.py**

Delete the route-only imports (lines 8–12) and tests: `test_parse_route_geometry_reads_existing_lat_lon_semicolon_format` (31), `test_point_to_route_distance_counts_points_near_segment_not_only_endpoints` (38), `test_route_corridor_exposure_uses_length_buffer_caps_and_days` (45), `test_route_corridor_exposure_rejects_missing_or_degenerate_geometry` (57), `test_count_incidents_in_route_corridor_filters_dates_coordinates_and_offense` (67), `test_count_incidents_in_route_corridor_rejects_missing_or_degenerate_geometry` (131). Keep the three place/shared tests.

- [ ] **Step 5: test_internal_surface.py**

Remove from `PUBLIC_PATHS` (lines 17–22): the three `/exports/tableau/route-*.csv` entries and `/routes/alternatives`, `/routes/requests/{request_id}/comparison`. The test functions themselves stay unchanged.

- [ ] **Step 6: Run backend suite**

Run: `.venv/bin/python -m pytest tests -q && .venv/bin/ruff check .`
Expected: all green. Ruff will also flag any unused imports left by Tasks 6–8 — fix them.

- [ ] **Step 7: Grep sweep of app/**

Run: `grep -rniE "route" app/ --include='*.py' | grep -viE "routes_(places|analysis|exports|sessions|dashboard|assistant|uploads|imports|crime|internal)|router|include_router|APIRouter"`
Expected: remaining hits are ONLY the assistant guardrail lexicon (`app/assistant/agent.py`, `app/assistant/prompts.py` — these stay by design) and FastAPI-routing vocabulary. Investigate anything else.

- [ ] **Step 8: Commit, gate, push, PR 2**

```bash
git add -A tests
git commit -m "test: excise route-path tests, keep place-engine coverage"
make test-all
git push -u origin jcscocca/claude/routes-removal-backend
gh pr create --base jcscocca/claude/routes-removal --title "feat(crime): delete the routes backend + drop route tables (routes removal 2/3)" --body "$(cat <<'EOF'
Phase 2: deletes the routes routers, app/routing/, route services/exports, divergence module, and route-path code in shared analysis modules. Migration 0012 deletes route-sourced statistical_comparisons rows, drops the source_route_request_id FK/index (SQLite batch mode), then drops the four route tables. Place comparison engine untouched (see plan Task 6 keep-list).

Migration chain verified up/down/up on SQLite [and Postgres — state result here honestly].

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(If PR 1 has already been squash-merged by now, use `--base main` and rebase this branch onto `origin/main` first.)

---

## PR 3 — Docs, deploy & reframe (branch `jcscocca/claude/routes-removal-docs`)

### Task 9: Deploy artifacts

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `.env.deploy.example`
- Delete: `scripts/otp_setup.sh`, `scripts/otp_thinkpad_setup.ps1`

- [ ] **Step 1: Branch**

```bash
git switch -c jcscocca/claude/routes-removal-docs
```

- [ ] **Step 2: Edit deploy files**

- `docker-compose.yml`: delete the otp service block (lines 84–100, incl. its comment header) and the three `MCA_ROUTING_PROVIDER`/`MCA_OPENTRIPPLANNER_*` env lines from the api service (53–57 region — keep any non-routing vars interleaved there).
- `.env.example`: delete lines 39–44 (routing comment + 3 vars).
- `.env.deploy.example`: delete lines 49–56 (routing comment + 3 vars).
- `git rm scripts/otp_setup.sh scripts/otp_thinkpad_setup.ps1`

- [ ] **Step 3: Sanity-check compose and commit**

Run: `docker compose config -q` (skip with a note if docker isn't running).

```bash
git add -A
git commit -m "chore(deploy): remove OTP service, scripts, and routing env vars"
```

### Task 10: README + ROADMAP reframe

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1: README.md**

- Lines 22–24 ("What it does"): rewrite the route bullets so the feature list reads address-first — look up an address, analyze it against its beat, compare candidate addresses, export.
- Section "## Routes and statistical comparison" (92–109): delete the "Route alternatives" bullet (94–102); retitle the section "## Statistical comparison" and rewrite the kept bullet (103–109) to mention place buffers only (drop "and route corridors").
- Config table: delete rows 251–253 (the three routing vars).
- Endpoint table: delete rows 284–286 (routes internal, `/internal/analysis/routes/compare`, route CSVs).
- Read the top intro (lines 1–20): if it frames Waypoint around commutes/routes, rewrite to the address-first framing from the spec ("explore reported SPD incident context around addresses — look one up, compare candidates"). Keep the product invariant wording (reported incident context; no safety scores) verbatim.

- [ ] **Step 2: docs/ROADMAP.md**

- Add near the top a short "Removed: Routes (2026-07)" note: the routes/commute feature (shipped #29, saved views #81, divergent corridors #87–#90) was removed in 2026-07 — premise retired in favor of the address-first product; see git history and `docs/superpowers/specs/2026-07-03-routes-removal-design.md`.
- Delete or collapse the routes-specific blocks: Routes saved-views (91–98), C5 divergent-corridor (131–138), and route lines at 30–31, 34, 41, 48, 51, 61, 66, 69, 79, 106–107, 140, 152 — where a line mixes route + place content, trim the route half; where a block is pure routes, replace with a one-line "(removed 2026-07)" marker rather than silently deleting shipped-history entries.
- Add a "Phase 2 — compare-first flagship (to be brainstormed)" placeholder: richer side-by-side verdicts, multi-address compare, comparison-first landing; primary scenario choosing-where-to-live, secondary knowing-your-own-area.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: reframe README and ROADMAP address-first"
```

### Task 11: Architecture docs + analysis doc + DEPLOY

**Files:**
- Modify: `docs/architecture/overview.md`, `docs/architecture/api.md`, `docs/architecture/data-model.md`, `docs/architecture/assistant.md`, `docs/DEPLOY.md`, `docs/reference/spd-crime-analysis-suite/README.md`, `CLAUDE.md`
- Delete: `docs/analysis/statistical-route-place-comparison.md`, `docs/analysis/img/route-divergence-corridors.svg`

- [ ] **Step 1: architecture docs**

- `overview.md`: remove route mentions at lines 9, 41, 51, 53, 68 (Routing subsystem row), 71, 74, and the diagram nodes at 139, 149, 161, 173 (delete the nodes AND their edges — render the Mermaid mentally or paste into a viewer to confirm no dangling edge references).
- `api.md`: remove public route endpoint rows (80–81), route CSV export rows (86–88), route-layer prose (93, 99–102), `/internal/analysis/routes/compare` row (121), `/internal/routes/*` rows (123–124), and the route parts of the Exports section (186–194).
- `data-model.md`: remove entity rows 58–61, the `source_route_request_id` mention in row 67, prose 151–152, migration-table rows 169 and 177 — for 0002/0010 keep the rows but mark "(tables dropped by 0012)", and ADD a row for `0012_drop_route_tables.py`; remove the route blocks from the Mermaid ER diagram (283–327) and edges (361–365).
- `assistant.md`: line 125 — drop "routes" from the unaffected-subsystems list. Line 141 documents the guard regex — leave it (the regex and its doc stay; refusing "safest route" remains correct).

- [ ] **Step 2: DEPLOY.md, reference README, analysis doc**

- `docs/DEPLOY.md`: delete the "### Routing (OpenTripPlanner)" section (lines 185–~316) and the scattered OTP mentions (14, 23–24, 32, 116, 120).
- `docs/reference/spd-crime-analysis-suite/README.md`: remove its route/OTP mentions (grep for them).
- `git rm docs/analysis/statistical-route-place-comparison.md docs/analysis/img/route-divergence-corridors.svg`

- [ ] **Step 3: CLAUDE.md**

Project `CLAUDE.md` lists `/routes*` in the Public API-tier bullet and `/internal/routes/*` in the Internal bullet — remove both mentions (keep the tier structure).

- [ ] **Step 4: Commit**

```bash
git add -A docs CLAUDE.md
git commit -m "docs: excise routes from architecture, deploy, and analysis docs"
```

### Task 12: Final acceptance gate

- [ ] **Step 1: Repo-wide grep**

Run: `grep -rniE "route|opentripplanner|\botp\b" --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.worktrees --exclude-dir=docs/superpowers .`
Expected surviving hits ONLY: assistant guardrail lexicon (`app/assistant/`), FastAPI `routes_*.py` module names / `router` vocabulary, `docs/superpowers/` historical specs+plans, ROADMAP/data-model "removed 2026-07" markers, and frontend build artifacts if any. Investigate every other hit.

- [ ] **Step 2: Full gate**

Run: `make test-all`
Expected: green.

- [ ] **Step 3: Fresh-DB migrate sanity**

Run: `rm -f /tmp/routes_final_check.db && MCA_DATABASE_URL=sqlite:////tmp/routes_final_check.db .venv/bin/alembic upgrade head` (same env-var caveat as Task 7 Step 3).
Expected: clean run from empty DB through 0012.

- [ ] **Step 4: Push and open PR 3**

```bash
git push -u origin jcscocca/claude/routes-removal-docs
gh pr create --base jcscocca/claude/routes-removal-backend --title "docs: address-first reframe (routes removal 3/3)" --body "$(cat <<'EOF'
Phase 3: README/ROADMAP reframed address-first, architecture + deploy docs pruned, OTP compose service/scripts/env vars removed, route analysis doc deleted. ROADMAP gains the Phase 2 compare-flagship placeholder.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Same rebase note as PR 2: retarget `--base` to `main` as earlier PRs squash-merge.)

---

## Out of scope (do not do in these PRs)

- Phase 2 compare-flagship features (own brainstorm/spec later).
- Pruning the four stale merged `route-*` worktrees/branches (separate housekeeping; needs user confirmation).
- Any change to the assistant guardrail regexes/copy — "safest route" refusals stay.
- Renaming `routes_*.py` API modules or the repo.
