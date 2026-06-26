# Internal-Gate Legacy Analysis Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the four UI-unwired legacy routers (`/analysis/*`, `/routes/*`, `/imports/*`, `/crime/*`) behind the existing `/internal/...` convention so they leave the public OpenAPI surface and their anonymous demo-identity fallback is no longer publicly reachable — without deleting the features or their tests.

**Architecture:** Waypoint already runs a two-tier API: public endpoints require a real session (`required_public_user_hash`) and appear in OpenAPI; `/internal/...` endpoints allow the demo-identity fallback (`current_user_hash`) and are hidden (`include_in_schema=False`). The map-first dashboard UI calls **only** the public tier (`/sessions`, `/places*`, `/dashboard/*`, `/assistant/chat`). This plan extends the established `/internal` pattern (see `app/api/routes_places.py:24` and `app/api/routes_exports.py:29`) to the four routers the redesign left on bare public paths, then codifies the boundary with a guard test.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, ruff, `fastapi.testclient.TestClient`.

**Reference spec:** `docs/superpowers/specs/2026-06-26-waypoint-hardening-consolidation-design.md` (Approach A, Phase 0 + Phase 1).

---

## Scope

In scope: Phase 0 foundation (green-baseline gate, `CLAUDE.md`) and the cohesive core of Phase 1 (internal-gating + the OpenAPI invariant + README doc sync).

Deliberately out of scope, as separate follow-up plans (see spec): the geocoder-provider config (frontend-only — the seam already exists in `frontend/src/lib/geocoding.ts` via `createNominatimProvider(endpoint)`) and the personal-upload consent copy. Vestigial-gateway cleanup waits for the `claude/assistant-failover` branch.

**Coordination — do NOT touch these files (the `claude/assistant-failover` worktree is editing them):** `app/assistant/localagent_client.py`, `app/api/routes_assistant.py`, `app/config.py`, `docs/DEPLOY.md`, `.env.deploy.example`. The `DEPLOY.md` "Open API surface" note (`docs/DEPLOY.md:67`) becomes stale after this plan; updating it is a one-line follow-up after both branches merge — not part of this plan.

## File structure

| File | Change | Responsibility |
|------|--------|----------------|
| `CLAUDE.md` | Create | Committed project guide: product invariant, API tiers, LLM env, verification gate, worktree discipline. |
| `app/api/routes_analysis.py` | Modify | Move 3 routes to `/internal/analysis/*`, hide from schema. |
| `app/api/routes_routes.py` | Modify | Move 2 routes to `/internal/routes/*`, hide from schema. |
| `app/api/routes_imports.py` | Modify | Move 3 routes to `/internal/imports*`, hide from schema. |
| `app/api/routes_crime.py` | Modify | Move 2 routes to `/internal/crime/*`, hide from schema. |
| `tests/test_statistical_comparison_api.py`, `tests/test_statistical_comparison_exports.py` | Modify | Retarget `/analysis/*` → `/internal/analysis/*`. |
| `tests/test_route_alternatives_api.py`, `tests/test_route_tableau_exports.py` | Modify | Retarget `/routes/*` → `/internal/routes/*` (and `/crime/*` in Task 6). |
| `tests/test_api_flow.py`, `tests/test_dashboard_summary.py`, `tests/test_tableau_export.py`, `tests/test_commute_scenario_parser.py`, `tests/test_recurring_places_parser.py` | Modify | Retarget `/imports*` and `/crime/*`. |
| `tests/test_internal_surface.py` | Create | Guard test: legacy paths absent from public schema, public paths present, `/internal` still served. |
| `README.md` | Modify | Sync curl examples + API reference table to `/internal/` paths. |

`app/api/deps.py` and `app/main.py` need **no change**: `current_user_hash` stays exactly as-is (now used only by `/internal` routes), and `main.py` already includes each router with no prefix, so per-route `/internal/...` paths take effect automatically.

---

## Task 1: Confirm green baseline

**Files:** none (verification gate).

- [ ] **Step 1: Run the full verification suite on a clean tree**

Run:
```bash
git status --short --branch
make test-all
```

Expected: working tree clean except untracked docs (`docs/superpowers/specs/2026-06-26-waypoint-hardening-consolidation-design.md`, this plan). `make test-all` exits 0 — pytest passes, `ruff check .` passes, frontend tests pass, frontend build passes.

- [ ] **Step 2: Gate**

If `make test-all` fails, STOP. Do not build on a red baseline — report the failure. Only continue when it is green.

---

## Task 2: Add committed `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create `CLAUDE.md`**

```markdown
# Waypoint — agent guide

Waypoint is a privacy-first web app for exploring **reported Seattle SPD incident
context** around places and routes. FastAPI + SQLAlchemy/Alembic backend, React +
TypeScript + Vite frontend, SQLite for dev / Postgres + PostGIS for deploy.

## Product invariant (do not break)

Waypoint reports *reported incident context*. It MUST NOT score safety, rank places as
safe/unsafe/dangerous, or claim a user was present at an incident. The assistant refuses
safety-score requests by design (`app/assistant/agent.py`). Keep this true in code and
copy.

## API tiers

- **Public** (in OpenAPI, require a real session via `required_public_user_hash`):
  `/sessions`, `/places*`, `/dashboard/*`, `/assistant/chat`, `/exports/tableau/*`.
  The React UI (`frontend/src/api/client.ts`) calls only this tier.
- **Internal** (`/internal/...`, `include_in_schema=False`, allow the demo-identity
  fallback `current_user_hash`): everything the UI does not call —
  `/internal/analysis/*`, `/internal/routes/*`, `/internal/imports*`, `/internal/crime/*`,
  `/internal/places`, `/internal/exports/*`. Do not re-expose these on bare public paths;
  `tests/test_internal_surface.py` enforces this.
- **Admin**: `/admin/crime/ingest/socrata` is guarded by the `X-Admin-Token` header
  (`MCA_ADMIN_INGEST_TOKEN`).

## Assistant LLM

The assistant calls an OpenAI-compatible endpoint directly: `MCA_LLM_BASE_URL`,
`MCA_LLM_MODEL`. If unreachable, only the chat panel is affected — the rest of the app
works. (The old LocalAgent gateway / `MCA_LOCALAGENT_BASE_URL` is being retired.)

## Verification gate

`make test-all` = `pytest` + `ruff check .` + frontend `npm test` + `npm run build`.
Run it before claiming work complete. Migrations: `make migrate` (alembic upgrade head).
Dev server: `make run` (uvicorn on :8000).

## Concurrent agents

Multiple agents work this repo at once. Do your work in a **dedicated git worktree**, not
the main checkout, to avoid collisions.
```

- [ ] **Step 2: Verify it is staged-clean and lint is unaffected**

Run:
```bash
ls -la CLAUDE.md && .venv/bin/ruff check .
```
Expected: file exists; ruff passes (ruff ignores Markdown — this just confirms no accidental code change).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md project guide"
```

---

## Task 3: Internal-gate `routes_analysis.py`

**Files:**
- Modify: `app/api/routes_analysis.py`
- Modify: `tests/test_statistical_comparison_api.py`, `tests/test_statistical_comparison_exports.py`

- [ ] **Step 1: Retarget the analysis tests to `/internal/analysis/*` (write the new expectation first)**

Run:
```bash
perl -pi -e 's{(["\x27])/analysis/}{$1/internal/analysis/}g' \
  tests/test_statistical_comparison_api.py \
  tests/test_statistical_comparison_exports.py
```

Verify no bare `/analysis/` literal remains and the internal ones are present:
```bash
grep -rnE "[\"']/analysis/" tests/ ; echo "exit: $?"
grep -rcE "/internal/analysis/" tests/test_statistical_comparison_api.py
```
Expected: first grep prints nothing and `exit: 1` (no bare matches); second prints a count ≥ 6.

- [ ] **Step 2: Run the analysis tests and watch them fail**

Run:
```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_api.py tests/test_statistical_comparison_exports.py -q
```
Expected: FAIL — requests to `/internal/analysis/...` return 404 because the router still serves bare `/analysis/...`.

- [ ] **Step 3: Move the routes to `/internal` and hide them**

In `app/api/routes_analysis.py`, change the three decorators:

```python
@router.post("/internal/analysis/sites/compare", include_in_schema=False)
```
```python
@router.post("/internal/analysis/routes/compare", include_in_schema=False)
```
```python
@router.get("/internal/analysis/comparisons/{comparison_id}", include_in_schema=False)
```

Leave the function bodies and the `current_user_hash` dependency unchanged.

- [ ] **Step 4: Run the analysis tests and watch them pass**

Run:
```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_api.py tests/test_statistical_comparison_exports.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routes_analysis.py tests/test_statistical_comparison_api.py tests/test_statistical_comparison_exports.py
git commit -m "refactor: internal-gate /analysis endpoints"
```

---

## Task 4: Internal-gate `routes_routes.py`

**Files:**
- Modify: `app/api/routes_routes.py`
- Modify: `tests/test_route_alternatives_api.py`, `tests/test_route_tableau_exports.py`

- [ ] **Step 1: Retarget the route tests to `/internal/routes/*`**

Run:
```bash
perl -pi -e 's{(["\x27])/routes/}{$1/internal/routes/}g' \
  tests/test_route_alternatives_api.py \
  tests/test_route_tableau_exports.py
```

Verify:
```bash
grep -rnE "[\"']/routes/" tests/ ; echo "exit: $?"
grep -rcE "/internal/routes/" tests/test_route_alternatives_api.py
```
Expected: first grep prints nothing and `exit: 1`; second prints a count ≥ 12.

- [ ] **Step 2: Run the route tests and watch them fail**

Run:
```bash
.venv/bin/python -m pytest tests/test_route_alternatives_api.py tests/test_route_tableau_exports.py -q
```
Expected: FAIL — `/internal/routes/...` 404s (router still on bare paths). (Tests that also call `/crime/ingest/sample` keep working — that router is untouched until Task 6.)

- [ ] **Step 3: Move the routes to `/internal` and hide them**

In `app/api/routes_routes.py`, change the two decorators:

```python
@router.post("/internal/routes/alternatives", include_in_schema=False)
```
```python
@router.get("/internal/routes/requests/{request_id}/comparison", include_in_schema=False)
```

Leave the bodies and `current_user_hash` unchanged.

- [ ] **Step 4: Run the route tests and watch them pass**

Run:
```bash
.venv/bin/python -m pytest tests/test_route_alternatives_api.py tests/test_route_tableau_exports.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routes_routes.py tests/test_route_alternatives_api.py tests/test_route_tableau_exports.py
git commit -m "refactor: internal-gate /routes endpoints"
```

---

## Task 5: Internal-gate `routes_imports.py`

**Files:**
- Modify: `app/api/routes_imports.py`
- Modify: `tests/test_api_flow.py`, `tests/test_dashboard_summary.py`, `tests/test_tableau_export.py`, `tests/test_commute_scenario_parser.py`, `tests/test_recurring_places_parser.py`

- [ ] **Step 1: Retarget the imports references to `/internal/imports`**

This replaces `/imports` and its sub-paths (`/imports/{id}`, `/imports/{id}/normalize`). `test_api_flow.py` already uses `/internal/places` and `/internal/exports/...`; this only changes its `/imports*` references.

Run:
```bash
perl -pi -e 's{(["\x27])/imports}{$1/internal/imports}g' \
  tests/test_api_flow.py \
  tests/test_dashboard_summary.py \
  tests/test_tableau_export.py \
  tests/test_commute_scenario_parser.py \
  tests/test_recurring_places_parser.py
```

Verify (the negative grep must exclude the new `/internal/imports`):
```bash
grep -rnE "[\"']/imports" tests/ | grep -v "/internal/imports" ; echo "exit: $?"
```
Expected: prints nothing and `exit: 1` (every bare `/imports` is now `/internal/imports`).

- [ ] **Step 2: Run the affected tests and watch them fail**

Run:
```bash
.venv/bin/python -m pytest tests/test_api_flow.py tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_commute_scenario_parser.py tests/test_recurring_places_parser.py -q
```
Expected: FAIL — `/internal/imports*` 404s (router still on bare paths).

- [ ] **Step 3: Move the routes to `/internal` and hide them**

In `app/api/routes_imports.py`, change the three decorators:

```python
@router.post("/internal/imports", include_in_schema=False)
```
```python
@router.get("/internal/imports/{import_id}", include_in_schema=False)
```
```python
@router.post("/internal/imports/{import_id}/normalize", include_in_schema=False)
```

Leave the bodies and `current_user_hash` unchanged.

- [ ] **Step 4: Run the affected tests and watch them pass**

Run:
```bash
.venv/bin/python -m pytest tests/test_api_flow.py tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_commute_scenario_parser.py tests/test_recurring_places_parser.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routes_imports.py tests/test_api_flow.py tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_commute_scenario_parser.py tests/test_recurring_places_parser.py
git commit -m "refactor: internal-gate /imports endpoints"
```

---

## Task 6: Internal-gate `routes_crime.py`

**Files:**
- Modify: `app/api/routes_crime.py`
- Modify: `tests/test_route_alternatives_api.py`, `tests/test_api_flow.py`, `tests/test_dashboard_summary.py`, `tests/test_tableau_export.py`, `tests/test_route_tableau_exports.py`

- [ ] **Step 1: Retarget the crime references to `/internal/crime/*`**

Only `/crime/ingest/sample` and `/crime/summarize` move. The admin path `/admin/crime/ingest/socrata` is a different router and MUST NOT change — the patterns below are anchored to the exact paths so it is untouched.

Run:
```bash
perl -pi -e 's{/crime/ingest/sample}{/internal/crime/ingest/sample}g; s{/crime/summarize}{/internal/crime/summarize}g' \
  tests/test_route_alternatives_api.py \
  tests/test_api_flow.py \
  tests/test_dashboard_summary.py \
  tests/test_tableau_export.py \
  tests/test_route_tableau_exports.py
```

Verify the admin path is intact and no bare crime paths remain:
```bash
grep -rnE "[\"']/crime/(ingest/sample|summarize)" tests/ ; echo "exit: $?"
grep -rn "/admin/crime/ingest/socrata" tests/ | head
```
Expected: first grep prints nothing and `exit: 1`; second still shows the admin path (unchanged) if any test used it.

- [ ] **Step 2: Run the affected tests and watch them fail**

Run:
```bash
.venv/bin/python -m pytest tests/test_route_alternatives_api.py tests/test_api_flow.py tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_route_tableau_exports.py -q
```
Expected: FAIL — `/internal/crime/...` 404s (router still on bare paths).

- [ ] **Step 3: Move the routes to `/internal` and hide them**

In `app/api/routes_crime.py`, change the two decorators:

```python
@router.post("/internal/crime/ingest/sample", include_in_schema=False)
```
```python
@router.post("/internal/crime/summarize", include_in_schema=False)
```

Leave the bodies and dependencies unchanged. (`/internal/crime/ingest/sample` stays unauthenticated — acceptable now that it is hidden and internal-only; it seeds bundled sample data for dev/test.)

- [ ] **Step 4: Run the affected tests and watch them pass**

Run:
```bash
.venv/bin/python -m pytest tests/test_route_alternatives_api.py tests/test_api_flow.py tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_route_tableau_exports.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routes_crime.py tests/test_route_alternatives_api.py tests/test_api_flow.py tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_route_tableau_exports.py
git commit -m "refactor: internal-gate /crime endpoints"
```

---

## Task 7: Codify the public/internal boundary with a guard test

**Files:**
- Create: `tests/test_internal_surface.py`

- [ ] **Step 1: Write the guard test**

Create `tests/test_internal_surface.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app

PUBLIC_PATHS = {
    "/sessions",
    "/places",
    "/places/bulk",
    "/dashboard/summary",
    "/dashboard/analyze",
    "/dashboard/incidents",
    "/dashboard/compare",
    "/dashboard/neighborhood",
    "/assistant/chat",
    "/exports/tableau/place-summary.csv",
}

# After internal-gating, none of these may appear in the public OpenAPI schema.
FORBIDDEN_PREFIXES = ("/internal/", "/analysis/", "/routes/", "/imports", "/crime/")


def _schema_paths(tmp_path) -> set[str]:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    return set(schema["paths"].keys())


def test_public_paths_present_in_schema(tmp_path):
    paths = _schema_paths(tmp_path)
    missing = sorted(p for p in PUBLIC_PATHS if p not in paths)
    assert missing == [], f"expected public paths missing from schema: {missing}"


def test_legacy_and_internal_paths_absent_from_schema(tmp_path):
    paths = _schema_paths(tmp_path)
    offenders = sorted(p for p in paths if p.startswith(FORBIDDEN_PREFIXES))
    assert offenders == [], f"paths leaked into public OpenAPI schema: {offenders}"


def test_internal_endpoint_still_served(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    # Hidden from schema, but still reachable with the demo-identity fallback.
    response = client.post("/internal/crime/ingest/sample")
    assert response.status_code == 200
    assert "inserted_count" in response.json()
```

- [ ] **Step 2: Run the guard test**

Run:
```bash
.venv/bin/python -m pytest tests/test_internal_surface.py -q
```
Expected: PASS. (If `test_legacy_and_internal_paths_absent_from_schema` fails, the offenders list names exactly which router still serves a bare/public path — fix that decorator.)

- [ ] **Step 3: Commit**

```bash
git add tests/test_internal_surface.py
git commit -m "test: guard public vs internal API boundary"
```

---

## Task 8: Sync README API docs to the internal paths

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the two sample-ingest curl examples**

In `README.md`, replace both occurrences of:
```
curl -X POST http://127.0.0.1:8000/crime/ingest/sample
```
with:
```
curl -X POST http://127.0.0.1:8000/internal/crime/ingest/sample
```

- [ ] **Step 2: Update the API reference table rows**

Replace this row:
```
| Routes | `POST /routes/alternatives` · `GET /routes/requests/{id}/comparison` |
```
with:
```
| Routes (internal) | `POST /internal/routes/alternatives` · `GET /internal/routes/requests/{id}/comparison` |
```

Replace this row:
```
| Statistical analysis | `POST /analysis/sites/compare` · `POST /analysis/routes/compare` · `GET /analysis/comparisons/{id}` |
```
with:
```
| Statistical analysis (internal) | `POST /internal/analysis/sites/compare` · `POST /internal/analysis/routes/compare` · `GET /internal/analysis/comparisons/{id}` |
```

Replace this row:
```
| Crime data | `POST /crime/ingest/sample` · `POST /crime/summarize` · `POST /admin/crime/ingest/socrata` |
```
with:
```
| Crime data | `POST /internal/crime/ingest/sample` · `POST /internal/crime/summarize` · `POST /admin/crime/ingest/socrata` |
```

Replace this row:
```
| Internal/demo | `POST /imports` · `GET /imports/{id}` · `POST /imports/{id}/normalize` |
```
with:
```
| Internal/demo | `POST /internal/imports` · `GET /internal/imports/{id}` · `POST /internal/imports/{id}/normalize` |
```

- [ ] **Step 2b: Add a one-line note above the API reference table**

Immediately before the table, add:
```
> Endpoints marked *internal* are hidden from the OpenAPI schema (`/internal/...`), allow
> the demo-identity fallback, and are not called by the dashboard UI. Do not expose them
> on bare public paths — `tests/test_internal_surface.py` enforces this.
```

- [ ] **Step 3: Confirm no stray bare references remain in the README**

Run:
```bash
grep -nE "127\.0\.0\.1:8000/(crime|imports|analysis|routes)/" README.md | grep -v "/internal/" | grep -v "/admin/" ; echo "exit: $?"
```
Expected: prints nothing and `exit: 1`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: sync README to internal-gated API paths"
```

---

## Task 9: Full verification

**Files:** none.

- [ ] **Step 1: Run the whole suite**

Run:
```bash
make test-all
```
Expected: exits 0 — pytest (incl. `tests/test_internal_surface.py`), ruff, frontend tests, frontend build all pass.

- [ ] **Step 2: Confirm the public surface no longer advertises the legacy paths**

Run:
```bash
.venv/bin/python -c "from fastapi.testclient import TestClient; from app.main import create_app; import tempfile, os; d=tempfile.mkdtemp(); c=TestClient(create_app(database_url=f'sqlite+pysqlite:///{os.path.join(d,\"m.sqlite3\")}')); ps=set(c.get('/openapi.json').json()['paths']); print('leaked:', sorted(p for p in ps if p.startswith(('/internal/','/analysis/','/routes/','/imports','/crime/'))))"
```
Expected: `leaked: []`.

- [ ] **Step 3: Confirm only intended files changed**

Run:
```bash
git status --short --branch
git log --oneline main..HEAD
```
Expected: clean tree; commits from Tasks 2–8 present; no edits to `app/config.py`, `app/api/routes_assistant.py`, `app/assistant/localagent_client.py`, `docs/DEPLOY.md`, or `.env.deploy.example`.

---

## Self-review notes (already applied)

- **Spec coverage:** Phase 0 green-baseline (Task 1) + `CLAUDE.md` (Task 2); Phase 1 internal-gating of all four legacy routers (Tasks 3–6); the OpenAPI invariant the spec calls for (Task 7); doc sync (Task 8). Geocoder-provider and consent copy are explicitly deferred per the spec.
- **Auth model:** `current_user_hash` is intentionally retained on the moved routes — once hidden under `/internal`, the demo fallback is no longer on the public surface, which is the spec's goal. Public endpoints already use `required_public_user_hash` and are unchanged.
- **No bare-path regressions:** each router task updates every reference to that router's paths in the same commit, so the suite stays green between tasks; Task 7 then locks the boundary.
- **Coordination:** no task edits any file owned by the `claude/assistant-failover` branch; the `DEPLOY.md` note is left for a post-merge follow-up.
