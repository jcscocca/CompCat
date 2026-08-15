# Keep the PUBLIC CompCat instance (compcat.app) up. This is the SUPERVISOR, not the deployer:
# it makes the already-deployed stack running and publicly reachable, and it never ships new code.
#
#   pwsh -File scripts\public\ensure-public.ps1
#
# Registered as a Scheduled Task by scripts\public\install-public-autostart.ps1: once at logon
# (after a delay, so Docker Desktop has begun) and every 10 minutes thereafter as a watchdog.
# Runbook: docs/DEPLOY-TUNNEL.md section 9.
#
# WHY THIS IS SEPARATE FROM start-public.ps1 - the distinction is load-bearing:
#
#   start-public.ps1   deploy tool. `up -d --build` bakes the current checkout into the image and
#                      asserts the served revision equals HEAD. You run it, deliberately, to
#                      publish a commit.
#   ensure-public.ps1  supervisor. `up -d` with NO --build, so an existing image is reused as-is.
#                      A checkout that has moved ahead of the running image is REPORTED, never
#                      deployed. Nothing that runs unattended every 10 minutes should be able to
#                      push code to compcat.app because someone left a `git pull` on disk.
#
# It also does not ingest: refreshing SPD data is the nightly ops sidecar's job (03:10), and a
# watchdog that could start an hour-long backfill every 10 minutes is a footgun, not a safety net.
#
# Idempotent and safe to run when everything is already fine - that is the normal case, and it
# costs one `docker info`, one `compose up -d` no-op and two health probes.
param(
    # Docker Desktop from cold takes well over a minute on this hardware; the logon trigger's own
    # delay is not enough on its own after a reboot.
    [int]$DockerTimeoutSec = 300,
    [int]$HealthTimeoutSec = 300,
    # Skip the external compcat.app probe (useful when the ThinkPad is off the network and only
    # the local stack's state is in question).
    [switch]$SkipExternalProbe
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

# --- logging -----------------------------------------------------------------------------------
# Outside the repo on purpose: the checkout stays clean, and the log survives a `git clean`. The
# Scheduled Task runs hidden, so this file is the only record of what the watchdog has been doing.
$logDir = Join-Path $env:LOCALAPPDATA 'CompCat\logs'
$null = New-Item -ItemType Directory -Path $logDir -Force
$logFile = Join-Path $logDir 'ensure-public.log'
# Roll at 5 MB, keeping one previous generation. At ~1 KB per healthy 10-minute tick that is
# months of history; the rotation exists so an error loop cannot fill the disk.
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 5MB) {
    Move-Item $logFile "$logFile.1" -Force
}
$script:exitCode = 0
function Write-Log {
    param([string]$Message, [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $logFile -Value $line
    Write-Host $line
    if ($Level -eq 'ERROR') { $script:exitCode = 1 }
}

# --- single instance ---------------------------------------------------------------------------
# The logon run can still be building an image when the 10-minute watchdog fires. Two concurrent
# `compose up` calls on one project race over the same containers, so the later one just leaves.
# MultipleInstances=IgnoreNew in the task covers the scheduler's own overlap; this also covers a
# hand-run copy in a terminal.
$mutex = New-Object System.Threading.Mutex($false, 'Global\CompCatEnsurePublic')
if (-not $mutex.WaitOne(0)) {
    Write-Log 'Another ensure-public run is in progress; exiting.'
    exit 0
}

try {
    $composeArgs = @(
        'compose', '-p', 'compcat-public',
        '-f', 'docker-compose.yml',
        '-f', 'docker-compose.prod.yml',
        '-f', 'docker-compose.tunnel.yml',
        '--profile', 'ops',
        '--env-file', '.env.tunnel'
    )
    function Compose { docker @composeArgs @args }

    if (-not (Test-Path '.env.tunnel')) {
        Write-Log 'Missing .env.tunnel - cannot start the public stack. See docs/DEPLOY-TUNNEL.md.' 'ERROR'
        exit 1
    }

    # --- 1. Docker engine ------------------------------------------------------------------
    # Docker Desktop cannot run as a Windows service; it needs this interactive session. That is
    # the whole reason the autostart is a logon-triggered task rather than a service.
    function Test-Docker { docker info *> $null; return ($LASTEXITCODE -eq 0) }

    # Orphaned-socket self-heal. This is not a hypothetical: it is what took compcat.app down for
    # ~2 days 19 hours across the 2026-08-13 reboot, and a watchdog that only restarts Docker
    # Desktop would have failed identically every 10 minutes forever.
    #
    # Docker Desktop's services each bind an AF_UNIX socket under %LOCALAPPDATA%. After an unclean
    # shutdown those socket files survive as 0-byte reparse points that Windows can no longer
    # touch: Remove-Item, `del` and `fsutil reparsepoint delete` all fail with error 1920, "The
    # file cannot be accessed by the system", and REBOOTING DOES NOT CLEAR THEM. Docker crashes at
    # startup because it cannot remove the stale socket before rebinding. Renaming the containing
    # directory is the only thing that works, and the directory is recreated on the next start.
    #
    # Every failed start leaves a fresh orphan behind, so the sweep has to cover all known socket
    # directories at once rather than the single one named in the newest crash.
    $backendLog = Join-Path $env:LOCALAPPDATA 'Docker\log\host\com.docker.backend.exe.log'
    $socketDirs = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@((Join-Path $env:LOCALAPPDATA 'Docker\run'), (Join-Path $env:LOCALAPPDATA 'docker-secrets-engine')),
        [System.StringComparer]::OrdinalIgnoreCase)

    function Repair-DockerSockets {
        param([datetime]$Since)
        $hits = Get-Content $backendLog -Tail 60 -ErrorAction SilentlyContinue |
            Select-String -SimpleMatch 'backend crashed'
        if (-not $hits) { return $false }
        $line = $hits[-1].Line
        $ts = ([regex]'\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]').Match($line)
        if (-not ($ts.Success -and [datetime]::Parse($ts.Groups[1].Value).ToUniversalTime() -gt $Since)) { return $false }
        $m = ([regex]'remove (<HOME>[^:]+?): The file cannot be accessed').Match($line)
        if (-not $m.Success) {
            Write-Log "Docker Desktop crashed for a reason other than a stale socket: $line" 'WARN'
            return $false
        }
        $null = $socketDirs.Add((Split-Path $m.Groups[1].Value.Replace('<HOME>', $env:USERPROFILE) -Parent))

        Get-Process 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 3
        $swept = $false
        foreach ($dir in @($socketDirs)) {
            if (-not (Test-Path $dir)) { continue }
            $contents = @(Get-ChildItem $dir -Force -Recurse -ErrorAction SilentlyContinue)
            if ($contents.Count -eq 0) { continue }
            # SAFETY: relocate only a directory holding nothing but zero-byte socket files. Never
            # move real data aside unattended.
            if ($contents | Where-Object { $_.PSIsContainer -or $_.Length -gt 0 }) {
                Write-Log "Not sweeping $dir - it holds real content, not just stale sockets." 'WARN'
                continue
            }
            $leaf = Split-Path $dir -Leaf
            $bak = '{0}.broken-{1}' -f $leaf, (Get-Date -Format 'yyyyMMdd-HHmmss')
            Rename-Item -LiteralPath $dir -NewName $bak
            $null = New-Item -ItemType Directory -Path $dir -Force
            Write-Log "Swept $($contents.Count) stale socket(s): $dir -> $bak" 'WARN'
            $swept = $true
        }
        return $swept
    }

    if (-not (Test-Docker)) {
        $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path $dd)) {
            Write-Log "Docker engine down and Docker Desktop not found at $dd." 'ERROR'
            exit 1
        }
        $ready = $false
        # Three passes: a clean start, then up to two stale-socket repairs.
        for ($pass = 1; $pass -le 3 -and -not $ready; $pass++) {
            $since = (Get-Date).ToUniversalTime()
            if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
                Write-Log "Docker engine down; starting Docker Desktop (pass $pass)..."
                Start-Process $dd | Out-Null
            }
            $deadline = (Get-Date).AddSeconds($DockerTimeoutSec)
            while ((Get-Date) -lt $deadline) {
                if (Test-Docker) { $ready = $true; break }
                # A crash report means waiting out the timeout is pointless.
                if (Repair-DockerSockets -Since $since) { break }
                Start-Sleep -Seconds 5
            }
            if (-not $ready -and (Test-Docker)) { $ready = $true }
        }
        if (-not $ready) {
            Write-Log "Docker engine did not become ready. Check $backendLog" 'ERROR'
            exit 1
        }
        Write-Log 'Docker engine ready.'
    }

    # --- 2. Public posture -----------------------------------------------------------------
    # The same gate start-public.ps1 applies, for the same reason and even more so: this path runs
    # unattended. A hand-edited .env.tunnel that switches personal uploads or the internal API tier
    # back on must never be published automatically at the next logon.
    python scripts\public\validate_public_env.py --mode tunnel .env.tunnel *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'Unsafe public posture in .env.tunnel; refusing to start. Run start-public.ps1 to see the validator output.' 'ERROR'
        exit 1
    }

    # --- 3. Containers ---------------------------------------------------------------------
    # No --build: an existing image is reused verbatim. Compose still builds if the image is
    # absent entirely (a first run, or after `docker system prune -a`), which is a bootstrap, not
    # a deploy - stamp it with the checkout revision so /health does not report an empty one.
    if (-not $env:BUILD_REVISION) {
        $rev = (git rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $rev) { $env:BUILD_REVISION = $rev.Trim() }
    }
    Compose up -d 2>&1 | ForEach-Object { Write-Log "compose: $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'compose up failed.' 'ERROR'
        exit 1
    }

    # --- 4. Application health -------------------------------------------------------------
    # Probed from INSIDE the api container: this stack publishes no host port at all.
    $healthy = $false
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" *> $null
        if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
        Start-Sleep -Seconds 5
    }
    if (-not $healthy) {
        Write-Log "API did not report healthy within ${HealthTimeoutSec}s. Check: compose logs api" 'ERROR'
        exit 1
    }

    # Report drift instead of acting on it. A checkout ahead of the running image is the normal
    # state between a `git pull` and the next deliberate deploy, not a fault.
    $served = (Compose exec -T api python -c "import json, urllib.request; print(json.load(urllib.request.urlopen('http://localhost:8000/health'))['revision'])" 2>$null)
    if ($served) { $served = "$served".Trim() }
    $head = (git rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $head) { $head = $head.Trim() } else { $head = $null }
    if ($served -and $head -and $served -ne $head) {
        Write-Log ("API healthy; serving {0} while the checkout is at {1}. Run start-public.ps1 to deploy the checkout." -f $served.Substring(0, 12), $head.Substring(0, 12))
    } else {
        Write-Log ('API healthy; serving revision {0}.' -f $(if ($served) { $served.Substring(0, [Math]::Min(12, $served.Length)) } else { 'unknown' }))
    }

    # --- 5. Public reachability ------------------------------------------------------------
    # The end-to-end proof, and the only check that catches a tunnel that is running but no longer
    # registered. Cloudflare answers 530 when the tunnel has no connection to this origin, which is
    # exactly the failure a healthy-looking local stack hides.
    if ($SkipExternalProbe) {
        Write-Log 'External probe skipped (-SkipExternalProbe).'
    } else {
        function Test-Public {
            try {
                $r = Invoke-WebRequest -Uri 'https://compcat.app/health' -TimeoutSec 25 -UseBasicParsing
                return ($r.StatusCode -eq 200)
            } catch { return $false }
        }
        if (Test-Public) {
            Write-Log 'compcat.app reachable (200 from /health).'
        } else {
            # Restart only cloudflared: the app is already known healthy, so the fault is in the
            # ingress. One restart, one re-probe - a watchdog that retries forever masks an outage
            # rather than surfacing it.
            Write-Log 'compcat.app not reachable although the API is healthy; restarting cloudflared.' 'WARN'
            Compose restart cloudflared *> $null
            Start-Sleep -Seconds 20
            if (Test-Public) {
                Write-Log 'compcat.app reachable after restarting cloudflared.'
            } else {
                Write-Log 'compcat.app still unreachable after restarting cloudflared. Check CLOUDFLARE_TUNNEL_TOKEN, the public-hostname route (compcat.app -> http://api:8000) in the Cloudflare dashboard, and: compose logs cloudflared' 'ERROR'
            }
        }
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}

exit $script:exitCode
