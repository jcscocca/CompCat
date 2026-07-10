# Tear down the demo instance AND the quick tunnel (the cloudflared process is the
# tunnel; its URL dies with it).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")  # repo root — compose -f paths are repo-relative
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
docker compose -p waypoint-demo -f docker-compose.yml -f docker-compose.demo.yml --env-file .env.demo down
Write-Host "Demo instance stopped. DB volume kept (docker volume rm waypoint-demo_* to wipe)."
