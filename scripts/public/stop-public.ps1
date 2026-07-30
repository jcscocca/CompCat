# Take the PUBLIC CompCat instance offline. Stopping cloudflared is what unpublishes
# compcat.app — the hostname keeps pointing at this tunnel and starts serving again the
# moment start-public.ps1 runs, unlike the demo's quick tunnel whose URL dies for good.
#
# Keeps every named volume (database, nightly backups). See docs/DEPLOY-TUNNEL.md for the
# deliberate `down -v` teardown.
#
#   pwsh -File scripts\public\stop-public.ps1
#
# Only touches the compcat-public project: the personal instance (compcat) and the demo
# (compcat-demo) are untouched, including their volumes.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')  # repo root — the compose -f paths are repo-relative

docker compose -p compcat-public `
    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml `
    --profile ops --env-file .env.tunnel down

Write-Host 'Public instance stopped; compcat.app now shows Cloudflare''s origin-unreachable page.'
Write-Host 'Volumes kept: compcat-public_mca-postgres (database), compcat-public_backups (nightly dumps).'
Write-Host 'To wipe them too (irreversible): ... down -v'
