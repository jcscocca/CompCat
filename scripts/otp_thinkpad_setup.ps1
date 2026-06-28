<#
.SYNOPSIS
  Stand up OpenTripPlanner 2.x (Seattle / Puget Sound) in Docker on this Windows host,
  for Waypoint's live routing provider (MCA_ROUTING_PROVIDER=opentripplanner).

.DESCRIPTION
  Downloads the OSM extract + GTFS feed (if missing), builds the OTP graph, and starts a
  container named "otp" with a restart policy so it returns after reboots. Also opens the
  Windows firewall for the port (needs an elevated PowerShell) so other machines on the LAN
  — e.g. a Mac running Waypoint — can reach it. Re-running is safe: it skips the download and
  build when the data / graph already exist (use -Rebuild to force a fresh graph).

.EXAMPLE
  .\scripts\otp_thinkpad_setup.ps1
  .\scripts\otp_thinkpad_setup.ps1 -Rebuild -Heap 12g
#>
param(
  [string]$DataDir = "C:\otp",
  [int]$Port = 8090,
  [string]$Heap = "8g",
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$Image    = "docker.io/opentripplanner/opentripplanner:2.7.0"
$OsmUrl    = "https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf"
$GtfsUrl   = "https://gtfs.sound.obaweb.org/prod/gtfs_puget_sound_consolidated.zip"
$OsmFile   = Join-Path $DataDir "washington-latest.osm.pbf"
$GtfsFile  = Join-Path $DataDir "gtfs_puget_sound_consolidated.zip"  # filename must contain "gtfs"
$Graph     = Join-Path $DataDir "graph.obj"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker not found. Install Docker Desktop and retry."
}
docker version *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker isn't responding — start Docker Desktop and retry." }

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if (-not (Test-Path $OsmFile)) {
  Write-Host "==> Downloading Washington OSM extract (large — can take several minutes)..."
  Invoke-WebRequest -Uri $OsmUrl -OutFile $OsmFile
}
if (-not (Test-Path $GtfsFile)) {
  Write-Host "==> Downloading Puget Sound consolidated GTFS..."
  Invoke-WebRequest -Uri $GtfsUrl -OutFile $GtfsFile
}

if ($Rebuild -or -not (Test-Path $Graph)) {
  Write-Host "==> Building the OTP graph (RAM/time-heavy; needs Docker file sharing on $DataDir)..."
  docker run --rm -e "JAVA_TOOL_OPTIONS=-Xmx$Heap" -v "${DataDir}:/var/opentripplanner" $Image --build --save
  if ($LASTEXITCODE -ne 0) { throw "Graph build failed (see output above)." }
} else {
  Write-Host "==> graph.obj already present — skipping build (use -Rebuild to force)."
}

Write-Host "==> (Re)starting the 'otp' container on port $Port..."
docker rm -f otp *> $null
docker run -d --name otp --restart unless-stopped -p "${Port}:8080" `
  -e "JAVA_TOOL_OPTIONS=-Xmx$Heap" -v "${DataDir}:/var/opentripplanner" $Image --load --serve | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to start the otp container (see output above)." }

# (Optional) open the firewall so you can reach OTP / GraphiQL from other machines on the LAN.
try {
  if (-not (Get-NetFirewallRule -DisplayName "OTP $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "OTP $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Write-Host "==> Added firewall rule 'OTP $Port'."
  }
} catch {
  Write-Warning "Couldn't add the firewall rule (run PowerShell as Administrator). Manually:"
  Write-Warning "  New-NetFirewallRule -DisplayName 'OTP $Port' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow"
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "OTP is starting. Watch it:   docker logs -f otp    (ready at 'Grizzly server running')"
Write-Host "Local check:                 http://localhost:$Port/graphiql"
Write-Host ""
Write-Host "Waypoint runs on this same ThinkPad (docker compose), so set in its .env.deploy and restart it:"
Write-Host "  MCA_ROUTING_PROVIDER=opentripplanner"
Write-Host "  MCA_OPENTRIPPLANNER_BASE_URL=http://host.docker.internal:$Port/otp/gtfs/v1"
Write-Host ""
Write-Host "(This host's LAN IP is $ip - use http://${ip}:$Port/otp/gtfs/v1 to reach OTP from other machines.)"
