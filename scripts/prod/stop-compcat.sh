#!/usr/bin/env bash
# Stop the public CompCat instance. Keeps every named volume (database, TLS certificates,
# backups) — see docs/DEPLOY-VPS.md for the deliberate `down -v` teardown.
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root — the compose -f paths are repo-relative

ENV_FILE="${ENV_FILE:-.env.prod}"

echo "== Stopping CompCat PUBLIC VPS instance =="
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    --profile ops --env-file "${ENV_FILE}" down

echo "Stopped. Volumes kept: database, Caddy certificates, backups."
echo "To wipe them too (irreversible): ... down -v"
