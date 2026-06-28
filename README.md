# Waypoint

Waypoint is a privacy-first web app for exploring **reported Seattle SPD incident context**
around the places you care about and the routes between them. You add approximate places on a
map, pick a radius and date range, and Waypoint shows how many reported incidents fall nearby,
what kinds, and how places compare — plus an optional AI analyst you can ask questions in plain
language.

Waypoint describes *reported incident context*. It does **not** score safety, rank places as
safe or unsafe, or claim anyone was present when an incident happened.

## What it does

- Map-first dashboard: search an address, drop a pin, type a place, or paste a list of places.
- Runs incident analysis for selected places at chosen radii (e.g. 250 m / 500 m / 1000 m) and
  a date range, filtered by offense category (all / person / property / society).
- Shows reported-incident counts, nearest-incident distance, the category mix, the top specific
  offenses, and the individual incident rows behind the numbers.
- Compares two or more places side by side at a single radius.
- Optional **Waypoint Analyst** chat that answers questions grounded in your current dashboard
  data ("how does this stop compare to my downtown one?").
- Compares route alternatives between generalized Seattle areas with reported-incident context
  along each route (currently a deterministic mock routing provider).
- Statistical, exposure-adjusted rate comparison of place buffers and route corridors.
- Exports privacy-safe, Tableau-ready CSVs using generalized display coordinates.
- Loads a bundled Seattle crime sample for offline development, or ingests a recent window of
  real Seattle SPD open data.

## What it does not do

- It does not score safety or label places as safe, unsafe, or dangerous.
- It does not claim a user was present when an incident occurred.
- It does not expose raw GPS observations in exports.
- It does not yet implement production authentication, encryption at rest, or tenant isolation.

## The dashboard

The dashboard is the primary way to use Waypoint. It is a single-page React app built around a
full-screen Leaflet map of Seattle, with a resizable side drawer organized into four tabs.

- **Places** — add places four ways: search by name/address (OpenStreetMap Nominatim geocoding),
  click **Add pin** and drop a point on the map, enter latitude/longitude manually, or paste a
  CSV of places. Select places to analyze, and remove ones you no longer want.
- **Analyze** — choose a date range, a radius, and an offense-category filter, then run analysis.
  Results include a findings summary, a crime-mix chart, the top offenses, and an incident-detail
  table (date, category, distance, block address, incident id). Analyzed places show their radius
  rings on the map.
- **Compare** — with two or more places selected, compare reported-incident counts and the top
  offense types side by side at one radius.
- **Export** — download the Tableau-ready place-summary CSV for the current session.

The map uses CARTO Positron basemap tiles (OpenStreetMap data). Address search is served by the
backend proxy `GET /dashboard/geocode` (session-required), which caches results and rate-limits
the upstream. Production must set `MCA_GEOCODER_CONTACT_EMAIL` (an identifiable contact is
required by Nominatim's usage policy). The browser never calls the geocoder directly.

## The Waypoint Analyst

The Analyst panel is an optional chat assistant that answers questions about your dashboard data.
It is grounded in what you currently have selected (places, date range, radii, and offense
filters) and is policy-constrained: it reports incident context and will refuse to label a place
as safe or unsafe.

Under the hood the assistant plans with an LLM and can call a small set of read-only tools
(`get_dashboard_summary`, `run_place_analysis`, `compare_places`, `get_incident_details`,
`suggest_followups`), capped at `MCA_ASSISTANT_MAX_TOOL_CALLS` per turn. Responses stream back to
the browser token by token.

The assistant talks directly to an **OpenAI-compatible LLM endpoint** (any server exposing a
`/chat/completions` API — llama.cpp/llama-swap, vLLM, etc.). Waypoint reaches it at
`MCA_LLM_BASE_URL` (default `http://127.0.0.1:8080/v1`) using the model `MCA_LLM_MODEL`. If no
endpoint is running, the rest of the dashboard works normally — only the Analyst panel is
unavailable. See [Running the Analyst](#running-the-analyst-optional).

## Input modes

`GET /input-modes` returns the entry modes available to the current build:

1. **Enter places manually** — approximate places with optional weekly visit frequency and dwell.
2. **Paste a place list** — rows with `latitude` and `longitude`, plus optional `display_label`,
   `visit_count`, `total_dwell_minutes`, `median_dwell_minutes`, `typical_days`, `typical_hours`,
   and `sensitivity_class`.
3. **Public commute scenario** — model a commute between generalized Seattle areas (Capitol Hill,
   Downtown Seattle, Rainier Valley, University District, Ballard, Westlake Station) instead of
   personal location data.

A fourth mode, **Personal timeline upload** (Google Timeline JSON, raw point CSV, GeoJSON, GPX),
is for internal demos and parser validation only. It is hidden unless you set
`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`. Uploaded files are temporary input artifacts; the
canonical product objects are stop visits, recurring place clusters, and context summaries.

## Routes and statistical comparison

- **Route alternatives** rank alternative routes between generalized Seattle areas (mode:
  `transit`, `walk`, `bike`, or `drive`) and, when analysis dates are supplied, attach reported-
  incident context near route points. The default provider is a deterministic **mock** used for
  local development, tests, and dashboard validation. A live **OpenTripPlanner** provider is also
  built in but off by default; enable it by setting `MCA_ROUTING_PROVIDER=opentripplanner` and
  `MCA_OPENTRIPPLANNER_BASE_URL` to a running OpenTripPlanner 2.x instance's GraphQL endpoint
  (see the configuration table). Route
  exports (`route-alternatives.csv`, `route-segments.csv`, `route-context.csv`) never include raw
  GPS observations.
- **Statistical comparison** compares place buffers and route corridors using exposure-adjusted
  reported-incident rates, with an `Overview` mode (public summary, decision class, rates, short
  caveat) and an `Analytical` mode (counts, exposure, rate ratio, confidence interval, p-values,
  method, overdispersion and minimum-data status, and full caveats). Product language may say
  "lower reported-incident rate"; it must never call a route safe, unsafe, dangerous, or
  crime-preventing.

## Privacy posture

- Places are stored as saved clusters with **generalized display coordinates**
  (`display_latitude` / `display_longitude`); when those are missing the exporter rounds exact
  centroids to a coarse grid.
- In the default `tableau_safe` mode, home-like, work-like, health-like, religious-like, and
  explicitly suppressed clusters are excluded from exports.
- Demo identity comes from the `X-Demo-User-Id` header (or `demo_user` when omitted) and is
  hashed server-side with `MCA_USER_HASH_SALT`.
- Raw uploaded points are discarded after clustering: the public personal-upload path keeps
  only the derived place clusters (the raw `StagingLocationObservation` points and per-visit
  `StopVisit` rows are deleted) unless `MCA_RAW_UPLOAD_RETENTION=true`.

### Personal uploads (disabled by default)

Users can upload their own location history (Google Timeline JSON, CSV points, GeoJSON, or
GPX) so the dashboard shows reported-incident context around the places they actually go.

This feature **ships disabled**. It is gated by `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS`, which
**defaults to `false`** — with it off, the `POST`/`DELETE /uploads` endpoints return `404`, the
`personal_timeline` input mode is not advertised, and **no upload UI is rendered anywhere**.
Enable it deliberately by setting `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`.

Retention: by default only the derived place clusters are kept — raw points and per-visit
stops are discarded immediately after clustering (set `MCA_RAW_UPLOAD_RETENTION=true` to keep
the raw points for re-clustering). The upload panel includes a consent gate and a
"Delete my uploaded data" control that erases every uploaded artifact for the user.

**Roadmap (not yet implemented):** production authentication, encryption at rest, and per-user
tenant isolation.

## Quick start

Requirements: Python 3.11+, Node 20.19+ (or 22.12+), and optionally Docker.

```bash
make install        # create .venv and install the app with dev extras
make run            # start the API on http://127.0.0.1:8000 (SQLite by default)
```

With no `.env`, Waypoint uses a local SQLite database at
`./localagent-output/mobility.sqlite3` and creates its schema on startup, so `make run` works out
of the box. Load the bundled sample crime data so analysis returns results:

```bash
curl -X POST http://127.0.0.1:8000/internal/crime/ingest/sample
```

### Running the dashboard

You can serve the dashboard two ways:

**Single server (built assets).** Build the frontend once; the API then serves it at `/`:

```bash
make frontend-install
make frontend-build         # outputs to app/static/dashboard
make run                    # open http://127.0.0.1:8000
```

**Dev server (hot reload).** Run the API and the Vite dev server side by side:

```bash
make run                    # API on :8000
cd frontend && npm run dev  # dashboard on http://127.0.0.1:5173
```

The dev server proxies API calls to `http://127.0.0.1:8000` by default. If the API runs on a
different port, point the proxy at it:

```bash
VITE_BACKEND_TARGET=http://127.0.0.1:8001 npm run dev
```

### Running the Analyst (optional)

The Analyst panel needs a running OpenAI-compatible LLM endpoint (any server exposing a
`/chat/completions` API — llama.cpp/llama-swap, vLLM, etc.). Start your endpoint (on its own
port so it does not collide with the API on `8000`) and point Waypoint at it:

```bash
export MCA_LLM_BASE_URL=http://127.0.0.1:8080/v1   # this is the default
export MCA_LLM_MODEL=gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k
make run
```

Without an LLM endpoint the dashboard still works; the Analyst panel is simply disabled.

### Running with Postgres/PostGIS

For a production-like database, use Docker Compose. It builds the frontend, runs Alembic
migrations, and serves everything on port `8000` against Postgres/PostGIS:

```bash
docker compose up --build   # open http://127.0.0.1:8000
```

### Loading real Seattle crime data

Ingest a recent window of real Seattle SPD open data through the admin endpoint (requires
`MCA_ADMIN_INGEST_TOKEN`; the Compose stack sets it to `local-admin-token`):

```bash
curl --fail --show-error -X POST \
  -H "X-Admin-Token: local-admin-token" \
  "http://127.0.0.1:8000/admin/crime/ingest/socrata?limit=5000&offset=0&start_date=2026-04-01&end_date=2026-06-22"
```

### Tests and migrations

```bash
make test        # backend tests (pytest)
make lint        # ruff
make test-all    # backend tests + lint + frontend tests + frontend build
make migrate     # apply Alembic migrations (for Postgres/production)
```

## Configuration

All backend settings are environment variables (prefix `MCA_`, except `SOCRATA_APP_TOKEN`). See
`.env.example` for a starting point. In `production`, Waypoint refuses to boot with the default
salt/secret and forces secure cookies.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCA_ENVIRONMENT` | `local` | Deployment environment; `production` enforces secret overrides and secure cookies. |
| `MCA_DATABASE_URL` | `sqlite+pysqlite:///./localagent-output/mobility.sqlite3` | SQLAlchemy database URL (use a Postgres URL for production). |
| `MCA_USER_HASH_SALT` | `local-demo-salt` | Salt for hashing demo user identity. Must be overridden in production. |
| `MCA_SESSION_SECRET` | `local-dashboard-session-secret` | Session cookie secret. Must be overridden in production. |
| `MCA_SESSION_COOKIE_SECURE` | auto | Force secure cookies; defaults to on in production. |
| `MCA_STATIC_DASHBOARD_DIR` | `app/static/dashboard` | Where the built dashboard is served from. |
| `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` | `false` | Surface the personal timeline upload mode (internal/demo). |
| `MCA_RAW_UPLOAD_RETENTION` | `false` | Keep raw uploads instead of deleting them after normalization. |
| `MCA_ADMIN_INGEST_TOKEN` | _unset_ | Token required by the admin Socrata ingest endpoint. The guessable Compose default (`local-admin-token`) is rejected at boot in production. |
| `MCA_CRIME_RADII_M` | `[250,500,1000]` | Default analysis radii in meters. |
| `MCA_SOCRATA_BASE_URL` | `https://data.seattle.gov/resource` | Seattle open-data base URL. |
| `MCA_SOCRATA_DATASET_ID` | `tazs-3rd5` | SPD "Crime Data: 2008-Present" dataset id. |
| `SOCRATA_APP_TOKEN` | _unset_ | Optional Socrata app token for higher rate limits. |
| `MCA_LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible LLM endpoint base URL for the Analyst. |
| `MCA_LLM_MODEL` | `gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k` | Model name sent to the LLM endpoint. |
| `MCA_ASSISTANT_ROLE` | `waypoint_analyst` | Analyst role label included in assistant responses. |
| `MCA_ASSISTANT_MAX_TOOL_CALLS` | `2` | Max tool calls the Analyst may make per turn. |
| `MCA_ROUTING_PROVIDER` | `mock` | Route alternatives provider: `mock` (deterministic, default) or `opentripplanner` (live). |
| `MCA_OPENTRIPPLANNER_BASE_URL` | _unset_ | OTP2 GTFS GraphQL endpoint (e.g. `http://localhost:8080/otp/gtfs/v1`); required when the provider is `opentripplanner`. |
| `MCA_OPENTRIPPLANNER_TIMEOUT_S` | `10.0` | HTTP timeout (seconds) for OpenTripPlanner requests. |

Normalization thresholds for the internal upload pipeline are also configurable:
`MCA_MINIMUM_STOP_DURATION_MINUTES`, `MCA_STOP_RADIUS_M`, `MCA_CLUSTER_RADIUS_M`,
`MCA_MINIMUM_CLUSTER_VISITS`, and `MCA_MINIMUM_CLUSTER_TOTAL_DWELL_MINUTES`.

For production, additionally set `MCA_ENVIRONMENT=production`, a real `MCA_DATABASE_URL`,
`MCA_USER_HASH_SALT`, `MCA_SESSION_SECRET`, `MCA_SESSION_COOKIE_SECURE=true`, and
`MCA_ADMIN_INGEST_TOKEN`; run Alembic migrations before serving traffic; and ingest recent SPD
data through the admin endpoint.

## Developer reference

The dashboard drives the API for you, and FastAPI publishes interactive docs at `/docs`
(Swagger UI) and `/openapi.json`. The public endpoints are grouped below.

> Endpoints marked *internal* are hidden from the OpenAPI schema (`/internal/...`), allow
> the demo-identity fallback, and are not called by the dashboard UI. Do not expose them
> on bare public paths — `tests/test_internal_surface.py` enforces this.

| Group | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Sessions | `POST /sessions` |
| Input modes | `GET /input-modes` |
| Places | `GET /places` · `POST /places` · `POST /places/bulk` · `PATCH /places/{id}` · `DELETE /places/{id}` |
| Dashboard | `GET /dashboard/summary` · `POST /dashboard/analyze` · `POST /dashboard/incidents` · `POST /dashboard/compare` |
| Analyst | `POST /assistant/chat` (Server-Sent Events) |
| Routes (internal) | `POST /internal/routes/alternatives` · `GET /internal/routes/requests/{id}/comparison` |
| Statistical analysis (internal) | `POST /internal/analysis/sites/compare` · `POST /internal/analysis/routes/compare` · `GET /internal/analysis/comparisons/{id}` |
| Exports | `GET /exports/tableau/place-summary.csv` · `route-alternatives.csv` · `route-segments.csv` · `route-context.csv` · `statistical-comparisons.csv` |
| Crime data | `POST /internal/crime/ingest/sample` · `POST /internal/crime/summarize` · `POST /admin/crime/ingest/socrata` |
| Internal/demo | `POST /internal/imports` · `GET /internal/imports/{id}` · `POST /internal/imports/{id}/normalize` |

A minimal end-to-end flow with `curl`:

```bash
# 1. Create a session (stores the cookie)
curl -c demo.cookies -X POST http://127.0.0.1:8000/sessions

# 2. Add an approximate place
curl -b demo.cookies -H "Content-Type: application/json" \
  -d '{"display_label":"Downtown transfer stop","latitude":47.609,"longitude":-122.333}' \
  http://127.0.0.1:8000/places

# 3. Load sample crime data, then analyze the saved place
#    (the bundled sample incidents are dated January 2024)
curl -X POST http://127.0.0.1:8000/internal/crime/ingest/sample
curl -b demo.cookies -H "Content-Type: application/json" \
  -d '{"place_ids":["<place_id>"],"analysis_start_date":"2024-01-01","analysis_end_date":"2024-01-31","radii_m":[250,500]}' \
  http://127.0.0.1:8000/dashboard/analyze

# 4. Export the Tableau CSV
curl -b demo.cookies http://127.0.0.1:8000/exports/tableau/place-summary.csv
```

The Tableau place-summary export includes recurring-place fields, generalized coordinates, the
selected analysis range, offense grouping fields, incident counts, nearest-incident distance,
incidents per expected visit, and incidents per hour of dwell. The expected-weekly-visit
denominator behind `incidents_per_visit` is routine metadata for context, not a risk score. Frame
each row as:

> Reported SPD incidents within 500 m of this recurring location during the selected date range.

## Data sources and caveats

Crime data comes from Seattle's open-data portal — by default the SPD "Crime Data: 2008-Present"
dataset (`tazs-3rd5`). Reported crime data can be incomplete, delayed, corrected, or
geographically generalized, and personal location history can be incomplete, inaccurate, or
biased by device behavior. Waypoint provides context summaries, not safety predictions.

## References and licensing

This implementation is original. Related projects (Google Timeline parsing tools, Reitti,
GeoPulse, Dawarich, and Seattle crime-data pipelines) were used as architecture references only;
no AGPL/GPL/BSL source was copied. If MIT-licensed code is reused, preserve attribution and
license notices.
