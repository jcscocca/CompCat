# Analysis Run Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `place_crime_summaries` from being a single mutable scratch table per user. Today every analyze run runs `DELETE FROM place_crime_summaries WHERE user_id_hash = …` then writes only the current selection, so analyzing different places silently wipes prior summaries and the dashboard totals / exports / assistant context go stale. Tie summaries to an `AnalysisRun`; reads use the user's latest run, so totals are trustworthy with multiple testers.

**Architecture:** Add an `AnalysisRun` row per analyze run (filters + timestamp) and an `analysis_run_id` column on `PlaceCrimeSummary`. The two write paths create a run, attach summaries to it, and **stop deleting**. The three read paths scope to the user's latest run (chosen by `created_at`), which is correct because the frontend fetches `/dashboard/summary` immediately after each analyze.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, pytest.

**Context (read before starting):** `app/models.py` (model style: `Mapped`/`mapped_column`, `new_id`, `utc_now`), `app/services/dashboard_analysis_service.py` (write path 1, broad delete at the `session.execute(delete(...))` line), `app/services/crime_service.py` (write path 2 `summarize_for_user` + `_summary_model`), `app/services/dashboard_service.py` / `app/services/export_service.py` / `app/assistant/semantic_layer.py` (the three reads, all `select(PlaceCrimeSummary).where(user_id_hash == …)`), `alembic/versions/0005_crime_filter_idx.py` (migration style; head revision), `tests/test_route_models_migration.py` (migration smoke-test pattern).

---

## File Structure

| File | Change |
|------|--------|
| `app/models.py` | Add `AnalysisRun`; add plain indexed `analysis_run_id` column to `PlaceCrimeSummary` (no DB FK — sqlite-safe, integrity at app layer, per roadmap). |
| `alembic/versions/0006_analysis_runs.py` (new) | Create `analysis_runs` table + `analysis_run_id` column/index. |
| `app/services/analysis_runs.py` (new) | `create_analysis_run(...)` + `latest_analysis_run_id(...)`. |
| `app/services/dashboard_analysis_service.py` | Write path 1: create run, attach, drop the broad delete. |
| `app/services/crime_service.py` | Write path 2 (`summarize_for_user`): same. |
| `app/services/dashboard_service.py` | Read scoped to latest run. |
| `app/services/export_service.py` | Read scoped to latest run. |
| `app/assistant/semantic_layer.py` | Direct `PlaceCrimeSummary` read scoped to latest run. |
| tests | New + updated under `tests/`. |

---

## Task 1: AnalysisRun model + column + migration

**Files:** Modify `app/models.py`; create `alembic/versions/0006_analysis_runs.py`; create `tests/test_analysis_run_model.py`.

- [ ] **Step 1: Write the failing model test** (`tests/test_analysis_run_model.py`). Use the same in-memory/temp-DB session bootstrap the existing model tests use (e.g. `create_app(database_url=...)` + `get_sessionmaker()()`; read `tests/test_route_models_migration.py` for the pattern):

```python
from datetime import date

from app.models import AnalysisRun, PlaceCrimeSummary


def test_summary_can_attach_to_an_analysis_run(db_session):  # reuse the project's session fixture/bootstrap
    run = AnalysisRun(
        user_id_hash="u1", analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        radii_m_json="[250]", offense_category=None, offense_subcategory=None, nibrs_group=None,
    )
    db_session.add(run)
    db_session.flush()
    summary = PlaceCrimeSummary(
        user_id_hash="u1", place_cluster_id="p1", radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        incident_count=3, analysis_run_id=run.id,
    )
    db_session.add(summary)
    db_session.flush()
    assert run.id is not None
    assert summary.analysis_run_id == run.id
```

If there is no shared `db_session` fixture, construct the session inline exactly as `tests/test_route_models_migration.py` does.

- [ ] **Step 2: Verify it fails** — `.venv/bin/python -m pytest tests/test_analysis_run_model.py -q` → FAIL (`cannot import name 'AnalysisRun'`).

- [ ] **Step 3: Implement the model + column.** In `app/models.py`, add after `PlaceCrimeSummary`:

```python
class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    analysis_start_date: Mapped[date] = mapped_column(Date)
    analysis_end_date: Mapped[date] = mapped_column(Date)
    radii_m_json: Mapped[str] = mapped_column(Text)
    offense_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_subcategory: Mapped[str | None] = mapped_column(Text, nullable=True)
    nibrs_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
```

And add this column to `PlaceCrimeSummary` (plain indexed string, no `ForeignKey` — keeps the sqlite migration trivial; referential integrity stays at the app layer, per the roadmap):

```python
    analysis_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
```

- [ ] **Step 4: Add the migration** `alembic/versions/0006_analysis_runs.py`:

```python
"""analysis run provenance

Revision ID: 0006_analysis_runs
Revises: 0005_crime_filter_idx
Create Date: 2026-06-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_analysis_runs"
down_revision = "0005_crime_filter_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("analysis_start_date", sa.Date(), nullable=False),
        sa.Column("analysis_end_date", sa.Date(), nullable=False),
        sa.Column("radii_m_json", sa.Text(), nullable=False),
        sa.Column("offense_category", sa.Text(), nullable=True),
        sa.Column("offense_subcategory", sa.Text(), nullable=True),
        sa.Column("nibrs_group", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_analysis_runs_user_id_hash", "analysis_runs", ["user_id_hash"])
    op.create_index("ix_analysis_runs_created_at", "analysis_runs", ["created_at"])
    op.add_column(
        "place_crime_summaries",
        sa.Column("analysis_run_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_place_crime_summaries_analysis_run_id", "place_crime_summaries", ["analysis_run_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_place_crime_summaries_analysis_run_id", table_name="place_crime_summaries")
    op.drop_column("place_crime_summaries", "analysis_run_id")
    op.drop_index("ix_analysis_runs_created_at", table_name="analysis_runs")
    op.drop_index("ix_analysis_runs_user_id_hash", table_name="analysis_runs")
    op.drop_table("analysis_runs")
```

- [ ] **Step 5: Add a migration smoke test** mirroring `tests/test_route_models_migration.py` — apply `alembic upgrade head` against a temp sqlite DB and assert the `analysis_runs` table and `place_crime_summaries.analysis_run_id` column exist (use `sqlalchemy.inspect`). Follow that file's exact bootstrap.

- [ ] **Step 6: Verify** — `.venv/bin/python -m pytest tests/test_analysis_run_model.py tests/test_route_models_migration.py -q` → PASS. Then `.venv/bin/ruff check app/models.py alembic/versions/0006_analysis_runs.py`.

- [ ] **Step 7: Commit** — `git add app/models.py alembic/versions/0006_analysis_runs.py tests/test_analysis_run_model.py && git commit -m "feat: add AnalysisRun model and migration"`

---

## Task 2: Analysis-run helpers

**Files:** Create `app/services/analysis_runs.py`; create `tests/test_analysis_runs_service.py`.

- [ ] **Step 1: Failing tests** (`tests/test_analysis_runs_service.py`):

```python
from datetime import date

from app.services.analysis_runs import create_analysis_run, latest_analysis_run_id


def test_latest_returns_most_recent_run(db_session):
    first = create_analysis_run(db_session, user_id_hash="u1", radii_m=[250],
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None)
    second = create_analysis_run(db_session, user_id_hash="u1", radii_m=[500],
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category="PROPERTY", offense_subcategory=None, nibrs_group=None)
    assert first.id != second.id
    assert latest_analysis_run_id(db_session, "u1") == second.id


def test_latest_is_none_without_runs(db_session):
    assert latest_analysis_run_id(db_session, "nobody") is None
```

- [ ] **Step 2: Verify failure** — `.venv/bin/python -m pytest tests/test_analysis_runs_service.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement** `app/services/analysis_runs.py`:

```python
from __future__ import annotations

import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AnalysisRun


def create_analysis_run(
    session: Session,
    *,
    user_id_hash: str,
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> AnalysisRun:
    run = AnalysisRun(
        user_id_hash=user_id_hash,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        radii_m_json=json.dumps(sorted(radii_m)),
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
    )
    session.add(run)
    session.flush()  # populate run.id within the caller's transaction
    return run


def latest_analysis_run_id(session: Session, user_id_hash: str) -> str | None:
    return session.scalar(
        select(AnalysisRun.id)
        .where(AnalysisRun.user_id_hash == user_id_hash)
        .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
    )
```

If `db_session` is not a shared fixture, bootstrap inline as the other service tests do.

- [ ] **Step 4: Verify pass** — `.venv/bin/python -m pytest tests/test_analysis_runs_service.py -q` → PASS; `ruff check app/services/analysis_runs.py`.

- [ ] **Step 5: Commit** — `git add app/services/analysis_runs.py tests/test_analysis_runs_service.py && git commit -m "feat: add analysis-run helpers"`

---

## Task 3: Write paths create runs and stop deleting

**Files:** Modify `app/services/dashboard_analysis_service.py`, `app/services/crime_service.py`; modify `tests/test_dashboard_analysis_api.py`.

- [ ] **Step 1: Failing test** — add to `tests/test_dashboard_analysis_api.py` (reuse its `_client_with_places_and_crime` helper). Assert prior summaries survive a second, differently-scoped run:

```python
def test_second_analyze_run_does_not_wipe_the_first(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]
    body = {"analysis_start_date": "2024-01-01", "analysis_end_date": "2024-01-31", "radii_m": [250]}

    client.post("/dashboard/analyze", json={**body, "place_ids": [places[0]["id"]]})
    client.post("/dashboard/analyze", json={**body, "place_ids": [places[1]["id"]]})

    # Both runs' summaries are retained in the table (no blanket delete).
    from app.db import get_sessionmaker
    from app.models import PlaceCrimeSummary
    with get_sessionmaker()() as session:
        rows = session.query(PlaceCrimeSummary).all()
        assert {r.place_cluster_id for r in rows} >= {places[0]["id"], places[1]["id"]}
        assert all(r.analysis_run_id is not None for r in rows)
```

- [ ] **Step 2: Verify failure** — `.venv/bin/python -m pytest tests/test_dashboard_analysis_api.py::test_second_analyze_run_does_not_wipe_the_first -q` → FAIL (first run's rows deleted; `analysis_run_id` None).

- [ ] **Step 3: Implement write path 1.** In `app/services/dashboard_analysis_service.py::analyze_selected_places`, replace the `session.execute(delete(PlaceCrimeSummary).where(...))` + `session.add_all([_summary_model(s) for s in summaries])` block with:

```python
    run = create_analysis_run(
        session,
        user_id_hash=user_id_hash,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
    )
    models = [_summary_model(summary) for summary in summaries]
    for model in models:
        model.analysis_run_id = run.id
    session.add_all(models)
    session.commit()
```

Add `from app.services.analysis_runs import create_analysis_run`. Remove the now-unused `delete` import (`from sqlalchemy import ...` — drop `delete` if nothing else uses it; verify with ruff).

- [ ] **Step 4: Implement write path 2.** In `app/services/crime_service.py::summarize_for_user`, do the same: create a run (offense filters are `None` here — that path has none), attach `analysis_run_id`, and remove `session.execute(delete(PlaceCrimeSummary).where(...))`. Drop the unused `delete` import if nothing else in the file uses it. Add a focused test in `tests/test_crime_ingestion_service.py` (or the test file that covers `summarize_for_user`) asserting two `summarize_for_user` calls retain both runs' rows and set `analysis_run_id`.

- [ ] **Step 5: Verify** — `.venv/bin/python -m pytest tests/test_dashboard_analysis_api.py tests/test_crime_ingestion_service.py -q` → PASS; `ruff check app/services/dashboard_analysis_service.py app/services/crime_service.py`.

- [ ] **Step 6: Commit** — `git add app/services/dashboard_analysis_service.py app/services/crime_service.py tests && git commit -m "feat: attach summaries to analysis runs instead of wiping"`

---

## Task 4: Reads scope to the latest run

**Files:** Modify `app/services/dashboard_service.py`, `app/services/export_service.py`, `app/assistant/semantic_layer.py`; modify `tests/test_dashboard_summary.py`, `tests/test_tableau_export.py`, `tests/test_assistant_semantic_layer.py`.

- [ ] **Step 1: Failing tests.** Add to `tests/test_dashboard_summary.py`: after two analyze runs (place A then place B, same filters), `dashboard_summary` returns only B's summaries — `totals.incident_count` equals B's run total, NOT A+B summed (the double-count the old code would produce once deletes stop). Mirror the existing summary-test setup. Add the analogous assertions to `tests/test_tableau_export.py` (export reflects only the latest run) and `tests/test_assistant_semantic_layer.py` (the assistant's direct read reflects only the latest run).

- [ ] **Step 2: Verify failure** — those targeted tests FAIL (reads still grab all rows by `user_id_hash`).

- [ ] **Step 3: Implement the three reads.** Each currently does `select(PlaceCrimeSummary).where(PlaceCrimeSummary.user_id_hash == user_id_hash)`. Scope to the latest run:

`app/services/dashboard_service.py::dashboard_summary`:
```python
from app.services.analysis_runs import latest_analysis_run_id
...
    run_id = latest_analysis_run_id(session, user_id_hash)
    summaries = (
        session.scalars(
            select(PlaceCrimeSummary).where(PlaceCrimeSummary.analysis_run_id == run_id)
        ).all()
        if run_id is not None
        else []
    )
```

`app/services/export_service.py::tableau_place_summary_csv`: same pattern (scope the `summaries` select to `analysis_run_id == latest_analysis_run_id(...)`, empty list when `None`).

`app/assistant/semantic_layer.py` (the function around the `select(PlaceCrimeSummary).where(user_id_hash == …)` at ~line 105): add `run_id = latest_analysis_run_id(session, user_id_hash)`; if `run_id is None` return `[]`; otherwise add `.where(PlaceCrimeSummary.analysis_run_id == run_id)` to the statement (keep the existing optional `place_cluster_id.in_(selected_ids)` filter).

- [ ] **Step 4: Verify** — `.venv/bin/python -m pytest tests/test_dashboard_summary.py tests/test_tableau_export.py tests/test_assistant_semantic_layer.py -q` → PASS; `ruff check` the three modified files.

- [ ] **Step 5: Commit** — `git add app/services/dashboard_service.py app/services/export_service.py app/assistant/semantic_layer.py tests && git commit -m "feat: scope summary reads to the latest analysis run"`

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run** `make test-all` → backend pytest + ruff + frontend test + frontend build all pass. (Frontend is unaffected, but `test-all` confirms no cross-impact.)
- [ ] **Step 2: Migration check** — `.venv/bin/alembic upgrade head` against a fresh sqlite (`MCA_DATABASE_URL=sqlite+pysqlite:///./dev-output/ws2-migration-check.sqlite3 .venv/bin/alembic upgrade head`) succeeds and reaches `0006_analysis_runs`.
- [ ] **Step 3: Confirm** `git status` clean and only the intended files changed.

---

## Notes for the implementer

- **Why retain (not scoped-delete):** all reads grab summaries by `user_id_hash` alone, so coexisting runs would otherwise double-count. Latest-run scoping fixes that without losing prior runs. Pruning old runs is a later concern (data is tiny).
- **No DB-level FK** on `analysis_run_id` — keeps the sqlite migration a plain `ADD COLUMN`; integrity is enforced by the write paths always setting it. The model column is a plain indexed `String(36)`.
- **`_summary_model` is shared** — don't change its signature; set `model.analysis_run_id` on the ORM object after building it.
