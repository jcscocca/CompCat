# Bring up the PERSONAL CompCat stack on the ThinkPad, on demand.
#
# THIS is the normal private/LAN launcher. It uses:
#   compose project  compcat
#   env file         .env.deploy
#   app              http://<thinkpad>:8000
#   database         compcat_mca-postgres
#   analyst          host-side llama-swap on :8080
#
# Personal uploads are enabled by the shipped .env.deploy posture, so this project MUST
# NEVER be exposed through Cloudflare. The isolated public deployment is:
#   scripts\public\start-public.ps1   persistent compcat.app named tunnel
#
# Run this when you want the private instance; nothing here auto-starts on its own
# (containers use restart: "no"). Re-running it is safe.
#
# It pulls the current branch from its configured upstream unless -SkipPull is supplied.
# This checkout is normally pull-only and on main; the script prints the branch so an
# accidental feature-branch deploy is visible. If the tree is dirty or origin is
# unreachable it warns and starts the current checkout rather than failing to come up.
#
# The api image is rebuilt by default. Docker's layer cache makes an unchanged rebuild
# cheap, and this guarantees that local merges and checked-out commits cannot leave an
# older image running. Use -SkipBuild only when you intentionally want the existing image.
#
# Once the api is healthy it also refreshes any stale data layer (reported / arrests /
# 911 calls) via the watermarked backfill - same policy as the public/VPS paths -
# so there is no separate ingest step. Skip that with -SkipIngest.
#
#   pwsh -File scripts\start-compcat.ps1
#
# To stop it: pwsh -File scripts\stop-compcat.ps1
param(
    [switch]$Update,  # accepted for backwards compatibility; pulling is now always on
    [switch]$SkipPull,
    [switch]$SkipBuild,
    [switch]$SkipIngest,
    [switch]$SkipLlmPrewarm,
    [int]$FreshnessMaxAgeDays = 14
)
$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env.deploy'
$composeArgs = @(
    'compose', '-p', 'compcat',
    '-f', 'docker-compose.yml',
    '--env-file', $envFile
)
function Compose { docker @composeArgs @args }

function Test-Docker { docker info *> $null; return ($LASTEXITCODE -eq 0) }
function Wait-Docker([int]$timeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) { if (Test-Docker) { return $true }; Start-Sleep -Seconds 3 }
    return $false
}

Set-Location $repo

if (-not (Test-Path $envFile)) {
    throw 'Missing .env.deploy - copy .env.deploy.example to .env.deploy and fill in its values.'
}

$branch = (git branch --show-current).Trim()
$revision = (git rev-parse --short HEAD).Trim()
Write-Host '== CompCat PERSONAL instance =='
Write-Host ("Project: compcat | branch: {0} | revision: {1}" -f $branch, $revision)
Write-Host 'Exposure: private/LAN :8000 | personal uploads may be enabled | never tunnel this project'

# 0. Pull the current branch unless explicitly skipped. This checkout is normally pull-only
#    and on main. If the tree is dirty or origin is unreachable, warn and start the current
#    checkout rather than blocking the app from coming up.
if ($SkipPull) {
    Write-Host 'Git update: skipped (-SkipPull)'
} else {
    if (git status --porcelain --untracked-files=no) {
        Write-Host 'WARNING: working tree has local changes; skipping pull, starting the current checkout.'
    } else {
        Write-Host ("Pulling branch '{0}' from its configured upstream..." -f $branch)
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'WARNING: git pull --ff-only failed (diverged or offline?); starting the current checkout.'
        } else {
            $revision = (git rev-parse --short HEAD).Trim()
            Write-Host ("Git update complete; starting revision {0}." -f $revision)
        }
    }
}

# 0.5 Self-hosted basemap tiles: fetch once if missing (kept out of git; ~100 MB).
#     Gates on both artifacts: the docker build bakes basemaps-assets (fonts/sprites) into
#     the image, so a missing assets dir would ship a glyphless map on the next rebuild.
#     fetch_tiles.py skips whatever already exists, so re-running is idempotent.
#     A failure here is non-fatal - the app runs with a flat-background map fallback.
$tiles = Join-Path $repo 'app\data\tiles\seattle.pmtiles'
if (-not (Test-Path $tiles) -or -not (Test-Path (Join-Path $repo 'frontend\public\basemaps-assets'))) {
    Write-Host 'Basemap artifacts missing; fetching (one-time, ~100 MB)...'
    python (Join-Path $repo 'scripts\fetch_tiles.py')
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'WARNING: tile fetch failed; map will use the fallback background.'
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

# 2. App + Postgres on :8000 (api runs migrations on boot). Build by default so the running
#    image always matches the checked-out revision, including after a local fast-forward.
if ($SkipBuild) {
    Compose up -d | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Personal compose start failed.' }
    Write-Host 'App + db: up on :8000 (existing image; -SkipBuild)'
} else {
    Compose up -d --build | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Personal compose build/start failed.' }
    Write-Host 'App + db: up on :8000 (image verified/rebuilt)'
}

# 3. Analyst gateway (llama-swap) on :8080 - launch hidden if not already serving.
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Analyst: already on :8080'
} else {
    $exe = (Get-Command llama-swap -ErrorAction SilentlyContinue).Source
    if (-not $exe) { $exe = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\mostlygeek.llama-swap_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-swap.exe' }
    if (-not (Test-Path $exe)) { throw "llama-swap.exe not found (PATH and $exe)" }
    $config = Join-Path $env:USERPROFILE 'llama-swap.yaml'
    $logDir = Join-Path $env:USERPROFILE '.compcat'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Start-Process -FilePath $exe -ArgumentList @('-config', $config, '-listen', '0.0.0.0:8080') `
        -RedirectStandardOutput (Join-Path $logDir 'llama-swap.out.log') `
        -RedirectStandardError  (Join-Path $logDir 'llama-swap.err.log') -WindowStyle Hidden
    Write-Host 'Analyst: launched on :8080 (loads the model on first request)'
}

# GPT-OSS 120B needs materially longer to load than the smaller personal model. Warm it here so
# the startup cost happens once, before the first Tabby turn, and never affects public launchers.
$configuredLlmModel = ((Get-Content $envFile | Where-Object { $_ -match '^MCA_LLM_MODEL=' }) -split '=', 2)[1].Trim()
if ($configuredLlmModel -eq 'openai/gpt-oss-120b' -and -not $SkipLlmPrewarm) {
    try {
        Write-Host 'Analyst: prewarming GPT-OSS 120B (first load can take several minutes)...'
        $gatewayDeadline = (Get-Date).AddSeconds(60)
        while ($true) {
            try {
                $null = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/v1/models' -TimeoutSec 2
                break
            } catch {
                if ((Get-Date) -gt $gatewayDeadline) { throw 'llama-swap did not become ready within 60 seconds.' }
                Start-Sleep -Seconds 2
            }
        }
        $prewarmBody = @{
            model = $configuredLlmModel
            messages = @(@{ role = 'user'; content = 'Reply OK.' })
            max_tokens = 1
            stream = $false
        } | ConvertTo-Json -Depth 4
        $null = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/v1/chat/completions' -Method Post `
            -ContentType 'application/json' -Body $prewarmBody -TimeoutSec 600
        Write-Host 'Analyst: GPT-OSS 120B is warm.'
    } catch {
        Write-Host "WARNING: GPT-OSS prewarm failed ($_); CompCat will retry on the first Tabby request."
    }
} elseif ($configuredLlmModel -eq 'openai/gpt-oss-120b') {
    Write-Host 'Analyst: GPT-OSS prewarm skipped (-SkipLlmPrewarm)'
}

# 3.5 Data freshness: refresh any stale layer on start (mirrors the public and VPS paths).
#     mode=backfill resolves each layer's start date from its stored
#     watermark and pages through Socrata internally, so re-runs advance or no-op. The
#     first 911-calls backfill is the long one (rolling 24-month window). Non-fatal by
#     design: an offline Socrata must not block the app from coming up.
if ($SkipIngest) {
    Write-Host 'Data refresh: skipped (-SkipIngest)'
} else {
    try {
        Write-Host 'Waiting for /health before the data-freshness check...'
        $deadline = (Get-Date).AddMinutes(3)
        while ($true) {
            try { $null = Invoke-RestMethod -Uri 'http://localhost:8000/health' -TimeoutSec 5; break }
            catch { if ((Get-Date) -gt $deadline) { throw 'API did not become healthy in 3 minutes.' }; Start-Sleep -Seconds 5 }
        }
        # Freshness needs a session cookie; the response is keyed by layer.
        $ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $null = Invoke-RestMethod -Uri 'http://localhost:8000/sessions' -Method Post -WebSession $ws
        $freshness = Invoke-RestMethod -Uri 'http://localhost:8000/dashboard/freshness' -WebSession $ws
        $token = ((Get-Content $envFile | Where-Object { $_ -match '^MCA_ADMIN_INGEST_TOKEN=' }) -split '=', 2)[1]
        $layers = [ordered]@{ reported = 'seattle_spd_crime'; arrests = 'seattle_spd_arrests'; calls = 'seattle_spd_911' }
        foreach ($layer in $layers.Keys) {
            # Missing data_through (fresh DB) would make [datetime]$null throw; treat it
            # as maximally stale so the first run ingests.
            $dataThrough = $freshness.$layer.data_through
            if (-not $dataThrough -or ([datetime]$dataThrough -lt (Get-Date).AddDays(-$FreshnessMaxAgeDays))) {
                Write-Host ("{0}: data through [{1}] - backfilling {2} (the first calls run takes a while)..." -f $layer, $dataThrough, $layers[$layer])
                $null = Invoke-RestMethod -Method Post -Headers @{ 'X-Admin-Token' = $token } -TimeoutSec 3600 `
                    -Uri ("http://localhost:8000/admin/crime/ingest/socrata?source={0}&mode=backfill&limit=5000" -f $layers[$layer])
                Write-Host ("{0}: done" -f $layer)
            } else {
                Write-Host ("{0}: data through {1} - fresh enough." -f $layer, $dataThrough)
            }
        }
    } catch {
        Write-Host "WARNING: data-freshness refresh failed ($_); the app is up with whatever data it already has."
    }
}

# 4. Print the LAN URL for the Mac's browser.
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notlike '*vEthernet*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "CompCat is starting. From the Mac:  http://${ip}:8000"
Write-Host '(give the api ~20-30s to migrate + boot, then hard-refresh Safari.)'
