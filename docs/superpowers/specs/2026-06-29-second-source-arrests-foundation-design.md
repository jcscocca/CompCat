# Second Data Source — Arrests Foundation — Design (Phase 4, C4 · increment 1)

> Status: approved via brainstorming 2026-06-29. Branches from `main` (`e43cf0f`, post-C2).
> **Backend foundation only — no UI.** Makes the crime layer source-aware and ingests SPD
> Arrest Data behind a **reports-only default**, so nothing changes for users and the
> silent-blend landmine is closed. The first *visible* arrest surface (and its
> enforcement-framing copy) is a later increment.

## Objective

Today the crime layer assumes a single homogeneous dataset: `crime_incidents` carries a
`source_dataset` discriminator ([`app/models.py:146`](../../../app/models.py)), but the ingest
never sets it explicitly and **none of the incident-query call sites filter on it**. Dropping a
second dataset's rows into the table as-is would *silently* sum SPD reports + the new source into
every count, rate, temporal profile, and category breakdown — both statistically wrong and an
invariant violation (an arrest is an enforcement action, not a confirmed incident).

This increment makes the layer source-aware and ingests **SPD Arrest Data** (Socrata `9bjs-7a7w`,
~138k one-row-per-arrest records) tagged `source_dataset="seattle_spd_arrests"`, with **every
existing analysis defaulting to reports-only** (zero behavior change). Arrests are stored but
unreachable by any default path until a surfacing increment exists.

## The dataset (`9bjs-7a7w`)

One row per arrest *report*. Fields we use map almost 1:1 onto `CrimeIncident`:

| Arrest column | → `CrimeIncident` | Note |
|---|---|---|
| `arrest_number` | `external_incident_id` | natural key; cannot collide with offense IDs → see dedup |
| `arrest_occurred_date_time` | `offense_start_utc` | naive Seattle-local, like existing rows |
| `arrest_reported_date_time` | `report_utc` | |
| `nibrs_description` | `offense_subcategory` | best-effort; **source-specific semantics** (see below) |
| `beat`/`sector`/`precinct`/`neighborhood` | `beat`/`sector`/`precinct`/`mcpp` | |
| `block_address`, `latitude`, `longitude` | same | coords are block-centroid / sometimes station-snapped → coarser than reports |
| `report_number` | `report_number` | numeric in source; stored as text |

**Dropped by construction:** `CrimeIncidentData` ([`app/schemas.py:122`](../../../app/schemas.py))
has no demographic or officer fields, so the mapper simply never reads `subject_race/gender/age_range`,
`officer_race/gender/age/id`, `arrest_type`, SMC `offense_type`, `cad_*`, `crisis_involved`,
`force_involved`, `complaint_involved`, `terry_stop`, `demonstration`, `reporting_area`,
`census_block_2020`. Nothing demographic is stored. A test documents this intent.

## Approved decisions

| Decision | Choice |
|---|---|
| Storage | **Shared `crime_incidents` table + `source_dataset` discriminator** (the column already exists); no new table |
| Default behavior | **Reports-only** — existing analyses unchanged; arrests opt-in via an explicit source argument that no public caller passes yet |
| Source threading | **Single `source_dataset` filter** threaded through the query layer (default = reports); widening to a multi-source set deferred (YAGNI for a separate lens) |
| Dedup uniqueness | **Composite `(source_dataset, external_incident_id)`** (was global on `external_incident_id`) |
| Arrest taxonomy | Best-effort: `offense_subcategory ← nibrs_description`; `offense_category`/`nibrs_group` left null. Crosswalk to a unified taxonomy deferred to the surfacing increment |
| Demographics | **Not ingested** (dropped by schema construction) |
| Surface | **None** — backend only |

## Design

### 1 · Source registry + constants (new `app/crime/sources.py`)

```
SOURCE_SPD_CRIME   = "seattle_spd_crime"
SOURCE_SPD_ARRESTS = "seattle_spd_arrests"
```

A small registry maps a source key → (Socrata dataset id, row→`CrimeIncidentData` mapper). The
crime dataset id stays in config ([`app/config.py:31`](../../../app/config.py)); add
`socrata_arrests_dataset_id: str = "9bjs-7a7w"` alongside it. The registry is the single place
that knows "which dataset, which mapper, which tag."

### 2 · Arrest mapper (`app/crime/seattle_socrata.py`)

`arrest_from_mapping(row: dict) -> CrimeIncidentData`, mirroring the existing
`crime_incident_from_mapping` (lines 62–109) but for the arrest field names, setting
`source_dataset=SOURCE_SPD_ARRESTS`. `offense_category`/`nibrs_group`/`offense_end_utc`/`offense_id`
are `None`. Reuses the existing `_first` / `_float_or_none` / `parse_datetime` helpers.

> **Per-source column semantics (documented):** for arrests, `offense_subcategory` holds
> `nibrs_description` rather than the SPD report taxonomy. This is safe because (a) reports-only
> default means no arrest row is queried by category in this increment, and (b) we never filter
> across sources (arrests are a separate lens). The surfacing increment formalizes the crosswalk.

### 3 · Dedup + uniqueness (`app/models.py`, migration, `crime_ingestion_service.py`)

- Model: drop `unique=True` from `external_incident_id`; add
  `UniqueConstraint("source_dataset", "external_incident_id")` via `__table_args__`. SQLite
  dev/test picks this up through `create_all`.
- Migration (new alembic revision, Postgres): drop the old single-column unique, add the composite
  unique, add an index on `source_dataset`. Existing rows already carry `"seattle_spd_crime"` (the
  non-null column default), so no data backfill is required — assert it defensively in the migration
  notes.
- `ingest_crime_incidents` ([`crime_ingestion_service.py:12`](../../../app/services/crime_ingestion_service.py)):
  the existence check and the in-run `seen` set become keyed by **(source_dataset, external_incident_id)**;
  the composite unique is the IntegrityError safety net. Incidents already carry `source_dataset`
  from the mapper, so the function reads it off each record — no new parameter needed.

### 4 · Source-aware query layer (default = reports)

Add `source_dataset: str = SOURCE_SPD_CRIME` and a `.where(CrimeIncident.source_dataset == source_dataset)`
clause to each incident-query call site:

1. `incidents_in_bbox` — [`incident_query_service.py:43`](../../../app/services/incident_query_service.py)
2. `_filtered_incidents` — [`dashboard_analysis_service.py:177`](../../../app/services/dashboard_analysis_service.py) (powers analyze / incidents / compare / neighborhood)
3. `_beat_incidents` — [`neighborhood_service.py:80`](../../../app/services/neighborhood_service.py)
4. `_incidents_near_clusters` — [`crime_service.py:110`](../../../app/services/crime_service.py)
5. `latest_observed_date` (watermark) — [`backfill.py:26`](../../../app/crime/backfill.py)
6. `_compute_freshness` — [`crime_service.py:52`](../../../app/services/crime_service.py)

No public caller passes the argument, so the default makes this a behavior-preserving change. The
surfacing increment passes `SOURCE_SPD_ARRESTS` to reach arrests.

### 5 · Freshness, per-source (`crime_service.py`)

`crime_data_freshness(session, *, source_dataset=SOURCE_SPD_CRIME)` scopes `_compute_freshness` to
the source. The in-process cache (`_freshness_cache`/`_freshness_expires`, TTL `FRESHNESS_CACHE_TTL_S`)
becomes **keyed by source_dataset** (a dict). The `/dashboard/freshness` endpoint
([`routes_public_dashboard.py:138`](../../../app/api/routes_public_dashboard.py)) keeps calling with
the default, so the topbar "Data through &lt;date&gt;" pill stays **reports-scoped** — critical, since
once arrests are ingested an unscoped aggregate would otherwise blend their dates and counts.

### 6 · API (additive)

Add `source_dataset` to the `/dashboard/incidents` detail rows
(`incident_details_for_places` in `dashboard_analysis_service.py` + its response schema). Harmless
now (every row is reports), forward-compatible for the surfacing increment. The user-summary
builders in `crime_service.py` already carry `source_dataset` ([:215](../../../app/services/crime_service.py), [:288](../../../app/services/crime_service.py)).

### 7 · Ingest wiring + seed

- `/admin/crime/ingest/socrata` ([`routes_admin_crime.py:29`](../../../app/api/routes_admin_crime.py))
  gains a `source: str = SOURCE_SPD_CRIME` query param (validated against the registry keys);
  resolves dataset id + mapper from the registry. Default = crime → backward-compatible.
- `backfill_socrata` / `latest_observed_date` thread the source so the arrest backfill cursor is
  source-scoped (not polluted by report dates).
- Seed: `app/data/seed_arrests.csv` (a small synthetic fixture), `scripts/seed_arrests.py`, and a
  `make seed-arrests` target mirroring `seed-crime`. A `load_arrest_csv` (or generalized CSV loader
  taking the arrest mapper) parallels `load_crime_csv`.
- Pulling the ~138k live arrest rows into a real deployment is a **separate admin/ops action** (the
  parameterized admin route or a `make ingest-arrests`), not part of this PR.

## Invariant (must hold)

Arrests are stored but **unreachable by any default analysis** — no count, rate, temporal, or
category number changes; nothing ranks, scores, or merges sources. The freshness pill stays
reports-scoped. Because no arrest data reaches a user surface in this increment, the product
invariant (no safety scoring / ranking) is untouched; enforcement-framing copy lands with the first
visible surface (later increment). **The existing test suite staying green is the proof of zero
behavior change.**

## Error / edge cases

- Same `arrest_number` value as some report's `external_incident_id` → both rows coexist (composite
  unique); neither dedups the other.
- Duplicate `arrest_number` within an arrest ingest run → skipped (in-run set + DB check + unique).
- Arrest row missing lat/long → stored, but excluded from radius queries (they already require
  non-null coords); still counted in beat/freshness queries for its source.
- Freshness requested for a source with zero rows → `incident_count: 0`, null dates (existing
  `_compute_freshness` shape).
- Arrest `nibrs_description` absent → `offense_subcategory` null.

## Testing

**Backend**
- `arrest_from_mapping`: arrest_number→external_incident_id; occurred/reported datetimes;
  beat/sector/precinct/neighborhood→mcpp; lat/long; `offense_subcategory == nibrs_description`;
  `offense_category`/`nibrs_group` None; `source_dataset == "seattle_spd_arrests"`; a row carrying
  demographic/officer columns yields a record with none of that data (intent guard).
- Dedup/composite-unique: same external id under both sources both insert; duplicate within a source
  skipped; IntegrityError path covered.
- Source-aware queries: with both sources seeded, the default excludes arrests across
  `incidents_in_bbox`, `_filtered_incidents`, `_beat_incidents`, `_incidents_near_clusters`; passing
  `SOURCE_SPD_ARRESTS` returns only arrests.
- Freshness-by-source: with arrests dated later than reports, default freshness reflects reports
  only (data_through + count); arrests source reflects arrests; cache keyed per source (no
  cross-source bleed).
- Watermark: `latest_observed_date` is source-scoped both ways.
- API: `/dashboard/incidents` detail rows include `source_dataset` (= reports tag).
- Admin route: `source` param selects dataset + mapper; unknown source rejected; default unchanged.
- Regression: the full existing suite stays green.

**Gate:** `make test-all` (pytest + ruff + frontend `npm test` + `npm run build`); `make migrate`
clean to head.

## Non-goals (→ later C4 increments)

- Any UI / Analyze-tab surfacing of arrests and its enforcement-framing copy.
- Taxonomy crosswalk to a unified category set; arrest category-breakdown / temporal; per-source
  significance testing.
- Cross-source comparison or "both sources at once" multi-source queries.
- Arrest-native columns (`arrest_type`, SMC `offense_type`); the demographic / enforcement-equity
  angle (explicitly not pursued in Waypoint).
- A real spatial index / perf tuning for arrest-scoped queries (revisit if a surfacing increment's
  query patterns need composite indexes).
- Loading live arrest data into a deployment (a separate ops action).

## Roadmap tick

This is **increment 1 of a multi-increment C4** and does **not** complete it. Update the
`Phase 4 · C4` line with a foundation sub-note (source-aware backend + arrest ingest, no UI, shipped
in this PR) and leave the box **unchecked**; the full `C4 → [x]` tick waits for the surfacing
increment(s).
