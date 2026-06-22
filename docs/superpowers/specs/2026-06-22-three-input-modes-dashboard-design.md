# Three Input Modes Dashboard Design

## Goal

Add three community-friendly input modes that feed the same app-owned dashboard pipeline:
personal timeline upload, generalized recurring places, and public commute scenarios. The
dashboard should not depend on raw GPS history as the only path to value.

## Product Direction

The app will keep the guided upload flow selected during brainstorming:

1. choose an input mode,
2. upload or configure the input,
3. preview detected recurring areas or scenario areas,
4. review privacy-sensitive locations,
5. open the dashboard and export views.

The first build remains backend-first but should expose API contracts that a frontend guided
flow can consume.

## Input Modes

### Mode 1: Personal Timeline Upload

This keeps the existing Google Timeline JSON, raw CSV point, GeoJSON, and GPX upload path.
It produces staging observations and source-derived stops, then runs stop detection and
recurring-place clustering. This mode is the highest-detail option and should carry the
strongest privacy language.

### Mode 2: Generalized Recurring Places CSV

This mode lets privacy-conscious users upload only recurring places or areas they want
analyzed. The CSV uses required columns:

- `display_label`
- `latitude`
- `longitude`

Optional columns:

- `visit_count`
- `total_dwell_minutes`
- `median_dwell_minutes`
- `typical_days`
- `typical_hours`
- `sensitivity_class`

The parser should convert rows into recurring-place clusters directly, with generalized display
coordinates. If dwell and visit counts are absent, the parser should use conservative defaults
that make the area visible but do not imply observed behavior.

### Mode 3: Public Commute Scenario

This mode lets users model commute context without uploading personal movement history. The
initial CSV uses required columns:

- `origin_area`
- `destination_area`
- `mode`

Optional columns:

- `usual_departure_time`
- `frequency_per_week`

For the first build, area names resolve against a small Seattle-area fixture with generalized
centroids. The service should create origin and destination recurring areas with labels such as
`Capitol Hill origin area` and `Downtown Seattle destination area`. Live Census, GTFS, and
Seattle boundary integrations are later follow-ups.

## API Shape

Add `GET /input-modes` to return supported modes, descriptions, privacy levels, required
columns, optional columns, and sample CSV snippets.

Keep `POST /imports` as the upload endpoint. Parser detection should recognize the new
recurring-place and commute-scenario CSV schemas by column names. Import summaries should expose
the detected schema so the future frontend can show mode-specific preview language.

Add `GET /dashboard/summary` to return dashboard-ready data for the current demo user:

- non-sensitive recurring places,
- high-level totals,
- available analysis radii,
- existing crime summary rows,
- privacy status counts,
- export links.

## Data Flow

All three input modes converge into the existing product objects:

- recurring places become `PlaceCluster` rows,
- timeline data can still create `StopVisit` rows before clustering,
- crime summaries continue to use `PlaceCrimeSummary`,
- Tableau export continues to use the same safe place-summary data.

Mode 2 and Mode 3 should avoid creating fake raw GPS observations. They should create
place-cluster objects directly through a service boundary, because their input is already
generalized.

## Privacy And Wording

The dashboard must describe outputs as reported incidents near recurring areas or scenario
areas. It must avoid "safe," "unsafe," "dangerous," or "you were near a crime" language.

Sensitive classes remain excluded from Tableau-safe exports by default. Public commute scenarios
should default to `sensitivity_class=normal` because they are generalized and not personal
claims.

## Testing

Add fixtures and tests for:

- `GET /input-modes`,
- recurring-place CSV parsing,
- public commute scenario parsing,
- direct creation of generalized place clusters,
- dashboard summary response,
- Tableau export compatibility for Mode 2 and Mode 3 data.

No tests should depend on live public-data network calls.

## Follow-Ups

After this build, add a frontend guided upload flow, then replace the public scenario fixture
with maintained Census, GTFS, and Seattle boundary data loaders. Embedded Tableau can consume
the same dashboard/export data once auth and row-level security are designed.
