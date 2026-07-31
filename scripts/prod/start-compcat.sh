#!/usr/bin/env bash
# Bring up the public CompCat VPS instance (https://compcat.app) and refresh SPD data if
# it is stale. This is the LINUX/VPS launcher, not a ThinkPad script. Idempotent:
# re-running is the normal way to deploy a new commit.
#
#   compose files  docker-compose.yml + docker-compose.prod.yml
#   env file       .env.prod
#   ingress        Caddy on host :80/:443
#   data           VPS-local Postgres + nightly backup volume
#   updates        current checkout; run git pull separately
#
#   scripts/prod/start-compcat.sh
#
# Runbook: docs/DEPLOY-VPS.md. Caddy is the ingress and comes up with the stack.
set -euo pipefail

# Resolve everything against the repo root no matter where this is invoked from (the
# compose -f paths and .env.prod are repo-relative).
cd "$(dirname "$0")/../.."

ENV_FILE="${ENV_FILE:-.env.prod}"
FRESHNESS_MAX_AGE_DAYS="${FRESHNESS_MAX_AGE_DAYS:-14}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-300}"

if [ ! -f "${ENV_FILE}" ]; then
    echo "Missing ${ENV_FILE} — copy .env.prod.example and fill in real values." >&2
    exit 1
fi

compose() {
    docker compose -f docker-compose.yml -f docker-compose.prod.yml \
        --profile ops --env-file "${ENV_FILE}" "$@"
}

echo "== CompCat PUBLIC VPS instance =="
echo "Exposure: https://compcat.app via Caddy :80/:443 | personal uploads OFF"
echo "Source: current checkout (this script does not pull)"
echo "Starting the production stack (db, api, caddy, ops sidecar)..."
compose up -d --build

echo "Waiting for /health..."
# The prod overlay publishes no app port — Caddy is the only ingress — so probe the api from
# inside its own container, with the same one-liner the compose healthcheck uses.
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
until compose exec -T api python -c \
    "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" >/dev/null 2>&1
do
    if [ "$(date +%s)" -ge "${deadline}" ]; then
        echo "API did not become healthy in ${HEALTH_TIMEOUT_S}s — check: compose logs api" >&2
        exit 1
    fi
    sleep 5
done
echo "API healthy."

# Refresh SPD data if stale. /dashboard/freshness is session-scoped, so mint one first; a
# null data_through (fresh database, first run) counts as maximally stale.
freshness_report="$(compose exec -T api python - "${FRESHNESS_MAX_AGE_DAYS}" <<'PY'
import datetime, http.cookiejar, json, sys, urllib.request

max_age_days = int(sys.argv[1])
base = "http://localhost:8000"
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)
opener.open(urllib.request.Request(base + "/sessions", method="POST")).read()
layers = json.load(opener.open(base + "/dashboard/freshness"))
data_through = (layers.get("reported") or {}).get("data_through")
try:
    age_days = (datetime.date.today() - datetime.date.fromisoformat(data_through)).days
except (TypeError, ValueError):
    age_days = None
verdict = "stale" if age_days is None or age_days > max_age_days else "fresh"
print(f"{verdict} {data_through or 'none'} {age_days if age_days is not None else '-'}")
PY
)"
read -r verdict data_through age_days <<< "${freshness_report}"

if [ "${verdict}" = "stale" ]; then
    echo "Reported data through ${data_through} (age: ${age_days} days) — ingesting..."
    # The ops sidecar already carries the admin token, curl, and the per-layer loop; running
    # its nightly script by hand keeps the bring-up path and the cron path identical.
    compose exec -T ingest-cron /bin/sh /etc/ingest/run.sh
else
    echo "Reported data through ${data_through} (age: ${age_days} days) — fresh enough."
fi

echo ""
compose ps
cat <<'EOF'

CompCat is up.
  https://compcat.app/             public site (TLS via Caddy; first issuance takes ~30s)
  https://compcat.app/health       readiness probe
  https://compcat.app/health/data  data-recency probe — point the uptime monitor here

  logs:   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile ops --env-file .env.prod logs -f
  stop:   scripts/prod/stop-compcat.sh
EOF
