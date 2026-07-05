# Bring up the full Waypoint stack on the ThinkPad, on demand.
#
# Run this when you want Waypoint; nothing here auto-starts on its own (containers
# use restart: "no"). It's idempotent: anything already running is left alone.
#
# It ALWAYS pulls the latest from origin first (this checkout is pull-only - do dev on
# the Mac), and rebuilds only if HEAD actually moved. If the tree is dirty or origin is
# unreachable it warns and starts the current checkout rather than failing to come up.
#
#   pwsh -File scripts\start-waypoint.ps1     # pull latest, rebuild if it changed, then start
#
# To stop everything when you're done: `docker compose stop`,
# and close llama-swap from Task Manager (or just reboot — nothing comes back).
param([switch]$Update)  # accepted for backwards compatibility; pulling is now always on
$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env.deploy'
$doBuild = $false

function Test-Docker { docker info *> $null; return ($LASTEXITCODE -eq 0) }
function Wait-Docker([int]$timeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) { if (Test-Docker) { return $true }; Start-Sleep -Seconds 3 }
    return $false
}

Write-Host '== Waypoint bring-up =='

# 0. Always pull latest from origin, and rebuild only if HEAD actually moved. This checkout is
#    pull-only (do dev on the Mac). If the tree is dirty or origin is unreachable, warn and start
#    the current checkout rather than blocking the app from coming up.
Push-Location $repo
try {
    if (git status --porcelain --untracked-files=no) {
        Write-Host 'WARNING: working tree has local changes; skipping pull, starting the current checkout.'
    } else {
        $before = (git rev-parse HEAD).Trim()
        Write-Host 'Pulling latest from origin...'
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'WARNING: git pull --ff-only failed (diverged or offline?); starting the current checkout.'
        } else {
            $after = (git rev-parse HEAD).Trim()
            if ($before -ne $after) {
                Write-Host ('Updated {0} -> {1}; will rebuild.' -f $before.Substring(0,7), $after.Substring(0,7))
                $doBuild = $true
            } else {
                Write-Host 'Already up to date; no rebuild needed.'
            }
        }
    }
} finally { Pop-Location }

# 0.5 Self-hosted basemap tiles: fetch once if missing (kept out of git; ~100 MB).
#     Gates on both artifacts: the docker build bakes basemaps-assets (fonts/sprites) into
#     the image, so a missing assets dir would ship a glyphless map on the next rebuild.
#     fetch_tiles.py skips whatever already exists, so re-running is idempotent.
#     A failure here is non-fatal — the app runs with a flat-background map fallback.
$tiles = Join-Path $repo 'app\data\tiles\seattle.pmtiles'
if (-not (Test-Path $tiles) -or -not (Test-Path (Join-Path $repo 'frontend\public\basemaps-assets'))) {
    Write-Host 'Basemap artifacts missing; fetching (one-time, ~100 MB)...'
    python (Join-Path $repo 'scripts\fetch_tiles.py')
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'WARNING: tile fetch failed; map will use the fallback background.'
    } else {
        # The image bakes basemaps-assets at build time, so a fresh fetch must force a
        # rebuild even when HEAD did not move (first run after the map-overhaul merge).
        $doBuild = $true
    }
}

# 1. Docker engine. Docker Desktop starts at login, but the engine takes a moment;
#    if it isn't up at all, nudge Docker Desktop, then wait for readiness.
if (-not (Test-Docker)) {
    $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) { Write-Host 'Starting Docker Desktop...'; Start-Process $dd | Out-Null }
}
if (-not (Wait-Docker)) { throw 'Docker engine did not become ready within 120s.' }
Write-Host 'Docker: ready'

# 2. App + Postgres on :8000 (api runs migrations on boot). Rebuild only if the pull moved HEAD.
Push-Location $repo
try {
    if ($doBuild) { docker compose --env-file $envFile up -d --build | Out-Null }
    else          { docker compose --env-file $envFile up -d         | Out-Null }
} finally { Pop-Location }
if ($doBuild) { Write-Host 'App + db: up on :8000 (rebuilt)' } else { Write-Host 'App + db: up on :8000' }

# 3. Analyst gateway (llama-swap) on :8080 - launch hidden if not already serving.
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Analyst: already on :8080'
} else {
    $exe = (Get-Command llama-swap -ErrorAction SilentlyContinue).Source
    if (-not $exe) { $exe = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\mostlygeek.llama-swap_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-swap.exe' }
    if (-not (Test-Path $exe)) { throw "llama-swap.exe not found (PATH and $exe)" }
    $config = Join-Path $env:USERPROFILE 'llama-swap.yaml'
    $logDir = Join-Path $env:USERPROFILE '.waypoint'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Start-Process -FilePath $exe -ArgumentList @('-config', $config, '-listen', '0.0.0.0:8080') `
        -RedirectStandardOutput (Join-Path $logDir 'llama-swap.out.log') `
        -RedirectStandardError  (Join-Path $logDir 'llama-swap.err.log') -WindowStyle Hidden
    Write-Host 'Analyst: launched on :8080 (loads the model on first request)'
}

# 4. Print the LAN URL for the Mac's browser.
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notlike '*vEthernet*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "Waypoint is starting. From the Mac:  http://${ip}:8000"
Write-Host '(give the api ~20-30s to migrate + boot, then hard-refresh Safari.)'
