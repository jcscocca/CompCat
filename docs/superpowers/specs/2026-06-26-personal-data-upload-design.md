# Personal Data Upload (epic A)

**Date:** 2026-06-26
**Status:** Approved for implementation
**Related:** roadmap epic **A** in `docs/superpowers/plans/2026-06-26-waypoint-next-steps-roadmap.md`;
beta-scope deferral (personal upload + consent copy) recorded in the v2 backlog.

## Goal

Let a user upload their own location history so Waypoint shows reported-incident context
around the places **they actually go** — reusing the existing (internal-gated) parser →
stop-detection → clustering pipeline, behind a privacy-first retention model, a consent
gate, and an explicit feature flag.

> ## ⚠️ Ships DISABLED by default (dark launch)
> Personal uploads are gated by `public_enable_personal_uploads` (env
> **`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS`**), which **defaults to `False`**. With the flag
> off: the `/uploads` endpoints return **404**, the `personal_timeline` input mode is **not**
> returned by the input-modes API, and the upload UI is **not rendered anywhere**. The
> feature is invisible until an operator explicitly sets
> `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`. This default is **not** changed by this work —
> enabling it is a deliberate, separate deploy step. This is documented in `README.md` and
> `.env.example`.

## Background / current state

The whole backend pipeline already exists and is tested, only internal-gated:
- **Parsers** (`app/parsers/`): `GoogleTimelineParser`, `CsvPointsParser`,
  `GeoJsonPointsParser`, `GpxPointsParser` (+ direct-place parsers), each with
  `can_parse` / `parse_bytes`.
- **`import_service.create_import_batch`** → `ImportBatch` + raw `StagingLocationObservation`
  rows.
- **`normalization_service.normalize_import`** → stop-detection (`StopVisit`) → clustering
  (`PlaceCluster`). `PlaceCluster` is the **same model** the public places list and
  neighborhood/dashboard analysis already operate on.
- Internal endpoints: `POST /internal/imports`, `GET /internal/imports/{id}`,
  `POST /internal/imports/{id}/normalize`.

**Two gaps this epic closes:**
1. **Retention.** `normalize_import` keeps raw `StagingLocationObservation` points
   **forever**, and `raw_upload_retention` (default `False`) is **never enforced**.
2. **No public/consented surface and no UI.** Uploads are reachable only via the
   internal demo-identity endpoints; the frontend has no upload affordance.

Confirmed safe to discard: **nothing** outside `import_service`/`normalization_service`
reads `StagingLocationObservation` or `StopVisit` — the dashboard/exports/analysis use only
`PlaceCluster`.

## Decisions (approved in brainstorming)

1. **Scope = full feature**: A1 backend (public surface + retention + delete) and A2 frontend
   (upload + consent + caveat).
2. **Retention default (`raw_upload_retention=False`) = keep only clusters.** After
   clustering succeeds, discard both the raw points (`StagingLocationObservation`) and the
   per-visit stops (`StopVisit`); keep only `PlaceCluster`. Opt-in retention keeps raw points
   for re-clustering. A delete endpoint erases everything regardless.
3. **Single-call `POST /uploads`** (parse + normalize + discard in one request).
4. **Flag default stays `False`** (dark launch — see the banner above).
5. **Retention enforced in the public wrapper**, leaving `normalize_import` and the internal
   endpoints/tests untouched.

## Architecture

### A1 — backend

**New `app/services/public_upload_service.py`:**
```python
def run_personal_upload(session, payload, filename, user_id_hash, settings) -> dict:
    # 1. create_import_batch(...)  -> ImportBatch + StagingLocationObservation (reuse)
    # 2. normalize_import(...)     -> StopVisit + PlaceCluster (reuse)
    # 3. if not settings.raw_upload_retention:  discard raw + stops for this import
    #       delete StagingLocationObservation where import_id == ...
    #       delete StopVisit where import_id == ...
    # 4. return { import_id, place_cluster_count, source_type, retained_raw: bool }

def delete_personal_data(session, user_id_hash) -> dict:
    # erase the user's upload artifacts: all ImportBatch, StagingLocationObservation,
    # StopVisit; and ONLY the upload-origin PlaceCluster rows
    # (cluster_method == app.normalization.clusters.CLUSTER_METHOD) plus their
    # PlaceCrimeSummary. Manually-entered places (MANUAL_CLUSTER_METHOD) and commute /
    # recurring-place clusters (DIRECT_CLUSTER_METHOD) are preserved. Return counts.
```

**New `app/api/routes_uploads.py`** (public tier — in OpenAPI, `required_public_user_hash`):
- `POST /uploads` (multipart `file`): guard `settings.public_enable_personal_uploads` →
  `HTTPException(404)` when off; else `run_personal_upload(...)`, which accepts the four
  **point-data** formats (Google Timeline JSON, CSV points, GeoJSON, GPX — the `parse_upload`
  set) and produces `CLUSTER_METHOD` clusters. `UnsupportedFormatError` → 400. (Direct-place
  formats — commute scenario / recurring places — are out of scope here; they belong to the
  existing bulk/scenario input modes.)
- `DELETE /uploads`: same flag guard; `delete_personal_data(...)` → counts.

Registered in `app/main.py` alongside the other public routers. The `personal_timeline`
input mode (already gated on the flag in `app/input_modes.py`) is the discovery hook.

### A2 — frontend

- **`frontend/src/components/PersonalUpload.tsx`**: a file picker + drag-drop zone shown for
  the `personal_timeline` mode. It posts `multipart/form-data` to `/uploads` via a new
  `uploadPersonalData(file)` client call, shows parse/cluster progress and the resulting
  cluster count, and surfaces errors (unsupported format, flag-off 404).
- **Consent gate**: an explicit acknowledgement (checkbox + summary) the user must accept
  before the file posts; the upload button is disabled until then.
- **Caveat copy**: the standing reported-incident-context disclaimer near the results.
- **Delete control**: a "Delete my uploaded data" action calling `deletePersonalData()`
  (`DELETE /uploads`), then refreshing the places list.
- **Integration**: on success the component refreshes the existing places query; the new
  `PlaceCluster` rows appear as places and feed the existing dashboard/neighborhood analysis
  with no extra wiring.

### Copy (gist; final wording in implementation)

- **Consent:** "Your location history is processed in your session into a small set of
  approximate place clusters. By default the raw points and individual stops are discarded
  immediately — only the clusters are kept, and you can delete everything anytime."
- **Caveat:** "Waypoint shows reported-incident context near these places. It never claims
  you were present at any incident and does not score safety."

## Data flow

1. User picks the `personal_timeline` mode (only visible when the flag is on), acknowledges
   consent, selects a file.
2. `POST /uploads` → `run_personal_upload`: parse → stage → stop-detect → cluster → discard
   raw + stops (default) → return cluster summary.
3. Frontend refreshes places; clusters render and are analyzable via the existing dashboard.
4. "Delete my uploaded data" → `DELETE /uploads` → everything for the user is erased.

## Error handling / edge cases

- **Flag off** → `/uploads` 404 (both verbs); UI never shows the mode.
- **No session** → 401 (public tier requires `required_public_user_hash`).
- **Unsupported / unparseable file** → 400 `UnsupportedFormatError` message; nothing
  persisted.
- **Zero clusters produced** (too few/sparse points) → 200 with `place_cluster_count: 0`
  and a UI message; raw + stops still discarded by default.
- **Re-upload** → a new `ImportBatch`; clusters are recomputed (`normalize_import` already
  clears prior clusters for the user).

## Testing

- **Backend:** `run_personal_upload` produces ≥1 cluster and (default) leaves **zero**
  `StagingLocationObservation` and **zero** `StopVisit` rows for the import; with
  `raw_upload_retention=True` those rows remain; `delete_personal_data` zeroes the user's
  batches/staging/stops and the upload-origin clusters + summaries **while preserving a
  manually-entered place** (`MANUAL_CLUSTER_METHOD`); `POST /uploads` returns **404 when the
  flag is off** and **401 without a session**, and **200 + clusters when on**; one end-to-end
  test per point-data format reusing the existing parser fixtures.
- **Frontend:** the upload button is disabled until consent is acknowledged; a successful
  upload refreshes places; the delete action calls `DELETE /uploads`; the mode/upload UI is
  absent when the flag is reported off.
- **Docs:** `README.md` and `.env.example` document the flag, its **default-off** behavior,
  and the retention model.
- **Gate:** `make test-all`.

## Out of scope

- Changing the flag default (stays `False`).
- Background/async processing of very large files; multi-file batches; richer cluster
  editing/labeling beyond what the pipeline already produces.
- Any change to the internal `/internal/imports*` endpoints or their behavior.
