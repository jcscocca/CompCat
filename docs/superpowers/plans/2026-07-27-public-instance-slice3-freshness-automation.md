# Public instance — Slice 3 (Freshness automation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep an always-on instance's data honest without an operator: a cron sidecar that triggers
the existing admin Socrata ingest once per layer every night, and a schema-hidden `GET /health/data`
probe an external monitor can watch so a dead cron, a broken admin token, or an upstream Socrata
outage surfaces as a 503 instead of silently ageing data.

**Architecture:** Two independent, additive pieces. (1) A second route in the existing
`app/api/routes_health.py` (`include_in_schema=False`, no session) that reads the **already TTL-cached**
per-layer freshness the dashboard uses — no new query load — and compares each layer's `data_through`
against a new `MCA_DATA_STALENESS_DAYS` setting (default 7), returning 200/503 with a per-layer stale
list. Unknown counts as stale, so an unreadable DB or an empty layer is a 503, not a false green.
(2) A compose sidecar in `docker-compose.prod.yml` gated behind an `ops` profile: alpine + `curl` +
`tzdata`, busybox `crond` in the foreground, a mounted crontab firing 03:10 America/Los_Angeles and a
mounted script that POSTs `/admin/crime/ingest/socrata` once per source (reported → arrests → calls,
sequential) over the compose network. Backend + compose only; no frontend work, no user-facing copy.

**Tech Stack:** FastAPI + pydantic-settings, pytest (`.venv/bin/python -m pytest`), ruff
(line-length 100, `select = ["E", "F", "I", "UP", "B"]`), Docker Compose v2 profiles + overlay merge,
alpine/busybox `crond`, `curl`.

**Working context:** Worktree `/Users/jscocca/Repos/compcat/.worktrees/p8-slice3-freshness`, branch
`p8-slice3-freshness` (cut from `origin/main` at `1461604`, which contains slices 1 and 2). Spec:
`docs/superpowers/specs/2026-07-27-public-instance-slice3-freshness-automation-design.md` (committed at
`8bc57c5`, decision-complete — do not re-open decisions). Gate: `make test-all` from the worktree root.
**Prerequisite:** this worktree has no `.venv` yet — run `make install` from the worktree root once
before Task 1, and `cd frontend && npm install` before the gate. Every backend test command below is
`.venv/bin/python -m pytest ...`; the `pytest` shebang in the venv is stale, so never invoke bare
`pytest`.

**Invariant (do not break):** no user-facing copy in this slice. The probe payload speaks only of data
recency (`status`, `layer`, `data_through`, `lag_days`) — never safety, risk, danger, or place
vocabulary. The container healthcheck/liveness probe stays on `/health`: stale data must alert a
monitor, never restart-loop the app container.

---

## Verified wire facts this plan relies on

Read (and, where noted, executed) from this worktree at plan time.

**Health route (`app/api/routes_health.py`)**
- The whole module is 21 lines: `router = APIRouter()` (`:8`), one route `@router.get("/health")`
  (`:11-20`) that opens `get_engine().connect()`, runs `SELECT 1`, and raises
  `HTTPException(503, "database unavailable")` on any exception. It is **in** the OpenAPI schema (no
  `include_in_schema=False`) — the new probe is the hidden one.
- Registered as the first router: `from app.api.routes_health import router as health_router`
  (`app/main.py:16`), `app.include_router(health_router)` (`app/main.py:91`) — no prefix, so the new
  path is literally `/health/data`.
- The container healthcheck pins `/health`, not `/health/data`
  (`docker-compose.yml:` api `healthcheck.test` → `urllib.request.urlopen('http://localhost:8000/health')`).
  Do not touch it.

**Freshness accessor (`app/services/crime_service.py`)**
- `dashboard_freshness_by_layer(session, *, now=monotonic) -> dict[str, dict[str, object]]`
  (`:107-127`) is exactly what `/dashboard/freshness` calls
  (`app/api/routes_public_dashboard.py:30`, `:191-199`). It loops `LAYERS`, serving each layer from
  `_freshness_cache[f"layer:{layer}"]` while `now() < _freshness_expires[...]` and otherwise
  recomputing + re-caching. TTLs: `FRESHNESS_CACHE_TTL_S = 300.0`, calls layer `1800.0`
  (`:45-52`). Reusing it means the probe adds **no** table scans of its own.
- Each layer value is `{"incident_count": int, "data_through": str|None, "earliest": str|None,
  "last_ingested_at": str|None}` (`:73-78`); `data_through` is `max(coalesce(offense_start_utc,
  report_utc))` rendered by `_as_date_str` as a `YYYY-MM-DD` string, or `None` when the layer has no
  rows (`:20-26`, `:64-72`).
- `reset_freshness_cache()` (`:55-58`) is called autouse per test by `tests/conftest.py:26-31`, so a
  probe test's DB can't be answered from another test's cached value.
- Layers are `LAYERS = {reported: (seattle_spd_crime,), arrests: (seattle_spd_arrests,),
  calls: (seattle_spd_911,)}` (`app/crime/sources.py:72-76`). **There is no per-layer enable setting
  anywhere in `app/config.py`** — all three layers are always enabled, so "every enabled layer" means
  every key of `LAYERS`/the freshness dict. The calls layer's rolling 24-month floor
  (`rolling_window=True`, `app/crime/sources.py:56`) bounds the *earliest* row, never `data_through`,
  so one threshold covers all three (spec, Components §2).
- Sessions: `app/db.py` exposes `get_engine()` (`:40`), `get_sessionmaker()` (`:46-49`) and the
  FastAPI dependency `get_session()` (`:52`). The probe must **not** use `Depends(get_session)`: a
  dependency that raises yields a 500, and the spec requires unreadable → 503. Open the session inside
  the handler's `try`.

**Config (`app/config.py`)**
- `Settings(BaseSettings)` with `env_prefix="MCA_"` (`:26`), so `data_staleness_days` reads
  `MCA_DATA_STALENESS_DAYS`. The ingest/data block runs `socrata_base_url` … `socrata_app_token`
  (`:48-52`) then `raw_upload_retention` (`:53`) — the new setting goes between them.
- `get_settings()` is `@lru_cache`d and cleared per test by `tests/conftest.py:11-17`, so
  `monkeypatch.setenv` works for the env-override test.

**Burst limiter (`app/ratelimit.py`)**
- `_BURST_EXEMPT_PREFIXES = ("/health", "/tiles", "/assets", "/basemaps-assets", "/fonts",
  "/dashboard-app", "/docs", "/openapi.json")` (`:121-130`), consumed by
  `path.startswith(_BURST_EXEMPT_PREFIXES)` (`:168-172`) — a **prefix** test, not equality.
  `"/health/data".startswith("/health")` is `True`, so the probe is exempt the moment it exists;
  adding a literal `"/health/data"` entry to that tuple would be dead code. The requirement is
  therefore satisfied by pinning it with a test (Task 2), not by editing the tuple —
  see "Deviations" at the end of this plan.
- Existing exemption test to mirror: `tests/test_ratelimit_api.py:112-118`
  (`MCA_RATE_LIMIT_BURST_PER_MINUTE=1`, then five `GET /health` all 200).

**Admin ingest endpoint (`app/api/routes_admin_crime.py`)**
- `POST /admin/crime/ingest/socrata` (`:38-41`) guarded by `require_admin_ingest_token` (`:26-35`):
  constant-time compare of the `X-Admin-Token` header against `settings.admin_ingest_token`; an unset
  token rejects every request with 403.
- Query params: `limit` (1…5000), `offset`, `start_date`, `end_date`, `mode` in `{page, backfill}`,
  `source` (a `CRIME_SOURCES` key, default `seattle_spd_crime`) (`:42-50`). In `backfill` mode with no
  `start_date` it resumes from the watermark `latest_observed_date(session, source_dataset=source)`
  (`:67-72`) — that is the incremental behavior the sidecar wants for all three sources.
- Existing invocations to mirror (`Makefile:29-58`): `-X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN"`
  against `…/admin/crime/ingest/socrata?source=<key>&mode=backfill&limit=5000`.
- Source keys: `seattle_spd_crime`, `seattle_spd_arrests`, `seattle_spd_911`
  (`app/crime/sources.py:17-19`).

**Prod overlay as merged by slice 1 (`docker-compose.prod.yml`)**
- Current content: `db` with `ports: !reset []`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?…}`,
  `restart: unless-stopped`; `api` with `MCA_DATABASE_URL: ${MCA_DATABASE_URL:?…}`,
  `MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY: ${MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY:?…}`,
  `restart: unless-stopped`. Header comment documents `docker compose -f docker-compose.yml -f
  docker-compose.prod.yml`.
- The base file enumerates the api environment explicitly (`docker-compose.yml:33-97`), so any var not
  listed there never reaches the api container. `MCA_ADMIN_INGEST_TOKEN: ${MCA_ADMIN_INGEST_TOKEN:-}`
  is already listed (`docker-compose.yml:45`), so the *api* side of the admin token is already wired;
  only the sidecar needs it added.
- Base service names are `db` and `api`; the api is reachable in-network at `api:8000`
  (`ports: ["8000:8000"]`, uvicorn on 8000).

**Compose render behavior — verified by running it (Docker Compose v5.1.4, this Mac)**
- **Interpolation happens before profile filtering.** A profile-gated service containing
  `${MCA_ADMIN_INGEST_TOKEN:?…}` makes a *plain* `docker compose config` (no `--profile`) fail with
  `error while interpolating services.ingest-cron.environment.MCA_ADMIN_INGEST_TOKEN: required
  variable … is missing a value`. So the sidecar must **not** use `:?` for the token — that would
  break the slice-1 render tests and every non-ops render.
- **Env passthrough list form works and needs no interpolation:** `environment: [- MCA_ADMIN_INGEST_TOKEN,
  - TZ=America/Los_Angeles]`. Rendered without `--profile ops` with the token unset: exit 0, zero
  occurrences of `ingest-cron`. Rendered with `--profile ops` and `MCA_ADMIN_INGEST_TOKEN=tok`: the
  service appears with `MCA_ADMIN_INGEST_TOKEN: tok`, `TZ: America/Los_Angeles`, both bind mounts,
  `depends_on: api: condition: service_healthy`, `restart: unless-stopped`.
- Existing render tests already require `POSTGRES_PASSWORD`, `MCA_DATABASE_URL` **and**
  `MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY` in the environment for *any* render
  (`tests/test_compose_prod_overlay.py:66-106`), with `--env-file /dev/null` so a stray repo-root
  `.env` cannot supply them. New tests reuse that `_render` helper.
- `tests/test_compose_prod_overlay.py:18-26` asserts on the overlay **file text**:
  `"ports: !reset []"`, `"${POSTGRES_PASSWORD:?"`, `"${MCA_DATABASE_URL:?"`,
  `text.count("restart: unless-stopped") == 2`, and `":-" not in text`. Two consequences: the sidecar
  may contain **no** `:-` default anywhere, and that count becomes **3** once the sidecar restarts too
  (the *rendered* count in the no-profile render test stays 2, which doubles as a profile-gating
  assertion).

**Sidecar image — verified by running containers**
- `alpine:3.22` + `apk add --no-cache curl tzdata` builds and runs (`curl 8.14.1`). Plain
  `docker run -e TZ=America/Los_Angeles alpine:3.22 date` prints **UTC** — musl silently ignores a
  zone name with no tzdata, which would drift the nightly run by an hour across DST. With `tzdata`
  installed the same env var yields `PDT`. That is why the image is not bare alpine/busybox.
- `busybox:1.37`'s wget *does* support `--header` and `--post-data`, but has no `--fail`-style
  status handling and writes the body to a file by default; `curl -sS --fail` prints
  `curl: (22) The requested URL returned error: 403` / `curl: (7) Failed to connect …` on stderr,
  which is the "failures land in the container log with cause" the spec asks for. **Choice: alpine +
  curl + tzdata via a two-line Dockerfile under `deploy/`** — ~13 MB base, one `apk add`, deterministic
  (no install at container start), correct local time, and readable failures. The crontab and the
  script are *mounted*, not baked, so the schedule can be edited without a rebuild.
- busybox `crond` **passes the container environment through to jobs** (verified: a job printed
  `token=[secret-abc] tz=America/Los_Angeles`) and fires on container-local time (job ran at
  `19:47 PDT`). `crond -f -d 8` logs each job start to stderr; redirecting a job's own output to
  `/proc/1/fd/1` (crond is PID 1) puts it in `docker logs`. The crontab file needs a trailing newline.
- `date "+%Y-%m-%dT%H:%M:%S%z"` works in the image (busybox date); `date -Iseconds` is not relied on.

---

## Task 1: `MCA_DATA_STALENESS_DAYS` + the `GET /health/data` probe

**Files:**
- Modify: `app/config.py`
- Modify: `app/api/routes_health.py`
- Create: `tests/test_health_data_probe.py`

- [x] **Step 1: Write the failing test**

Create `tests/test_health_data_probe.py`:

```python
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import app.api.routes_health as health_module
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident

_SOURCES = {
    "reported": "seattle_spd_crime",
    "arrests": "seattle_spd_arrests",
    "calls": "seattle_spd_911",
}


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'probe.sqlite3'}")
    return TestClient(app)


def _seed(layer_ages: dict[str, int]) -> None:
    """One incident per layer, `age` days before today (UTC) — the probe reads
    max(coalesce(offense_start_utc, report_utc)) per layer."""
    today = datetime.now(UTC)
    session = get_sessionmaker()()
    for layer, age in layer_ages.items():
        session.add(
            CrimeIncident(
                id=f"{layer}-{age}",
                source_dataset=_SOURCES[layer],
                offense_start_utc=today - timedelta(days=age),
                offense_category="PROPERTY",
                latitude=47.6,
                longitude=-122.3,
            )
        )
    session.commit()
    session.close()


def _iso_days_ago(age: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=age)).isoformat()


def test_all_layers_fresh_returns_200(tmp_path) -> None:
    client = _client(tmp_path)
    _seed({"reported": 0, "arrests": 1, "calls": 2})
    response = client.get("/health/data")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "stale": []}


def test_one_stale_layer_returns_503_and_names_it(tmp_path) -> None:
    client = _client(tmp_path)
    _seed({"reported": 1, "arrests": 1, "calls": 30})
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "stale"
    assert body["stale"] == [
        {"layer": "calls", "data_through": _iso_days_ago(30), "lag_days": 30}
    ]


def test_every_layer_stale_is_reported(tmp_path) -> None:
    client = _client(tmp_path)
    _seed({"reported": 9, "arrests": 12, "calls": 40})
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert [entry["layer"] for entry in body["stale"]] == ["reported", "arrests", "calls"]
    assert [entry["lag_days"] for entry in body["stale"]] == [9, 12, 40]


def test_a_layer_with_no_data_counts_as_stale(tmp_path) -> None:
    # Unknown = stale: an empty database must never read as green.
    client = _client(tmp_path)
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert [entry["layer"] for entry in body["stale"]] == ["reported", "arrests", "calls"]
    assert all(entry["data_through"] is None for entry in body["stale"])
    assert all(entry["lag_days"] is None for entry in body["stale"])


def test_unreadable_freshness_returns_503(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path)
    _seed({"reported": 0, "arrests": 0, "calls": 0})

    def boom(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(health_module, "dashboard_freshness_by_layer", boom)
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unknown"
    assert [entry["layer"] for entry in body["stale"]] == ["reported", "arrests", "calls"]


def test_threshold_boundary_is_inclusive(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Exactly MCA_DATA_STALENESS_DAYS days of lag is still fresh; one more is not.
    monkeypatch.setenv("MCA_DATA_STALENESS_DAYS", "7")
    client = _client(tmp_path)
    _seed({"reported": 7, "arrests": 7, "calls": 7})
    response = client.get("/health/data")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "stale": []}


def test_one_day_past_the_threshold_is_stale(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCA_DATA_STALENESS_DAYS", "7")
    client = _client(tmp_path)
    _seed({"reported": 8, "arrests": 7, "calls": 7})
    response = client.get("/health/data")
    assert response.status_code == 503
    assert [entry["layer"] for entry in response.json()["stale"]] == ["reported"]


def test_threshold_is_configurable(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCA_DATA_STALENESS_DAYS", "60")
    client = _client(tmp_path)
    _seed({"reported": 30, "arrests": 45, "calls": 59})
    assert client.get("/health/data").status_code == 200


def test_default_threshold_is_seven_days() -> None:
    from app.config import Settings

    assert Settings(_env_file=None).data_staleness_days == 7


def test_probe_payload_uses_only_recency_vocabulary(tmp_path) -> None:
    # Product invariant: the probe describes data recency, never safety or places.
    client = _client(tmp_path)
    _seed({"reported": 40, "arrests": 40, "calls": 40})
    text = client.get("/health/data").text.lower()
    for banned in ("safe", "unsafe", "safety", "danger", "risk", "address", "neighborhood"):
        assert banned not in text


def test_probe_needs_no_session(tmp_path) -> None:
    # No POST /sessions first: an external monitor holds no cookie.
    client = _client(tmp_path)
    _seed({"reported": 0, "arrests": 0, "calls": 0})
    assert client.get("/health/data").status_code == 200


def test_liveness_probe_is_unchanged(tmp_path) -> None:
    # The container healthcheck stays on /health: stale data must not restart the app.
    client = _client(tmp_path)
    _seed({"reported": 400, "arrests": 400, "calls": 400})
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/health/data").status_code == 503


def test_lag_days_helper_handles_unparseable_values() -> None:
    today = date(2026, 7, 27)
    assert health_module._lag_days("2026-07-20", today) == 7
    assert health_module._lag_days(None, today) is None
    assert health_module._lag_days("not-a-date", today) is None
    assert health_module._lag_days(20260720, today) is None
```

- [x] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_health_data_probe.py -v`
Expected: FAIL — every probe test 404s (`/health/data` does not exist),
`test_default_threshold_is_seven_days` fails with
`AttributeError: 'Settings' object has no attribute 'data_staleness_days'`, and
`test_lag_days_helper_handles_unparseable_values` fails with
`AttributeError: module 'app.api.routes_health' has no attribute '_lag_days'`.
`test_liveness_probe_is_unchanged` fails only on its second assertion.

- [x] **Step 3: Add the setting**

In `app/config.py`, insert directly after
`socrata_app_token: str | None = Field(default=None, validation_alias="SOCRATA_APP_TOKEN")` and before
`raw_upload_retention: bool = False`:

```python
    # Data-recency threshold for the monitoring probe GET /health/data: a layer whose newest
    # incident date lags more than this many days is reported stale (503) so an external monitor
    # catches a dead ingest cron, a broken admin token, or an upstream Socrata outage. A lag of
    # exactly this many days is still fresh. Liveness stays on /health — staleness alerts, it
    # never restarts the container.
    data_staleness_days: int = 7
```

- [x] **Step 4: Add the probe**

Replace `app/api/routes_health.py` in full:

```python
from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.crime.sources import LAYERS
from app.db import get_engine, get_sessionmaker
from app.services.crime_service import dashboard_freshness_by_layer

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    # Readiness probe: confirm the database is reachable, not just that the process is up,
    # so an orchestrator/healthcheck can tell "serving" from "running but DB is down".
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any DB/connection failure means not-ready
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok"}


def _lag_days(data_through: object, today: date) -> int | None:
    """Days between a layer's newest incident date and today, or None when that date is
    missing or unparseable (which the caller treats as stale)."""
    if not isinstance(data_through, str):
        return None
    try:
        return (today - date.fromisoformat(data_through)).days
    except ValueError:
        return None


@router.get("/health/data", include_in_schema=False)
def health_data() -> JSONResponse:
    """Data-recency probe for an external uptime monitor — deliberately not the container
    healthcheck (that stays on /health): a dead ingest cron, a rejected admin token, or an
    upstream Socrata outage must page someone, not restart-loop the app.

    Hidden from the schema and session-free: it exposes only per-layer data_through/lag, which
    /dashboard/freshness already serves. Reads the freshness values the dashboard has cached
    in-process, so polling it adds no table scans. Unknown counts as stale.
    """
    threshold = get_settings().data_staleness_days
    today = datetime.now(UTC).date()
    try:
        with get_sessionmaker()() as session:
            freshness = dashboard_freshness_by_layer(session)
    except Exception:  # noqa: BLE001 — unreadable freshness is stale, not healthy
        unknown = [
            {"layer": layer, "data_through": None, "lag_days": None} for layer in LAYERS
        ]
        return JSONResponse(status_code=503, content={"status": "unknown", "stale": unknown})

    stale: list[dict[str, object]] = []
    for layer, values in freshness.items():
        data_through = values.get("data_through")
        lag_days = _lag_days(data_through, today)
        if lag_days is None or lag_days > threshold:
            stale.append(
                {
                    "layer": layer,
                    "data_through": data_through if isinstance(data_through, str) else None,
                    "lag_days": lag_days,
                }
            )
    if stale:
        return JSONResponse(status_code=503, content={"status": "stale", "stale": stale})
    return JSONResponse(status_code=200, content={"status": "ok", "stale": []})
```

- [x] **Step 5: Run to verify it passes, plus the neighbouring health/freshness suites**

Run: `.venv/bin/python -m pytest tests/test_health_data_probe.py tests/test_health.py tests/test_dashboard_freshness.py tests/test_freshness_cache.py -v`
Expected: PASS (13 new tests; the existing health, freshness and cache suites unchanged and green).

Run: `.venv/bin/ruff check .`
Expected: clean (mind the 100-char limit and the import order in the rewritten module).

- [x] **Step 6: Commit**

```bash
git add app/config.py app/api/routes_health.py tests/test_health_data_probe.py
git commit -m "feat(health): schema-hidden /health/data staleness probe with MCA_DATA_STALENESS_DAYS"
```

---

## Task 2: Pin the probe's exposure surface (schema-hidden + burst-exempt)

The probe must stay out of the public OpenAPI schema and stay pollable once a minute by a monitor.
Both properties already hold as implemented (`include_in_schema=False`; `_BURST_EXEMPT_PREFIXES`
matches by prefix, so `/health` covers `/health/data`) — this task pins them so a later edit cannot
regress them silently.

**Files:**
- Modify: `tests/test_internal_surface.py`
- Modify: `tests/test_ratelimit_api.py`

- [x] **Step 1: Write the tests and watch them pass for the right reason**

Append to `tests/test_internal_surface.py`:

```python
def test_data_freshness_probe_absent_from_schema(tmp_path):
    # /health/data is a monitoring probe, not part of the public contract. /health stays
    # documented — it is the container's readiness check.
    paths = _schema_paths(tmp_path)
    assert "/health" in paths
    assert "/health/data" not in paths


def test_data_freshness_probe_still_served(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    # Hidden from the schema, but reachable with no session.
    response = client.get("/health/data")
    assert response.status_code == 503
    assert response.json()["stale"]  # empty DB: unknown recency counts as stale
```

Append to `tests/test_ratelimit_api.py`:

```python
def test_burst_limit_exempts_the_data_freshness_probe(tmp_path, monkeypatch) -> None:
    # An external monitor polls /health/data every minute; the /health prefix in
    # _BURST_EXEMPT_PREFIXES must keep covering it.
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "1")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl7.sqlite3")
    client = TestClient(app)
    for _ in range(5):
        assert client.get("/health/data").status_code != 429
```

- [x] **Step 2: Run them**

Run: `.venv/bin/python -m pytest tests/test_internal_surface.py tests/test_ratelimit_api.py -v`
Expected: PASS (3 new tests). If `test_burst_limit_exempts_the_data_freshness_probe` returns 429, the
exempt tuple no longer covers the probe — add `"/health/data"` to `_BURST_EXEMPT_PREFIXES`
(`app/ratelimit.py:121-130`) and re-run. Sanity-check the pinning by temporarily deleting
`include_in_schema=False` from the probe: `test_data_freshness_probe_absent_from_schema` must fail.
Restore it before committing.

- [x] **Step 3: Commit**

```bash
git add tests/test_internal_surface.py tests/test_ratelimit_api.py
git commit -m "test(health): pin /health/data as schema-hidden and burst-exempt"
```

---

## Task 3: Nightly ingest sidecar under the compose `ops` profile

**Choice recorded (image):** `alpine:3.22` + `apk add --no-cache curl tzdata` via a two-line Dockerfile
at `deploy/ingest-cron.Dockerfile`, running busybox `crond -f -d 8`. Bare busybox was rejected on two
verified grounds: its wget has no `--fail`-equivalent (failure cause would not reach `docker logs` as
cleanly as `curl: (22) …`), and with no tzdata musl silently resolves `TZ=America/Los_Angeles` to UTC,
which would drift the nightly run by an hour across DST. Installing at build time (not at container
start) keeps restarts deterministic and offline-safe. The crontab and the job script are bind-mounted
rather than baked, so the schedule can be changed without rebuilding the image.

**Files:**
- Create: `deploy/ingest-cron.Dockerfile`
- Create: `deploy/ingest-cron.crontab`
- Create: `deploy/ingest-daily.sh`
- Modify: `docker-compose.prod.yml`
- Modify: `tests/test_compose_prod_overlay.py`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Write the failing tests**

In `tests/test_compose_prod_overlay.py`, extend the module constants (after `_PROD`):

```python
_DEPLOY = _ROOT / "deploy"
_CRONTAB = _DEPLOY / "ingest-cron.crontab"
_JOB = _DEPLOY / "ingest-daily.sh"
_DOCKERFILE = _DEPLOY / "ingest-cron.Dockerfile"
```

Update the existing file-text assertion (`test_overlay_documents_its_own_usage_and_sources_secrets_from_env`)
— the count moves from 2 to 3 now that the sidecar restarts too:

```python
    # db, api, and the ops-profile ingest sidecar.
    assert text.count("restart: unless-stopped") == 3
```

Give `_render` a `profiles` parameter (the rest of the helper is unchanged):

```python
def _render(
    env_overrides: dict[str, str],
    drop: tuple[str, ...] = (),
    profiles: tuple[str, ...] = (),
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_overrides)
    for name in drop:
        env.pop(name, None)
    profile_args: list[str] = []
    for profile in profiles:
        profile_args += ["--profile", profile]
    return subprocess.run(
        [
            "docker",
            "compose",
            # /dev/null so a stray repo-root .env cannot supply the required variables.
            "--env-file",
            "/dev/null",
            *profile_args,
            "-f",
            str(_BASE),
            "-f",
            str(_PROD),
            "config",
        ],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
```

Then append the sidecar tests at the end of the file:

```python
# ---------- nightly ingest sidecar (ops profile) ----------

_BASE_ENV = {
    "POSTGRES_PASSWORD": _TEST_PASSWORD,
    "MCA_DATABASE_URL": _TEST_DATABASE_URL,
    "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
}


def test_sidecar_is_absent_without_the_ops_profile() -> None:
    # Dev/demo and the plain prod stack must be unaffected by the automation.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(_BASE_ENV, drop=("MCA_ADMIN_INGEST_TOKEN",))
    assert result.returncode == 0, result.stderr
    assert "ingest-cron" not in result.stdout
    # Only db and api restart in the default rendering.
    assert result.stdout.count("restart: unless-stopped") == 2


def test_sidecar_renders_under_the_ops_profile() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {**_BASE_ENV, "MCA_ADMIN_INGEST_TOKEN": "ci-not-a-real-token"}, profiles=("ops",)
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert "ingest-cron" in rendered
    assert "MCA_ADMIN_INGEST_TOKEN: ci-not-a-real-token" in rendered
    assert "TZ: America/Los_Angeles" in rendered
    assert "target: /etc/crontabs/root" in rendered
    assert 'published: "5432"' not in rendered  # the overlay's own guarantee still holds


def test_crontab_fires_once_daily_and_holds_no_secret() -> None:
    text = _CRONTAB.read_text(encoding="utf-8")
    schedule_lines = [
        line for line in text.splitlines() if line.strip() and not line.startswith("#")
    ]
    assert len(schedule_lines) == 1
    assert schedule_lines[0].startswith("10 3 * * *")
    # The token is an env reference resolved at run time; it is never written into this file.
    assert "MCA_ADMIN_INGEST_TOKEN" not in text
    assert "X-Admin-Token" not in text
    assert text.endswith("\n")  # crond ignores a crontab without a trailing newline


def test_job_script_posts_every_layer_in_order_using_the_env_token() -> None:
    text = _JOB.read_text(encoding="utf-8")
    order = [
        text.index("seattle_spd_crime"),
        text.index("seattle_spd_arrests"),
        text.index("seattle_spd_911"),
    ]
    assert order == sorted(order)
    assert '"X-Admin-Token: ${MCA_ADMIN_INGEST_TOKEN}"' in text
    assert "http://api:8000" in text  # reached over the compose network, not the host
    assert "mode=backfill" in text  # incremental from the stored watermark
    assert "-sS --fail" in text  # non-2xx cause lands in docker logs


def test_sidecar_image_is_pinned_and_installs_tzdata() -> None:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    assert "FROM alpine:3.22" in text
    # tzdata is load-bearing: without it musl resolves TZ=America/Los_Angeles to UTC.
    assert "tzdata" in text
    assert "curl" in text
```

- [x] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: FAIL — the three file-text tests raise `FileNotFoundError` (nothing under `deploy/` yet),
`test_sidecar_renders_under_the_ops_profile` fails on `"ingest-cron" in rendered`, and the updated
`restart: unless-stopped` count assertion fails at 2 != 3. The two slice-1 render tests still pass.

- [x] **Step 3: Create the sidecar image definition**

Create `deploy/ingest-cron.Dockerfile`:

```dockerfile
# Nightly SPD ingest sidecar (docker-compose.prod.yml, "ops" profile). Alpine + curl for a
# readable failure cause in `docker logs`, + tzdata because musl silently resolves an unknown
# TZ name to UTC — which would drift the 03:10 America/Los_Angeles run across DST.
FROM alpine:3.22
RUN apk add --no-cache curl tzdata
```

Create `deploy/ingest-cron.crontab` (mounted at `/etc/crontabs/root`; trailing newline required):

```
# Nightly SPD ingest, 03:10 America/Los_Angeles (TZ is set on the container). SPD datasets
# update daily; this hour is quiet and local to the data. The job's own output goes to PID 1's
# stdout (crond), which is the container log — `docker logs <stack>-ingest-cron-1`.
10 3 * * * /bin/sh /etc/ingest/run.sh >> /proc/1/fd/1 2>&1
```

Create `deploy/ingest-daily.sh` (mounted at `/etc/ingest/run.sh`):

```sh
#!/bin/sh
# Triggers the app's existing admin Socrata ingest once per layer, sequentially. All the hard
# parts (watermark, paging, retry/backoff, rolling-window purge) live in the endpoint; this
# script only fires it and makes failures legible in `docker logs`.
#
# Sequential on purpose: overlapping Socrata paging loops would fight for the same rate limit.
# Each layer runs even if an earlier one failed, and a failing layer is reported without
# retrying here (the endpoint already retries; /health/data is the alert path if data ages).
set -u

API_BASE="${INGEST_API_BASE:-http://api:8000}"
PAGE_LIMIT="${INGEST_PAGE_LIMIT:-5000}"

log() {
	echo "[$(date "+%Y-%m-%dT%H:%M:%S%z")] ingest-cron: $*"
}

if [ -z "${MCA_ADMIN_INGEST_TOKEN:-}" ]; then
	log "MCA_ADMIN_INGEST_TOKEN is not set — refusing to run"
	exit 1
fi

status=0
for source in seattle_spd_crime seattle_spd_arrests seattle_spd_911; do
	log "${source}: starting"
	if curl -sS --fail --max-time 3600 -X POST \
		-H "X-Admin-Token: ${MCA_ADMIN_INGEST_TOKEN}" \
		"${API_BASE}/admin/crime/ingest/socrata?source=${source}&mode=backfill&limit=${PAGE_LIMIT}"
	then
		echo ""
		log "${source}: ok"
	else
		status=1
		log "${source}: FAILED (curl error above)"
	fi
done

exit "${status}"
```

Then: `chmod +x deploy/ingest-daily.sh` (cron invokes it through `/bin/sh` either way, but the exec
bit keeps it runnable by hand during the slice-4 bring-up check).

- [x] **Step 4: Add the service to the production overlay**

Append to `docker-compose.prod.yml` (after the `api` service; keep the file free of `:-` defaults —
`tests/test_compose_prod_overlay.py` asserts there are none):

```yaml
  # Nightly ingest automation. Only starts with an explicit profile:
  #
  #   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile ops up -d --build
  #
  # Dev/demo stacks and a plain prod bring-up never render it. MCA_ADMIN_INGEST_TOKEN is passed
  # through from the operator's environment (list form, not interpolation — a "${VAR:?}" here
  # would break every render that does not use the profile, since Compose interpolates the whole
  # file before it filters by profile) and never appears in the crontab.
  ingest-cron:
    profiles: ["ops"]
    build:
      context: .
      dockerfile: deploy/ingest-cron.Dockerfile
    command: ["crond", "-f", "-d", "8"]
    environment:
      - MCA_ADMIN_INGEST_TOKEN
      - TZ=America/Los_Angeles
    volumes:
      - ./deploy/ingest-cron.crontab:/etc/crontabs/root:ro
      - ./deploy/ingest-daily.sh:/etc/ingest/run.sh:ro
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
```

- [x] **Step 5: Run to verify the tests pass**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: PASS (9 tests: 3 from slice 1 + 6 new). If the render tests skip, the Docker CLI is missing
locally — CI still enforces them via Step 7.

- [x] **Step 6: Verify the sidecar by hand (renders, and the schedule/token wiring is real)**

Run from the worktree root:

```bash
POSTGRES_PASSWORD=x MCA_DATABASE_URL=x MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY=0 \
MCA_ADMIN_INGEST_TOKEN=not-a-real-token \
docker compose --env-file /dev/null --profile ops \
  -f docker-compose.yml -f docker-compose.prod.yml config | sed -n '/ingest-cron/,/^networks/p'
```

Expected: the service block with `MCA_ADMIN_INGEST_TOKEN: not-a-real-token`, `TZ: America/Los_Angeles`,
both read-only bind mounts, and `restart: unless-stopped`. Then a live smoke of the cron mechanics
(image + schedule + env passthrough + logging), without waiting for 03:10:

```bash
docker build -f deploy/ingest-cron.Dockerfile -t compcat-ingest-cron .
printf '* * * * * /bin/sh /etc/ingest/run.sh >> /proc/1/fd/1 2>&1\n' > /tmp/cron-smoke
docker run -d --name compcat-cron-smoke -e MCA_ADMIN_INGEST_TOKEN=not-a-real-token \
  -e TZ=America/Los_Angeles -e INGEST_API_BASE=http://127.0.0.1:9 \
  -v /tmp/cron-smoke:/etc/crontabs/root:ro \
  -v "$PWD/deploy/ingest-daily.sh:/etc/ingest/run.sh:ro" compcat-ingest-cron crond -f -d 8
sleep 75 && docker logs compcat-cron-smoke && docker rm -f compcat-cron-smoke
```

Expected in the log: `crond … started`, one `USER root … cmd /bin/sh /etc/ingest/run.sh` line, then
three `ingest-cron: <source>: starting` / `FAILED (curl error above)` pairs in the order
`seattle_spd_crime` → `seattle_spd_arrests` → `seattle_spd_911`, each preceded by a `curl: (7) Failed
to connect …` line, with timestamps in `-0700`/`-0800` (not `+0000`) — that is tzdata working. Firing
against a real API is the slice-4 bring-up step, not a CI job.

- [x] **Step 7: Add the CI docker-lane assertion**

In `.github/workflows/ci.yml`, append to the `docker` job's existing render step (after the
`test "$(grep -c 'restart: unless-stopped' rendered.yml)" = "2"` line), a second step:

```yaml
      - name: Ingest sidecar renders only under the ops profile
        env:
          POSTGRES_PASSWORD: ci-not-a-real-password
          MCA_DATABASE_URL: postgresql+psycopg://mca:ci-not-a-real-password@db:5432/mca
          MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY: "0"
          MCA_ADMIN_INGEST_TOKEN: ci-not-a-real-token
        run: |
          docker compose --env-file /dev/null --profile ops \
            -f docker-compose.yml -f docker-compose.prod.yml config > rendered-ops.yml
          grep -q 'ingest-cron' rendered-ops.yml
          grep -q 'target: /etc/crontabs/root' rendered-ops.yml
          if grep -q 'ingest-cron' rendered.yml; then
            echo "sidecar must not render without --profile ops" >&2
            exit 1
          fi
```

- [x] **Step 8: Commit**

```bash
git add deploy/ingest-cron.Dockerfile deploy/ingest-cron.crontab deploy/ingest-daily.sh \
  docker-compose.prod.yml tests/test_compose_prod_overlay.py .github/workflows/ci.yml
git commit -m "feat(deploy): nightly SPD ingest sidecar under the compose ops profile"
```

---

## Task 4: Full gate

- [x] **Step 1: Run `make test-all` from the worktree root**

Run: `make test-all`
Expected: green — pytest (backend, including the ~22 new tests), `ruff check .` clean, frontend
`npm test` green, `npm run build` succeeds. The frontend is untouched in this slice, so any frontend
failure is pre-existing; re-run on a clean checkout before investigating.

If `make test` reports a stale-shebang error, run the suite as `.venv/bin/python -m pytest tests -q`
and treat that as the pytest leg.

- [x] **Step 2: Confirm the slice completion criteria**

From the spec, restated as a checklist — verify each before declaring the slice done:

- [x] **1. With the `ops` profile, the cron container fires all three layers sequentially, visible in
  `docker logs`.** Covered structurally by
  `tests/test_compose_prod_overlay.py::test_sidecar_renders_under_the_ops_profile` and
  `::test_job_script_posts_every_layer_in_order_using_the_env_token`, and behaviorally by the Task 3
  Step 6 smoke (short schedule, unreachable API, three ordered failures in the log). Firing against
  live Socrata is a slice-4 bring-up step.
- [x] **2. `/health/data` is 200 on fresh data, 503 when the threshold forces staleness, and absent
  from OpenAPI.** Covered by `tests/test_health_data_probe.py::test_all_layers_fresh_returns_200`,
  `::test_one_day_past_the_threshold_is_stale`, `::test_a_layer_with_no_data_counts_as_stale` and
  `tests/test_internal_surface.py::test_data_freshness_probe_absent_from_schema`. Note the exact
  boundary semantics: with `MCA_DATA_STALENESS_DAYS=0` only data through *today* stays fresh, so a dev
  DB seeded any earlier flips to 503.
- [x] **3. Dev and demo compose behavior unchanged; the sidecar exists only under the prod overlay's
  ops profile.** `docker-compose.yml` and `docker-compose.demo.yml` are untouched (`git diff --stat`
  must show neither), and
  `tests/test_compose_prod_overlay.py::test_sidecar_is_absent_without_the_ops_profile` pins the
  rendering.
- [x] **4. `make test-all` green** (Step 1 above).
- [x] **Invariant:** no user-facing copy. The probe payload carries only `status`, `layer`,
  `data_through`, `lag_days` — pinned by
  `tests/test_health_data_probe.py::test_probe_payload_uses_only_recency_vocabulary`. The container
  healthcheck still points at `/health` (`docker-compose.yml` unchanged), pinned by
  `::test_liveness_probe_is_unchanged`.

- [ ] **Step 3: Hand back to the orchestrator**

Do not push and do not open a PR from this worktree (per the delivery workflow). Report: commits,
`git diff --stat`, test counts, deviations, deferrals.

---

## Deviations recorded up front

- **The burst-limiter exempt tuple is not edited.** `_BURST_EXEMPT_PREFIXES` is consumed by
  `path.startswith(...)` (`app/ratelimit.py:168-172`), so the existing `"/health"` entry already
  exempts `/health/data`; adding a literal would be dead code. The behavior the spec asks for is
  pinned by a test instead (Task 2). If that test ever fails, add the literal.
- **`MCA_DATA_STALENESS_DAYS` is not forwarded in the compose files.** The base file enumerates the api
  environment explicitly, so forwarding it would mean either a `:-` default (banned by the overlay's
  own test) or a new hard-required variable for every render. The default of 7 is the intended
  production value; wiring an override belongs with `.env.prod.example` in slice 4.

## Out of scope (do not do here)

- Any frontend change, and any user-facing copy — including staleness banners beyond the existing
  freshness pill.
- Alerting integrations (email/pager) and choosing the external monitor — slice-4 runbook.
- Editing `docker-compose.yml`, `docker-compose.demo.yml`, the container healthcheck, or the personal
  ThinkPad deploy path (`scripts/start-compcat.ps1`).
- Backfill-window changes, new datasets, ingest-stats rows, or any change to the ingest endpoint's
  internals (watermark, paging, retry/backoff).
- `.env.prod.example`, VPS bring-up, reverse proxy, TLS, or `docs/DEPLOY.md` updates (slice 4).
