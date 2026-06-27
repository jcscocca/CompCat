# Personal Data Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing parse→stop→cluster pipeline as a public, consent-gated, **flag-off-by-default** personal-upload feature that keeps only derived place clusters.

**Architecture:** Reuse the parsers + `normalize_import`. Add a `public_upload_service` that runs parse→persist→normalize→**discard raw points + stops**, plus a public `/uploads` surface gated on `public_enable_personal_uploads` (default `False`). Fix `_delete_existing_normalization` so an upload never wipes manually-entered places. A frontend upload component feeds the existing places/dashboard path.

**Tech Stack:** FastAPI, SQLAlchemy, pytest, ruff; React, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-personal-data-upload-design.md`
**Worktree/branch:** `.worktrees/personal-upload` on `claude/personal-upload`. Run commands from the worktree root.

**Key constants:** `CLUSTER_METHOD = "pure_python_radius"` (`app/normalization/clusters.py`), `MANUAL_CLUSTER_METHOD = "manual_public_dashboard"`, `DIRECT_CLUSTER_METHOD = "direct_user_input"`. Cluster-producing fixture: `tests/fixtures/google_recurring.json` → 3 stops → 1 cluster.

---

## File Structure

- Modify `app/services/import_service.py` — extract `persist_point_import` (no behavior change).
- Modify `app/services/normalization_service.py` — scope `_delete_existing_normalization` to upload-origin clusters.
- Create `app/services/public_upload_service.py` — `run_personal_upload`, `delete_personal_data`.
- Create `app/api/routes_uploads.py` — public `POST/DELETE /uploads`, flag-gated.
- Modify `app/main.py` — register the router.
- Create `frontend/src/components/PersonalUpload.tsx`; modify `frontend/src/api/client.ts`, `PlacesTab.tsx`, and `MapWorkspace.tsx` (wiring).
- Modify `README.md`, `.env.example`.
- Tests: `tests/test_public_upload_service.py`, `tests/test_uploads_api.py`, `frontend/src/components/PersonalUpload.test.tsx`.

---

## Task 0: Workspace setup

- [ ] **Step 1: Symlinks + local excludes**

```bash
cd .worktrees/personal-upload
ln -sfn "/Users/jscocca/Repos/Crime Commute Safety Tool/.venv" .venv
ln -sfn "/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/node_modules" frontend/node_modules
printf '%s\n' '.venv' 'frontend/node_modules' >> "$(git rev-parse --git-path info/exclude)"
```

- [ ] **Step 2: Baseline green**

Run: `.venv/bin/python -m pytest tests/test_api_flow.py tests/test_internal_surface.py -q`
Expected: PASS.

---

## Task 1: Extract `persist_point_import` (no behavior change)

**Files:** Modify `app/services/import_service.py`

- [ ] **Step 1: Refactor — extract the helper, keep behavior identical**

In `app/services/import_service.py`, replace the body of `create_import_batch` after the `direct_result` early-return so the point branch delegates to a new `persist_point_import`:

```python
def create_import_batch(
    session: Session,
    payload: bytes,
    filename: str,
    user_id_hash: str,
) -> dict[str, object]:
    direct_result = parse_direct_place_upload(payload, filename)
    if direct_result is not None:
        return persist_direct_place_import(session, direct_result, payload, filename, user_id_hash)
    result = parse_upload(payload, filename)
    batch = persist_point_import(session, result, payload, filename, user_id_hash)
    return {
        "id": batch.id,
        "status": batch.status,
        "source_type": batch.source_type,
        "detected_schema": batch.detected_schema,
        "observation_count": len(result.observations),
        "source_stop_count": len(result.source_stops),
    }


def persist_point_import(
    session: Session,
    result: ParseResult,
    payload: bytes,
    filename: str,
    user_id_hash: str,
) -> ImportBatch:
    times = _time_bounds(result)
    batch = ImportBatch(
        user_id_hash=user_id_hash,
        source_type=result.source_type,
        original_filename=filename,
        file_hash_sha256=sha256(payload).hexdigest(),
        parser_version=result.parser_version,
        detected_schema=result.detected_schema,
        min_time_utc=times[0],
        max_time_utc=times[1],
        status="parsed",
        privacy_mode="tableau_safe",
    )
    session.add(batch)
    session.flush()
    rows = []
    for observation in result.observations:
        rows.append(
            StagingLocationObservation(
                import_id=batch.id,
                user_id_hash=user_id_hash,
                source_record_type=observation.source_record_type,
                source_record_hash=observation.source_record_hash,
                observed_at_utc=observation.observed_at_utc,
                start_time_utc=observation.start_time_utc,
                end_time_utc=observation.end_time_utc,
                latitude=observation.latitude,
                longitude=observation.longitude,
                accuracy_m=observation.accuracy_m,
                activity_type=observation.activity_type,
                confidence_score=observation.confidence_score,
            )
        )
    for source_stop in result.source_stops:
        rows.append(
            StagingLocationObservation(
                import_id=batch.id,
                user_id_hash=user_id_hash,
                source_record_type=source_stop.source_record_type,
                source_record_hash=source_stop.source_record_hash,
                start_time_utc=source_stop.start_time_utc,
                end_time_utc=source_stop.end_time_utc,
                latitude=source_stop.latitude,
                longitude=source_stop.longitude,
                accuracy_m=source_stop.accuracy_m,
                activity_type=source_stop.activity_type,
                confidence_score=source_stop.confidence_score,
                display_label=source_stop.display_label,
            )
        )
    session.add_all(rows)
    session.commit()
    return batch
```

- [ ] **Step 2: Verify the refactor preserved behavior**

Run: `.venv/bin/python -m pytest tests/test_api_flow.py -q && .venv/bin/python -m ruff check app/services/import_service.py`
Expected: PASS + ruff clean (the existing flow still returns the same dict).

- [ ] **Step 3: Commit**

```bash
git add app/services/import_service.py
git commit -m "refactor: extract persist_point_import from create_import_batch"
```

---

## Task 2: Scope `_delete_existing_normalization` to upload-origin clusters

**Files:** Modify `app/services/normalization_service.py`; Test: `tests/test_public_upload_service.py`

- [ ] **Step 1: Write the failing test (manual place must survive an upload)**

Create `tests/test_public_upload_service.py`:

```python
from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster, StagingLocationObservation, StopVisit
from app.normalization.clusters import CLUSTER_METHOD
from app.services.import_service import create_import_batch
from app.services.manual_place_service import MANUAL_CLUSTER_METHOD, create_manual_place
from app.services.normalization_service import normalize_import

FIXTURES = Path(__file__).parent / "fixtures"
USER = "upload-user"


def _app_session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'u.sqlite3'}")
    return get_sessionmaker()()


def _add_manual_place(session):
    from app.places.schemas import ManualPlaceCreate

    create_manual_place(
        session, USER,
        ManualPlaceCreate(display_label="My desk", latitude=47.61, longitude=-122.33),
    )


def test_upload_normalize_preserves_manual_place(tmp_path):
    session = _app_session(tmp_path)
    _add_manual_place(session)
    batch = create_import_batch(
        session, (FIXTURES / "google_recurring.json").read_bytes(), "timeline.json", USER
    )
    normalize_import(session, batch["id"], USER, Settings())
    methods = {
        m for (m,) in session.query(PlaceCluster.cluster_method).filter(
            PlaceCluster.user_id_hash == USER
        )
    }
    assert MANUAL_CLUSTER_METHOD in methods  # manual place survived
    assert CLUSTER_METHOD in methods  # upload cluster created
```

(If `ManualPlaceCreate`'s field names differ, open `app/places/schemas.py` and match them — keep the call to `create_manual_place(session, USER, ManualPlaceCreate(...))`.)

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_public_upload_service.py::test_upload_normalize_preserves_manual_place -q`
Expected: FAIL — the manual place is wiped (only `CLUSTER_METHOD` remains).

- [ ] **Step 3: Scope the deletion**

In `app/services/normalization_service.py`, add `CLUSTER_METHOD` to the clusters import:

```python
from app.normalization.clusters import CLUSTER_METHOD, cluster_stop_visits, infer_sensitive_locations
```

Replace `_delete_existing_normalization`:

```python
def _delete_existing_normalization(session: Session, import_id: str, user_id_hash: str) -> None:
    cluster_ids = list(
        session.scalars(
            select(PlaceCluster.id).where(
                PlaceCluster.user_id_hash == user_id_hash,
                PlaceCluster.cluster_method == CLUSTER_METHOD,
            )
        )
    )
    if cluster_ids:
        session.execute(
            delete(PlaceCrimeSummary).where(PlaceCrimeSummary.place_cluster_id.in_(cluster_ids))
        )
    session.execute(delete(StopVisit).where(StopVisit.import_id == import_id))
    session.execute(
        delete(PlaceCluster).where(
            PlaceCluster.user_id_hash == user_id_hash,
            PlaceCluster.cluster_method == CLUSTER_METHOD,
        )
    )
    session.flush()
```

- [ ] **Step 4: Run the test + internal flow**

Run: `.venv/bin/python -m pytest tests/test_public_upload_service.py::test_upload_normalize_preserves_manual_place tests/test_api_flow.py -q`
Expected: PASS (manual survives; the internal flow's upload clusters are `CLUSTER_METHOD`, unaffected).

- [ ] **Step 5: Commit**

```bash
git add app/services/normalization_service.py tests/test_public_upload_service.py
git commit -m "fix: scope normalization cluster reset to upload-origin clusters"
```

---

## Task 3: `run_personal_upload` (parse → normalize → discard)

**Files:** Create `app/services/public_upload_service.py`; Test: `tests/test_public_upload_service.py`

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_public_upload_service.py`:

```python
def _staging_and_stops(session):
    staging = session.query(StagingLocationObservation).filter(
        StagingLocationObservation.user_id_hash == USER
    ).count()
    stops = session.query(StopVisit).filter(StopVisit.user_id_hash == USER).count()
    return staging, stops


def test_run_personal_upload_default_discards_raw_and_stops(tmp_path):
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    result = run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(),
    )
    assert result["place_cluster_count"] == 1
    assert result["retained_raw"] is False
    assert _staging_and_stops(session) == (0, 0)  # raw + stops discarded
    clusters = session.query(PlaceCluster).filter(PlaceCluster.user_id_hash == USER).count()
    assert clusters == 1  # the derived cluster is kept


def test_run_personal_upload_retains_when_opted_in(tmp_path):
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(raw_upload_retention=True),
    )
    staging, stops = _staging_and_stops(session)
    assert staging > 0 and stops > 0


def test_run_personal_upload_rejects_unknown_format(tmp_path):
    import pytest

    from app.parsers.base import UnsupportedFormatError
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    with pytest.raises(UnsupportedFormatError):
        run_personal_upload(session, b"not a known format", "mystery.bin", USER, Settings())
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_public_upload_service.py -k run_personal_upload -q`
Expected: FAIL (`ModuleNotFoundError: app.services.public_upload_service`).

- [ ] **Step 3: Implement `run_personal_upload`**

Create `app/services/public_upload_service.py`:

```python
from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import StagingLocationObservation, StopVisit
from app.services.import_service import parse_upload, persist_point_import
from app.services.normalization_service import normalize_import


def run_personal_upload(
    session: Session,
    payload: bytes,
    filename: str,
    user_id_hash: str,
    settings: Settings,
) -> dict[str, object]:
    # parse_upload only matches the four point-data formats; non-point uploads raise
    # UnsupportedFormatError (callers map to HTTP 400).
    result = parse_upload(payload, filename)
    batch = persist_point_import(session, result, payload, filename, user_id_hash)
    normalized = normalize_import(session, batch.id, user_id_hash, settings)
    if not settings.raw_upload_retention:
        session.execute(
            delete(StagingLocationObservation).where(
                StagingLocationObservation.import_id == batch.id
            )
        )
        session.execute(delete(StopVisit).where(StopVisit.import_id == batch.id))
        session.commit()
    return {
        "import_id": batch.id,
        "place_cluster_count": normalized["place_cluster_count"],
        "source_type": result.source_type,
        "retained_raw": settings.raw_upload_retention,
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_public_upload_service.py -k run_personal_upload -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/public_upload_service.py tests/test_public_upload_service.py
git commit -m "feat: personal upload runs the pipeline and discards raw points by default"
```

---

## Task 4: `delete_personal_data` (erase upload data, keep manual)

**Files:** Modify `app/services/public_upload_service.py`; Test: `tests/test_public_upload_service.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_public_upload_service.py`:

```python
def test_delete_personal_data_erases_upload_keeps_manual(tmp_path):
    from app.services.public_upload_service import delete_personal_data, run_personal_upload

    session = _app_session(tmp_path)
    _add_manual_place(session)
    run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(raw_upload_retention=True),
    )
    counts = delete_personal_data(session, USER)
    assert counts["place_clusters"] >= 1
    remaining = {
        m for (m,) in session.query(PlaceCluster.cluster_method).filter(
            PlaceCluster.user_id_hash == USER
        )
    }
    assert remaining == {MANUAL_CLUSTER_METHOD}  # only the manual place survives
    assert _staging_and_stops(session) == (0, 0)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_public_upload_service.py::test_delete_personal_data_erases_upload_keeps_manual -q`
Expected: FAIL (`ImportError: delete_personal_data`).

- [ ] **Step 3: Implement `delete_personal_data`**

Append to `app/services/public_upload_service.py` (and extend the imports):

```python
from app.models import ImportBatch, PlaceCluster, PlaceCrimeSummary
from app.normalization.clusters import CLUSTER_METHOD
```

```python
def delete_personal_data(session: Session, user_id_hash: str) -> dict[str, int]:
    cluster_ids = list(
        session.scalars(
            select(PlaceCluster.id).where(
                PlaceCluster.user_id_hash == user_id_hash,
                PlaceCluster.cluster_method == CLUSTER_METHOD,
            )
        )
    )
    summaries = 0
    if cluster_ids:
        summaries = session.execute(
            delete(PlaceCrimeSummary).where(PlaceCrimeSummary.place_cluster_id.in_(cluster_ids))
        ).rowcount
    clusters = session.execute(
        delete(PlaceCluster).where(
            PlaceCluster.user_id_hash == user_id_hash,
            PlaceCluster.cluster_method == CLUSTER_METHOD,
        )
    ).rowcount
    stops = session.execute(
        delete(StopVisit).where(StopVisit.user_id_hash == user_id_hash)
    ).rowcount
    staging = session.execute(
        delete(StagingLocationObservation).where(
            StagingLocationObservation.user_id_hash == user_id_hash
        )
    ).rowcount
    batches = session.execute(
        delete(ImportBatch).where(ImportBatch.user_id_hash == user_id_hash)
    ).rowcount
    session.commit()
    return {
        "import_batches": batches,
        "staging": staging,
        "stop_visits": stops,
        "place_clusters": clusters,
        "place_crime_summaries": summaries,
    }
```

Add `select` to the sqlalchemy import: `from sqlalchemy import delete, select`.

- [ ] **Step 4: Run + commit**

Run: `.venv/bin/python -m pytest tests/test_public_upload_service.py -q && .venv/bin/python -m ruff check app/services/public_upload_service.py`
Expected: PASS + clean.

```bash
git add app/services/public_upload_service.py tests/test_public_upload_service.py
git commit -m "feat: delete-my-data erases uploads, preserves manual places"
```

---

## Task 5: Public `/uploads` endpoints (flag-gated)

**Files:** Create `app/api/routes_uploads.py`; Modify `app/main.py`; Test: `tests/test_uploads_api.py`

- [ ] **Step 1: Write the failing API tests**

Create `tests/test_uploads_api.py`:

```python
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def _client(tmp_path):
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'm.sqlite3'}"))


def _files():
    return {"file": ("timeline.json", (FIXTURES / "google_recurring.json").read_bytes(), "application/json")}


def test_uploads_404_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", raising=False)
    client = _client(tmp_path)
    client.post("/sessions")  # real session so the dep passes; flag check then 404s
    assert client.post("/uploads", files=_files()).status_code == 404


def test_uploads_401_without_session(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    client = _client(tmp_path)
    assert client.post("/uploads", files=_files()).status_code == 401


def test_uploads_creates_clusters_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.post("/uploads", files=_files())
    assert response.status_code == 200
    assert response.json()["place_cluster_count"] == 1
    assert client.delete("/uploads").status_code == 200
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_uploads_api.py -q`
Expected: FAIL (no `/uploads` route → 404/405 mismatches).

- [ ] **Step 3: Create the router**

Create `app/api/routes_uploads.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.config import get_settings
from app.db import get_session
from app.parsers.base import UnsupportedFormatError
from app.services.public_upload_service import delete_personal_data, run_personal_upload

router = APIRouter()


@router.post("/uploads")
async def create_upload(
    file: Annotated[UploadFile, File()],
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    settings = get_settings()
    if not settings.public_enable_personal_uploads:
        raise HTTPException(status_code=404, detail="Not found")
    payload = await file.read()
    try:
        return run_personal_upload(
            session, payload, file.filename or "upload", user_id_hash, settings
        )
    except UnsupportedFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/uploads")
def delete_uploads(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    if not get_settings().public_enable_personal_uploads:
        raise HTTPException(status_code=404, detail="Not found")
    return delete_personal_data(session, user_id_hash)
```

- [ ] **Step 4: Register the router**

In `app/main.py`, add the import near the other public routers (`from app.api.routes_uploads import router as uploads_router`) and `app.include_router(uploads_router)` next to `app.include_router(public_places_router)`.

- [ ] **Step 5: Run uploads + surface guard tests**

Run: `.venv/bin/python -m pytest tests/test_uploads_api.py tests/test_internal_surface.py tests/test_public_session_required.py -q`
Expected: PASS. If `test_internal_surface.py` or `test_public_session_required.py` enforces an explicit public-path allowlist, add `/uploads` to it (these endpoints are intentionally public + session-gated). If `test_public_session_required.py` drives every public route and expects 401 without a session, the new routes already satisfy it.

- [ ] **Step 6: Commit**

```bash
git add app/api/routes_uploads.py app/main.py tests/test_uploads_api.py
git commit -m "feat: add public personal-upload endpoints behind the flag"
```

---

## Task 6: Frontend upload component

**Files:** Modify `frontend/src/api/client.ts`; Create `frontend/src/components/PersonalUpload.tsx`; Modify `PlacesTab.tsx` + `MapWorkspace.tsx`; Test: `frontend/src/components/PersonalUpload.test.tsx`

- [ ] **Step 1: Add client calls**

In `frontend/src/api/client.ts`, add (multipart needs a raw `fetch`, not the JSON `request` helper):

```ts
export async function uploadPersonalData(file: File): Promise<{ place_cluster_count: number }> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/uploads", { method: "POST", credentials: "include", body });
  if (!response.ok) {
    throw new Error((await response.text()) || `Upload failed (${response.status})`);
  }
  return response.json();
}

export function deletePersonalData(): Promise<{ place_clusters: number }> {
  return request("/uploads", { method: "DELETE" });
}
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/components/PersonalUpload.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalUpload } from "./PersonalUpload";

afterEach(cleanup);

describe("PersonalUpload", () => {
  it("disables upload until consent is acknowledged and shows the caveat", () => {
    render(<PersonalUpload onUploaded={vi.fn()} />);
    expect(screen.getByText(/never claims you were present/i)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /upload/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand/i));
    expect(button).not.toBeDisabled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/PersonalUpload.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/PersonalUpload.tsx`:

```tsx
import { useRef, useState } from "react";
import { deletePersonalData, uploadPersonalData } from "../api/client";

type Props = { onUploaded: () => void };

export function PersonalUpload({ onUploaded }: Props) {
  const [consented, setConsented] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await uploadPersonalData(file);
      setStatus(`Created ${result.place_cluster_count} place${result.place_cluster_count === 1 ? "" : "s"}.`);
      onUploaded();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    setBusy(true);
    try {
      await deletePersonalData();
      setStatus("Your uploaded data was deleted.");
      onUploaded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mc-upload">
      <p className="mc-upload-consent">
        Your location history is processed in your session into a small set of approximate
        place clusters. By default the raw points and individual stops are discarded
        immediately — only the clusters are kept, and you can delete everything anytime.
      </p>
      <p className="mc-upload-caveat">
        Waypoint shows reported-incident context near these places. It never claims you were
        present at any incident and does not score safety.
      </p>
      <label>
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />{" "}
        I understand and want to continue.
      </label>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv,.geojson,.gpx"
        aria-label="Location history file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="button" disabled={!consented || !file || busy} onClick={submit}>
        Upload
      </button>
      <button type="button" disabled={busy} onClick={removeAll}>
        Delete my uploaded data
      </button>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the component test**

Run: `cd frontend && npx vitest run src/components/PersonalUpload.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire it into the places UI**

Open `frontend/src/components/PlacesTab.tsx` (it surfaces `PlaceForm` and `BulkPlaceEntry` as modal options via `onManualSubmit` / `onImportSubmit`) and `frontend/src/components/MapWorkspace.tsx` (the parent that supplies those callbacks and refreshes places). Add a third "Upload location history" option that renders `<PersonalUpload onUploaded={refreshPlaces} />`, following the existing modal/callback pattern. Pass the existing places-refresh function as `onUploaded`. Only show the option when the `personal_timeline` input mode is available (mirror however the other modes are gated; the input-modes API already hides it when the flag is off — if the modes aren't fetched yet, fetching `/input-modes` and checking for `personal_timeline` is acceptable).

- [ ] **Step 7: Frontend tests + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS + build ok.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/components/PersonalUpload.tsx frontend/src/components/PersonalUpload.test.tsx frontend/src/components/PlacesTab.tsx frontend/src/components/MapWorkspace.tsx
git commit -m "feat: personal-upload UI with consent gate and delete control"
```

---

## Task 7: Documentation (flag is off by default)

**Files:** Modify `README.md`, `.env.example`

- [ ] **Step 1: README section**

Add a "Personal uploads (disabled by default)" section to `README.md` stating: the feature is gated by `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` which **defaults to `false`**; with it off the `/uploads` endpoints 404, the `personal_timeline` mode is hidden, and no upload UI renders; enable it by setting `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`; supported formats are Google Timeline JSON, CSV points, GeoJSON, GPX; by default only derived place clusters are kept (`MCA_RAW_UPLOAD_RETENTION=false` discards raw points + stops after clustering); "Delete my uploaded data" erases all uploaded artifacts.

- [ ] **Step 2: .env.example**

Add to `.env.example`:

```bash
# Personal location-history uploads. OFF by default — the /uploads endpoints 404,
# the personal_timeline mode is hidden, and no upload UI renders until this is true.
MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=false
# When false (default), raw points and per-visit stops are discarded after clustering;
# only the derived place clusters are kept.
MCA_RAW_UPLOAD_RETENTION=false
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document personal uploads (disabled by default)"
```

---

## Task 8: Full verification gate

- [ ] **Step 1:** Run `make test-all`. Expected: pytest, ruff, frontend test, and build all pass.
- [ ] **Step 2:** Fix any stragglers; re-run until green.
- [ ] **Step 3:** `git status --short --branch` — only intended files changed; `.venv`/`frontend/node_modules` excluded; `app/static/dashboard/` ignored.

---

## Self-Review

- **Spec coverage:** dark-launch flag gating (Tasks 5, 7); reuse + point-only path via `persist_point_import` (Task 1); keep-only-clusters retention (Task 3); delete-my-data scoped to upload-origin (Task 4); manual-place-preservation fix (Task 2); public endpoints + session gating (Task 5); frontend upload + consent + caveat + delete (Task 6); README/.env docs (Task 7). Covered.
- **Placeholders:** none — every code step is complete; the two "open the file and follow the pattern" steps (Task 6 Step 6 wiring; Task 2 Step 1 schema-field match) are bounded discovery against named files with the exact pattern to follow.
- **Type/name consistency:** `persist_point_import(session, result, payload, filename, user_id_hash) -> ImportBatch` defined in Task 1, used in Task 3; `run_personal_upload` / `delete_personal_data` signatures consistent across Tasks 3/4/5; `CLUSTER_METHOD` used identically in Tasks 2/4; `uploadPersonalData` / `deletePersonalData` consistent between client (Task 6 Step 1) and component (Task 6 Step 4).
