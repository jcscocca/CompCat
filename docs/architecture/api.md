# API Contract

This document covers the auth model, tier contracts, enforcement invariant, and transport
notes for the CompCat API. The live `/openapi.json` (and Swagger UI at `/docs`) is the
field-level source of truth; this document covers rules and tier structure only.

> Verified against `2d6d4f3` (2026-07-19).

⚠ **Invariant:** CompCat reports *reported incident context*. The API must not score
safety, rank places as safe/unsafe/dangerous, or claim a user was present at an incident.
The assistant refuses safety-score requests by design (`app/assistant/agent.py`). This
invariant applies to code, copy, and any future endpoints.

---

## 1. Auth model

### Session cookie

`POST /sessions` creates an anonymous session token (HMAC-signed, 24 h TTL) and sets it
as an `HttpOnly` cookie named `mca_session` (`MCA_SESSION_SECRET` is the signing key).
Posting again with a valid cookie is idempotent — the session is resumed, not rotated
(a reload keeps the same pseudonymous identity for the cookie's 24 h TTL). The cookie is
`Secure` in `prod`/`production` environments; settable explicitly via
`MCA_SESSION_COOKIE_SECURE`. Logic lives in `app/sessions.py`.

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

`POST /admin/crime/ingest/socrata` requires an `X-Admin-Token` header whose value must
equal `MCA_ADMIN_INGEST_TOKEN`. The guard is defined inline in
`app/api/routes_admin_crime.py` (`require_admin_ingest_token` dependency). The endpoint
appears in the public OpenAPI schema (it is not `include_in_schema=False`) but returns
HTTP 403 without a matching token.

---

## 2. Tier reference

### Public tier

Endpoints appear in `/openapi.json`. All require `required_public_user_hash` (valid
session cookie; HTTP 401 otherwise), except `/sessions`, `/health`, and `/input-modes`
which are unauthenticated or session-creating.

| Endpoint | Method | Router file | Request schema | Response schema |
|---|---|---|---|---|
| `/sessions` | POST | `app/api/routes_sessions.py` | — | `{"session_state": "created"}` |
| `/health` | GET | `app/api/routes_health.py` | — | `{"status": "ok"}` |
| `/input-modes` | GET | `app/api/routes_input_modes.py` | — | `{"modes": [...]}` |
| `/places` | GET | `app/api/routes_places.py` | — | `{"count": int, "places": [...]}` |
| `/places` | POST | `app/api/routes_public_places.py` | `ManualPlaceCreate` (`app/places/schemas.py`) | `ManualPlaceResponse` |
| `/places/bulk` | POST | `app/api/routes_public_places.py` | `BulkPlaceCreate` | `BulkPlaceCreateResponse` |
| `/places/{place_id}` | PATCH | `app/api/routes_public_places.py` | `ManualPlaceUpdate` | `ManualPlaceResponse` |
| `/places/{place_id}` | DELETE | `app/api/routes_public_places.py` | — | 204 No Content |
| `/dashboard/summary` | GET | `app/api/routes_dashboard.py` | — | `dict` |
| `/dashboard/analyze` | POST | `app/api/routes_public_dashboard.py` | `DashboardAnalyzeRequest` (`app/api/dashboard_schemas.py`) | `dict[str, int]` |
| `/dashboard/incidents` | POST | `app/api/routes_public_dashboard.py` | `DashboardIncidentDetailsRequest` | `dict` |
| `/dashboard/compare` | POST | `app/api/routes_public_dashboard.py` | `DashboardCompareRequest` | `dict` |
| `/dashboard/neighborhood` | POST | `app/api/routes_public_dashboard.py` | `DashboardAnalyzeRequest` | `dict` |
| `/dashboard/freshness` | GET | `app/api/routes_public_dashboard.py` | — | `dict` |
| `/dashboard/beats` | GET | `app/api/routes_public_dashboard.py` | — | `Response` (slimmed beat-outline GeoJSON, gzip-negotiated) |
| `/dashboard/mcpp` | GET | `app/api/routes_public_dashboard.py` | — | `Response` (slimmed MCPP-neighborhood-polygon GeoJSON, gzip-negotiated; sibling of `/dashboard/beats`) |
| `/dashboard/geocode` | GET | `app/api/routes_public_dashboard.py` | `?q=` query param | `list[GeocodeResultSchema]` |
| `/dashboard/trends` | GET | `app/api/routes_public_dashboard.py` | `?mcpp=` (normalized, 404 unknown), `?layer=` (400 unknown), `?category=` | `dict` (raw zero-filled monthly `area_counts`/`citywide_counts`, last complete month, TTL-cached with a shared citywide entry; math: `docs/analysis/trend-indexing-method.md`) |
| `/assistant/chat` | POST | `app/api/routes_assistant.py` | `AssistantChatRequest` (`app/assistant/schemas.py`) | SSE stream (see §4) |
| `/assistant/commands` | POST | `app/api/routes_assistant.py` | `AssistantCommandRequest` (fixed command enum) | SSE stream (no LLM; see §4) |
| `/uploads` | POST | `app/api/routes_uploads.py` | multipart file upload | `dict` (gated — see §4) |
| `/uploads` | DELETE | `app/api/routes_uploads.py` | — | `dict` (gated — see §4) |
| `/exports/tableau/place-summary.csv` | GET | `app/api/routes_exports.py` | optional `?run_id=` | CSV attachment for the requested user-owned run, or the latest run when omitted |

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
`PlaceCrimeSummary` rows it persists, so `/dashboard/summary` echoes a `layer` field.
`/dashboard/freshness` returns coverage keyed by layer (`{"reported": {...}, "calls": {...}}`)
so the UI pill reflects the active layer.

`/dashboard/neighborhood` response payload. Each place additionally carries `baselines: [{kind:
"mcpp"|"beat"|"sector"|"city", label, area_km2, baseline_incident_count, baseline_rate,
rate_ratio, ci_lower, ci_upper, adjusted_p_value (BH within place), method, relation:
"above"|"similar"|"below"|"insufficient"}]`. MCPP/beat entries are rest-of-area (place buffer
carved out); sector/city are whole-area. Unresolvable geographies are omitted. Each place also
carries its own quasi-Poisson rate interval (place_rate, place_rate_ci_lower/upper — same variance
model as the Compare tab's per-address interval). The former top-level single-beat pair fields
(beat_rate, rate_ratio, ci_*, adjusted_p_value, method, overdispersion_status) were removed in
slice 2; per-baseline statistics live in baselines[]. Also new: `GET /dashboard/mcpp` —
slimmed MCPP polygon GeoJSON, session-gated, gzip-negotiated (sibling of `GET /dashboard/beats`).

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

The single admin endpoint appears in the public OpenAPI schema but is gated by token.

| Endpoint | Method | Router file | Auth | Notes |
|---|---|---|---|---|
| `/admin/crime/ingest/socrata` | POST | `app/api/routes_admin_crime.py` | `X-Admin-Token: MCA_ADMIN_INGEST_TOKEN` (HTTP 403 without it) | Ingests or backfills SPD data from Seattle Socrata |

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

`POST /uploads` and `DELETE /uploads` are public-tier endpoints (session-cookie
authenticated, in schema) but return **HTTP 404** unless `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`
is set. The gate is checked at request time inside the handler (`app/api/routes_uploads.py`),
not at startup. The `/input-modes` response also reflects this flag via
`app/input_modes.supported_input_modes`.

Default: `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` is `false`; uploads are disabled in the
default configuration.

### Assistant streams (`/assistant/chat`, `/assistant/commands`)

`POST /assistant/chat` responds with **Server-Sent Events** (`text/event-stream`). The
handler returns a `StreamingResponse` yielding SSE-formatted events. Each event is shaped
as `AssistantStreamEvent` (`app/assistant/schemas.py`), with `event` in
`{"meta", "status", "tool", "token", "replace", "done", "error"}` — a `status` event carries a
`{label}` turn-progress phrase, and `replace` wholesale-replaces the turn's streamed `token`
text (holdback-guard trip or narrated-answer fallback). See `docs/architecture/assistant.md`
§2 for the full per-event breakdown and turn flow.

The LLM backing the assistant is called via `MCA_LLM_BASE_URL` / `MCA_LLM_MODEL`
(OpenAI-compatible), both for the single planning call and for the second, streamed narration
call that writes the model-authored final (kill switch: `MCA_ASSISTANT_NARRATION_ENABLED`). An
optional failover node is configured via `MCA_LLM_FALLBACK_BASE_URL` / `MCA_LLM_FALLBACK_MODEL`.
If both are set, `FailoverLlmClient` is used. If the LLM is unreachable, only the chat panel is
affected; the rest of the API is unaffected.

`POST /assistant/commands` accepts only the fixed command enum declared by
`AssistantCommandRequest`: `analyze_places`, `compare_places`, `add_place`, `select_places`,
`update_filters`, and `suggest_followups`. It executes the validated tool directly, makes no LLM
call, and emits the same `meta`/`tool`/`token`/`done`/`error` vocabulary so the frontend reducer is
shared. It has its own per-session hourly limit and remains available when free-text chat is
offline. Unadvertised internal tool handlers are rejected by request validation.

### Exports split

`app/api/routes_exports.py` defines **both** public and internal export endpoints in the
same router file:

- **Public** (`required_public_user_hash`, in schema): `GET /exports/tableau/place-summary.csv`.
  Supplying `run_id` scopes the CSV to that exact run after verifying the run belongs to the
  session; unknown or foreign ids return 404. Omitting it preserves latest-run behavior.
- **Internal** (`current_user_hash`, `include_in_schema=False`): `GET /internal/exports/tableau/place-summary.csv`.

---

## 5. Source of truth

- **`/docs`** — Swagger UI; shows all public and admin endpoints with full request/response
  schemas.
- **`/openapi.json`** — Machine-readable OpenAPI 3.x schema; the canonical field-level
  source of truth. Internal endpoints (`include_in_schema=False`) are intentionally absent.
- Router files in `app/api/routes_*.py` — the authoritative source for path strings,
  HTTP methods, auth dependencies, and which endpoints are public vs. internal.
