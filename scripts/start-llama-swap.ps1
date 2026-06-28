# Idempotently start the Waypoint analyst gateway (llama-swap) on :8080.
#
# Run at logon by the "Waypoint llama-swap" scheduled task (llama-swap is a plain
# process with no restart policy, unlike the Docker services). Safe to run by hand:
# if :8080 is already serving, it does nothing.
$ErrorActionPreference = 'Stop'

if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'llama-swap already listening on :8080 - nothing to do.'
    return
}

# Resolve the exe from PATH, falling back to the winget install location.
$exe = (Get-Command llama-swap -ErrorAction SilentlyContinue).Source
if (-not $exe) {
    $exe = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\mostlygeek.llama-swap_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-swap.exe'
}
if (-not (Test-Path $exe)) { throw "llama-swap.exe not found (looked on PATH and at $exe)" }

$config = Join-Path $env:USERPROFILE 'llama-swap.yaml'
if (-not (Test-Path $config)) { throw "llama-swap config not found at $config" }

$logDir = Join-Path $env:USERPROFILE '.waypoint'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Bind 0.0.0.0 so the api container reaches it via host.docker.internal.
Start-Process -FilePath $exe `
    -ArgumentList @('-config', $config, '-listen', '0.0.0.0:8080') `
    -RedirectStandardOutput (Join-Path $logDir 'llama-swap.out.log') `
    -RedirectStandardError  (Join-Path $logDir 'llama-swap.err.log') `
    -WindowStyle Hidden
Write-Host "llama-swap launched from $exe (logs in $logDir)."
