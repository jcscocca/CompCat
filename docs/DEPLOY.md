# Deploying Waypoint for a small internal trial (~5 testers)

This runs the whole app — FastAPI API **and** the built React UI — in one container,
with Postgres alongside, via `docker compose`. Each tester's browser gets its own
isolated session (signed cookie → per-user data); the UI only calls session-scoped
endpoints, so testers can't see each other's places.

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

## 4. Share with testers

Give the five testers `http://<host>:8000`. Nothing else to set up per user — a session
is created automatically on first load.

## Notes / hardening

- **HTTPS:** for an internal HTTP trial, `MCA_SESSION_COOKIE_SECURE=false` is fine
  (set in `.env.deploy`). If you put it behind a TLS proxy (recommended), set it to
  `true` so cookies are only sent over HTTPS.
- **Postgres:** `docker-compose.yml` publishes `5432` and uses the `mca/mca` dev
  password — fine on a trusted internal host. If the instance is internet-reachable,
  drop the `db` `ports:` mapping (the API reaches Postgres over the compose network)
  and set a real DB password.
- **Open API surface:** a few non-`/internal/` endpoints (`/imports*`, `/analysis*`,
  `/routes*`, one `/crime`) still accept an unauthenticated demo identity. The UI never
  calls them, so this is not a tester-to-tester leak, but lock them down (roadmap WS5)
  before any public exposure.

### Assistant

The AI panel (chat assistant) calls an **OpenAI-compatible** model gateway (e.g. a
[llama-swap](https://github.com/mostlygeek/llama-swap) server) directly via
`POST /v1/chat/completions`. The old LocalAgent `/api/llm/stream` gateway is no longer
used.

Set two variables in `.env.deploy`:

```
MCA_LLM_BASE_URL=http://10.0.0.76:8080/v1   # reachable from container (LAN IP or host.docker.internal:PORT)
MCA_LLM_MODEL=gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k
```

`127.0.0.1` will not work from inside the container — use a LAN IP or
`host.docker.internal:PORT` (the `extra_hosts` mapping in `docker-compose.yml` makes
`host.docker.internal` resolve to the Docker host's gateway).

**Optional automatic failover.** Set a second endpoint and the assistant tries the
primary first, then fails over to the fallback when the primary is offline or returns
no usable content. Failover activates only when **both** fallback values are set:

```
MCA_LLM_FALLBACK_BASE_URL=http://10.0.0.77:8080/v1
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
