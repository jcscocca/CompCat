# Bring up the PUBLIC CompCat instance on the ThinkPad and publish it at https://compcat.app
# through the named Cloudflare tunnel. Idempotent: re-running is the normal way to deploy a
# new commit (git pull first - this script builds the current checkout but does not pull).
#
#   pwsh -File scripts\public\start-public.ps1
#
# Runbook: docs/DEPLOY-TUNNEL.md. Shape mirrors scripts/start-compcat.ps1 (Docker wait, tile
# fetch, per-layer freshness backfill) and scripts/prod/start-compcat.sh (health probed from
# INSIDE the api container, because this stack publishes no host port at all).
#
# ISOLATION - the load-bearing property of this script. This project must stay walled off from
# the personal instance:
#
#   compcat         personal instance   .env.deploy   host :8000, real saved places,
#                                                     MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true
#                                                     -> MUST NEVER BE EXPOSED
#   compcat-public  THIS ONE            .env.tunnel   no host port, named tunnel, uploads off
#
# The `-p compcat-public` project name is what enforces it: Compose prefixes every named
# volume and network with it, so this instance gets compcat-public_mca-postgres and
# compcat-public_backups - distinct from the personal compcat_mca-postgres. Never drop -p, and
# never point .env.tunnel's MCA_DATABASE_URL at anything but this project's own db service.
param(
    [switch]$SkipIngest,
    [int]$FreshnessMaxAgeDays = 14,
    [int]$HealthTimeoutMinutes = 5
)
$ErrorActionPreference = 'Stop'
# Resolve everything against the repo root no matter where this is invoked from (the compose
# -f paths, .env.tunnel and the tile paths are all repo-relative).
$repo = Join-Path $PSScriptRoot '..\..'
Set-Location $repo

$composeArgs = @(
    'compose', '-p', 'compcat-public',
    '-f', 'docker-compose.yml',
    '-f', 'docker-compose.prod.yml',
    '-f', 'docker-compose.tunnel.yml',
    '--profile', 'ops',
    '--env-file', '.env.tunnel'
)
function Compose { docker @composeArgs @args }

function Test-Docker { docker info *> $null; return ($LASTEXITCODE -eq 0) }
function Wait-Docker([int]$timeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) { if (Test-Docker) { return $true }; Start-Sleep -Seconds 3 }
    return $false
}

Write-Host '== CompCat public instance (compcat-public) =='
Write-Host 'Exposure: https://compcat.app via named tunnel | no host ports | personal uploads OFF'
Write-Host 'Source: current checkout (this script does not pull)'

if (-not (Test-Path '.env.tunnel')) {
    Write-Error 'Missing .env.tunnel - copy .env.tunnel.example and fill in real values (see docs/DEPLOY-TUNNEL.md).'
}

# Fail before Docker starts if the env file contradicts the public-instance isolation
# advertised above. The application allows uploads/internal routes in legitimate private
# deployments, so this stricter check belongs to the public launcher.
python scripts\public\validate_public_env.py --mode tunnel .env.tunnel
if ($LASTEXITCODE -ne 0) { throw 'Unsafe public posture; refusing to start.' }

# Bake the exact checkout into the image so the public /health response can verify a deploy.
$env:BUILD_REVISION = (git rev-parse HEAD).Trim()
if ($env:BUILD_REVISION -notmatch '^[0-9a-f]{40}([0-9a-f]{24})?$') {
    throw 'Could not resolve a valid Git revision for the image build.'
}

# 1. Docker engine. Docker Desktop starts at login, but the engine takes a moment.
if (-not (Test-Docker)) {
    $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) { Write-Host 'Starting Docker Desktop...'; Start-Process $dd | Out-Null }
}
if (-not (Wait-Docker)) { throw 'Docker engine did not become ready within 120s.' }
Write-Host 'Docker: ready'

# 2. Self-hosted basemap tiles: fetch once if missing (kept out of git; ~100 MB). Gates on
#    both artifacts - the image build bakes basemaps-assets (fonts/sprites) in, so a missing
#    assets dir would ship a glyphless map. Non-fatal: the app runs with a flat-background
#    fallback. Shared with the personal instance; usually already present.
if (-not (Test-Path 'app\data\tiles\seattle.pmtiles') -or -not (Test-Path 'frontend\public\basemaps-assets')) {
    Write-Host 'Basemap artifacts missing; fetching (one-time, ~100 MB)...'
    python scripts\fetch_tiles.py
    if ($LASTEXITCODE -ne 0) { Write-Host 'WARNING: tile fetch failed; map will use the fallback background.' }
}

# 3. Build and start: db, api, the ops sidecar (03:10 ingest / 03:40 backup / 03:50 retention)
#    and cloudflared. No caddy (parked on a dead profile by the tunnel overlay) and no
#    published port - cloudflared dials out to Cloudflare and reaches the app at api:8000 over
#    the compose network.
Write-Host 'Starting the public stack (db, api, ops sidecar, cloudflared)...'
Compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'compose up failed.' }

# 4. Wait for /health from INSIDE the api container - there is no host port to probe.
Write-Host 'Waiting for /health (inside the api container)...'
$deadline = (Get-Date).AddMinutes($HealthTimeoutMinutes)
while ($true) {
    try {
        Compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" *> $null
        if ($LASTEXITCODE -eq 0) { break }
    } catch { }
    if ((Get-Date) -gt $deadline) { throw "API did not become healthy in $HealthTimeoutMinutes minutes - check: docker compose -p compcat-public ... logs api" }
    Start-Sleep -Seconds 5
}
$servedRevision = (Compose exec -T api python -c "import json, urllib.request; print(json.load(urllib.request.urlopen('http://localhost:8000/health'))['revision'])").Trim()
if ($LASTEXITCODE -ne 0 -or $servedRevision -ne $env:BUILD_REVISION) {
    throw "Deployed revision mismatch: expected $env:BUILD_REVISION, served $servedRevision."
}
Write-Host ("API: healthy; deployed revision verified: {0}" -f $servedRevision)

# 5. Data freshness, per layer (same policy as scripts/start-compcat.ps1). mode=backfill
#    starts from the configured overlap before each stored watermark and pages through Socrata
#    internally, so re-runs reconcile recent late rows/corrections and advance. The first
#    911-calls backfill is the long one
#    (rolling 24-month window). Non-fatal by design: an offline Socrata must not block the
#    site from coming up.
if ($SkipIngest) {
    Write-Host 'Data refresh: skipped (-SkipIngest)'
} else {
    try {
        # /dashboard/freshness is session-scoped, so mint a cookie first. Run inside the api
        # container for the same reason as the health probe above.
        #
        # Carry the cookie BY HAND rather than through an HTTPCookieProcessor. Every
        # production-like posture sets MCA_SESSION_COOKIE_SECURE=true (it is true in
        # .env.tunnel), and a cookiejar will not replay a Secure cookie over the plain-HTTP
        # loopback this probe necessarily uses - so /dashboard/freshness answered 401, every
        # layer read as "data through []", and each deploy silently backfilled all three layers
        # instead of the stale ones. Plain HTTP is fine here: it never leaves the container.
        $freshnessScript = @'
import json, urllib.request

base = "http://localhost:8000"
created = urllib.request.urlopen(urllib.request.Request(base + "/sessions", method="POST"))
cookie = created.getheader("Set-Cookie", "").split(";", 1)[0]
if not cookie:
    raise SystemExit("POST /sessions returned no session cookie")
request = urllib.request.Request(base + "/dashboard/freshness", headers={"Cookie": cookie})
layers = json.load(urllib.request.urlopen(request))
print(json.dumps({name: (values or {}).get("data_through") for name, values in layers.items()}))
'@
        # Piped straight to `docker`, not through the Compose function: a PowerShell function
        # buffers pipeline input into $input instead of wiring it to the native process stdin.
        $freshnessJson = ($freshnessScript | docker @composeArgs exec -T api python -)
        # Fail loudly. Left unchecked, a broken probe yields $null, every layer compares as
        # maximally stale, and the launcher quietly runs a full backfill - the 911-calls layer
        # alone is a rolling 24-month window. Skipping the refresh and saying so is the safer
        # failure: the 03:10 sidecar catches the data up anyway.
        if ($LASTEXITCODE -ne 0 -or -not $freshnessJson) {
            throw 'the freshness probe failed (see the error above)'
        }
        $freshness = $freshnessJson | ConvertFrom-Json

        $layers = [ordered]@{ reported = 'seattle_spd_crime'; arrests = 'seattle_spd_arrests'; calls = 'seattle_spd_911' }
        foreach ($layer in $layers.Keys) {
            # Missing data_through (fresh DB) would make [datetime]$null throw; treat it as
            # maximally stale so the first run ingests.
            $dataThrough = $freshness.$layer
            if (-not $dataThrough -or ([datetime]$dataThrough -lt (Get-Date).AddDays(-$FreshnessMaxAgeDays))) {
                Write-Host ("{0}: data through [{1}] - backfilling {2} (the first calls run takes a while)..." -f $layer, $dataThrough, $layers[$layer])
                # Fired from the ops sidecar, which already holds MCA_ADMIN_INGEST_TOKEN in
                # its environment and reaches the api over the compose network - the admin
                # token never has to be read out of .env.tunnel here.
                $url = 'http://api:8000/admin/crime/ingest/socrata?source={0}&mode=backfill&limit=5000' -f $layers[$layer]
                # Single quotes around the URL (its & would background the command in sh) and a
                # colon-form header, so the shell string carries no double quotes for PowerShell's
                # native-argument escaping to mangle on the way through docker.
                $curl = "curl -sS --fail-with-body --max-time 3600 -X POST -H X-Admin-Token:`$MCA_ADMIN_INGEST_TOKEN '$url'"
                Compose exec -T ingest-cron /bin/sh -c $curl
                # Each layer runs even if an earlier one failed, like the nightly sidecar.
                if ($LASTEXITCODE -ne 0) {
                    Write-Host ("WARNING: {0}: backfill failed (curl error above); continuing." -f $layer)
                } else {
                    Write-Host ("{0}: done" -f $layer)
                }
            } else {
                Write-Host ("{0}: data through {1} - fresh enough." -f $layer, $dataThrough)
            }
        }
    } catch {
        Write-Host "WARNING: data-freshness refresh failed ($_); the site is up with whatever data it already has."
    }
}

# 6. Status. The tunnel logs its own registration; a hostname that 502s usually means the
#    public-hostname route in the Cloudflare dashboard does not point at http://api:8000.
Write-Host ''
Compose ps
Write-Host ''
# cloudflared logs to stderr, hence 2>&1; it opens one connection per Cloudflare edge colo
# (normally four). Zero means the site is not actually published - usually a bad token.
try {
    $tunnelLog = Compose logs --tail 60 cloudflared 2>&1 | ForEach-Object { "$_" }
    $registered = @($tunnelLog | Select-String -SimpleMatch 'Registered tunnel connection').Count
    Write-Host ("Tunnel: {0} registered connection(s) to Cloudflare." -f $registered)
    if ($registered -eq 0) {
        Write-Host 'WARNING: no registered connections yet - check CLOUDFLARE_TUNNEL_TOKEN and the cloudflared logs.'
    }
} catch { Write-Host "WARNING: could not read the cloudflared logs ($_)." }
Write-Host ''
Write-Host 'Volumes (must all be compcat-public_*; the personal instance owns compcat_*):'
docker volume ls --filter 'label=com.docker.compose.project=compcat-public' --format '  {{.Name}}'
Write-Host ''
Write-Host 'CompCat is public at:'
Write-Host '  https://compcat.app/             the site'
Write-Host '  https://compcat.app/health       readiness probe'
Write-Host '  https://compcat.app/health/data  data-recency probe - point the uptime monitor here'
Write-Host ''
Write-Host '  logs: docker compose -p compcat-public -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml --profile ops --env-file .env.tunnel logs -f'
Write-Host '  stop: pwsh -File scripts\public\stop-public.ps1'
