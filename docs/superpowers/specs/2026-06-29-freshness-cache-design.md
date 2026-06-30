# Freshness Cache — Design (Phase 4, H1 · lean)

> Status: approved via brainstorming 2026-06-29. Branches from `main` (independent of #71/#72).
> Scope is **lean by deliberate decision**: a query-perf audit (this session) found the main
> public incident paths (`_filtered_incidents`, `incidents_in_bbox`, compare/route) already
> bbox + date + category SQL-filtered, and the audit's headline "`_beat_incidents` needs a
> bbox" was a **false positive** (the whole-beat load is the rest-of-beat statistical baseline;
> a bbox would corrupt the rate-ratio). The one genuine full-table-on-every-load path is
> `crime_data_freshness`.

## Objective

Stop `crime_data_freshness` (`app/services/crime_service.py`) from scanning the whole
`crime_incidents` table on **every dashboard load**. The freshness pill (`/dashboard/freshness`,
added in #67) calls it on each load; the query is `count(id)` + `max/min(coalesce(offense_start,
report))` + `max(snapshot_at)` — `count(*)` is O(n), the `coalesce` defeats the
`offense_start_utc` index, and `snapshot_at` is unindexed, so it's effectively a full scan.

## Decision — in-process TTL cache

Memoize the freshness dict in-process for `FRESHNESS_CACHE_TTL_S = 300`. Within the TTL the
endpoint returns the cached dict (O(1), no DB); after it, the next call recomputes and re-caches.

**Why this and not the alternatives:**
- *Ingest-maintained stats row* (a singleton table updated at ingest) would be always-exact and
  O(1), but adds a model + migration + wiring into every ingest path — not lean, and YAGNI for
  the single-host trial. Noted as the scale-up path if the dataset or worker count grows.
- *Index-only* can't help: `count(*)` is O(n) regardless.

**Staleness is acceptable:** the pill exists precisely to signal the data is *not live*, and
backfill runs ~daily, so a ≤5-min lag in the displayed count/date is invisible.

## Implementation (`app/services/crime_service.py` only)

- Module-level cache: `_freshness_cache: dict | None` + `_freshness_expires: float`, and
  `FRESHNESS_CACHE_TTL_S = 300`.
- `crime_data_freshness(session, *, now: Callable[[], float] = time.monotonic) -> dict`: if a
  cached value exists and `now() < _freshness_expires`, return it; otherwise run the existing
  aggregate, store it with `expires = now() + FRESHNESS_CACHE_TTL_S`, and return it. The
  aggregate logic and the returned shape are unchanged.
- `reset_freshness_cache() -> None`: clears the cache (for tests / explicit invalidation).
- Concurrency: a race only causes a redundant recompute — no lock needed.
- The endpoint (`app/api/routes_public_dashboard.py`) and the response shape are untouched.

## Testing (`tests/`)

- **Cache hit:** two `crime_data_freshness` calls within the TTL execute the underlying
  aggregate **once** (assert via a query-counting session / spy, or a SQLAlchemy event counter).
- **Expiry:** with an injected `now` advanced past `FRESHNESS_CACHE_TTL_S`, the next call
  recomputes (query count increments).
- **Value parity:** the cached dict equals a fresh (post-`reset`) computation and has the
  expected keys/values against seeded incidents.
- **Reset:** `reset_freshness_cache()` forces the next call to recompute.
- Tests call `reset_freshness_cache()` in setup/teardown so module state can't leak between tests
  (important: the existing freshness API test must still pass).
- Gate: `make test-all`.

## Non-goals

- Stats-row / ingest watermark (deferred — the scale-up path).
- `_beat_incidents` column-narrowing (marginal; the load is already beat+date bounded).
- Spatial indexing (SQLite R*Tree / PostGIS) — a separate, larger effort.
- Any change to the freshness response shape, the endpoint, or the UI.

## Roadmap tick

Marks **Phase 4 · H1** done (lean), with a one-line note that the audit found the main query
paths already filtered and records spatial-indexing + the stats-row as deferred follow-ups.
(Deferred to integration like H3, to avoid colliding with PR #71's Phase 4 section.)
