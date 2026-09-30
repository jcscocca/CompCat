#!/bin/sh
# Exercise the built image's locked runtime and normal migration/server command.
# No host ports, volumes, credentials, or deployment configuration are needed.
set -eu

image=${1:?Usage: sh scripts/smoke-production-image.sh IMAGE}
container="compcat-image-smoke-$$"

docker run --rm --entrypoint python "$image" -c '
import os, sys
assert sys.version_info[:2] == (3, 14), sys.version
assert os.getuid() != 0, "production runtime must be unprivileged"
import alembic, anthropic, defusedxml, fastapi, greenlet, httpx, multipart, openai
import pydantic, pydantic_settings, psycopg, shapely, sqlalchemy, uvicorn
import app.main
print("Python 3.14 locked runtime imports passed")
'

started=false
cleanup() {
  if [ "$started" = true ]; then
    docker rm --force "$container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
docker run --name "$container" --detach \
  --env MCA_DATABASE_URL=sqlite+pysqlite:////tmp/compcat-smoke.sqlite3 \
  "$image" >/dev/null
started=true

attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$container" python -c '
import json, sqlite3
from urllib.request import urlopen
from alembic.config import Config
from alembic.script import ScriptDirectory

with urlopen("http://127.0.0.1:8000/health", timeout=2) as response:
    assert response.status == 200
    health = json.load(response)
assert health["status"] == "ok", health
with sqlite3.connect("/tmp/compcat-smoke.sqlite3") as database:
    applied = {row[0] for row in database.execute("SELECT version_num FROM alembic_version")}
expected = set(ScriptDirectory.from_config(Config("alembic.ini")).get_heads())
assert applied == expected, (applied, expected)
print(json.dumps({"health": health, "migration_heads": sorted(applied)}))
' 2>/dev/null; then
    exit 0
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != true ]; then
    docker logs "$container"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "Production image did not become healthy at the migration head" >&2
docker logs "$container"
exit 1
