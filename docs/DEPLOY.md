# Deploying Waypoint for a small internal trial (~5 testers)

This runs the whole app — FastAPI API **and** the built React UI — in one container,
with Postgres alongside, via `docker compose`. Each tester's browser gets its own
isolated session (signed cookie → per-user data); the UI only calls session-scoped
endpoints, so testers can't see each other's places.

## Single host: everything on the ThinkPad

This trial runs **entirely on the ThinkPad** — no second machine:

- **Waypoint** (API + UI + Postgres) — this `docker compose` stack, on `:8000`.
- **Analyst LLM** (LocalAgent / llama-swap) — already serving on the ThinkPad at `:8080`.
- **Routing** (OpenTripPlanner) — `scripts/otp_thinkpad_setup.ps1`, on `:8090`.

Because Waypoint runs in a container, it reaches the two host-port services via
`host.docker.internal`. Put this wiring in `.env.deploy` (alongside the secrets from the next
section):

```
MCA_LLM_BASE_URL=http://host.docker.internal:8080/v1
MCA_LLM_MODEL=gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k
MCA_ROUTING_PROVIDER=opentripplanner
MCA_OPENTRIPPLANNER_BASE_URL=http://host.docker.internal:8090/otp/gtfs/v1
```

Bring-up order on the ThinkPad (PowerShell). The analyst (llama-swap) is already running, so
there is nothing to start there:

```powershell
cp .env.deploy.example .env.deploy        # fill in secrets (next section) + the wiring above
.\scripts\otp_thinkpad_setup.ps1          # routing: download data, build graph, serve :8090
docker compose --env-file .env.deploy up -d --build   # Waypoint on :8000
# then load crime data (step 3 below) and open http://localhost:8000
```

If `host.docker.internal` ever fails to resolve, substitute the ThinkPad's LAN IP
(e.g. `http://10.0.0.76:8080/...`). Detailed steps for each piece (secrets, crime data,
analyst, routing) follow.

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
- **Internal API surface:** the `/internal/*` endpoints (analysis, imports, crime
  ingest/summary, route engine) are hidden from OpenAPI and accept the **demo-identity
  fallback** instead of requiring a real session; the UI never calls them, and
  `tests/test_internal_surface.py` keeps them off the bare public paths. Not a
  tester-to-tester leak, but lock them down before any internet exposure. The public
  endpoints the UI uses (`/places`, `/dashboard/*`, `/routes*`, `/uploads`, `/exports/*`)
  all require a real session.

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

### Routing (OpenTripPlanner)

Route alternatives default to a built-in deterministic **mock** provider
(`MCA_ROUTING_PROVIDER=mock`) — fine for the trial. To serve **live** routes for any
origin/destination, point Waypoint at an OpenTripPlanner (OTP) instance.

On a single-box (ThinkPad) setup the analyst LLM and OTP co-locate cleanly: the model uses
the **GPU/VRAM**, while OTP is a JVM that uses **system RAM + CPU and no GPU**, so they do
not contend. Run OTP on a port *other than* `8080` (llama-swap already owns `8080` on that
host) — e.g. `8090` — then set in `.env.deploy`:

```
MCA_ROUTING_PROVIDER=opentripplanner
MCA_OPENTRIPPLANNER_BASE_URL=http://10.0.0.76:8090/otp/gtfs/v1
```

Same LAN-IP rule as the assistant: `127.0.0.1` will not resolve from inside the container —
use the host's LAN IP or `host.docker.internal:8090`.

**Standing up OTP** — two phases, build a graph once then serve it:

1. Gather the inputs: a Washington/Puget Sound **OSM** extract
   ([Geofabrik](https://download.geofabrik.de/north-america/us/washington.html)) and the
   **Puget Sound Consolidated GTFS**
   (`https://gtfs.sound.obaweb.org/prod/gtfs_puget_sound_consolidated.zip`).
2. Put both in a folder and build + serve with OTP **2.x**, e.g.:

   ```bash
   java -Xmx8G -jar otp-2.7.0-shaded.jar --build --serve /graphs
   ```

   OTP serves on `:8080` by default; since llama-swap already owns `:8080` on the ThinkPad,
   put OTP behind a port map / reverse proxy on `:8090` (e.g. Docker `-p 8090:8080`).

   The graph *build* is the only real RAM spike (it loads all the OSM + GTFS at once); the
   ThinkPad's spare system RAM handles it, or build once on another machine and copy the
   graph file over — *serving* only needs ~4–8 GB.

> **OTP version:** the provider speaks the **OTP 2.x GTFS GraphQL API** — it POSTs a `plan`
> query to `MCA_OPENTRIPPLANNER_BASE_URL` (the full GraphQL endpoint, e.g. `…/otp/gtfs/v1`).
> OTP 1.x's REST `/plan` API is not supported. See the
> [GTFS GraphQL API docs](https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/).

If OTP is unreachable, `/routes` requests return an error; every other part of the app is
unaffected (same graceful-degradation posture as the assistant).

#### Running the OTP container day-to-day

**Fastest path:** on the ThinkPad, run [`scripts/otp_thinkpad_setup.ps1`](../scripts/otp_thinkpad_setup.ps1)
in PowerShell — it downloads the OSM + GTFS data, builds the graph, starts the container with the
restart policy, and opens the firewall, then prints the exact `MCA_OPENTRIPPLANNER_BASE_URL` (with
the host's LAN IP) to set on the Mac. The manual steps below do the same by hand.

Building the graph is a one-time step that writes `graph.obj` into the data folder; after that
you only run the lightweight **serve** container, which loads that graph. Run it with a restart
policy so it comes back on its own after reboots / Docker restarts:

```powershell
cd C:\otp   # the folder that holds graph.obj
docker run -d --name otp --restart unless-stopped -p 8090:8080 `
  -e JAVA_TOOL_OPTIONS='-Xmx8g' -v ${PWD}:/var/opentripplanner `
  docker.io/opentripplanner/opentripplanner:latest --load --serve
```

`--restart unless-stopped` is the important part: Docker Desktop restarts OTP automatically on
boot, so normally you never start it by hand. Once that container exists:

| Action | Command |
| --- | --- |
| Start it again | `docker start otp` |
| Stop it | `docker stop otp` |
| Restart | `docker restart otp` |
| Follow logs (wait for `Grizzly server running`) | `docker logs -f otp` |
| Status | `docker ps -a --filter name=otp` |
| Recreate from scratch | `docker rm -f otp`, then re-run the `docker run …` above |

If `docker run` says the name is already in use, the container already exists — use
`docker start otp` (or `docker rm -f otp` first to recreate it with the restart policy).
`--load` needs the saved `graph.obj`; if you ever built with `--serve` instead of `--save`,
run `--build --save` once to produce it.

**Confirm it is serving** — open `http://localhost:8090/graphiql`, or:

```powershell
curl http://localhost:8090/otp/gtfs/v1 -X POST -H "Content-Type: application/json" `
  -d '{"query":"{ plan(from:{lat:47.62,lon:-122.32}, to:{lat:47.61,lon:-122.33}, transportModes:[{mode:TRANSIT},{mode:WALK}]) { itineraries { duration } } }"}'
```

**Point Waypoint at it.** When Waypoint runs on a *different* machine (e.g. a Mac), it reaches
OTP over the LAN — use the ThinkPad's IP, and make sure the firewall allows the port. The setup
script adds the rule; by hand, in an elevated PowerShell:
`New-NetFirewallRule -DisplayName "OTP 8090" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow`.
Set these where Waypoint runs (its `.env` / `.env.deploy`) and restart it:

```
MCA_ROUTING_PROVIDER=opentripplanner
MCA_OPENTRIPPLANNER_BASE_URL=http://10.0.0.76:8090/otp/gtfs/v1
```

Use `http://localhost:8090/...` only if Waypoint runs on the ThinkPad itself (or
`http://host.docker.internal:8090/...` if it is containerized on the ThinkPad).

**Refresh transit data** when the GTFS feed changes: re-download it into the data folder,
rebuild with `--build --save`, then `docker restart otp`.

## Stop / reset

```bash
docker compose down            # stop; keeps the Postgres volume (data survives)
docker compose down -v         # stop AND wipe the database volume
```
