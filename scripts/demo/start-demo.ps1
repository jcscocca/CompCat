# Start the Waypoint demo-on-demand instance and expose it via an ephemeral
# Cloudflare quick tunnel. Run from the repo root on the ThinkPad.
#   powershell -ExecutionPolicy Bypass -File scripts/demo/start-demo.ps1
param(
    [int]$Port = 8001,
    [int]$FreshnessMaxAgeDays = 14
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env.demo")) {
    Write-Error "Missing .env.demo — copy .env.demo.example and fill in real values."
}
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Error "cloudflared not found — install with: winget install Cloudflare.cloudflared"
}

Write-Host "Starting demo compose project (waypoint-demo)..."
docker compose -p waypoint-demo -f docker-compose.yml -f docker-compose.demo.yml --env-file .env.demo up -d --build
if ($LASTEXITCODE -ne 0) { Write-Error "compose up failed" }

Write-Host "Waiting for /health..."
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 5
        break
    } catch {
        if ((Get-Date) -gt $deadline) { Write-Error "API did not become healthy in 3 minutes" }
        Start-Sleep -Seconds 5
    }
}

# Refresh SPD data if stale (freshness endpoint needs a session cookie). The response is
# keyed by layer ("reported", "arrests", "calls"); the reported-crime layer maps to the
# SPD crime-reports source used by the ingest below.
$ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-RestMethod -Uri "http://localhost:$Port/sessions" -Method Post -WebSession $ws
$freshness = Invoke-RestMethod -Uri "http://localhost:$Port/dashboard/freshness" -WebSession $ws
$dataThrough = [datetime]$freshness.reported.data_through
if ($dataThrough -lt (Get-Date).AddDays(-$FreshnessMaxAgeDays)) {
    Write-Host "Data through $dataThrough is older than $FreshnessMaxAgeDays days — ingesting recent SPD data..."
    $envLines = Get-Content ".env.demo" | Where-Object { $_ -match "^MCA_ADMIN_INGEST_TOKEN=" }
    $token = ($envLines -split "=", 2)[1]
    $start = (Get-Date).AddMonths(-24).ToString("yyyy-MM-dd")
    $end = (Get-Date).ToString("yyyy-MM-dd")
    Invoke-RestMethod -Method Post -Headers @{ "X-Admin-Token" = $token } `
        -Uri "http://localhost:$Port/admin/crime/ingest/socrata?limit=50000&offset=0&start_date=$start&end_date=$end"
} else {
    Write-Host "Data through $dataThrough — fresh enough."
}

Write-Host ""
Write-Host "Starting quick tunnel — the public URL appears below (Ctrl+C stops the tunnel):"
cloudflared tunnel --url "http://localhost:$Port"
