# Mobility Context Analyzer

Privacy-first mobility context tool with a public dashboard for approximate manual place
entry, place-list paste flows, selected-place analysis, and reported Seattle SPD incident
context exports. Personal timeline uploads remain available for internal demos, but they
are not the center of the public launch experience.

## What It Does

- Accepts approximate places entered manually or pasted as rows.
- Imports public commute scenario CSV files using generalized Seattle area centroids.
- Supports selected-place analysis and comparison for saved public-dashboard places.
- Exports privacy-safe Tableau CSV rows using generalized display coordinates.
- Keeps internal/demo parsers for Google Maps/Timeline JSON, raw point CSV, GeoJSON, and GPX.
- Normalizes uploads into stop visits and recurring place clusters.
- Marks home-like and work-like clusters for privacy suppression.
- Loads a local Seattle crime fixture for offline tests and demo work.
- Computes reported SPD incident counts within selected radii and date ranges.

## What It Does Not Do

- It does not score safety or label places as safe or unsafe.
- It does not claim a user was present when an incident occurred.
- It does not expose raw GPS observations in Tableau exports.
- It does not implement real authentication, encryption at rest, or tenant isolation yet.
- It does not run live Socrata ingestion in unit tests.

## Privacy Posture

Manual and pasted public-dashboard entries are stored as saved place clusters. Raw uploads
are temporary input artifacts for internal/demo flows. The canonical product objects are
stop visits, recurring place clusters, and context summaries. Demo identity comes from the
`X-Demo-User-Id` header, or `demo_user` when omitted, and is hashed server-side.

In `tableau_safe` mode, home-like, work-like, health-like, religious-like, and explicitly
suppressed clusters are excluded from the Tableau export by default. Exported coordinates use
`display_latitude` and `display_longitude`; if those are missing, the exporter rounds exact
centroids to a coarse grid.

TODO: add production authentication, encryption at rest, per-user tenant isolation, upload
retention controls, and explicit user-facing consent screens.

## Local Setup

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
cp .env.example .env
```

Run tests:

```bash
make test
```

Run the API with SQLite defaults:

```bash
make run
```

Run with Postgres/PostGIS:

```bash
docker compose up --build
```

Then open `http://127.0.0.1:8000`.

Load a recent window of real Seattle SPD public incident data into the local
Compose database:

```bash
curl --fail --show-error -X POST \
  -H "X-Admin-Token: local-admin-token" \
  "http://127.0.0.1:8000/admin/crime/ingest/socrata?limit=5000&offset=0&start_date=2026-04-01&end_date=2026-06-22"
```

Apply migrations manually:

```bash
make migrate
```

## Public Dashboard Flow

The public dashboard is designed for generalized manual entry. Users can enter approximate
places, paste a place list, run selected-place analysis, compare saved places, and export
reported-incident context. Personal timeline uploads remain an internal/demo capability and
are not part of the public launch flow.

Start the API and create a public dashboard session:

```bash
curl -c demo.cookies -X POST http://127.0.0.1:8000/sessions
```

Check the public-first input modes:

```bash
curl -b demo.cookies http://127.0.0.1:8000/input-modes
```

Enter an approximate place manually:

```bash
curl -b demo.cookies -H "Content-Type: application/json" \
  -d '{"display_label":"Downtown transfer stop","latitude":47.609,"longitude":-122.333,"visit_count":12,"total_dwell_minutes":360}' \
  http://127.0.0.1:8000/places
```

Or paste a place list:

```bash
curl -b demo.cookies -H "Content-Type: application/json" \
  -d '{"csv_text":"display_label,latitude,longitude,visit_count,total_dwell_minutes\nDowntown transfer stop,47.609,-122.333,12,360\nLibrary area,47.621,-122.321,6,420\n"}' \
  http://127.0.0.1:8000/places/bulk
```

Load sample crime data, then analyze selected saved places:

```bash
curl -X POST http://127.0.0.1:8000/crime/ingest/sample
curl -b demo.cookies -H "Content-Type: application/json" \
  -d '{"place_ids":["<place_id>"],"analysis_start_date":"2024-01-01","analysis_end_date":"2024-01-31","radii_m":[250,500]}' \
  http://127.0.0.1:8000/dashboard/analyze
```

Compare two or more saved places:

```bash
curl -b demo.cookies -H "Content-Type: application/json" \
  -d '{"place_ids":["<first_place_id>","<second_place_id>"],"analysis_start_date":"2024-01-01","analysis_end_date":"2024-01-31","radius_m":500}' \
  http://127.0.0.1:8000/dashboard/compare
```

Export Tableau CSV:

```bash
curl -b demo.cookies http://127.0.0.1:8000/exports/tableau/place-summary.csv
```

## Public Input Modes

The public dashboard flow exposes upload-free modes first:

1. **Enter places manually** for approximate places, visit frequency, and optional dwell time.
2. **Paste a place list** for rows with `latitude` and `longitude`, plus optional display
   labels, visit counts, or dwell fields.
3. **Public commute scenario** for neighborhood or transit-oriented scenarios that use
   generalized Seattle area centroids instead of personal location data.

Set `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` in an internal/demo environment to append
**Personal timeline upload** after the public modes.

Mode metadata is available from:

```text
GET /input-modes
```

Dashboard-ready summary data is available from:

```text
GET /dashboard/summary
```

## Public Launch Checklist

- Run `make test` and `make lint`.
- Run `cd frontend && npm test && npm run build`.
- Run `docker build .` in CI or another environment with Docker available.
- Set `MCA_ENVIRONMENT=production`, `MCA_DATABASE_URL`,
  `MCA_USER_HASH_SALT`, `MCA_SESSION_SECRET`,
  `MCA_SESSION_COOKIE_SECURE=true`, and `MCA_ADMIN_INGEST_TOKEN`.
- Run Alembic migrations before serving traffic.
- Ingest recent Seattle SPD data through the admin Socrata endpoint.
- Confirm the public dashboard does not show personal timeline upload as an entry mode.
- Confirm the dashboard copy describes reported incident context, not personal safety.

## Internal Upload Demo Flow

Personal timeline uploads are available for internal demos and parser validation. Enable the
mode metadata with `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` when a demo needs to surface it.

Start the API, then upload the recurring Google fixture:

```bash
curl -F "file=@tests/fixtures/google_recurring.json" \
  -H "X-Demo-User-Id: demo@example.com" \
  http://127.0.0.1:8000/imports
```

Normalize the returned import id:

```bash
curl -X POST -H "X-Demo-User-Id: demo@example.com" \
  http://127.0.0.1:8000/imports/<import_id>/normalize
```

Load sample crime data and summarize:

```bash
curl -X POST http://127.0.0.1:8000/crime/ingest/sample
curl -X POST -H "Content-Type: application/json" \
  -H "X-Demo-User-Id: demo@example.com" \
  -d '{"analysis_start_date":"2024-01-01","analysis_end_date":"2024-01-31","radii_m":[250]}' \
  http://127.0.0.1:8000/crime/summarize
```

Export Tableau CSV:

```bash
curl -H "X-Demo-User-Id: demo@example.com" \
  http://127.0.0.1:8000/internal/exports/tableau/place-summary.csv
```

### Supported Upload Formats

- Google Semantic Location History JSON with `timelineObjects`.
- Google records-style JSON with `locations`, `latitudeE7`, and `longitudeE7`.
- CSV with `timestamp`, `latitude`, `longitude`, and optional `accuracy_m`,
  `activity_type`, and `source`.
- Recurring places CSV:

```csv
display_label,latitude,longitude,visit_count,total_dwell_minutes,median_dwell_minutes,typical_days,typical_hours,sensitivity_class
Downtown transfer stop,47.609,-122.333,12,360,30,weekday,8-9,normal
Library area,47.621,-122.321,6,420,70,weekend,afternoon,normal
```

- Public commute scenario CSV:

```csv
origin_area,destination_area,mode,usual_departure_time,frequency_per_week
Capitol Hill,Downtown Seattle,transit,08:00,4
```

- Minimal GeoJSON Point/LineString support.
- Minimal GPX track point support.

## Tableau Export

The session-scoped recurring-place export is available at:

```text
GET /exports/tableau/place-summary.csv
```

It includes recurring-place fields, generalized coordinates, selected analysis range,
crime grouping fields, incident counts, nearest incident distance, incidents per visit, and
incidents per hour of dwell. Product language should describe rows as:

> Reported SPD incidents within 500m of this recurring location during the selected date range.

## Route Alternatives

Route comparison is available in Stage 1 with the current mock routing provider:

```text
POST /routes/alternatives
GET /routes/requests/{request_id}/comparison
```

`POST /routes/alternatives` accepts generalized Seattle origin and destination labels,
route mode (`transit`, `walk`, `bike`, or `drive`), optional departure details, and optional
`analysis_start_date`, `analysis_end_date`, and `radii_m` values. When analysis dates are
provided, the response and persisted comparison include reported incident context summaries
near route points including segment starts and ends.

Tableau route exports are available at:

```text
GET /exports/tableau/route-alternatives.csv
GET /exports/tableau/route-segments.csv
GET /exports/tableau/route-context.csv
```

`route-segments.csv` includes provider/mock route point labels and coordinates for segment
starts and ends; it does not include raw GPS observations.

OpenTripPlanner is the planned provider for live route alternatives. Until that provider is
implemented, the mock provider supplies deterministic Stage 1 route alternatives for local
development, tests, and Tableau dashboard validation.

Product language for route dashboards should describe these rows as reported route-point
incident context, not as safe or unsafe route claims.

## Statistical Route And Place Comparison

The app compares public place buffers and route corridors using exposure-adjusted reported
SPD incident rates. Statistical comparison dashboards have two modes: `Overview` for the
public summary and `Analytical` for the audit view. `Overview` includes public summary
text, the decision class, exposure-adjusted rates, and a short caveat. `Analytical`
includes counts, exposure, rate ratio, confidence interval, p-values, method,
overdispersion status, minimum-data status, filters, and full caveats.

Endpoints:

```text
POST /analysis/sites/compare
POST /analysis/routes/compare
GET /analysis/comparisons/{comparison_id}
GET /exports/tableau/statistical-comparisons.csv
```

Language constraint: the app may say "lower reported-incident rate" and must not say a
route is safe, unsafe, dangerous, risk-free, or crime-preventing.

## Data Caveats

Seattle SPD open data contains reported incidents. Reported crime data can be incomplete,
delayed, corrected, or geographically generalized. Personal location history can also be
incomplete, inaccurate, or biased by device behavior. This tool provides context summaries,
not safety predictions.

The default Socrata dataset id is `tazs-3rd5`, the City of Seattle's "SPD Crime Data:
2008-Present" dataset.

## References And Licensing

This implementation is original. Related projects were used as architecture references only,
including Google Timeline parsing tools, Reitti, GeoPulse, Dawarich, and Seattle crime data
pipelines. No AGPL/GPL/BSL source code was copied. If future MIT-licensed code is reused,
preserve attribution and license notices.
