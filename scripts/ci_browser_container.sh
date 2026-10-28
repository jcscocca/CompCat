#!/usr/bin/env bash
# CI-only browser gate. No public app, host port, HOME or browser cache is shared.
set -euo pipefail
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]]
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]
[[ "${GITHUB_JOB:-}" == frontend ]]
: "${RUNNER_TEMP:?}"
export COMPCAT_CI_IMAGE_TAG="compcat-ci-browser:$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cleanup_owned() {
set -euo pipefail
local cleanup_status=0
cidfile="$RUNNER_TEMP/compcat-ci-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.cid"
cid=
if [[ -s "$cidfile" ]]; then
  cid=$(cat "$cidfile")
fi
name="compcat-ci-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
if [[ -z "$cid" ]] && docker container inspect "$name" >/dev/null 2>&1; then
  cid=$(docker container inspect --format '{{.Id}}' "$name")
fi
if [[ -n "$cid" ]]; then
  [[ "$cid" =~ ^[0-9a-f]{64}$ ]]
  if docker inspect "$cid" >/dev/null 2>&1; then
    test "$(docker inspect --format '{{index .Config.Labels "compcat.ci.run"}}' "$cid")" = "$GITHUB_RUN_ID"
    test "$(docker inspect --format '{{index .Config.Labels "compcat.ci.attempt"}}' "$cid")" = "$GITHUB_RUN_ATTEMPT"
    test "$(docker inspect --format '{{index .Config.Labels "compcat.ci.kind"}}' "$cid")" = browser
    docker stop --time 3 "$cid" >/dev/null || true
    out="$RUNNER_TEMP/compcat-ci-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    export COMPCAT_CI_OUT="$out"
    if python3 "$source_root/scripts/ci_browser_storage.py" verify >/dev/null; then
      docker inspect --format '{{json .State}}' "$cid" > "$out/container-state.json"
      if [[ ! -e "$out/report.json" ]]; then docker cp "$cid:/work/frontend/ci-browser-report.json" "$out/report.json" >/dev/null 2>&1 || true; fi
      if [[ ! -e "$out/inventory.json" ]]; then docker cp "$cid:/work/frontend/ci-browser-inventory.json" "$out/inventory.json" >/dev/null 2>&1 || true; fi
      if [[ ! -e "$out/test-results" ]]; then docker cp "$cid:/work/frontend/test-results" "$out/test-results" >/dev/null 2>&1 || true; fi
    else
      cleanup_status=1
      printf '%s\n' 'Refusing invalid diagnostics; continuing owned Docker cleanup.' >&2
    fi
    docker rm -f "$cid" >/dev/null
    printf 'COMPCAT_BROWSER_CONTAINER_REMOVED %s\n' "$cid"
  fi
fi
if docker image inspect "$COMPCAT_CI_IMAGE_TAG" >/dev/null 2>&1; then
  test "$(docker image inspect --format '{{index .Config.Labels "compcat.ci.run"}}' "$COMPCAT_CI_IMAGE_TAG")" = "$GITHUB_RUN_ID"
  test "$(docker image inspect --format '{{index .Config.Labels "compcat.ci.attempt"}}' "$COMPCAT_CI_IMAGE_TAG")" = "$GITHUB_RUN_ATTEMPT"
  test "$(docker image inspect --format '{{index .Config.Labels "compcat.ci.kind"}}' "$COMPCAT_CI_IMAGE_TAG")" = browser
  docker image rm "$COMPCAT_CI_IMAGE_TAG" >/dev/null
  printf 'COMPCAT_BROWSER_IMAGE_TAG_REMOVED %s\n' "$COMPCAT_CI_IMAGE_TAG"
fi
if python3 "$source_root/scripts/ci_browser_storage.py" remove; then
  printf 'COMPCAT_BROWSER_DIAGNOSTICS_REMOVED %s-%s\n' "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
else
  cleanup_status=1
  printf '%s\n' 'Refusing invalid diagnostics; the paths have been preserved.' >&2
fi
return "$cleanup_status"
}
if [[ "${1:-run}" == cleanup ]]; then cleanup_owned; exit; fi
[[ "${1:-run}" == run ]]
cd "$source_root"
export COMPCAT_CI_SOURCE_SHA=$(git rev-parse HEAD)
[[ "$COMPCAT_CI_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
python3 - <<'PY'
import json
from pathlib import Path
lock = json.loads(Path('frontend/package-lock.json').read_text())
assert lock['packages']['node_modules/@playwright/test']['version'] == '1.63.0'
assert lock['packages']['node_modules/playwright-core']['version'] == '1.63.0'
PY
trap cleanup_owned EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
timeout --signal=TERM 15m docker build --platform linux/amd64 --file ci/browser.Dockerfile \
  --build-arg "COMPCAT_CI_RUN_ID=$GITHUB_RUN_ID" --build-arg "COMPCAT_CI_ATTEMPT=$GITHUB_RUN_ATTEMPT" \
  --tag "$COMPCAT_CI_IMAGE_TAG" .
set -euo pipefail
umask 077
out=$(python3 "$source_root/scripts/ci_browser_storage.py" prepare)
printf 'COMPCAT_BROWSER_EVIDENCE %s\n' "$out"
cidfile="$RUNNER_TEMP/compcat-ci-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.cid"
trap cleanup_owned EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker run --detach --cidfile "$cidfile" \
  --name "compcat-ci-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --label compcat.ci.kind=browser \
  --label "compcat.ci.run=$GITHUB_RUN_ID" --label "compcat.ci.attempt=$GITHUB_RUN_ATTEMPT" \
  --label "compcat.ci.source=$COMPCAT_CI_SOURCE_SHA" \
  --init --cpus 2 --memory 8g --memory-swap 8g --shm-size 2g --ipc private --network none \
  --pids-limit 512 --cap-drop ALL --security-opt no-new-privileges=true \
  --tmpfs /home/probe:rw,nosuid,nodev,size=512m,uid=1001,gid=1001 \
  --tmpfs /tmp:rw,nosuid,nodev,size=2g,mode=1777 \
  --env HOME=/home/probe --env TMPDIR=/tmp/probe --env TMP=/tmp/probe --env TEMP=/tmp/probe \
  --env "COMPCAT_CI_OWNER_RUN=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --env PLAYWRIGHT_JSON_OUTPUT_FILE=/work/frontend/ci-browser-report.json \
  "$COMPCAT_CI_IMAGE_TAG"
cid=$(cat "$cidfile")
export COMPCAT_CI_CID="$cid" COMPCAT_CI_OUT="$out"
python3 - <<'PY'
import json
import os
from pathlib import Path
import subprocess
info = json.loads(subprocess.check_output(['docker', 'inspect', os.environ['COMPCAT_CI_CID']]))[0]
host = info['HostConfig']
assert host['NanoCpus'] == 2_000_000_000 and host['Memory'] == 8 * 1024**3
assert host['MemorySwap'] == 8 * 1024**3 and host['ShmSize'] == 2 * 1024**3
assert host['IpcMode'] == 'private' and host['NetworkMode'] == 'none' and host['Init'] is True
assert not host.get('PortBindings') and not host.get('Binds') and not host['Privileged']
assert set(host['Tmpfs']) == {'/home/probe', '/tmp'}
assert info['Config']['User'] == 'pwuser'
assert not any(value.split('=', 1)[0] in {'GITHUB_TOKEN', 'GH_TOKEN', 'ACTIONS_RUNTIME_TOKEN'} for value in info['Config']['Env'])
proof = {'run_id': os.environ['GITHUB_RUN_ID'], 'attempt': os.environ['GITHUB_RUN_ATTEMPT'],
    'repository': 'jcscocca/CompCat', 'job': os.environ['GITHUB_JOB'],
    'source_sha': os.environ['COMPCAT_CI_SOURCE_SHA'], 'container_id': info['Id'], 'hostname': info['Config']['Hostname'],
    'image_id': info['Image'], 'limits': {key: host[key] for key in ('NanoCpus', 'Memory', 'MemorySwap', 'ShmSize', 'IpcMode', 'NetworkMode', 'Init', 'Tmpfs')},
    'published_ports': host.get('PortBindings'), 'host_binds': host.get('Binds')}
(Path(os.environ['COMPCAT_CI_OUT']) / 'isolation.json').write_text(json.dumps(proof, indent=2) + '\n')
print('COMPCAT_BROWSER_ISOLATION ' + json.dumps(proof))
PY
docker logs --follow "$cid" 2>&1 | tee "$out/container.log" &
log_pid=$!
(
  while [[ "$(docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null || true)" == true ]]; do
    docker stats --no-stream --format '{{json .}}' "$cid" >> "$out/stats.jsonl" || true
    sleep 2
  done
) &
stats_pid=$!
docker wait "$cid" > "$out/exit-code.txt" &
wait_pid=$!
wait "$wait_pid"
wait "$log_pid" || true
wait "$stats_pid" || true
docker inspect --format '{{json .State}}' "$cid" > "$out/container-state.json"
docker cp "$cid:/work/frontend/ci-browser-report.json" "$out/report.json" || true
docker cp "$cid:/work/frontend/ci-browser-inventory.json" "$out/inventory.json" || true
docker cp "$cid:/work/frontend/test-results" "$out/test-results" || true
result=$(cat "$out/exit-code.txt")
[[ "$result" =~ ^[0-9]+$ ]]
if [[ "$result" != 0 ]]; then exit "$result"; fi
python3 scripts/ci_browser_report.py "$out/inventory.json" "$out/report.json" "$out/container-state.json" "$out/container.log"
