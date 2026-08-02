#!/bin/sh
# Triggers the app's existing admin Socrata ingest once per layer, sequentially. All the hard
# parts (floor-clamped watermark overlap, paging, retry/backoff, rolling-window purge) live in
# the endpoint; this
# script only fires it and makes failures legible in `docker logs`.
#
# Sequential on purpose: overlapping Socrata paging loops would fight for the same rate limit.
# Each layer runs even if an earlier one failed, and a failing layer is reported without
# retrying here (the endpoint already retries; /health/data is the alert path if data ages).
set -u

API_BASE="${INGEST_API_BASE:-http://api:8000}"
PAGE_LIMIT="${INGEST_PAGE_LIMIT:-5000}"

log() {
    echo "[$(date "+%Y-%m-%dT%H:%M:%S%z")] ingest-cron: $*"
}

if [ -z "${MCA_ADMIN_INGEST_TOKEN:-}" ]; then
    log "MCA_ADMIN_INGEST_TOKEN is not set — refusing to run"
    exit 1
fi

status=0
for source in seattle_spd_crime seattle_spd_arrests seattle_spd_911; do
    log "${source}: starting"
    if curl -sS --fail-with-body --max-time 3600 -X POST \
        -H "X-Admin-Token: ${MCA_ADMIN_INGEST_TOKEN}" \
        "${API_BASE}/admin/crime/ingest/socrata?source=${source}&mode=backfill&limit=${PAGE_LIMIT}"
    then
        echo ""
        log "${source}: ok"
    else
        status=1
        log "${source}: FAILED (curl error above)"
    fi
done

exit "${status}"
