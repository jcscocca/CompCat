# Deploying CompCat for a small internal trial (~5 testers)

This runs the whole app — FastAPI API **and** the built React UI — in one container,
with Postgres alongside, via `docker compose`. Each tester's browser gets its own
isolated session (signed cookie → per-user data); the UI only calls session-scoped
endpoints, so testers can't see each other's places.

## Single host: everything on the ThinkPad

This trial runs **entirely on the ThinkPad** — no second machine:

- **CompCat** (API + UI + Postgres) — this `docker compose` stack, on `:8000`.
- **Analyst LLM** (llama-swap, OpenAI-compatible) — already serving on the ThinkPad at `:8080`.

Because CompCat runs in a container, it reaches the host-port LLM service via
`host.docker.internal`. Put this wiring in `.env.deploy` (alongside the secrets from the next
section):

```
MCA_LLM_BASE_URL=http://host.docker.internal:8080/v1
MCA_LLM_MODEL=gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k
```

Bring-up order on the ThinkPad (PowerShell). The analyst (llama-swap) is already running, so
there is nothing to start there:

```powershell
cp .env.deploy.example .env.deploy        # fill in secrets (next section) + the wiring above
docker compose --env-file .env.deploy up -d --build   # CompCat on :8000
# then load crime data (step 3 below) and open http://localhost:8000
```

If `host.docker.internal` ever fails to resolve, substitute the ThinkPad's LAN IP
(e.g. `http://<llm-host-lan-ip>:8080/...`). Detailed steps for each piece (secrets, crime data,
analyst) follow.

## 1. Generate secrets

The committed `docker-compose.yml` ships with `local-*` placeholder secrets that are
public in the repo. A shared instance **must** override them, or session cookies are
forgeable. `MCA_ENVIRONMENT=production` makes the app refuse to boot on the defaults,
so this is enforced, not just advised.

```bash
cp .env.deploy.example .env.deploy
# fill in MCA_SESSION_SECRET / MCA_USER_HASH_SALT with `openssl rand -hex 32`
# and MCA_ADMIN_INGEST_TOKEN with `openssl rand -hex 24`
```

`.env.deploy` is gitignored — keep it off the repo.

## 2. Bring it up

```bash
docker compose --env-file .env.deploy up -d --build
```

- API + UI on **http://<host>:8000** (the UI is served at `/`).
- `alembic upgrade head` runs on start (creates the schema, incl. `analysis_runs`).
- Postgres data persists in the `mca-postgres` Docker volume across restarts.

## 3. Load 2018+ crime data

**Quick demo seed (optional, no network).** To get a fresh deploy rendering immediately
with bundled synthetic incidents (≈400 rows across several beats, 2018–2025):

```bash
docker compose exec api python scripts/seed_crime.py    # or, for local dev: make seed-crime
```

This is demo data, not real SPD data; it's idempotent (re-running skips existing rows).
For real data, run the Socrata ingest below.

Beat-area reference data ships inside the image; crime incidents are ingested at
runtime from Seattle's open data. Pull ~2018-onward incidents (newest first) — adjust
the page count for how much you want (each page ≈ 5,000 incidents):

```bash
TOKEN=$(grep '^MCA_ADMIN_INGEST_TOKEN=' .env.deploy | cut -d= -f2)
for offset in 0 5000 10000 15000 20000 25000; do
  curl -fsS -X POST -H "X-Admin-Token: $TOKEN" \
    "http://localhost:8000/admin/crime/ingest/socrata?start_date=2018-01-01&limit=5000&offset=$offset" \
    && echo " ingested offset $offset"
  sleep 1
done
```

> If the ingest fails with a TLS/certificate error, the slim image is missing CA roots —
> add `RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates`
> to the `python:3.11-slim` stage of the `Dockerfile` and rebuild.

**SPD Arrest Data (optional).** Arrests load separately via `make ingest-arrests` (or
`POST /admin/crime/ingest/socrata?source=seattle_spd_arrests&mode=backfill` with the
`X-Admin-Token` header). They are stored but not yet surfaced in the UI, and the dashboard
"Data through" freshness pill remains scoped to SPD reported incidents only.

## 4. Share with testers

Give the five testers `http://<host>:8000`. Nothing else to set up per user — a session
is created automatically on first load.

## Basemap tiles (self-hosted)

The map renders from a self-hosted Seattle vector-tile extract so no third-party tile
server ever sees where users look. `scripts/start-compcat.ps1` fetches it automatically
on first run; to fetch or refresh manually:

    python scripts/fetch_tiles.py            # or: make fetch-tiles (Mac/dev)
    python scripts/fetch_tiles.py --force    # refresh to the latest Protomaps build

Artifacts (all gitignored): `app/data/tiles/seattle.pmtiles` (~100 MB, volume-mounted
into the api container read-only) and `frontend/public/basemaps-assets/` (fonts/sprites,
baked into the frontend build). If the file is missing the app still runs — the map shows
a flat background with a "run make fetch-tiles" notice.

Notes:
- Point `MCA_TILES_DIR` (default `app/data/tiles`) at a dedicated directory only — the
  whole directory is served at `/tiles/`.
- If the fetch fails with `CERTIFICATE_VERIFY_FAILED`, the invoking Python has no usable
  CA bundle. On the Mac/dev side, run it through the project venv (`make fetch-tiles` uses
  `.venv/bin/python`, where certifi is available) with
  `SSL_CERT_FILE="$(.venv/bin/python -c 'import certifi; print(certifi.where())')"`. On the
  Windows deploy host, `pip install certifi` for the system Python and set
  `$env:SSL_CERT_FILE = python -c "import certifi; print(certifi.where())"` in PowerShell
  before running the script — or fix the system certificate store.
- The `.pmtiles` file is served with ETag/Last-Modified but no `Cache-Control`; if a
  reverse proxy is ever added, long-lived caching for `/tiles/` is a cheap win.

## Notes / hardening

- **HTTPS:** for an internal HTTP trial, `MCA_SESSION_COOKIE_SECURE=false` is fine
  (set in `.env.deploy`). If you put it behind a TLS proxy (recommended), set it to
  `true` so cookies are only sent over HTTPS.
- **Postgres:** `docker-compose.yml` publishes `5432` and uses the `mca/mca` dev
  password — fine on a trusted internal host. If the instance is internet-reachable,
  drop the `db` `ports:` mapping (the API reaches Postgres over the compose network)
  and set a real DB password.
- **Internal API surface:** the `/internal/*` endpoints (analysis, imports, crime
  ingest/summary) are hidden from OpenAPI and accept the **demo-identity
  fallback** instead of requiring a real session; the UI never calls them, and
  `tests/test_internal_surface.py` keeps them off the bare public paths. Not a
  tester-to-tester leak, but lock them down before any internet exposure. The public
  endpoints the UI uses (`/places`, `/dashboard/*`, `/uploads`, `/exports/*`)
  all require a real session.
- **Schema is Alembic-owned in production.** The container runs `alembic upgrade head`
  on start (the Docker `CMD`); the app no longer also runs `create_all` against Postgres
  (it only does so for local SQLite dev). If you have a pre-existing Postgres deploy whose
  schema was created by the old `create_all` path, run a one-time
  `docker compose exec api alembic stamp head` so Alembic knows the current revision before
  the next `alembic upgrade head`.

### Personal location-history uploads

The `/uploads` surface (import a Google Timeline / CSV / GeoJSON / GPX location history into
saved places) is gated by `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS`. It is **enabled** in
`.env.deploy.example` for this single-host trial; the endpoints 404 and the upload UI is
hidden when it is false.

- **What's stored:** raw points are discarded after clustering (`MCA_RAW_UPLOAD_RETENTION`
  stays `false`) — only the derived place clusters are kept. Users can delete their uploaded
  data from the UI.
- **Keep it OFF for any shared/multi-user or public deployment.** An upload is real personal
  data tied to a session; the **Roadmap (not yet implemented)** items above —
  production authentication, encryption at rest, and per-user tenant isolation — are genuine
  prerequisites before exposing this beyond a single trusted host.

### Assistant

The AI panel (chat assistant) calls an **OpenAI-compatible** model gateway (e.g. a
[llama-swap](https://github.com/mostlygeek/llama-swap) server) directly via
`POST /v1/chat/completions`. The old LocalAgent `/api/llm/stream` gateway is no longer
used.

Set two variables in `.env.deploy`:

```
MCA_LLM_BASE_URL=http://<llm-host-lan-ip>:8080/v1   # reachable from container (LAN IP or host.docker.internal:PORT)
MCA_LLM_MODEL=gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k
```

`127.0.0.1` will not work from inside the container — use a LAN IP or
`host.docker.internal:PORT` (the `extra_hosts` mapping in `docker-compose.yml` makes
`host.docker.internal` resolve to the Docker host's gateway).

**Optional automatic failover.** Set a second endpoint and the assistant tries the
primary first, then fails over to the fallback when the primary is offline or returns
no usable content. This needs a **second always-on host**, so skip it for the
single-ThinkPad setup. Failover activates only when **both** fallback values are set:

```
MCA_LLM_FALLBACK_BASE_URL=http://<second-host>:8080/v1
MCA_LLM_FALLBACK_MODEL=qwen3.6-27b-q4-k-m-ctx32k
```

For llama.cpp "thinking" models (e.g. Qwen) that otherwise spend the whole token
budget on `reasoning_content` and return empty content, disable the chain-of-thought
so the answer lands in `content`. The flags are per-endpoint:

```
MCA_LLM_DISABLE_THINKING=false            # primary (gemma needs no thinking control)
MCA_LLM_FALLBACK_DISABLE_THINKING=true    # fallback Qwen: emit content, not reasoning
```

If the endpoint or model is unreachable the assistant returns an error message, but
every other part of the app — maps, analysis, neighborhood, compare, exports — is
completely unaffected.

## Stop / reset

```bash
docker compose down            # stop; keeps the Postgres volume (data survives)
docker compose down -v         # stop AND wipe the database volume
```

## Backup / restore

The database lives in the named volume `mca-postgres`. Back it up with a logical dump
(safe while the stack is running):

```bash
# Backup -> a timestamped SQL file on the host
docker compose exec -T db pg_dump -U mca -d mca > "compcat-$(date +%Y%m%d).sql"

# Restore into a fresh/empty database (wipe first if needed: docker compose down -v && docker compose up -d db)
cat compcat-YYYYMMDD.sql | docker compose exec -T db psql -U mca -d mca
```

For a binary, parallel-restorable dump use custom format instead:

```bash
docker compose exec -T db pg_dump -U mca -d mca -Fc > compcat.dump
docker compose exec -T db pg_restore -U mca -d mca --clean --if-exists < compcat.dump
```

Keep dumps off-host. A daily `pg_dump` via cron/systemd-timer on the ThinkPad is enough
for the trial; restore is the two commands above against a fresh volume.
