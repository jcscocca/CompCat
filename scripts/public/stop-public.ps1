# Take the PUBLIC CompCat instance offline. Stopping cloudflared is what unpublishes
# compcat.app - the hostname keeps pointing at this tunnel and starts serving again the
# moment start-public.ps1 runs.
#
# Keeps every named volume (database, nightly backups). See docs/DEPLOY-TUNNEL.md for the
# deliberate `down -v` teardown.
#
#   pwsh -File scripts\public\stop-public.ps1
#
# Only touches the compcat-public project: the personal instance (compcat) is untouched,
# including its volume.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')  # repo root - the compose -f paths are repo-relative

Write-Host '== Stopping CompCat PUBLIC instance (project: compcat-public) =='
docker compose -p compcat-public `
    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml `
    --profile ops --env-file .env.tunnel down
if ($LASTEXITCODE -ne 0) { throw 'Public compose stop failed.' }

Write-Host 'Public instance stopped; compcat.app now shows Cloudflare''s origin-unreachable page.'
Write-Host 'Volumes kept: compcat-public_mca-postgres (database), compcat-public_backups (nightly dumps).'
Write-Host 'To wipe them too (irreversible): ... down -v'
