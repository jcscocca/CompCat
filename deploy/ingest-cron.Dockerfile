# Nightly ops sidecar (docker-compose.prod.yml, "ops" profile): SPD ingest at 03:10 and a
# pg_dump backup at 03:40. Alpine + curl for a readable failure cause in `docker logs`,
# + tzdata because musl silently resolves an unknown TZ name to UTC — which would drift the
# runs across DST — + postgresql16-client, whose major must match the postgres:16 server in
# docker-compose.yml (pg_dump refuses to dump a newer server than itself).
FROM alpine:3.22
RUN apk add --no-cache curl tzdata postgresql16-client
