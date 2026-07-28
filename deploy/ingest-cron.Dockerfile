# Nightly ops sidecar (docker-compose.prod.yml, "ops" profile): SPD ingest at 03:10, a
# pg_dump backup at 03:40 and the retention sweep at 03:50. Alpine + curl for a readable
# failure cause in `docker logs`,
# + tzdata because musl silently resolves an unknown TZ name to UTC — which would drift the
# runs across DST — + postgresql16-client, whose major must match the postgres:16 server in
# docker-compose.yml (pg_dump refuses to dump a newer server than itself).
#
# This image deliberately stays root, unlike the app image (which drops to appuser).
# busybox crond runs each job as the user named by its crontab file and needs privileges
# to do it; both non-root arrangements were tried and neither works:
#   - USER nobody + /etc/crontabs/root: crond starts, then silently never fires a job —
#     the worst failure mode, since the nightly ingest would stop with no error anywhere;
#   - USER nobody + /etc/crontabs/nobody: crond logs "root: Permission denied" and no
#     job runs either.
# Independently, nobody cannot write the root-owned "backups" volume, so the nightly
# pg_dump would fail even if crond cooperated. The container publishes no ports and makes
# only outbound calls (Socrata via the api, pg_dump over the compose network), so root
# here buys an attacker nothing that reaching the container did not already.
FROM alpine:3.24
RUN apk add --no-cache curl tzdata postgresql16-client
