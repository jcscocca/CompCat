#!/bin/sh
# Run in an isolated ops image, with /source pointing to deploy/ and no network.
set -eu
mkdir -p /tmp/ops-mocks /tmp/test-backups
export PATH="/tmp/ops-mocks:$PATH"
cat > /tmp/ops-mocks/curl <<'MOCK'
#!/bin/sh
echo called >> /tmp/curl-calls
exit "${MOCK_CURL_STATUS:-0}"
MOCK
cat > /tmp/ops-mocks/pg_dump <<'MOCK'
#!/bin/sh
while [ "$#" -gt 0 ]; do
    if [ "$1" = -f ]; then shift; printf 'mock archive' > "$1"; exit 0; fi
    shift
done
exit 1
MOCK
cat > /tmp/ops-mocks/rm <<'MOCK'
#!/bin/sh
echo 'Unexpected deletion in smoke test' >&2
touch /tmp/unexpected-delete
exit 99
MOCK
chmod +x /tmp/ops-mocks/*
unset MCA_ADMIN_INGEST_TOKEN POSTGRES_PASSWORD
for name in ingest-daily backup-daily retention-sweep; do
    sh -n "/source/$name.sh"
    if sh "/source/$name.sh"; then echo 'Missing credential guard failed'; exit 1;
    else [ "$?" = 1 ]; fi
done
[ ! -e /tmp/curl-calls ]
export MCA_ADMIN_INGEST_TOKEN=test-only POSTGRES_PASSWORD=test-only
sh /source/ingest-daily.sh
[ "$(wc -l < /tmp/curl-calls)" -eq 3 ]
sh /source/retention-sweep.sh
[ "$(wc -l < /tmp/curl-calls)" -eq 4 ]
BACKUP_DIR=/tmp/test-backups sh /source/backup-daily.sh
[ "$(cat /tmp/test-backups/compcat-*.dump)" = 'mock archive' ]
[ ! -e /tmp/unexpected-delete ]
export MOCK_CURL_STATUS=22
if sh /source/ingest-daily.sh; then exit 1; else [ "$?" = 1 ]; fi
[ "$(wc -l < /tmp/curl-calls)" -eq 7 ]
if sh /source/retention-sweep.sh; then exit 1; else [ "$?" = 22 ]; fi
echo 'Ops syntax, credential guards, three-source ingestion, retention and backup smoke passed'
