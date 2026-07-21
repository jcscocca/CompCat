# CompCat

[![CI](https://github.com/jcscocca/CompCat/actions/workflows/ci.yml/badge.svg)](https://github.com/jcscocca/CompCat/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

*CompCat — a pun on CompStat.*

CompCat is a privacy-first web app for exploring **reported Seattle SPD incident context**
around the addresses you care about. Look up an address, pick a radius and date range, and
CompCat shows how many reported incidents fall nearby, what kinds, and how candidate
addresses compare — with honest statistics (exposure-adjusted rates, confidence intervals,
overdispersion handling) and an optional AI analyst grounded in your dashboard.

> **The product invariant:** CompCat describes *reported incident context*. It does **not**
> score safety, rank places as safe or unsafe, or claim anyone was present when an incident
> happened. The AI analyst refuses safety-scoring requests by design. This constraint shapes
> the whole product — see [docs/](docs/README.md) for how.

| Light | Night |
| --- | --- |
| ![CompCat dashboard, light theme](docs/images/dashboard-light.png) | ![CompCat dashboard, night theme](docs/images/dashboard-night.png) |

Built with FastAPI + SQLAlchemy/Alembic, React + TypeScript + Vite, MapLibre over a
self-hosted Seattle vector-tile extract, SQLite for dev / Postgres for deploy. The deployed
app makes **zero third-party requests** — tiles, fonts, and geocoding are all self-hosted or
proxied.

## What it does

- Map-first dashboard: search an address, drop a pin, type a place, or paste a list of places.
- Runs incident analysis for selected places at chosen radii (e.g. 250 m / 500 m / 1000 m) and
  a date range, filtered by offense category (all / person / property / society).
- Shows reported-incident counts, nearest-incident distance, the category mix, the top specific
  offenses, and the individual incident rows behind the numbers.
- Compares two or more candidate addresses side by side at a single radius.
- Optional **CompCat Analyst** chat — *Tabby*, the case-desk analyst — that answers questions
  grounded in your current dashboard data ("how does this address compare to my downtown one?").
- Statistical, exposure-adjusted rate comparison of place buffers.
- Exports privacy-safe, Tableau-ready CSVs using generalized display coordinates.
- Loads a bundled Seattle crime sample for offline development, or ingests a recent window of
  real Seattle SPD open data.

## What it does not do

- It does not score safety or label places as safe, unsafe, or dangerous.
- It does not claim a user was present when an incident occurred.
- It does not expose raw GPS observations in exports.
- It does not yet implement production authentication, encryption at rest, or tenant isolation.

## The dashboard

The dashboard is the primary way to use CompCat. It is a single-page React app built around a
full-screen MapLibre map of Seattle and a persistent **Tabby rail** (a three-snap bottom sheet on
phones). Analysis and comparison results appear as frozen cards in the rail instead of separate
Analyze/Compare tabs.

- **Place chips** — saved places appear as toggle chips at the top of the rail, each with an
  identity letter and color that matches its map pin. Click a chip to include or exclude a place;
  click **+ Add** to open the manage-places dialog, where you can search, drop a pin, enter
  coordinates, paste a CSV, rename/remove places, and control export inclusion.
- **Context strip** — the active dates, radius, offense category, and data layer stay visible
  above Tabby's composer. Open it for exact controls, run the current selection, or copy a
  generalized-coordinate share link.
- **Inline analysis cards** — one selected place produces neighborhood/baseline context; two or
  more produce the statistical comparison as well. Expanding a card reveals the frozen baseline
  detail, monthly trend, category breakdown, incident rows, methods, and a run-scoped CSV link.
  Neutral presence badges connect analyzed map pins back to their latest card.
- **Exports** — card links export that exact stored run. The manage-places dialog also exposes the
  current-session Tableau CSV and per-place privacy toggles.

The map renders from a self-hosted Seattle vector-tile extract (Protomaps/OpenStreetMap data), so
no third-party tile server ever sees where users look; if the tile artifact is missing the map
falls back to a flat background. Address search is served by the
backend proxy `GET /dashboard/geocode` (session-required), which caches results and rate-limits
the upstream. Production must set `MCA_GEOCODER_CONTACT_EMAIL` (an identifiable contact is
required by Nominatim's usage policy). The browser never calls the geocoder directly.

## The CompCat Analyst

The Analyst panel is an optional chat assistant — **Tabby**, CompCat's case-desk analyst — that
answers questions about your dashboard data. It is grounded in what you currently have selected
(places, date range, radii, and offense filters) and is policy-constrained: it reports incident
context and will refuse to label a place as safe or unsafe.

Under the hood free-text turns use an LLM planning call and a small tool set (`add_place`,
`select_places`, `analyze_places`, `compare_places`, `update_filters`, `get_dashboard_summary`,
`suggest_followups`). Chips and explicit rail controls use `POST /assistant/commands`, a
deterministic no-LLM path that shares the same streamed tool-event contract. If the LLM endpoint
is unavailable, free text pauses but commands, filters, cards, badges, and exports keep working.

The assistant talks directly to an **OpenAI-compatible LLM endpoint** (any server exposing a
`/chat/completions` API — llama.cpp/llama-swap, vLLM, etc.). CompCat reaches it at
`MCA_LLM_BASE_URL` (default `http://127.0.0.1:8080/v1`) using the model `MCA_LLM_MODEL`. If no
endpoint is running, the rest of the dashboard works normally — only the Analyst panel is
limited to its deterministic controls; free-text questions pause while chips, filters, cards,
badges, and exports continue to work. See [Running the Analyst](#running-the-analyst-optional).

## Input modes

`GET /input-modes` returns the entry modes available to the current build:

1. **Enter places manually** — approximate places with optional weekly visit frequency and dwell.
2. **Paste a place list** — rows with `latitude` and `longitude`, plus optional `display_label`,
   `visit_count`, `total_dwell_minutes`, `median_dwell_minutes`, `typical_days`, `typical_hours`,
   and `sensitivity_class`.

A third mode, **Personal timeline upload** (Google Timeline JSON, raw point CSV, GeoJSON, GPX),
is for internal demos and parser validation only. It is hidden unless you set
`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true`. Uploaded files are temporary input artifacts; the
canonical product objects are stop visits, recurring place clusters, and context summaries.

## Statistical comparison

Statistical comparison compares place buffers using exposure-adjusted reported-incident rates,
with an `Overview` mode (public summary, decision class, rates, short caveat) and an
`Analytical` mode (counts, exposure, rate ratio, confidence interval, p-values, method,
overdispersion and minimum-data status, and full caveats). Product language may say "lower
reported-incident rate"; it must never call a place safe, unsafe, dangerous, or
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

With no `.env`, CompCat uses a local SQLite database at
`./dev-output/mobility.sqlite3` and creates its schema on startup, so `make run` works out
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
port so it does not collide with the API on `8000`) and point CompCat at it:

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

Ingest a recent window of real Seattle SPD open data through the admin endpoint. It requires
`MCA_ADMIN_INGEST_TOKEN`, which has no default — the endpoint rejects every request until you
set one (e.g. `export MCA_ADMIN_INGEST_TOKEN=$(openssl rand -hex 24)` before starting the stack):

```bash
curl --fail --show-error -X POST \
  -H "X-Admin-Token: $MCA_ADMIN_INGEST_TOKEN" \
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
`.env.example` for a starting point. In `production`, CompCat refuses to boot with the default
salt/secret and forces secure cookies.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCA_ENVIRONMENT` | `local` | Deployment environment; `production` enforces secret overrides and secure cookies. |
| `MCA_DATABASE_URL` | `sqlite+pysqlite:///./dev-output/mobility.sqlite3` | SQLAlchemy database URL (use a Postgres URL for production). |
| `MCA_USER_HASH_SALT` | `local-demo-salt` | Salt for hashing demo user identity. Must be overridden in production. |
| `MCA_SESSION_SECRET` | `local-dashboard-session-secret` | Session cookie secret. Must be overridden in production. |
| `MCA_SESSION_COOKIE_SECURE` | auto | Force secure cookies; defaults to on in production. |
| `MCA_STATIC_DASHBOARD_DIR` | `app/static/dashboard` | Where the built dashboard is served from. |
| `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` | `false` | Surface the personal timeline upload mode (internal/demo). |
| `MCA_RAW_UPLOAD_RETENTION` | `false` | Keep raw uploads instead of deleting them after normalization. |
| `MCA_ADMIN_INGEST_TOKEN` | _unset_ | Token required by the admin Socrata ingest endpoint. No default anywhere, including Compose: while unset the endpoint rejects every request. The formerly-shipped `local-admin-token` is still rejected at boot in production. |
| `MCA_CRIME_RADII_M` | `[250,500,1000]` | Default analysis radii in meters. |
| `MCA_SOCRATA_BASE_URL` | `https://data.seattle.gov/resource` | Seattle open-data base URL. |
| `MCA_SOCRATA_DATASET_ID` | `tazs-3rd5` | SPD "Crime Data: 2008-Present" dataset id. |
| `SOCRATA_APP_TOKEN` | _unset_ | Optional Socrata app token for higher rate limits. |
| `MCA_LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible LLM endpoint base URL for the Analyst. |
| `MCA_LLM_MODEL` | `gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k` | Model name sent to the LLM endpoint. |
| `MCA_ASSISTANT_ROLE` | `compcat_analyst` | Analyst role label included in assistant responses. |

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

For internal architecture — system overview, data model, the full API contract, the assistant
design, and the roadmap — see [`docs/`](docs/README.md).

> Endpoints marked *internal* are hidden from the OpenAPI schema (`/internal/...`), allow
> the demo-identity fallback, and are not called by the dashboard UI. Do not expose them
> on bare public paths — `tests/test_internal_surface.py` enforces this.

| Group | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Sessions | `POST /sessions` |
| Input modes | `GET /input-modes` |
| Places | `GET /places` · `POST /places` · `POST /places/bulk` · `PATCH /places/{id}` · `DELETE /places/{id}` |
| Dashboard | `GET /dashboard/summary` · `POST /dashboard/analyze` · `POST /dashboard/incidents` · `POST /dashboard/compare` · `POST /dashboard/neighborhood` · `GET /dashboard/trends` · `GET /dashboard/freshness` · `GET /dashboard/beats` · `GET /dashboard/mcpp` · `POST /dashboard/incident-points` · `GET /dashboard/geocode` |
| Analyst | `POST /assistant/chat` · `POST /assistant/commands` (Server-Sent Events) |
| Statistical analysis (internal) | `POST /internal/analysis/sites/compare` · `GET /internal/analysis/comparisons/{id}` |
| Exports | `GET /exports/tableau/place-summary.csv` (optional `run_id`) |
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
biased by device behavior. CompCat provides context summaries, not safety predictions.

Police beat boundaries come from the City of Seattle's Seattle GeoData open-data site
(Seattle Police Department Beats layer; source: City of Seattle, Seattle Police Department
GIS), published under the City's Open Data Policy on an open-license basis with no
restriction on copying, republishing, or modifying — the City provides these boundaries
as-is and makes no warranty as to positional accuracy. The bundled seed/sample incident
CSVs are synthetic — generated to resemble the schema of SPD's "Crime Data: 2008-Present"
dataset (Socrata `tazs-3rd5`, itself published Public Domain by SPD) for offline
development — not redistributed SPD records.

## License

MIT — see [LICENSE](LICENSE). This implementation is original; related projects (Google
Timeline parsing tools, Reitti, GeoPulse, Dawarich, and Seattle crime-data pipelines) were
used as architecture references only — no AGPL/GPL/BSL source was copied.
