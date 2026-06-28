# Handoff: run the full Waypoint stack on the ThinkPad (used from the Mac's browser)

This is a deployment handoff for a Claude Code session running **on the Windows ThinkPad**.
Goal: bring up the **entire Waypoint stack on this one machine** — the app (UI + API), Postgres,
the analyst LLM (llama-swap), and OpenTripPlanner (OTP) routing — expose it on the LAN, and verify
it end-to-end. The **Mac is only a browser**: you use the app by visiting `http://<THINKPAD_IP>:8000`
from it, like any website. Nothing is served from or installed on the Mac.

## Read first

- `CLAUDE.md` — repo conventions, the product invariant, and the verification gate.
- `docs/DEPLOY.md` → the **"Single host: everything on the ThinkPad"** section, plus the
  **"Routing (OpenTripPlanner)"** section under *Notes / hardening*.
- `scripts/otp_thinkpad_setup.ps1` — the OTP setup those docs reference.
- `C:\Users\jacob\llama-swap.yaml` — the llama-swap config (maps the analyst model ids to
  `llama-server` commands).

Everything is on `main`.

## What's already on this ThinkPad (persistent — you rarely redo these)

- **Gateways + models:** `llama-swap` and `llama-server` are installed (winget) and on `PATH`. The
  analyst model `gemma-4-26b-a4b-it-ud-q4-k-m` (plus a Qwen alternative) lives under
  `C:\Users\jacob\AI Models\...`, mapped by `C:\Users\jacob\llama-swap.yaml`.
- **OTP data + prebuilt graph** in `C:\otp` (`graph.obj`, the OSM extract, the GTFS zip) — so OTP
  setup **skips the slow download/build** and just loads + serves.
- **`.env.deploy`** is already filled in (real secrets + the wiring below). On a fresh box you'd
  recreate it (step 3).
- The **`mca-postgres` Docker volume** already holds ~30k Seattle incidents from a prior run, so the
  crime ingest mostly de-dupes rather than re-fetching. (That volume was first created by a PostGIS
  image; it runs fine under the plain `postgres:16` the compose file uses — see **Gotchas**.)

**None of the three services auto-start.** Each session you (re)start **llama-swap**, the **OTP
container**, and the **Waypoint** compose stack. OTP and the compose containers carry restart
policies (they return after a Docker/host restart); **llama-swap is a plain process and does not** —
relaunch it.

## Pre-flight

- Docker Desktop is running, with file sharing enabled for the OTP data folder (`C:\otp`).
- This repo is cloned and on `main` (`git pull`).
- `docker`, `llama-swap`, and `llama-server` resolve on `PATH`.

## Bring-up (PowerShell)

```powershell
# 1. Routing / maps: serve OTP on :8090. The graph already exists in C:\otp, so this only
#    loads + serves (no rebuild) and sets a restart-on-boot policy.
./scripts/otp_thinkpad_setup.ps1
#    Confirm it serves (wait for "Grizzly server running"): http://localhost:8090/graphiql
```

> If `otp_thinkpad_setup.ps1` throws parser/encoding errors under **Windows PowerShell 5.1**
> ("Unexpected token", "the string is missing the terminator"), run it with `pwsh` (PowerShell 7),
> or start OTP directly — equivalent, since the graph is already built:
> ```powershell
> docker run -d --name otp --restart unless-stopped -p 8090:8080 `
>   -e "JAVA_TOOL_OPTIONS=-Xmx8g" -v "C:\otp:/var/opentripplanner" `
>   docker.io/opentripplanner/opentripplanner:2.7.0 --load --serve
> ```
> (A fix making the script 5.1-safe is in flight.)

```powershell
# 2. Analyst LLM: start llama-swap on :8080. Bind 0.0.0.0 so the Waypoint container can reach it
#    via host.docker.internal. Leave it running (it does NOT survive a reboot).
llama-swap -config "C:\Users\jacob\llama-swap.yaml" -listen 0.0.0.0:8080
#    Confirm: (Invoke-RestMethod http://localhost:8080/v1/models).data.id   # lists the model ids
#    The Gemma model is a "thinking" model; the app sends max_tokens=1024, which is enough for the
#    answer to land in `content`. If replies come back empty, set MCA_LLM_DISABLE_THINKING=true.
```

```powershell
# 3. Waypoint env: on this box .env.deploy already exists. On a FRESH box, copy + edit it:
cp .env.deploy.example .env.deploy
#    Generate secrets: openssl rand -hex 32 (salt + session secret); openssl rand -hex 24 (admin token).
```

The Waypoint **container** reaches the host-port services via `host.docker.internal`:

```
MCA_LLM_BASE_URL=http://host.docker.internal:8080/v1
MCA_LLM_MODEL=gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k
MCA_ROUTING_PROVIDER=opentripplanner
MCA_OPENTRIPPLANNER_BASE_URL=http://host.docker.internal:8090/otp/gtfs/v1
MCA_SESSION_COOKIE_SECURE=false
```

`MCA_SESSION_COOKIE_SECURE=false` is **required** here: the Mac reaches this over **plain HTTP at a
non-localhost IP**, so a `Secure` session cookie would be dropped by the browser and every login
would silently fail. This **explicit** flag is what matters — it overrides the cookie default, so
`MCA_ENVIRONMENT=production` is fine (production just *additionally* requires non-default secrets and
`MCA_GEOCODER_CONTACT_EMAIL`, both already set). The cookie is `SameSite=Lax`, which is fine — the
page and its API calls share one origin, so requests are same-site.

```powershell
# 4. Waypoint: API + UI + Postgres on :8000 (the container binds 0.0.0.0, so it's LAN-reachable).
#    Migrations run automatically on boot. This uses the standalone OTP from step 1 — do NOT add
#    `--profile otp` (that would double-bind :8090).
docker compose --env-file .env.deploy up -d --build
```

Then load crime data (the Socrata `for offset` loop in `docs/DEPLOY.md` step 3 — on this box the
volume already has ~30k incidents, so it mostly de-dupes) and smoke-test locally at
`http://localhost:8000`. If `host.docker.internal` doesn't resolve from the container, substitute
the ThinkPad's LAN IP (e.g. `http://10.0.0.76:8080/...`).

```powershell
# 5. Open the Windows firewall so the Mac can reach the app (elevated PowerShell).
New-NetFirewallRule -DisplayName "Waypoint 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow

# 6. Print this ThinkPad's LAN IP — the address to type into the Mac's browser.
#    Pick the Wi-Fi/Ethernet IP, NOT a vEthernet (WSL/Hyper-V) 172.x address.
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -notlike '*vEthernet*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object InterfaceAlias, IPAddress
```

## Use it from the Mac

On the Mac, just open a browser to **`http://<THINKPAD_IP>:8000`** (the IP from step 6). That is
the whole app — UI and API are served together from this ThinkPad on one origin, so it behaves
like any website: no dev server, no proxy, nothing installed on the Mac. Because the page and its
API calls share that origin, there is **no CORS and no cross-origin-cookie problem**; the only
requirement is the non-`Secure` cookie from the env step above (plain HTTP).

Quick check from the Mac before declaring victory: `curl http://<THINKPAD_IP>:8000/health` should
return `{"status":"ok"}`. If the page loads but you can't get past the first screen, open browser
devtools → Application → Cookies and confirm `mca_session` exists for `<THINKPAD_IP>` with **no**
Secure flag.

## Success criteria — verify all three end-to-end

From the Mac's browser at `http://<THINKPAD_IP>:8000` (or locally on the ThinkPad at
`http://localhost:8000`):

1. **App** — the map + place analysis load.
2. **Analyst** — the chat panel answers a question (proves the `MCA_LLM_*` wiring to llama-swap).
3. **Routing** — the **Routes** tab returns real route alternatives (proves OTP).

All three were verified working end-to-end on 2026-06-28.

## OTP2 GraphQL provider — validated live; debug guide if it regresses

`app/routing/opentripplanner_provider.py` speaks OTP2's GTFS GraphQL API. It was **validated live on
2026-06-28** — both a direct OTP query and the app path (`/internal/routes/alternatives`) return
real itineraries (e.g. "Monorail via OpenTripPlanner"). It had previously only been tested against a
recorded fixture, so if `/routes` ever errors or returns nothing after an OTP/image change:

- Check `docker logs otp` (is the graph loaded? did it log `Grizzly server running`?).
- Hit the endpoint directly and compare the response shape to the provider's parser:
  ```
  curl http://localhost:8090/otp/gtfs/v1 -X POST -H "Content-Type: application/json" -d '{"query":"{ plan(from:{lat:47.62,lon:-122.32}, to:{lat:47.61,lon:-122.33}, transportModes:[{mode:TRANSIT},{mode:WALK}]) { itineraries { duration legs { mode route { shortName } legGeometry { points } } } } }"}'
  ```
- The provider reads `data.plan.itineraries[].{duration, walkDistance, legs[...]}`. If OTP2's
  field names / mode enums differ, adjust the query + parser in
  `app/routing/opentripplanner_provider.py` and update `tests/test_opentripplanner_provider.py`.

Any code change: do it in a **dedicated git worktree** (per CLAUDE.md), **test-first**, and run
the gate (`make test-all`, or `pytest` + `ruff check .` + the frontend `npm test` / `npm run
build` if `make` isn't available on Windows) before opening a PR.

## Gotchas

- **A stale `docker-compose.yml` edit keeps reappearing.** It reverts the db image to
  `postgis/postgis`, re-adds the retired `MCA_LOCALAGENT_BASE_URL`, and drops the api
  `restart`/`healthcheck`. It's wrong for this deploy — discard it (`git restore docker-compose.yml`,
  or stash) and use committed `main`.
- **The Postgres volume is PostGIS-origin.** `mca-postgres` was first created by a `postgis/postgis`
  image; it runs fine under plain `postgres:16` (the app uses no PostGIS), but `REINDEX DATABASE`
  fails with `could not access file "$libdir/postgis-3"` — reindex per-table instead. A glibc
  collation-version warning was cleared once with `ALTER DATABASE mca REFRESH COLLATION VERSION`.
- **llama-swap doesn't survive a reboot** (plain process). Relaunch the step-2 command, or set up a
  startup task.

## Constraint

The entire deployment runs on this ThinkPad — API, UI, Postgres, the analyst LLM, and OTP. The
Mac is only a browser pointed at `http://<THINKPAD_IP>:8000`: a client, not part of the runtime.
Don't run any Waypoint service on the Mac.
