# Make the public CompCat instance (compcat.app) come back on its own, so the ThinkPad being on
# is all it takes to keep the site up.
#
#   pwsh -File scripts\public\install-public-autostart.ps1            # install / re-install
#   pwsh -File scripts\public\install-public-autostart.ps1 -Uninstall # remove
#
# No elevation needed: the task is registered under the current user only.
# Runbook: docs/DEPLOY-TUNNEL.md section 9.
#
# WHAT IT INSTALLS - a Scheduled Task, deliberately NOT a Windows service:
#
#   Docker Desktop on Windows cannot run as a service. It needs an interactive user session, so
#   anything that drives it must run inside one too. A task with an at-logon trigger is therefore
#   the strongest honest guarantee available here, and the limit is worth stating plainly: the
#   site returns when this user signs in, NOT at the login screen. An unattended reboot (a
#   Windows Update at 03:00) leaves compcat.app down until the next sign-in.
#
# Three pieces, because a single trigger is not enough:
#
#   1. Docker Desktop's own autostart entry - without the engine nothing else can work.
#   2. An at-logon trigger with a delay, which does the initial bring-up.
#   3. A repeating trigger every N minutes: the watchdog. It is what covers everything a logon
#      trigger structurally cannot - Docker Desktop crashing or being quit, the tunnel dropping
#      its registration, a `compose down` someone forgot to undo, or a resume from sleep that
#      left the stack half-alive. Both triggers run the same idempotent ensure-public.ps1.
param(
    [switch]$Uninstall,
    [int]$WatchdogMinutes = 10,
    # Docker Desktop is itself starting at this point; ensure-public.ps1 waits for the engine
    # anyway, so this delay only avoids a pointless first attempt during the logon storm.
    [int]$LogonDelayMinutes = 2
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$taskName = 'CompCat public site'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed the '$taskName' scheduled task."
    } else {
        Write-Host "No '$taskName' scheduled task registered."
    }
    Write-Host 'Docker Desktop autostart and the running containers were left alone.'
    Write-Host 'To take the site down as well: pwsh -File scripts\public\stop-public.ps1'
    return
}

$ensure = Join-Path $repo 'scripts\public\ensure-public.ps1'
if (-not (Test-Path $ensure)) { throw "Missing $ensure" }
if (-not (Test-Path (Join-Path $repo '.env.tunnel'))) {
    throw 'Missing .env.tunnel - deploy the public instance with start-public.ps1 before installing the autostart.'
}

# PowerShell 7. Windows PowerShell 5.1 would do for this script, but ensure-public.ps1 is written
# for pwsh and the runbook's commands assume it.
$pwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwshExe) { $pwshExe = 'C:\Program Files\PowerShell\7\pwsh.exe' }
if (-not (Test-Path $pwshExe)) { throw 'PowerShell 7 (pwsh) not found; install it before registering the task.' }

Write-Host '== CompCat public autostart =='
Write-Host "Repo: $repo"

# --- 1. Docker Desktop autostart ---------------------------------------------------------------
# The Run key is the mechanism Docker Desktop's own "Start Docker Desktop when you sign in"
# setting writes. Assert it rather than assume it: a Docker Desktop reinstall or a settings reset
# silently drops it, and the failure mode is a site that never comes back after a reboot.
$runKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
$dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (Test-Path $dockerExe) {
    $existing = (Get-ItemProperty -Path $runKey -Name 'Docker Desktop' -ErrorAction SilentlyContinue).'Docker Desktop'
    if ($existing) {
        Write-Host 'Docker Desktop autostart: already enabled.'
    } else {
        Set-ItemProperty -Path $runKey -Name 'Docker Desktop' -Value $dockerExe
        Write-Host 'Docker Desktop autostart: enabled.'
    }
} else {
    Write-Warning "Docker Desktop not found at $dockerExe - the autostart cannot work without it."
}

# --- 2. The task -------------------------------------------------------------------------------
$action = New-ScheduledTaskAction -Execute $pwshExe -WorkingDirectory $repo `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $ensure)

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME)
$logonTrigger.Delay = 'PT{0}M' -f $LogonDelayMinutes

# The watchdog. Start time is in the past so the first repetition is due immediately on
# registration; an omitted RepetitionDuration means "repeat forever".
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(-1) `
    -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes)

# Interactive: the task must land in the desktop session, because that is where Docker Desktop
# lives. RunLevel Limited keeps it out of UAC - nothing here needs administrator.
$principal = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) `
    -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
# A laptop lid-close is the common case, so the stack must not be torn down on idle; and an
# hour-long first build must not be killed halfway.
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
$settings.IdleSettings.StopOnIdleEnd = $false

$task = New-ScheduledTask -Action $action -Trigger @($logonTrigger, $watchdogTrigger) `
    -Principal $principal -Settings $settings `
    -Description 'Keeps the public CompCat instance (compcat.app) running: brings the compcat-public Docker stack up at logon and re-checks it every few minutes. Supervisor only - it never deploys new code. See docs/DEPLOY-TUNNEL.md.'

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

Write-Host ''
Write-Host ("Task '{0}' registered:" -f $taskName)
Write-Host ("  at logon        +{0} min" -f $LogonDelayMinutes)
Write-Host ("  watchdog        every {0} min" -f $WatchdogMinutes)
Write-Host ("  runs            {0}" -f $ensure)
Write-Host ("  log             {0}" -f (Join-Path $env:LOCALAPPDATA 'CompCat\logs\ensure-public.log'))

# --- 3. Power ----------------------------------------------------------------------------------
# A sleeping laptop is an offline site: S0 modern standby keeps the network card alive but Docker
# is suspended with everything else, so compcat.app answers 530. Only the plugged-in setting is
# forced - draining the battery to serve a hobby site is not a trade worth making silently.
$acSleep = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC Power Setting Index').ToString()
if ($acSleep -notmatch '0x00000000') {
    powercfg /change standby-timeout-ac 0
    Write-Host 'Power: sleep-on-AC disabled (was set to sleep; the site would have gone offline).'
} else {
    Write-Host 'Power: sleep-on-AC already disabled.'
}
Write-Host 'Power: on battery the ThinkPad still sleeps, and the site is down while it does.'

Write-Host ''
Write-Host 'Limit worth remembering: this returns the site at SIGN-IN, not at the login screen.'
Write-Host 'After an unattended reboot compcat.app stays down until you log in.'
Write-Host ''
Write-Host '  run now:   Start-ScheduledTask -TaskName ''CompCat public site'''
Write-Host '  history:   Get-Content "$env:LOCALAPPDATA\CompCat\logs\ensure-public.log" -Tail 30'
Write-Host '  remove:    pwsh -File scripts\public\install-public-autostart.ps1 -Uninstall'
