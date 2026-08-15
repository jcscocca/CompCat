# CompCat run modes

Start here when deciding how to run CompCat. The launchers are intentionally separate because
they use different databases, secrets, network exposure, and data-retention policies.

## The normal ThinkPad command

For the private CompCat instance on the ThinkPad:

```powershell
pwsh -File .\scripts\start-compcat.ps1
```

Open `http://localhost:8000` on the ThinkPad or `http://<thinkpad-lan-ip>:8000` from a trusted
device on the LAN.

To stop the app while keeping its database:

```powershell
pwsh -File .\scripts\stop-compcat.ps1
```

Add `-StopAnalyst` if the stop command should also close the host-side `llama-swap` process.

This is the **personal** project. Its `.env.deploy` posture may enable personal location-history
uploads, and its database may contain real saved places. Never expose this project through a
Cloudflare tunnel.

## Choose the mode

| Need | Launcher | Project and data | Exposure |
|---|---|---|---|
| Use CompCat privately on the ThinkPad | `scripts\start-compcat.ps1` | `compcat`; `.env.deploy`; `compcat_mca-postgres` | Host/LAN `:8000` |
| Operate the persistent public ThinkPad site | `scripts\public\start-public.ps1` | `compcat-public`; `.env.tunnel`; isolated public database and backups | `https://compcat.app` through a named tunnel; no host ports |
| Operate the public Linux VPS | `scripts/prod/start-compcat.sh` | VPS Compose project; `.env.prod`; VPS database and backups | Caddy on public `:80/:443` |
| Develop the application on the Mac | `scripts/dev.sh` or `make dev` | Local development environment; normally SQLite | API `:8000` plus Vite `:5173` |

Only the first command is the normal ThinkPad startup. The public launcher is a deployment tool,
not an alternative for opening the personal instance.

## What each launcher does

### Personal ThinkPad

Start:

```powershell
pwsh -File .\scripts\start-compcat.ps1
```

The launcher:

- fixes the Compose project name to `compcat`;
- prints the current Git branch and revision;
- pulls the current branch from its configured upstream;
- fetches the self-hosted basemap when missing;
- starts Docker Desktop when necessary;
- builds the API image so local merges cannot leave an older image running;
- starts the API, built React UI, and Postgres on host port `8000`;
- starts host-side `llama-swap` on `8080` when it is not already running; and
- refreshes stale reported-incident, arrest, and 911-call layers.

### Optional local GPT-OSS 120B model

The personal ThinkPad normally uses the local Gemma model named in `.env.deploy`. To install the
same OpenAI GPT-OSS 120B model used by the Groq-backed public configuration, run this one-time
installer from the repository root:

```powershell
pwsh -File .\scripts\install-gpt-oss-120b.ps1 -PlanOnly
pwsh -File .\scripts\install-gpt-oss-120b.ps1 -ActivateForCompCat
```

The installer downloads the llama.cpp MXFP4 GGUF into
`$env:USERPROFILE\AI Models\Library\OpenAI\gpt-oss-120b`, resumes interrupted downloads,
verifies the pinned SHA-256, backs up and updates `$env:USERPROFILE\llama-swap.yaml`, and
optionally changes
the private `.env.deploy` model selection before restarting the personal stack. Activation keeps
Tabby narration enabled, raises only the private OpenAI-compatible timeout to 300 seconds, sets
llama-swap's root health-check timeout to 300 seconds, warms the model before the first chat, and
keeps it resident for one hour after use. It does not change the
public ThinkPad or VPS configurations; hosted calls retain the 120-second default.

The file is about 59 GiB. The ThinkPad's 64 GB RAM and 12 GB RTX 3500 Ada GPU require hybrid
CPU/GPU inference, so the installed profile uses one 8K context slot and keeps 34 of the model's 36
mixture-of-experts layers on the CPU. Expect substantially slower startup and generation than the
Groq-hosted model. The llama.cpp maintainers caution that Windows can spill excess GPU allocation
into shared memory and become extremely slow; check Task Manager's dedicated GPU memory during the
first live test.

Useful switches:

```powershell
pwsh -File .\scripts\start-compcat.ps1 -SkipPull
pwsh -File .\scripts\start-compcat.ps1 -SkipBuild
pwsh -File .\scripts\start-compcat.ps1 -SkipIngest
```

`-SkipBuild` deliberately reuses the existing Docker image. Normal startup builds with Docker's
layer cache and is the reliable choice after any pull, checkout, or local merge.

Stop:

```powershell
pwsh -File .\scripts\stop-compcat.ps1
pwsh -File .\scripts\stop-compcat.ps1 -StopAnalyst
```

Stopping removes the personal containers and network but keeps `compcat_mca-postgres`. It does
not touch the public project.

Detailed setup and environment configuration: [DEPLOY.md](DEPLOY.md).

### Persistent public site from the ThinkPad

Update, start, and stop:

```powershell
git pull --ff-only
pwsh -File .\scripts\public\start-public.ps1
pwsh -File .\scripts\public\stop-public.ps1
```

The public launcher builds the current checkout but does **not** pull Git changes. It uses the
production and named-tunnel Compose overlays under the fixed project `compcat-public`. The API
and Postgres publish no host ports; a `cloudflared` container makes the outbound connection to
the durable `compcat.app` tunnel. Before touching Docker it runs
`scripts/public/validate_public_env.py` and refuses any env that would enable uploads/internal
routes, disable the production cookie/rate-limit posture, misconfigure proxy trust, or retain
example credentials.

This project has uploads and the internal API tier disabled. It has its own database, nightly
ingestion, backups, retention sweep, restart policy, hosted LLM configuration, and rate limits.
Its volumes never overlap the personal project.

Keeping it up without being asked is a separate, one-time install:

```powershell
pwsh -File .\scripts\public\install-public-autostart.ps1
```

That registers the **CompCat public site** scheduled task, which runs
`scripts\public\ensure-public.ps1` at logon and every 10 minutes thereafter. `ensure-public.ps1` is
a **supervisor, not a launcher**: it starts Docker Desktop, brings the stack up with no `--build`,
verifies `/health` and that `compcat.app` actually answers, and repairs the orphaned-socket failure
that stops Docker Desktop from starting. It never deploys new code and never ingests — a checkout
ahead of the running image is reported, not published. Use `start-public.ps1` to deploy.

Detailed setup and incident response: [DEPLOY-TUNNEL.md](DEPLOY-TUNNEL.md), section 9.

### Public Linux VPS

Update, start, and stop on the VPS:

```bash
git pull --ff-only
scripts/prod/start-compcat.sh
scripts/prod/stop-compcat.sh
```

These are Linux production scripts, not ThinkPad launchers. They use Caddy as the public TLS
edge on ports 80 and 443. The API and Postgres remain private to the Compose network. The VPS
path otherwise shares the public posture: uploads off, rate limits on, nightly ingestion,
backups, and retention. The same validator gates `.env.prod` before Compose starts.

Detailed provisioning and recovery: [DEPLOY-VPS.md](DEPLOY-VPS.md).

### Mac development

```bash
make install
make dev
```

`make dev` wraps `scripts/dev.sh`. It runs Uvicorn and the Vite development server directly,
without the ThinkPad deployment stack. Open `http://127.0.0.1:5173`.

## Data and network isolation

The two ThinkPad Docker projects must remain separate:

| Project | Database volume | Can contain personal data? | Internet exposure |
|---|---|---|---|
| `compcat` | `compcat_mca-postgres` | Yes | None intended; trusted LAN only |
| `compcat-public` | `compcat-public_mca-postgres` | Yes—saved places; timeline uploads off | Persistent named tunnel |

The basemap file under `app\data\tiles` is shared read-only. Databases, backups, networks,
session secrets, and LLM credentials are not shared.

## The other files under `scripts/`

These are supporting tools, not application launchers:

- `fetch_tiles.py`, `generate_*.py` — regenerate versioned data or visual assets;
- `seed_crime.py`, `seed_arrests.py`, `seed_calls.py` — load bundled synthetic development data;
- `render_*.mjs` — regenerate favicon or iOS image assets;
- `analyze_overdispersion.py` — reproduce the statistical-methods analysis;
- `live_smoke.py` — probe an already-running instance; and
- `soak/` — sustained-load and Postgres observation tools.

None of these should be used merely to open CompCat on the ThinkPad.
