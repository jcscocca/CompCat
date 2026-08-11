# API Contract

This document covers the auth model, tier contracts, enforcement invariant, and transport
notes for the CompCat API. The live `/openapi.json` (and Swagger UI at `/docs`) is the
field-level source of truth; this document covers rules and tier structure only.

> Audited 2026-08-10 against every registered FastAPI route. The route table is enforced by
> `tests/test_documentation_contract.py`.

⚠ **Invariant:** CompCat reports *reported incident context*. The API must not score
safety, rank places as safe/unsafe/dangerous, or claim a user was present at an incident.
The assistant refuses safety-score requests through the deterministic guard in
`app/assistant/output_guard.py`, wired through `app/assistant/agent.py`. This invariant
applies to code, copy, and any future endpoints.

---

## 1. Auth model

### Session cookie

`POST /sessions` creates an anonymous HMAC-signed token and sets it as an `HttpOnly`
cookie named `mca_session` (`MCA_SESSION_SECRET` is the signing key). Its signed payload
contains the session id, fixed `issued_at`, and a sliding expiry. Posting again with a
valid cookie re-signs the same identity for up to another 24 hours, bounded by
`MCA_SESSION_ABSOLUTE_MAX_DAYS` from the original issuance (30 days by default). At or
past that ceiling, `POST /sessions` creates a fresh identity. `DELETE /sessions`
idempotently clears the cookie.

Every successful create/resume upserts `SessionActivity(user_id_hash, last_seen_at)`.
Only the one-way public user hash is stored; there is still no raw session-id database
record. This makes read-only returning visitors visible to the retention sweep.

The cookie is `Secure` in production-like environments; settable explicitly via
`MCA_SESSION_COOKIE_SECURE`. Logic lives in `app/sessions.py` and
`app/services/session_activity_service.py`.

The `public_user_hash` function in `app/sessions.py` derives a stable pseudonymous hash
from the session token:

```
SHA-256( MCA_USER_HASH_SALT + ":public-session:" + session_id )
```

### FastAPI dependencies (`app/api/deps.py`)

| Dependency | Accepts | Rejects with |
|---|---|---|
| `required_public_user_hash` | Valid `mca_session` cookie only | HTTP 401 |
| `current_user_hash` | Valid cookie **or** `X-Demo-User-Id` header (hashed via `hash_demo_user`) | Never rejects — falls back to demo identity |

`required_public_user_hash` is used by all public endpoints. `current_user_hash` is the
internal-tier fallback that allows demo/scripted access without a browser session.

The `X-Demo-User-Id` header value is hashed deterministically via
`app/services/users.hash_demo_user` using `MCA_USER_HASH_SALT`. It is never stored raw.

### Admin token

Both `POST /admin/crime/ingest/socrata` and the schema-hidden
`POST /admin/maintenance/retention-sweep` require an `X-Admin-Token` header whose value must equal
`MCA_ADMIN_INGEST_TOKEN`. The shared guard is `require_admin_ingest_token` in
`app/api/routes_admin_crime.py`. Socrata ingest appears in the public OpenAPI schema; retention is
deliberately omitted. Both return HTTP 403 without a matching token.

---

## 2. Tier reference

### Public tier

Endpoints appear in `/openapi.json`. All require `required_public_user_hash` (valid
session cookie; HTTP 401 otherwise), except `/sessions`, `/health`, and `/input-modes`
which are unauthenticated or session-creating.

| Endpoint | Method | Router file | Request schema | Response schema |
|---|---|---|---|---|
| `/sessions` | POST | `app/api/routes_sessions.py` | — | `{"session_state": "created"|"resumed"}` |
| `/sessions` | DELETE | `app/api/routes_sessions.py` | — | 204; clears `mca_session` |
| `/health` | GET | `app/api/routes_health.py` | — | `{"status": "ok", "revision": str \| null}` |
| `/health/data` | GET | `app/api/routes_health.py` | — | Hidden, session-free data-recency probe for external monitoring; 200 when every layer is current, 503 when stale/unknown |
| `/input-modes` | GET | `app/api/routes_input_modes.py` | — | `{"modes": [...]}` |
| `/places` | GET | `app/api/routes_places.py` | — | `{"count": int, "places": [...]}` |
| `/places` | POST | `app/api/routes_public_places.py` | `ManualPlaceCreate` (`app/places/schemas.py`) | `ManualPlaceResponse` |
| `/places` | DELETE | `app/api/routes_public_places.py` | — | 204; removes all user-entered places |
| `/places/bulk` | POST | `app/api/routes_public_places.py` | `BulkPlaceCreate` | `BulkPlaceCreateResponse` |
| `/places/{place_id}` | PATCH | `app/api/routes_public_places.py` | `ManualPlaceUpdate` | `ManualPlaceResponse` |
| `/places/{place_id}` | DELETE | `app/api/routes_public_places.py` | — | 204 No Content |
| `/dashboard/summary` | GET | `app/api/routes_dashboard.py` | — | `dict` |
| `/dashboard/analyze` | POST | `app/api/routes_public_dashboard.py` | `DashboardAnalyzeRequest` (`app/api/dashboard_schemas.py`) | `{"summary_count": int, "analysis_run_id": str \| null}` |
| `/dashboard/incidents` | POST | `app/api/routes_public_dashboard.py` | `DashboardIncidentDetailsRequest` | `dict` |
| `/dashboard/compare` | POST | `app/api/routes_public_dashboard.py` | `DashboardCompareRequest` | `dict` |
| `/dashboard/neighborhood` | POST | `app/api/routes_public_dashboard.py` | `DashboardAnalyzeRequest` | `dict` |
| `/dashboard/freshness` | GET | `app/api/routes_public_dashboard.py` | — | `dict` |
| `/dashboard/beats` | GET | `app/api/routes_public_dashboard.py` | — | `Response` (slimmed beat-outline GeoJSON, gzip-negotiated) |
| `/dashboard/mcpp` | GET | `app/api/routes_public_dashboard.py` | — | `Response` (slimmed MCPP-neighborhood-polygon GeoJSON, gzip-negotiated; sibling of `/dashboard/beats`) |
| `/dashboard/incident-points` | POST | `app/api/routes_public_dashboard.py` | `DashboardIncidentPointsRequest` | `dict` (one feature per block-level coordinate with `record_count`; all-layer active-filter totals plus returned/total block-location counts; capped at 5,000 locations) |
| `/dashboard/area-selection/summary` | POST | `app/api/routes_public_dashboard.py` | `AreaSelectionRequest` (single-ring GeoJSON polygon, active date/layer/offense filters, and optional `selected_types`/`selected_hours`/`selected_days`) | Complete polygon-member counts, compact type mix plus exact per-type `type_counts`, Seattle-local temporal profile, and exact-or-grid map highlights; every aggregate reflects all supplied filters |
| `/dashboard/area-selection/records` | POST | `app/api/routes_public_dashboard.py` | `AreaSelectionRecordsRequest` (`page_size` 1-100 plus optional opaque cursor) | Newest-first, filter- and scope-bound cursor page of underlying polygon-member records |
| `/dashboard/geocode` | GET | `app/api/routes_public_dashboard.py` | `?q=` query param | `list[GeocodeResultSchema]` |
| `/dashboard/trends` | GET | `app/api/routes_public_dashboard.py` | `?mcpp=` (normalized, 404 unknown), `?layer=` (400 unknown), `?category=` | `dict` (raw zero-filled monthly `area_counts`/`citywide_counts`, last complete month, TTL-cached with a shared citywide entry; math: `docs/analysis/trend-indexing-method.md`) |
| `/dashboard/report-profiles` | GET | `app/api/routes_reports.py` | — | `list[ReportLayerProfile]` (server-owned vocabulary and capabilities for reported incidents, arrests, and 911 calls) |
| `/dashboard/reports` | POST | `app/api/routes_reports.py` | `AnalysisReportRequest` | Frozen `AnalysisReport`; saved-place selections persist an owned snapshot, while ad-hoc point selections return a nonpersistent DTO |
| `/dashboard/reports/{report_id}` | GET | `app/api/routes_reports.py` | — | Owned saved report after current saved-place privacy revalidation; unknown/foreign is 404, deleted/sensitive selection is 409 |
| `/dashboard/reports/{report_id}` | DELETE | `app/api/routes_reports.py` | — | 204; deletes one owned snapshot |
| `/dashboard/reports` | DELETE | `app/api/routes_reports.py` | — | Deletes all snapshots owned by the current session identity |
| `/assistant/chat` | POST | `app/api/routes_assistant.py` | `AssistantChatRequest` (`app/assistant/schemas.py`) | SSE stream (see §4) |
| `/assistant/commands` | POST | `app/api/routes_assistant.py` | `AssistantCommandRequest` (fixed command enum) | SSE stream (no LLM; see §4) |
| `/uploads` | POST | `app/api/routes_uploads.py` | multipart file upload | `dict` (gated — see §4) |
| `/uploads` | DELETE | `app/api/routes_uploads.py` | — | `dict` (always available for erasure — see §4) |
| `/exports/analysis.csv` | GET | `app/api/routes_exports.py` | required `?run_id=` | Current analytical detail CSV for an owned run; unknown/foreign run is 404 |
| `/exports/area-selection.csv` | POST | `app/api/routes_exports.py` | `AreaSelectionRequest` | Formula-safe streaming CSV containing every record in the polygon, independent of the UI page size |
| `/exports/tableau/place-summary.csv` | GET | `app/api/routes_exports.py` | optional `?run_id=` | CSV attachment for the requested user-owned run, or the latest run when omitted |

`/health.revision` is the validated Git object ID baked into a launcher-built image. It is
`null` for direct local runs that do not provide build metadata. The public response never reads
the repository or invokes Git at request time; the launchers resolve the checkout once and Docker
stores it as `MCA_BUILD_REVISION` in the runtime image. Both public launchers compare the served
value with the checkout they built and fail clearly on a mismatch.

The `/dashboard/analyze`, `/dashboard/incidents`, `/dashboard/compare`, and
`/dashboard/neighborhood` request bodies accept an optional `layer` field (`"reported"`
default, `"arrests"`, or `"calls"`). It selects the incident-context layer: `"reported"`
queries SPD crime reports only, `"arrests"` queries SPD arrest records (enforcement activity),
and `"calls"` queries SPD 911 calls for service. The route maps the layer to its
`source_dataset`s via `app/crime/sources.py::sources_for_layer`; an unknown value is a 422.
The layers are mutually exclusive and disjoint — arrests are a separate layer, not unioned
into `"reported"` (on the public redacted data an arrest can't be linked back to its crime
report, so counting both would double-count), and a 911 call is never counted with the report
it produced. `/dashboard/analyze` records the layer on the `AnalysisRun` and the
`PlaceCrimeSummary` rows it persists and returns that exact run ID for a saved-place request
(`null` for an ad-hoc points request). `/dashboard/summary` echoes a `layer` field, an additive
`analysis.persisted_scope` object derived from the exact `AnalysisRun`, and `analysis_run_id` on
each summary row. The frontend shows persisted rings/counts only when run ID, selected-place set,
dates, radius, category, representable subfilters, and layer all match; legacy responses without
that provenance fail closed until rerun. `/dashboard/freshness` returns coverage keyed by layer
(`{"reported": {...}, "arrests": {...}, "calls": {...}}`) so the UI pill reflects the active
layer.

The canonical `/dashboard/reports` contract uses layer-native subtype vocabulary instead of
exposing the overloaded storage column: `offense_subcategory` for reported incidents,
`arrest_offense_description` for arrests, and `call_type` for 911 calls. Impossible
cross-layer filter combinations fail validation. It accepts one radius and either an owned
saved-place selection or inline points. Aggregate counts deduplicate source records across
overlapping buffers; per-place and record sections count memberships and flag duplicates.
Dashboard, report, persisted-analysis, assistant-state, and assistant-tool schemas share one
inclusive radius contract: 100 through 1000 meters. Configured radii are UI suggestions inside
that range, not the only accepted values, so a request such as 400 meters is valid throughout
the public and assistant paths.

`/dashboard/neighborhood` response payload. Each place carries
`reference_comparisons`, ordered MCPP → sector → city. Every entry has:

```text
kind, label, available, adequacy_status,
sampling_frame, sampling_frame_version, computation,
geography_components[{id,label,weight,center_count}],
reference_center_count, reference_draw_count, monte_carlo_error,
covered_area_share, effective_geographies, target_count,
p10, p25, median, p75, p90,
share_below, share_equal, share_above, midrank_percentile, warnings[]
```

MCPP and sector components are weighted by their share of the selected place circle's polygon
overlap. Every reference center receives the same radius and incident filters as the target;
incident locations remain fixed. `available: false` entries retain their method/adequacy
metadata but set distribution fields to null. The detailed UI, assistant explanation, and
run-scoped analytical CSV use this structure and make no significance claim.

The previous `baselines[]` polygon-density structure and place-level rate/verdict fields remain
in the payload during method validation for backward compatibility. MCPP/beat legacy entries
are rest-of-area; sector/city are whole-area. New consumers must not use them for the
single-place detailed comparison. The separate `/dashboard/compare` endpoint continues to use
the inferential rate model for user-selected place-vs-place comparisons. `GET /dashboard/mcpp`
returns slimmed MCPP polygon GeoJSON, session-gated and gzip-negotiated.

**Decision vocabularies.** The two surfaces use distinct decision-class enumerations; the
methodology record is [`docs/analysis/pairwise-comparison-engine.md`](../analysis/pairwise-comparison-engine.md).

`/dashboard/compare` — `decision_class` (per pairwise result and the overall verdict), from
`app/analysis/schemas.py::DecisionClass`:

| Value | Meaning |
|---|---|
| `statistically_lower` | The candidate's rate is below the comparator: BH-adjusted p < 0.05 **and** the effect-size floor holds (rate ratio ≤ 0.80). |
| `not_statistically_clear` | Tested, but no clear lower-rate verdict (p ≥ 0.05 or the effect is below the floor). |
| `insufficient_data` | Minimum-data floor not met (see `minimum_data_status`); no test decided. |
| `model_warning` | Data/geometry limitation (e.g. too few period bins to estimate overdispersion); needs analytical review, no directional claim. |

`/dashboard/neighborhood` — per-baseline `relation` (the `neighborhood_decision` outputs
mapped to plot words in `app/services/neighborhood_service.py`):

| Value | Meaning |
|---|---|
| `below` | Place rate statistically below the baseline (p < 0.05, rate ratio ≤ 0.80). |
| `above` | Place rate statistically above the baseline (p < 0.05, rate ratio ≥ 1.25). |
| `similar` | Tested, neither direction is statistically clear. |
| `insufficient` | Minimum-data floor unmet, **or** overdispersion could not be estimated (`model_warning` reads as `insufficient` — the UI must not claim a direction the model can't support). |

`minimum_data_status` (both surfaces; gates whether a comparison is `met` before any
directional class is assigned):

| Value | Meaning |
|---|---|
| `met` | All floors satisfied; the test is decisional. |
| `date_range_too_short` | Analysis window < 30 days (`MIN_ANALYSIS_DAYS`). |
| `non_positive_exposure` | An option/place has zero or negative exposure; not tested. |
| `option_count_too_low` / `place_count_too_low` | Candidate/place count < 3 (`MIN_PLACE_COUNT`); compare uses `option_`, neighborhood uses `place_`. |
| `combined_count_too_low` | Candidate + comparator count < 10 (`MIN_COMBINED_COUNT`). |

The neighborhood surface additionally emits place-level `decision` sentinels outside the
`minimum_data_status` set — `baseline_unavailable` (no beat/area could be resolved for the
place) and `baseline_too_small` (the rest-of-area baseline is empty or has non-positive
area) — both surfaced as `baseline_available: false`.

### Internal tier

Endpoints have `include_in_schema=False` and are absent from `/openapi.json`. All use
`current_user_hash` (session cookie or `X-Demo-User-Id` header; never rejects). Prefixes
are `/internal/` exclusively; the legacy bare paths (`/analysis/`, `/imports`, `/crime/`)
were retired and must not be re-exposed.

| Endpoint | Method | Router file | Request schema | Notes |
|---|---|---|---|---|
| `/internal/places` | GET | `app/api/routes_places.py` | — | Mirror of `GET /places` with demo-identity fallback |
| `/internal/dashboard/summary` | GET | `app/api/routes_dashboard.py` | — | Mirror of `GET /dashboard/summary` |
| `/internal/imports` | POST | `app/api/routes_imports.py` | multipart file | Raw personal data import |
| `/internal/imports/{import_id}` | GET | `app/api/routes_imports.py` | — | Import batch summary |
| `/internal/imports/{import_id}/normalize` | POST | `app/api/routes_imports.py` | — | Normalize import batch |
| `/internal/crime/ingest/sample` | POST | `app/api/routes_crime.py` | — | Load sample crime data |
| `/internal/crime/summarize` | POST | `app/api/routes_crime.py` | `CrimeSummarizeRequest` (inline in router) | Summarize crime for user |
| `/internal/analysis/sites/compare` | POST | `app/api/routes_analysis.py` | `SiteComparisonRequest` (`app/analysis/schemas.py`) | Statistical site comparison |
| `/internal/analysis/comparisons/{comparison_id}` | GET | `app/api/routes_analysis.py` | — | Retrieve stored comparison |
| `/internal/exports/tableau/place-summary.csv` | GET | `app/api/routes_exports.py` | — | Mirror of public export with demo-identity fallback |

### Admin tier

Both admin endpoints are token-gated. Socrata ingest appears in OpenAPI; the operational
retention endpoint is deliberately hidden from the schema.

| Endpoint | Method | Router file | Auth | Notes |
|---|---|---|---|---|
| `/admin/crime/ingest/socrata` | POST | `app/api/routes_admin_crime.py` | `X-Admin-Token: MCA_ADMIN_INGEST_TOKEN` (HTTP 403 without it) | Ingests or backfills SPD data from Seattle Socrata |
| `/admin/maintenance/retention-sweep` | POST | `app/api/routes_admin_maintenance.py` | `X-Admin-Token: MCA_ADMIN_INGEST_TOKEN` (HTTP 403 without it) | Deletes abandoned identity-owned rows in bounded FK order; hidden from OpenAPI |

---

## 3. Internal-surface invariant

⚠ **Internal endpoints must never appear on bare public paths.** This is enforced by
`tests/test_internal_surface.py`, which:

1. **`test_public_paths_present_in_schema`** — asserts all known public paths are present
   in the generated `/openapi.json`. Fails if a public endpoint is accidentally
   `include_in_schema=False`.

2. **`test_legacy_and_internal_paths_absent_from_schema`** — asserts no path beginning
   with `/internal/`, `/analysis/`, `/imports`, or `/crime/` appears in `/openapi.json`.
   This is the primary guard against accidentally re-exposing internal endpoints.

3. **`test_internal_endpoint_still_served`** — confirms that `POST
   /internal/crime/ingest/sample` returns HTTP 200 (hidden from schema but still
   reachable), verifying that `include_in_schema=False` does not disable the route.

The test file enumerates exact `FORBIDDEN_PREFIXES` and `PUBLIC_PATHS` sets — consult it
directly for the canonical list.

---

## 4. Gating and transport notes

### Personal uploads (`/uploads`)

`POST /uploads` and `DELETE /uploads` are public-tier endpoints (session-cookie authenticated,
in schema). `POST` returns **HTTP 404** unless
`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` is set; `DELETE` deliberately remains available when
the flag is off so an operator cannot strand previously uploaded data by disabling new uploads.
The gate is checked at request time inside the handler (`app/api/routes_uploads.py`), not at
startup. The `/input-modes` response also reflects this flag via
`app/input_modes.supported_input_modes`.

Default: `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` is `false`; uploads are disabled in the
default configuration.

### Request-edge limits and static PMTiles

`RequestBodyLimitMiddleware` enforces `MCA_MAX_REQUEST_BYTES` before FastAPI routing
(1 MiB by default). It rejects an oversized declared `Content-Length` immediately and
also measures bodies whose header is absent or dishonest. `/uploads` uses the larger
`MCA_MAX_UPLOAD_BYTES` ceiling only while
`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`; otherwise it remains under the ordinary cap
before its 404 feature gate.

`/tiles/*.pmtiles` is not an OpenAPI route. It requires an HTTP `Range` header; a
range-less request receives 416 so the complete ~100 MiB artifact cannot be fetched in
one GET. Range requests use a dedicated `MCA_RATE_LIMIT_TILES_PER_MINUTE` per-IP bucket
(600 by default). `/health` and `/health/data` use their own generous but finite
`MCA_RATE_LIMIT_HEALTH_PER_MINUTE` bucket because both can take pooled database
connections. That health family remains active even when the general public limiter is
disabled.

When `MCA_TRUST_PROXY_HEADERS=true`, client identity trusts `CF-Connecting-IP` only.
XFF fallback remains off unless the separately reviewed
`MCA_TRUST_X_FORWARDED_FOR=true` gate is set. The named Cloudflare tunnel trusts CF and
leaves XFF off; the Caddy deployment strips CF, pins XFF to `{client_ip}`, and opts into
the XFF gate.

`ResponseSecurityMiddleware` adds CSP, anti-framing, MIME-sniffing, referrer, and permissions
headers without buffering streaming responses. Session tokens, saved places, session-owned
dashboard analysis, assistant streams, uploads, exports, and internal/admin responses receive
`Cache-Control: no-store`. The public beat and MCPP reference-geometry responses retain their
explicit `public, max-age=3600` policy.

### Incident timestamp serialization

SPD source timestamps are Seattle local wall-clock values despite legacy database field
names ending in `_utc`. Public incident payloads preserve those clock digits and attach
the real `America/Los_Angeles` offset (`-07:00` or `-08:00`) rather than falsely emitting
`Z`. See `app/time_contract.py`.

### Assistant streams (`/assistant/chat`, `/assistant/commands`)

`POST /assistant/chat` responds with **Server-Sent Events** (`text/event-stream`). The
handler returns a `StreamingResponse` yielding SSE-formatted events. Each event is shaped
as `AssistantStreamEvent` (`app/assistant/schemas.py`), with `event` in
`{"meta", "status", "tool", "token", "replace", "done", "error"}` — a `status` event carries a
`{label}` turn-progress phrase, and `replace` wholesale-replaces the turn's streamed `token`
text (holdback-guard trip or narrated-answer fallback). See `docs/architecture/assistant.md`
§2 for the full per-event breakdown and turn flow.

The LLM backing the assistant is selected by `MCA_LLM_PROVIDER` — an OpenAI-compatible endpoint
(`MCA_LLM_BASE_URL` / `MCA_LLM_MODEL`, default), OpenAI's API (`openai_native`), or Claude
(`anthropic`) — and drives both the single planning call and the second, streamed narration call
that writes the model-authored final (kill switch: `MCA_ASSISTANT_NARRATION_ENABLED`). Two optional
failover slots are chosen independently via `MCA_LLM_FALLBACK_PROVIDER` and
`MCA_LLM_THIRD_PROVIDER`; compatible-endpoint slots also require their slot-specific base URL and
model. `FailoverLlmClient` tries the usable, deduplicated chain in order. The third compatible slot
never inherits `MCA_LLM_API_KEY`. If every backend is unreachable, only the chat panel is affected;
the rest of the API is unaffected.

`POST /assistant/commands` accepts only the fixed command enum declared by
`AssistantCommandRequest`: `analyze_places`, `compare_places`, `add_place`, `select_places`,
`update_filters`, and `suggest_followups`. It executes the validated tool directly, makes no LLM
call, and emits the same `meta`/`tool`/`token`/`done`/`error` vocabulary so the frontend reducer is
shared. It has its own per-session hourly limit and remains available when free-text chat is
offline. Unadvertised internal tool handlers are rejected by request validation.

### Exports split

`app/api/routes_exports.py` defines **both** public and internal export endpoints in the
same router file:

- **Public analytical card export** (`required_public_user_hash`, in schema):
  `GET /exports/analysis.csv?run_id=...`. The required run id is ownership-checked; unknown or
  foreign ids return 404. New `AnalysisRun` rows persist the ordered saved-place selection so
  zero-count places remain part of the export. The service recomputes the same neighborhood
  detail payload from the frozen run dates, radius, layer, and filters, then writes one row per
  place/reference-geography pair: target count, reference frame/version, component weights,
  exact/Monte Carlo method and precision, adequacy/coverage, quantiles, and tie-aware
  fewer/equal/more shares. Polygon-density ratios, p-values, visit/dwell, and derived per-visit
  fields are deliberately absent. Export-suppressed places are omitted.
- **Public area-selection export** (`required_public_user_hash`, in schema):
  `POST /exports/area-selection.csv`. The request repeats the transient GeoJSON polygon and
  active filters; no selection is persisted. Linked inspector selections use OR within crime
  type, hour, or day and AND across those three dimensions. Summary, highlights, cursor pages,
  and CSV export use the same filtered iterator. The export neutralizes spreadsheet-formula
  cells and carries the selection digest and filter scope on each row.
- **Public session place-summary export** (`required_public_user_hash`, in schema):
  `GET /exports/tableau/place-summary.csv`. Supplying `run_id` scopes the legacy place-summary
  schema to that exact owned run; omitting it preserves latest-run behavior. This remains the
  Manage Places download and retains its compatibility-oriented visit/dwell columns.
- **Internal** (`current_user_hash`, `include_in_schema=False`): `GET /internal/exports/tableau/place-summary.csv`.

---

## 5. Source of truth

- **`/docs`** — Swagger UI; shows all public and admin endpoints with full request/response
  schemas.
- **`/openapi.json`** — Machine-readable OpenAPI 3.x schema; the canonical field-level
  source of truth. Internal endpoints (`include_in_schema=False`) are intentionally absent.
- Router files in `app/api/routes_*.py` — the authoritative source for path strings,
  HTTP methods, auth dependencies, and which endpoints are public vs. internal.
