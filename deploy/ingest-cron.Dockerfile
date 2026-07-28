# Nightly SPD ingest sidecar (docker-compose.prod.yml, "ops" profile). Alpine + curl for a
# readable failure cause in `docker logs`, + tzdata because musl silently resolves an unknown
# TZ name to UTC — which would drift the 03:10 America/Los_Angeles run across DST.
FROM alpine:3.22
RUN apk add --no-cache curl tzdata
