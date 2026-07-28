# Public instance, slice 3 — freshness automation — design

**Date:** 2026-07-27 · **Status:** approved design, pre-plan.
**Scope:** the ingest scheduler and the staleness probe — the two pieces that keep an
always-on instance honest without an operator. Backend + compose; no frontend work. Parent:
`2026-07-27-public-instance-design.md`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scheduler shape | **Compose sidecar under an `ops` profile** running cron, POSTing the existing `POST /admin/crime/ingest/socrata` per layer daily | Keeps automation inside the compose stack (portable, env-scoped secrets, `docker logs` observability); no host crontab to document per-provider, no new backend dependency |
| Schedule | Daily 03:10 America/Los_Angeles, layers sequential (reported → arrests → calls) | SPD datasets update daily; low-traffic hour local to the data; sequential avoids overlapping Socrata paging loops |
| Ingest mechanics | Unchanged — the endpoint's existing watermark + paging + retry/backoff does incremental work; the sidecar only triggers it | The hard part already shipped (#37); don't rebuild it |
| Staleness probe | **`GET /health/data`** (schema-hidden): 200 when every layer's `data_through` lags ≤ `MCA_DATA_STALENESS_DAYS` (default 7), else 503 with per-layer lag payload | An external uptime monitor can watch one URL and catch a dead cron, a broken token, or an upstream Socrata failure — the three ways freshness silently dies |
| Liveness vs staleness | Container healthcheck **stays on `/health`**; `/health/data` is monitoring-only | Stale data must alert, not restart-loop the app container |
| Refresh-on-start | The slice-4 bring-up script keeps the demo's "ingest if stale" step | A rebooted box self-heals before the next cron tick |

## Components

### 1. Ingest sidecar (`docker-compose.prod.yml`, `ops/` profile)

A minimal cron container (image choice to the plan; smallest maintained option that can POST
with headers) mounting a crontab that calls the admin ingest endpoint on the compose network
(`app:8000`) with `X-Admin-Token` from `MCA_ADMIN_INGEST_TOKEN` env — the token never
appears in the crontab file. One invocation per layer, sequential, `-sS --fail` so failures
land in the container log with cause. Runs under the `ops` profile so dev/demo composes are
unaffected.

### 2. Staleness probe (`app/api/routes_health.py` or beside the existing `/health`)

`GET /health/data`, `include_in_schema=False`, no session required (it exposes only
layer→`data_through`/lag-days, already public via `/dashboard/freshness`): reads the
TTL-cached freshness the dashboard already uses (no new full-table scans), compares each
enabled layer's `data_through` against `MCA_DATA_STALENESS_DAYS`. The calls layer's rolling
24-month floor does not affect `data_through` recency — same threshold applies. Response
`{status, stale: [{layer, data_through, lag_days}]}` with 200/503.

## Error handling

- Ingest failure (Socrata down, bad token): non-2xx logged by the sidecar; data ages until
  the next tick; `/health/data` flips to 503 once the threshold passes — that is the alert
  path, deliberately not a retry storm (the endpoint has internal retry/backoff already).
- Probe conservatism: if freshness can't be read at all, `/health/data` returns 503 —
  unknown counts as stale.
- Burst-limiter interaction: `/health/data` joins `/health` on the limiter's exempt list so
  monitoring can poll each minute.

## Testing

- Probe unit tests: fresh (200), one layer stale (503 + payload names it), all stale,
  freshness unreadable (503), threshold boundary at exactly N days, env override.
- Schema test: `/health/data` absent from OpenAPI (extends `test_internal_surface.py`'s
  pattern).
- Sidecar: crontab rendered by `docker compose config` in the docker CI lane; live firing is
  a slice-4 bring-up verification step (like the soak harness, not in CI).
- `make test-all` green.

## Invariant checkpoint

No user-facing copy. The probe payload speaks only of data recency.

## Non-goals

- In-app staleness banners beyond the existing freshness pill (it already shows the date).
- Alerting integrations (email/pager) — the external monitor watching `/health/data` is the
  whole story; choosing/configuring one is a slice-4 runbook step.
- Backfill-window changes, new datasets, ingest-stats rows (still deferred from H1).

## Slice completion criteria

1. With the `ops` profile up locally, forcing the cron (short test schedule) ingests all
   three layers against a test Socrata fixture or live dev DB, visible in `docker logs`.
2. `/health/data` returns 200 on fresh dev data and 503 when `MCA_DATA_STALENESS_DAYS=0`
   forces staleness; absent from OpenAPI.
3. Dev and demo compose behavior unchanged (`docker compose config` diff shows the sidecar
   only under the prod overlay's `ops` profile).
4. `make test-all` green.
