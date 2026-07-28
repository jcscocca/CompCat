#!/bin/sh
# Nightly logical backup of the CompCat database, run by the ops sidecar's crond at 03:40
# local time — half an hour after the ingest, so the dump contains the night's fresh data.
#
# pg_dump runs over the compose network against the db service (the prod overlay publishes no
# Postgres port), writes a custom-format archive into the "backups" named volume, and prunes to
# KEEP_DAILY archives plus KEEP_WEEKLY Sunday archives. Output goes to PID 1's stdout via the
# crontab redirect, i.e. `docker logs <stack>-ingest-cron-1`.
#
# Restore rehearsal (do it before launch, and after any Postgres upgrade): docs/DEPLOY-VPS.md.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}

log() {
    echo "[$(date "+%Y-%m-%dT%H:%M:%S%z")] backup-daily: $*"
}

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    log "POSTGRES_PASSWORD is not set — refusing to run (an unauthenticated pg_dump would"
    log "leave a truncated archive that looks like a backup and is not one)"
    exit 1
fi

mkdir -p "${BACKUP_DIR}" || {
    log "cannot create ${BACKUP_DIR} — refusing to run"
    exit 1
}

stamp="$(date "+%Y-%m-%d")"
archive="${BACKUP_DIR}/compcat-${stamp}.dump"
tmp="${archive}.partial"

log "dumping to ${archive}"
# Dump to a .partial name and rename on success, so an interrupted run never leaves a file
# that the pruning logic would count as a good backup.
if PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h db -U mca -d mca -Fc --no-owner -f "${tmp}"
then
    mv "${tmp}" "${archive}"
    log "ok ($(wc -c < "${archive}" | tr -d ' ') bytes)"
else
    status=$?
    rm -f "${tmp}"
    log "FAILED (pg_dump exit ${status}; error above)"
    exit "${status}"
fi

# Sunday's archive is additionally hard-linked under a weekly- name: same inode, no extra
# space, and pruning the dailies below cannot take the weekly set with it. Computing the
# weekday here (date +%u, 7 = Sunday) avoids parsing dates back out of filenames later.
if [ "$(date +%u)" = "7" ]; then
    ln -f "${archive}" "${BACKUP_DIR}/compcat-weekly-${stamp}.dump" \
        && log "linked weekly archive compcat-weekly-${stamp}.dump"
fi

# Prune. Daily names start with the year digit, so compcat-2*.dump never matches a
# compcat-weekly-* name; sort -r puts newest first because the stamps are ISO-8601.
prune() {
    pattern="$1"
    keep="$2"
    # shellcheck disable=SC2012 -- names are ISO-stamped, so they contain no shell metacharacters
    ls -1 "${BACKUP_DIR}"/${pattern} 2>/dev/null | sort -r | tail -n "+$((keep + 1))" \
        | while read -r stale; do
            rm -f "${stale}" && log "pruned $(basename "${stale}")"
        done
}

prune "compcat-2*.dump" "${KEEP_DAILY}"
prune "compcat-weekly-*.dump" "${KEEP_WEEKLY}"

log "done ($(ls -1 "${BACKUP_DIR}" | wc -l | tr -d ' ') archives retained)"
