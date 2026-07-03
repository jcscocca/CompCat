# Postgres soak testing (H2)

Sustained-load validation of the **real Postgres deploy** on the ThinkPad. CI only ever
exercises SQLite, and `scripts/live_smoke.py` is a single fast pass — neither catches the
failure modes that only show up over hours under concurrency: connection-pool leaks,
sessions stuck idle-in-transaction, latency drift from plan flips or table bloat, lock
contention, and cache pressure. The soak harness drives the deploy hard and watches both the
client-side latency and the server-side Postgres internals.

The harness is two stdlib-only Python processes run side-by-side on the deploy host:

- **`scripts/soak/soak_driver.py`** — N threaded virtual users hammering the public
  dashboard endpoints; streams per-request latency to CSV and prints rolling p50/p95/p99.
- **`scripts/soak/pg_observer.py`** — samples `pg_stat_activity` / `pg_stat_database` /
  `pg_locks` every interval and diffs `pg_stat_statements` over the run, by shelling
  `docker compose exec db psql --csv` (no psycopg needed on the host).

## Prerequisites

1. **Deploy up** — bring the stack up on the ThinkPad the usual way:
   `pwsh -File scripts\start-waypoint.ps1`. This starts Postgres, the api (migrations run on
   boot), and llama-swap.
2. **Data ingested** — crime / calls / arrests data must already be loaded, or the dashboard
   queries return empty and the soak proves nothing. See `docs/DEPLOY.md`.
3. **Enable `pg_stat_statements` (one-time)** — the `db` service in `docker-compose.yml` sets
   `shared_preload_libraries=pg_stat_statements`, but a preload library only takes effect on
   server start. After pulling this change, recreate the db container once:

   ```
   docker compose --env-file .env.deploy up -d --force-recreate db
   ```

   The observer creates the extension itself (`CREATE EXTENSION IF NOT EXISTS
   pg_stat_statements`) and resets its counters at the start of each run.
4. **Python 3 on the host** — the scripts are stdlib-only. No pip installs.
5. **Run from the repo root** — the observer's default `psql` command is
   `docker compose --env-file .env.deploy exec -T db psql`, which resolves the compose
   project relative to the current directory.

## First run — start here

Two terminals, both at the repo root. Start the observer first so it captures the ramp-up:

```
# terminal 1 — Postgres observer
make soak-observe OUT=soak-out DURATION=2h

# terminal 2 — load driver
make soak-load USERS=25 DURATION=2h OUT=soak-out
```

Start at **25 virtual users for 2 hours** with a 15s observer interval. If that run is clean
against every pass criterion below, raise `USERS` on the next run (50, then 100) to find where
latency or the connection pool starts to bend. Both processes stop on their own at
`DURATION`; the driver also writes a partial summary if you Ctrl-C early.

Direct invocation (equivalent, if you want more knobs):

```
python scripts/soak/pg_observer.py --interval 15 --duration 2h --out soak-out
python scripts/soak/soak_driver.py --users 25 --ramp 60 --think-time 0.2 --duration 2h --out soak-out
```

## Windows / ThinkPad host

The deploy host is Windows (PowerShell). The `make` targets and the `.venv/bin/python` paths
above are Unix — they do not apply here. The soak scripts are **stdlib-only**, so run them with
any host `python` 3.x (no venv, no `pip install`) from the repo root — the app itself still runs
in Docker; only these two scripts run on the host:

```powershell
# terminal 1 — Postgres observer
python scripts\soak\pg_observer.py --interval 15 --duration 2h --out soak-out
# terminal 2 — load driver
python scripts\soak\soak_driver.py --users 25 --ramp 60 --duration 2h --out soak-out
```

Windows-specific prep, in order:

1. **Update the checkout** so `scripts\soak\` and the `pg_stat_statements` compose change are
   present: `pwsh -File scripts\start-waypoint.ps1 -Update` (then `git log --oneline -1` should
   show the soak-harness commit or later).
2. **Enable `pg_stat_statements`** (a preload lib — needs a db restart; `-Update` may already
   have recreated the db, so verify and only recreate if needed):
   ```powershell
   docker compose --env-file .env.deploy up -d --force-recreate db
   docker compose --env-file .env.deploy exec -T db psql -U mca -d mca -c "select 1 from pg_stat_statements limit 1"
   ```
   The observer exits fast with instructions if this isn't ready, so it won't burn a long run.
3. **Confirm a host Python 3** is on `PATH`: `python --version`.
4. **Keep the machine awake for the whole run** — a suspend/sleep mid-run kills both processes:
   `powercfg /change standby-timeout-ac 0` (and the monitor/disk timeouts if it's on battery),
   or use a keep-awake utility. Restore your settings afterward.

**Smoke first.** Before the 2h run, do a 3-minute dry run with the exact command and
`--duration 3m --out soak-smoke`, then check `soak-smoke\summary.json` shows errors ≈ 0 and
`soak-smoke\pg_summary.json` has `top_statements` populated. If both look right, launch the 2h
run; if not, you've spent 3 minutes instead of 120.

## Outputs

All under `--out` (default `soak-out/`):

| File | From | Contents |
|---|---|---|
| `requests.csv` | driver | one row per request: `ts, vu, endpoint, status, latency_ms, ok` |
| `summary.json` | driver | per-endpoint + overall p50/p95/p99, latency drift, budget breaches |
| `pg_stats.csv` | observer | one row per interval: connections, per-interval cache hit ratio, locks, run-delta deadlocks/temp_bytes |
| `pg_summary.json` | observer | top statements by mean time + hot-table size deltas |

Correlate the two CSVs by the `ts` (unix-seconds) column. The `pg_stats.csv` counter columns
are scoped to the run: `deadlocks_run` and `temp_bytes_run` are deltas since the observer
started (not lifetime totals), and `cache_hit_ratio` is computed over each interval — so all
three reflect the soak itself, not pre-soak history.

## What to watch

| Signal (source) | Healthy | Trouble → what it means |
|---|---|---|
| active/idle connections (`pg_stats.csv`) | plateaus below the SQLAlchemy pool size | steadily climbing → **connection-pool leak** |
| `idle_in_txn` (`pg_stats.csv`) | ~0 | sustained > 0 → a session opened a transaction and never committed (**bug**) |
| latency drift (`summary.json` `drift`) | < ~1.3× | last-window vs first-window p95 rising → plan flip, table bloat, or cache pressure (windows = first/last hour on a ≥2h run, else each half) |
| `locks_not_granted` (`pg_stats.csv`) | 0 | > 0 sustained → **lock contention** (unexpected for a read-mostly workload) |
| `cache_hit_ratio` (`pg_stats.csv`) | ≈ ≥ 0.99, steady | falling over the run → working set outgrowing `shared_buffers` |
| `temp_bytes_run` (`pg_stats.csv`) | 0 / flat | climbing → queries spilling to disk during the run (missing index / bad plan on the beat load) |
| `deadlocks_run` (`pg_stats.csv`) | 0 | > 0 → a deadlock occurred **during the soak** (**bug**) |
| top statements (`pg_summary.json`) | stable | a query whose mean time is unexpectedly high / a new expensive query |
| hot-table size delta (`pg_summary.json`) | ~0 on read-only tables | unexpected growth |
| error rate (`summary.json`) | ≈ 0 (bar intentional 4xx) | rising 5xx → the app or DB is shedding load (per-request status is in `requests.csv`) |

## Pass criteria (H2)

A run **passes** when, for the full target duration at the target concurrency:

- the stack survives without crashing and error-rate stays ≈ 0 (excluding intentional 4xx);
- connections plateau below the pool size — no creep — and `idle_in_txn` stays ~0;
- per-endpoint p95 stays within budget and latency **drift** stays under ~1.3× (drift is most
  reliable on a ≥2h run, where the compared windows are the first vs last hour);
- `deadlocks_run` stays 0 and there are no sustained not-granted locks.

Record which `USERS` level the run passed at; that's the validated sustained concurrency for
the current ThinkPad deploy.
