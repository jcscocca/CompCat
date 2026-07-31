# Stop the PERSONAL ThinkPad CompCat instance.
#
# This only touches compose project `compcat`. It does not stop or remove:
#   - compcat-public (persistent compcat.app named tunnel)
#   - the personal Postgres volume (`compcat_mca-postgres`)
#
# The host-side llama-swap process is left running by default because it may be serving
# another local client. Supply -StopAnalyst when you also want that process stopped.
#
#   pwsh -File scripts\stop-compcat.ps1
#   pwsh -File scripts\stop-compcat.ps1 -StopAnalyst
param(
    [switch]$StopAnalyst
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$composeArgs = @(
    'compose', '-p', 'compcat',
    '-f', 'docker-compose.yml'
)

Set-Location $repo
Write-Host '== Stopping CompCat PERSONAL instance (project: compcat) =='

docker @composeArgs down
if ($LASTEXITCODE -ne 0) { throw 'Personal compose stop failed.' }
Write-Host 'Personal app stopped. Database kept: compcat_mca-postgres.'

if ($StopAnalyst) {
    $analyst = Get-Process llama-swap -ErrorAction SilentlyContinue
    if ($analyst) {
        $analyst | Stop-Process
        Write-Host 'Analyst stopped: llama-swap.'
    } else {
        Write-Host 'Analyst was not running.'
    }
} elseif (Get-Process llama-swap -ErrorAction SilentlyContinue) {
    Write-Host 'Analyst is still running. Re-run with -StopAnalyst to stop llama-swap too.'
}
