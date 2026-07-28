#!/bin/sh
# Nightly server-side retention sweep, run by the ops sidecar's crond at 03:50 local time —
# after the 03:40 backup, so every night's dump predates that night's deletions and a restore
# can still reach the swept rows.
#
# All the logic (window, FK-safe order, bounded batches) lives in the endpoint; this script
# only fires it over the compose network and makes a failure legible in `docker logs
# <stack>-ingest-cron-1`. The response is a JSON object of per-table row counts — no user
# data, nothing to redact.
set -u

API_BASE="${INGEST_API_BASE:-http://api:8000}"

log() {
    echo "[$(date "+%Y-%m-%dT%H:%M:%S%z")] retention-sweep: $*"
}

if [ -z "${MCA_ADMIN_INGEST_TOKEN:-}" ]; then
    log "MCA_ADMIN_INGEST_TOKEN is not set — refusing to run (an unauthenticated sweep is"
    log "rejected by the endpoint, which would look like a nightly no-op rather than a fault)"
    exit 1
fi

log "starting"
if curl -sS --fail-with-body --max-time 1800 -X POST \
    -H "X-Admin-Token: ${MCA_ADMIN_INGEST_TOKEN}" \
    "${API_BASE}/admin/maintenance/retention-sweep"
then
    echo ""
    log "ok"
else
    status=$?
    log "FAILED (curl exit ${status}; error above)"
    exit "${status}"
fi
