# Public instance — Slice 4 (VPS bring-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship everything the repo owes a fresh Ubuntu box so that one operator, following one
document, can take CompCat from "empty VPS" to "TLS-terminated, rate-limited, nightly-ingested,
nightly-backed-up public instance at **https://compcat.app**" — and can rehearse the restore and
tear the whole thing down again. Repo-side only: the plan ends with everything committed and
`make test-all` green; the box itself is brought up by the operator afterwards.

**Architecture:** Six additive pieces plus two doc updates, all independent of each other.
(1) A Caddy service in the prod overlay owning 80/443 (+443/udp), with `ports: !reset []` moving to
the `api` service so Caddy is the *only* ingress — the same `!reset` mechanic slice 1 proved on `db`.
(2) A three-line `deploy/Caddyfile`. (3) `client_ip_from` in `app/ratelimit.py` grows one more
trusted-header step (CF-Connecting-IP → leftmost `X-Forwarded-For` → socket peer), shared by the
sessions route and the burst middleware. (4) `.env.prod.example` — the whole production posture in
one reviewable file. (5) `scripts/prod/start-compcat.sh` / `stop-compcat.sh`, bash mirrors of the
demo PowerShell pair, reusing the slice-3 sidecar for the ingest leg. (6) The slice-3 ops sidecar
gains `postgresql16-client`, a second crontab line at 03:40 and `deploy/backup-daily.sh` writing
date-stamped `pg_dump -Fc` archives into a `backups` named volume with 7-daily/4-weekly rotation.
(7) A `transformIndexHtml` hook in `frontend/vite.config.ts` that absolutizes the OG/Twitter image
URLs and adds `og:url` when `VITE_CANONICAL_ORIGIN` is set at build time. (8) `docs/DEPLOY-VPS.md`
plus cross-links and a ROADMAP tick. No product copy anywhere.

**Tech Stack:** Docker Compose v2 overlay merge + profiles (v5.1.4 on this Mac), Caddy 2 (automatic
Let's Encrypt), alpine/busybox `crond` + `pg_dump`/`pg_restore` 16, bash 5 (the scripts target the
Ubuntu box), FastAPI + pytest (`.venv/bin/python -m pytest`), ruff (line-length 100,
`select = ["E", "F", "I", "UP", "B"]`), Vite 7 + vitest 3.

**Working context:** Worktree `/Users/jscocca/Repos/compcat/.worktrees/p8-slice4-vps-bringup`, branch
`p8-slice4-vps-bringup` (cut from `origin/main` at `177b924`, which contains slices 1–3). Spec:
`docs/superpowers/specs/2026-07-27-public-instance-slice4-vps-bringup-design.md` (committed at
`8bc57c5`, decision-complete — do not re-open decisions). **The domain is decided: `compcat.app`,
canonical origin `https://compcat.app`** — write it literally, no placeholder. Gate: `make test-all`
from the worktree root. **Prerequisite:** run `make install` and `cd frontend && npm install` once
before Task 1. Every backend test command below is `.venv/bin/python -m pytest ...`; the `pytest`
shebang in the venv is stale, so never invoke bare `pytest`.

**Invariant (do not break):** this slice adds **no product copy at all** — no new user-facing string
reaches a browser. The runbook, the Caddyfile, the scripts and every `.env.prod.example` comment are
operator-facing, and they must avoid place-safety vocabulary entirely (`safe`, `unsafe`, `safety`,
`danger`, `dangerous`, `risk`, `risky`) so no copy guard can ever trip on them. Say "reported
incident context", "data recency", "request limits". The one *rendered* change is the OG/Twitter
`content` attributes becoming absolute — same strings, absolute paths; `index.html` itself is not
edited, so `frontend/tests/indexHtml.test.ts` (including its external-host guard) stays untouched
and green.

---

## Verified wire facts this plan relies on

Read (and, where marked **verified by running it**, executed) from this worktree at plan time.

**Rate limiter (`app/ratelimit.py`)**
- `client_ip_from(request, *, trust_proxy_headers)` (`app/ratelimit.py:108-114`) is the whole trusted-
  header path today: `if trust_proxy_headers:` → `request.headers.get("cf-connecting-ip")` → else
  `getattr(request.client, "host", None) or "unknown"`. Its only caller is
  `app/api/routes_sessions.py:30`.
- `BurstLimitMiddleware.__call__` re-implements the same decision on the raw ASGI scope
  (`app/ratelimit.py:175-183`): it builds `headers` as a **lowercased latin-1 dict** from
  `scope["headers"]`, then `if settings.trust_proxy_headers and headers.get("cf-connecting-ip")` →
  header, `elif scope.get("client")` → `scope["client"][0]`, else `"unknown"`. Both call sites must
  gain the `X-Forwarded-For` step or the two tiers would key on different IPs.
- Existing tests to sit beside: `tests/test_ratelimit.py:45-52`
  (`test_client_ip_ignores_header_without_trust`, `test_client_ip_uses_header_with_trust`) with a
  `FakeRequest` whose `headers` is a plain **lowercase-keyed dict** (`:7-10`) — so the new helper must
  index lowercase names, not rely on Starlette's case-insensitive mapping.
- Middleware-level equivalents: `tests/test_ratelimit_api.py:32-45`
  (`test_spoofed_proxy_header_ignored_without_trust`) and `:48-58`
  (`test_trusted_proxy_header_separates_clients`), both driving `POST /sessions` with
  `MCA_RATE_LIMIT_SESSIONS_PER_HOUR` set low and `client.cookies.clear()` between mints. Note the
  session tier is enforced in the route via `client_ip_from`, so these exercise **that** path; the
  burst tier is exercised by `test_burst_limit_on_api_routes` (`:102-109`).
- `reset_rate_limiter()` is autouse per test (`tests/conftest.py:36-40`), so buckets never leak.
- Config knob: `trust_proxy_headers: bool = False` (`app/config.py:112`), comment above it
  (`:110-111`) currently names only CF-Connecting-IP and cloudflared — it needs one clause about
  the Caddy hop.

**Prod overlay as merged (`docker-compose.prod.yml`, 58 lines)**
- `db`: `ports: !reset []` (`:16`), `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?…}` (`:18`),
  `restart: unless-stopped` (`:19`).
- `api`: `MCA_DATABASE_URL: ${MCA_DATABASE_URL:?…}` (`:23`),
  `MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY: ${…:?…}` (`:27`), bare `MCA_DATA_STALENESS_DAYS:` null
  passthrough (`:31`), `restart: unless-stopped` (`:32`). **No `ports:` key yet** — that is what
  Task 1 adds.
- `ingest-cron` (`:42-57`): `profiles: ["ops"]`, `build.dockerfile: deploy/ingest-cron.Dockerfile`,
  `command: ["crond", "-f", "-d", "8"]`, `environment:` **list form** `[- MCA_ADMIN_INGEST_TOKEN,
  - TZ=America/Los_Angeles]`, two read-only bind mounts (`ingest-cron.crontab` →
  `/etc/crontabs/root`, `ingest-daily.sh` → `/etc/ingest/run.sh`), `depends_on: api:
  condition: service_healthy`, `restart: unless-stopped`.
- The header comment already promises `.env.prod.example` "ships with the VPS bring-up slice"
  (`:10-11`) — Task 3 makes that true.
- The base file enumerates the api environment explicitly (`docker-compose.yml:32-88`), so anything
  not listed there never reaches the api container. `MCA_TRUST_PROXY_HEADERS` **is** listed
  (`docker-compose.yml:70`), so no compose change is needed for Task 2.
- Base `api` publishes `ports: ["8000:8000"]` (`docker-compose.yml:93-94`); base `db` publishes
  `5432` (`:19-20`). Base `volumes:` declares only `mca-postgres` (`:107-108`).

**Compose render behavior — verified by running it (Docker Compose v5.1.4, this Mac)**
- With `ports: !reset []` added to `api` in the overlay and a `caddy` service publishing
  `["80:80", "443:443", "443:443/udp"]`, `docker compose --env-file /dev/null -f docker-compose.yml
  -f docker-compose.prod.yml config` exits 0 and yields: **0** occurrences of `published: "8000"`,
  **0** of `published: "5432"`, **1** of `published: "80"`, **2** of `published: "443"` (tcp + udp),
  and **3** `restart: unless-stopped` (db, api, caddy). Under `--profile ops` the restart count is
  **4**. Top-level `volumes:` merges: the render lists `caddy-config`, `caddy-data` and
  `mca-postgres`.
- **Build-arg passthrough without a `:-` default works.** Adding
  `build: {args: [- VITE_CANONICAL_ORIGIN]}` to `api` in the overlay merges cleanly with the base's
  string-form `build: .` (which Compose normalizes to `{context, dockerfile}` first). With the
  variable set the render shows `args: {VITE_CANONICAL_ORIGIN: https://compcat.app}`; **with it
  unset the `args` key disappears from the render entirely** and the render still exits 0. That is
  the mechanism Task 6 uses to keep the repo default relative.
- `alpine:3.22` + `apk add postgresql16-client` resolves to **16.14-r0** (verified with
  `apk add --no-cache --simulate`), matching the `postgres:16` server image.

**Existing render assertions that Task 1 must UPDATE**
- `tests/test_compose_prod_overlay.py:23-32` asserts on the overlay **file text**:
  `"ports: !reset []" in text` (will now appear twice), `"${POSTGRES_PASSWORD:?"`,
  `"${MCA_DATABASE_URL:?"`, `text.count("restart: unless-stopped") == 3` (becomes **4** with caddy),
  and `":-" not in text` (the whole reason Task 6 uses list-form build args).
- `tests/test_compose_prod_overlay.py:78-92` (`test_rendered_overlay_publishes_no_postgres_port`)
  asserts `'published: "8000"' in rendered` and `rendered.count("restart: unless-stopped") == 2`.
  **Both flip**: no published 8000, count 3. Rename it to say what it now guarantees.
- `tests/test_compose_prod_overlay.py:130-138` (`test_sidecar_is_absent_without_the_ops_profile`)
  also asserts the render count `== 2` → **3**.
- `tests/test_compose_prod_overlay.py:156-166` (`test_crontab_fires_once_daily_and_holds_no_secret`)
  asserts **exactly one** schedule line starting `10 3 * * *`. Task 4 adds the 03:40 backup line, so
  this becomes two lines with an explicit assertion on each.
- `.github/workflows/ci.yml:74-89` ("Production overlay renders without publishing Postgres"):
  `grep -q 'published: "8000"'` and `test "$(grep -c 'restart: unless-stopped' rendered.yml)" = "2"`
  both flip the same way; the step gains negative assertions for 8000/5432 and positive ones for
  80/443. The ops step (`:90-105`) keeps working unchanged, and gains the backup-crontab grep.

**Ingest sidecar assets (slice 3)**
- `deploy/ingest-cron.Dockerfile` is two lines: `FROM alpine:3.22` + `RUN apk add --no-cache curl
  tzdata`. `tests/test_compose_prod_overlay.py:183-188` pins `FROM alpine:3.22`, `tzdata`, `curl`.
- `deploy/ingest-cron.crontab` is one job: `10 3 * * * /bin/sh /etc/ingest/run.sh >> /proc/1/fd/1
  2>&1`, trailing newline required by crond.
- `deploy/ingest-daily.sh` is `/bin/sh`, `set -u`, refuses with an explicit log line when
  `MCA_ADMIN_INGEST_TOKEN` is empty (`:18-21`), then loops
  `seattle_spd_crime → seattle_spd_arrests → seattle_spd_911` POSTing
  `${API_BASE}/admin/crime/ingest/socrata?source=…&mode=backfill&limit=…` with
  `-H "X-Admin-Token: ${MCA_ADMIN_INGEST_TOKEN}"`, `API_BASE` defaulting to `http://api:8000`. Its
  `log()` helper prefixes `[ISO-8601±ZZZZ] ingest-cron: …`. **The backup script mirrors this file's
  shape exactly** (same shebang, same `set -u`, same `log()`, same refuse-and-log guard) — and the
  start script reuses it verbatim for the ingest leg (`docker compose exec ingest-cron`), so the
  bring-up path and the nightly path are the same code.
- Slice 3's live-verification recipe (its plan, Task 3 Step 6) is the template for Task 4's: build
  the image, mount a `* * * * *` crontab, run `crond -f -d 8` against an unreachable target, `sleep
  75`, read `docker logs`. Reuse it.

**Postgres wiring for `pg_dump`**
- `docker-compose.yml:15-18`: `POSTGRES_DB: mca`, `POSTGRES_USER: mca`; the overlay makes
  `POSTGRES_PASSWORD` a required variable. So the dump command is
  `pg_dump -h db -U mca -d mca -Fc` with `PGPASSWORD` from the passed-through `POSTGRES_PASSWORD`.
  The sidecar's `environment:` list must gain a bare `- POSTGRES_PASSWORD` entry (list form → no
  `:-`, so the overlay's own `":-" not in text` assertion still holds).
- `docs/DEPLOY.md:218-239` already documents the manual `pg_dump -Fc` / `pg_restore` pair for the
  ThinkPad; the restore rehearsal in `DEPLOY-VPS.md` is the automated-dump version of it.

**Health / freshness endpoints the start script uses**
- `GET /health` (`app/api/routes_health.py:17-26`) is the readiness probe the container healthcheck
  already pins (`docker-compose.yml:96-102`, via `urllib.request.urlopen`) — the start script's
  wait loop reuses exactly that one-liner through `docker compose exec -T api python -c …`, because
  the prod overlay publishes no app port on the host.
- `GET /dashboard/freshness` (public tier, needs a session cookie) returns per-layer
  `{incident_count, data_through, earliest, last_ingested_at}`; `data_through` is a `YYYY-MM-DD`
  string or `None`. That is the field the demo script reads (`scripts/demo/start-demo.ps1:44`), and
  the bash port reads the same one for the `reported` layer.
- `GET /health/data` (`app/api/routes_health.py:40-79`) is session-free but only lists **stale**
  layers, and its threshold is `MCA_DATA_STALENESS_DAYS` — so it is the right thing for the uptime
  monitor and the **wrong** thing for a 14-day ingest-if-stale decision. Use `/dashboard/freshness`.

**Demo scripts to mirror (`scripts/demo/`)**
- `start-demo.ps1`: params `-Port`/`-FreshnessMaxAgeDays 14` (`:4-7`) → `Set-Location` repo root
  (`:11`) → refuse without `.env.demo` (`:13-15`) → `docker compose … up -d --build` (`:21`) → poll
  `/health` with a 3-minute deadline, 5s sleep (`:24-34`) → `POST /sessions` + `GET
  /dashboard/freshness`, treat a null `data_through` as maximally stale (`:39-45`) → ingest → print.
  `stop-demo.ps1` is 7 lines: cd repo root, stop the tunnel, `docker compose … down`, print that the
  DB volume was kept.
- Both resolve paths against the repo root so they work from any directory — the bash pair does the
  same with `cd "$(dirname "$0")/../.."`.

**Frontend build + metadata**
- `frontend/index.html:14-25` carries `og:type`, `og:site_name`, `og:title`, `og:description`,
  `og:image` = `/assets/og-card.png`, `og:image:width|height|alt`, `twitter:card|title|description`,
  `twitter:image` = `/assets/og-card.png`. There is **no `og:url`** — Task 6 adds it, absolute only.
- `frontend/tests/indexHtml.test.ts:5` reads `../index.html` **from disk**, so its
  `externals).toEqual([])` guard (`:8-11`) and its `/assets|basemaps-assets|fonts|src` path guard
  (`:76-84`) only ever see the source file. Editing the *build transform* cannot break them; editing
  `index.html` would. Do not edit `index.html`.
- `frontend/vite.config.ts` already defines a local `Plugin` factory (`maplibreWorkerAssets`,
  `:12-26`) with `apply: "build"`, and spreads plugins at `:29`. The new hook follows that shape.
- `frontend/tsconfig.json` includes **only `src`**, so neither `vite.config.ts` nor `frontend/tests/`
  is type-checked by `npm run build`'s `tsc -b` leg — a named export added to the config file cannot
  break the build.
- `frontend/tests/` already holds three `// @vitest-environment node` files
  (`indexHtml`, `viteProxy`, `mapWorkspaceStyle`); `npm test` is `vitest run --environment jsdom`,
  and the per-file pragma overrides it. The new test uses the same pragma.
- The Docker image builds the frontend **inside** the image (`Dockerfile:1-7`, `npm run build` in the
  `frontend` stage, copied at `:28`), so a host-side `npm run build` is discarded. `VITE_CANONICAL_ORIGIN`
  must therefore arrive as a **Docker build arg** — hence the overlay's list-form `build.args`.

**Docs to touch**
- `docs/DEMO.md:44-47` — "The 'for-real' launch (deferred)": three lines that say a VPS + TLS + real
  domain + durable README link is future work. Rewrite as now-built, pointing at `DEPLOY-VPS.md`.
- `docs/DEPLOY.md` is the ThinkPad/trial doc; its "Notes / hardening" section (`:129-150`) already
  says "lock them down before any internet exposure" and its backup section (`:218-239`) is the
  manual equivalent. It gets a pointer near the top plus one in the backup section.
- `docs/README.md:31-33` indexes `DEMO.md` and `DEPLOY.md` — add `DEPLOY-VPS.md` beside them.
- `docs/soak-testing.md:20-45` — the harness is two stdlib-only scripts run **on the deploy host**
  (`scripts/soak/soak_driver.py`, `scripts/soak/pg_observer.py`), the observer shelling
  `docker compose … exec -T db psql --csv`; its prerequisites assume `.env.deploy` and the ThinkPad
  start script. The launch checklist cites it with the `--env-file .env.prod` substitution.
- `docs/ROADMAP.md:355-376` — Phase 8 header + four unchecked slice bullets, in the exact wording to
  amend. PR numbers to record: slice 1 = #168, slice 2 = #167, slice 3 = #169 (from `git log`:
  `601d5c0` #167, `1461604` #168, `177b924` #169).

**Baseline (this worktree, before any change)**
- `.venv/bin/python -m pytest tests -q --collect-only` → **802 tests collected**.
- Docker daemon is up on this Mac, so the render tests will **not** skip locally.

---

## Task 1: Caddy TLS edge — Caddyfile, compose service, api stops publishing 8000

**Files:**
- Create: `deploy/Caddyfile`
- Modify: `docker-compose.prod.yml`
- Modify: `tests/test_compose_prod_overlay.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing tests (and update the ones whose guarantee inverts)**

In `tests/test_compose_prod_overlay.py`, add the Caddyfile path beside the other deploy constants
(after `_DOCKERFILE = _DEPLOY / "ingest-cron.Dockerfile"`, line 20):

```python
_CADDYFILE = _DEPLOY / "Caddyfile"
```

Replace `test_overlay_documents_its_own_usage_and_sources_secrets_from_env` (lines 23-32) with:

```python
def test_overlay_documents_its_own_usage_and_sources_secrets_from_env() -> None:
    text = _PROD.read_text(encoding="utf-8")
    assert "docker compose -f docker-compose.yml -f docker-compose.prod.yml" in text
    # !reset, not an empty list: Compose merges sequences, so only the tag drops the base publish.
    # Twice now — db (never published) and api (Caddy is the only ingress in production).
    assert text.count("ports: !reset []") == 2
    assert "${POSTGRES_PASSWORD:?" in text
    assert "${MCA_DATABASE_URL:?" in text
    # db, api, the ops-profile ingest sidecar, and caddy.
    assert text.count("restart: unless-stopped") == 4
    assert ":-" not in text  # no dev fallback defaults anywhere in the production overlay
```

Replace `test_rendered_overlay_publishes_no_postgres_port` (lines 78-92) with:

```python
def test_rendered_overlay_publishes_only_the_caddy_edge() -> None:
    # Production ingress is Caddy on 80/443 (+443/udp for HTTP/3) and nothing else: neither
    # Postgres nor the app's own 8000 may be reachable from the host network.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {
            "POSTGRES_PASSWORD": _TEST_PASSWORD,
            "MCA_DATABASE_URL": _TEST_DATABASE_URL,
            "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
        }
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert 'published: "5432"' not in rendered
    assert 'published: "8000"' not in rendered
    assert 'published: "80"' in rendered
    assert 'published: "443"' in rendered
    assert rendered.count("protocol: udp") == 1  # HTTP/3 on 443
    assert rendered.count("restart: unless-stopped") == 3  # db, api, caddy


def test_rendered_caddy_mounts_the_repo_caddyfile_read_only() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {
            "POSTGRES_PASSWORD": _TEST_PASSWORD,
            "MCA_DATABASE_URL": _TEST_DATABASE_URL,
            "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
        }
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert "caddy:2-alpine" in rendered
    assert "target: /etc/caddy/Caddyfile" in rendered
    # Certificates and OCSP staples survive a container replacement.
    assert "target: /data" in rendered
    assert "target: /config" in rendered


def test_caddyfile_terminates_tls_for_the_registered_domain_and_proxies_the_api() -> None:
    text = _CADDYFILE.read_text(encoding="utf-8")
    assert "compcat.app {" in text
    assert "reverse_proxy api:8000" in text
    assert "encode gzip" in text
    # Nothing else: no extra directives to review, no TLS overrides that would disable ACME.
    directives = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#") and line.strip() not in ("}",)
    ]
    assert directives == ["compcat.app {", "encode gzip", "reverse_proxy api:8000"]
```

In `test_sidecar_is_absent_without_the_ops_profile` (lines 130-138), change the trailing assertion
and its comment to:

```python
    # Only db, api and caddy restart in the default rendering.
    assert result.stdout.count("restart: unless-stopped") == 3
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: FAIL — `test_caddyfile_…` raises `FileNotFoundError` (no `deploy/Caddyfile`),
`test_overlay_documents_…` fails on the `ports: !reset []` count (1, not 2),
`test_rendered_overlay_publishes_only_the_caddy_edge` fails on `published: "8000"` still present,
`test_rendered_caddy_mounts_…` fails on `caddy:2-alpine`, and
`test_sidecar_is_absent_without_the_ops_profile` fails on the restart count (2, not 3).

- [ ] **Step 3: Create the Caddyfile**

Create `deploy/Caddyfile`:

```
# CompCat production edge. Mounted read-only into the caddy service by
# docker-compose.prod.yml; Caddy obtains and renews the Let's Encrypt certificate for this
# name automatically, provided the A record points here and 80/443 are open.
#
# Deliberately three directives. Anything more is another thing to review before a deploy.
compcat.app {
	encode gzip
	reverse_proxy api:8000
}
```

Caddy's own formatting uses tabs for directive indentation (`caddy fmt` will rewrite spaces), so
indent the two directives with a single tab each.

- [ ] **Step 4: Add the caddy service and stop publishing 8000**

In `docker-compose.prod.yml`, extend the header comment's "What it changes" list with a fourth
bullet, immediately after the Postgres bullet:

```yaml
#   - the api container publishes NO host port either — Caddy terminates TLS on 80/443 and is the
#     only ingress; the app is reachable solely over the compose network at api:8000;
```

Then add `ports: !reset []` to the `api` service as its first key (before `environment:`), with the
comment:

```yaml
  api:
    # Same !reset mechanic as db above: drop the base file's "8000:8000" publish. In production
    # the only listener on the host is caddy; nothing should be able to reach uvicorn directly
    # and bypass TLS, the edge, and the real client IP that the limiter keys on.
    ports: !reset []
    environment:
```

Append the caddy service after the `ingest-cron` block, plus the top-level volumes it needs:

```yaml
  # TLS edge. Caddy obtains and renews the Let's Encrypt certificate for the site name in
  # deploy/Caddyfile on its own; 80 must stay open for the ACME HTTP challenge and the
  # HTTP->HTTPS redirect, and 443/udp gives HTTP/3. The named volumes make certificates and
  # OCSP staples survive a container replacement — without them a redeploy re-issues and can
  # hit Let's Encrypt rate limits.
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - api
    restart: unless-stopped

volumes:
  caddy-data:
  caddy-config:
```

Note `depends_on: [api]` in short form on purpose: a `service_healthy` condition would keep the
edge down (and therefore the ACME challenge unanswerable) while the app is still migrating.

- [ ] **Step 5: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: PASS (11 tests: 9 existing/updated + 2 new).

- [ ] **Step 6: Verify the render by hand**

Run from the worktree root:

```bash
POSTGRES_PASSWORD=x MCA_DATABASE_URL=x MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY=0 \
docker compose --env-file /dev/null -f docker-compose.yml -f docker-compose.prod.yml config \
  | grep -E 'published|protocol|restart:|image:'
```

Expected: `published: "80"` once, `published: "443"` twice (one `protocol: tcp`, one
`protocol: udp`), `caddy:2-alpine`, three `restart: unless-stopped`, and **no** `published: "8000"`
or `published: "5432"`.

- [ ] **Step 7: Update the CI docker lane**

In `.github/workflows/ci.yml`, replace the body of the "Production overlay renders without
publishing Postgres" step (rename it too) with:

```yaml
      - name: Production overlay publishes only the Caddy edge
        env:
          POSTGRES_PASSWORD: ci-not-a-real-password
          MCA_DATABASE_URL: postgresql+psycopg://mca:ci-not-a-real-password@db:5432/mca
          MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY: "0"
        run: |
          docker compose --env-file /dev/null \
            -f docker-compose.yml -f docker-compose.prod.yml config > rendered.yml
          # "! cmd" is exempt from set -e; an if/exit keeps the assertion load-bearing.
          for port in 5432 8000; do
            if grep -q "published: \"$port\"" rendered.yml; then
              echo "prod overlay must not publish $port — caddy is the only ingress" >&2
              exit 1
            fi
          done
          grep -q 'published: "80"' rendered.yml
          grep -q 'published: "443"' rendered.yml
          grep -q 'caddy:2-alpine' rendered.yml
          grep -q 'MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY' rendered.yml
          test "$(grep -c 'restart: unless-stopped' rendered.yml)" = "3"
```

- [ ] **Step 8: Commit**

```bash
git add deploy/Caddyfile docker-compose.prod.yml tests/test_compose_prod_overlay.py \
  .github/workflows/ci.yml
git commit -m "feat(deploy): Caddy TLS edge as the only production ingress"
```

---

## Task 2: Trust the leftmost `X-Forwarded-For` behind our own proxy

Caddy's `reverse_proxy` appends the immediate peer to `X-Forwarded-For`, so the **leftmost** entry is
the original client. Without this, every visitor behind the edge shares one rate bucket and the
limiter is decorative.

**Files:**
- Modify: `app/ratelimit.py`
- Modify: `app/config.py`
- Modify: `tests/test_ratelimit.py`
- Modify: `tests/test_ratelimit_api.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_ratelimit.py`, insert directly after `test_client_ip_uses_header_with_trust`
(line 52), keeping the new cases beside the existing CF ones:

```python
def test_client_ip_uses_forwarded_for_with_trust() -> None:
    # Caddy sets X-Forwarded-For; without trusting it every visitor shares one bucket.
    req = FakeRequest(host="172.18.0.5", headers={"x-forwarded-for": "8.8.8.8"})
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_client_ip_ignores_forwarded_for_without_trust() -> None:
    # Untrusted, the header is just attacker-supplied text: fall back to the socket peer.
    req = FakeRequest(host="9.9.9.9", headers={"x-forwarded-for": "8.8.8.8"})
    assert client_ip_from(req, trust_proxy_headers=False) == "9.9.9.9"


def test_cf_connecting_ip_wins_over_forwarded_for() -> None:
    # Cloudflare's header is single-valued and set by the edge itself, so it is the stronger
    # signal when both are present (the demo path keeps working unchanged).
    req = FakeRequest(
        host="127.0.0.1",
        headers={"cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1"},
    )
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_forwarded_for_takes_the_leftmost_hop() -> None:
    # "client, proxy1, proxy2" — our Caddy appends the peer it saw, so the original client
    # is first. Taking the last entry would key every request on the proxy.
    req = FakeRequest(
        host="172.18.0.5", headers={"x-forwarded-for": "8.8.8.8, 203.0.113.7, 172.18.0.1"}
    )
    assert client_ip_from(req, trust_proxy_headers=True) == "8.8.8.8"


def test_blank_proxy_headers_fall_back_to_the_socket_peer() -> None:
    req = FakeRequest(host="9.9.9.9", headers={"cf-connecting-ip": "  ", "x-forwarded-for": " , "})
    assert client_ip_from(req, trust_proxy_headers=True) == "9.9.9.9"
```

In `tests/test_ratelimit_api.py`, append after `test_trusted_proxy_header_separates_clients`
(line 58) — the middleware re-implements the header decision on the raw ASGI scope, so it needs its
own coverage:

```python
def test_trusted_forwarded_for_separates_clients_through_the_middleware(
    tmp_path, monkeypatch
) -> None:
    # The burst tier reads the scope headers directly (BurstLimitMiddleware), not client_ip_from,
    # so the X-Forwarded-For step has to exist in both places or the two tiers key differently.
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "2")
    monkeypatch.setenv("MCA_TRUST_PROXY_HEADERS", "true")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rl8.sqlite3")
    client = TestClient(app)
    first = [
        client.get("/input-modes", headers={"X-Forwarded-For": "8.8.8.1, 172.18.0.1"}).status_code
        for _ in range(3)
    ]
    assert first[:2] == [200, 200]
    assert first[2] == 429
    # A different leftmost hop is a different client and gets its own bucket.
    assert (
        client.get("/input-modes", headers={"X-Forwarded-For": "8.8.8.2, 172.18.0.1"}).status_code
        == 200
    )


def test_spoofed_forwarded_for_ignored_without_trust(limited_client: TestClient) -> None:
    # Same socket peer for all four; the spoofed header must not mint fresh buckets.
    for i in range(3):
        assert (
            limited_client.post("/sessions", headers={"X-Forwarded-For": f"8.8.8.{i}"}).status_code
            == 200
        )
        limited_client.cookies.clear()
    assert (
        limited_client.post("/sessions", headers={"X-Forwarded-For": "8.8.9.9"}).status_code == 429
    )
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_ratelimit.py tests/test_ratelimit_api.py -v`
Expected: FAIL — the four XFF-honoring cases return the socket peer instead of the header
(`test_client_ip_uses_forwarded_for_with_trust`, `test_forwarded_for_takes_the_leftmost_hop`,
`test_trusted_forwarded_for_separates_clients_through_the_middleware`), while
`test_client_ip_ignores_forwarded_for_without_trust`, `test_cf_connecting_ip_wins_over_forwarded_for`,
`test_blank_proxy_headers_fall_back_to_the_socket_peer` and `test_spoofed_forwarded_for_ignored_without_trust`
already pass (nothing reads the header yet). Every pre-existing test stays green.

- [ ] **Step 3: Implement the shared resolution order**

In `app/ratelimit.py`, replace `client_ip_from` (lines 108-114) with a shared helper plus the
thin wrapper:

```python
def _proxy_header_ip(headers) -> str | None:
    """Client IP from proxy headers, in trust order — only ever consulted when
    MCA_TRUST_PROXY_HEADERS is on, because both headers are attacker-supplied otherwise.

    1. CF-Connecting-IP: single-valued and written by Cloudflare's own edge (the demo path).
    2. X-Forwarded-For, FIRST entry: our Caddy *appends* the peer it saw, so the leftmost hop
       is the original client. Taking the last entry would key every request on the proxy and
       collapse the whole internet into one bucket.

    `headers` is any mapping with lowercase keys (Starlette's case-insensitive Headers, or the
    lowercased dict BurstLimitMiddleware builds from the raw ASGI scope).
    """
    cf_header = (headers.get("cf-connecting-ip") or "").strip()
    if cf_header:
        return cf_header
    forwarded = (headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        first_hop = forwarded.split(",")[0].strip()
        if first_hop:
            return first_hop
    return None


def client_ip_from(request, *, trust_proxy_headers: bool) -> str:
    if trust_proxy_headers:
        header_ip = _proxy_header_ip(request.headers)
        if header_ip:
            return header_ip
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"
```

Then replace the middleware's inline decision (lines 179-183) with the same helper:

```python
        ip = "unknown"
        if settings.trust_proxy_headers:
            ip = _proxy_header_ip(headers) or ip
        if ip == "unknown" and scope.get("client"):
            ip = scope["client"][0]
```

In `app/config.py`, replace the two-line comment above `trust_proxy_headers` (lines 110-111) with:

```python
    # Trust proxy headers for client identity: CF-Connecting-IP first, then the leftmost
    # X-Forwarded-For hop. Set true only when a proxy we control is the sole ingress
    # (cloudflared for the demo, the Caddy edge in docker-compose.prod.yml) — otherwise both
    # headers are attacker-controlled and every caller can mint a fresh rate bucket.
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_ratelimit.py tests/test_ratelimit_api.py tests/test_config_demo.py tests/test_public_sessions.py -v`
Expected: PASS (7 new tests; every existing limiter, session and config test green — the CF path is
byte-for-byte unchanged in behavior).

Run: `.venv/bin/ruff check .`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/ratelimit.py app/config.py tests/test_ratelimit.py tests/test_ratelimit_api.py
git commit -m "feat(ratelimit): resolve the client IP from the leftmost X-Forwarded-For hop"
```

---

## Task 3: `.env.prod.example` — the whole production posture, reviewable in one file

No test drives this file (it is an example, and `.gitignore` already whitelists `!.env*.example`),
so the verification is a render + a boot: the values must be exactly the ones the overlay and the
slice-1 validators demand.

**Files:**
- Create: `.env.prod.example`

- [ ] **Step 1: Write the file**

Create `.env.prod.example`:

```bash
# CompCat production posture for the public instance at https://compcat.app.
# Copy to .env.prod (gitignored) on the box, fill in every __placeholder__, then:
#
#   scripts/prod/start-compcat.sh
#
# Full runbook: docs/DEPLOY-VPS.md. Every value below is deliberate — read the comments
# before changing one, because several of them are what make the app boot at all.

# Production mode: the app REFUSES to boot on placeholder secrets, requires a geocoder
# contact, and forces secure session cookies. Do not set this to anything else here.
MCA_ENVIRONMENT=production

# ---------------------------------------------------------------------------
# Secrets — generate fresh values on the box; never reuse another instance's.
# ---------------------------------------------------------------------------
#   openssl rand -hex 32
MCA_SESSION_SECRET=__run: openssl rand -hex 32__
MCA_USER_HASH_SALT=__run: openssl rand -hex 32__
#   openssl rand -hex 24   (admin ingest header X-Admin-Token; an empty value closes the
#   endpoint entirely, which also stops the nightly ingest sidecar from working)
MCA_ADMIN_INGEST_TOKEN=__run: openssl rand -hex 24__

# Database. These two must agree: POSTGRES_PASSWORD initializes the db container on first
# boot, MCA_DATABASE_URL is how the api connects. Both are required with no default — the
# prod overlay refuses to render if either is missing.
#   openssl rand -hex 24
POSTGRES_PASSWORD=__run: openssl rand -hex 24__
MCA_DATABASE_URL=postgresql+psycopg://mca:__same password as above__@db:5432/mca

# ---------------------------------------------------------------------------
# Request limits — ON. A hosted LLM key with the limiter off makes the app refuse to boot.
# Starting values are the demo caps (docs/DEMO.md); raise them once real traffic is boring.
# ---------------------------------------------------------------------------
MCA_RATE_LIMIT_ENABLED=true
MCA_RATE_LIMIT_SESSIONS_PER_HOUR=10
MCA_RATE_LIMIT_ASSISTANT_PER_HOUR=20
MCA_RATE_LIMIT_ASSISTANT_GLOBAL_PER_DAY=100
MCA_RATE_LIMIT_BURST_PER_MINUTE=120

# Shared daily LLM token budget (prompt + completion, every assistant call, UTC day; 0
# disables it). 2,000,000 is roughly 1,000 assistant turns at ~2k tokens each — comfortably
# above the 100/day global call cap above, so this is the spend backstop for unusually long
# turns rather than the primary throttle. Once it is spent, free-text chat declines for the
# rest of the UTC day and everything else in the app keeps working.
MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY=2000000

# Client identity comes from the Caddy edge (docker-compose.prod.yml publishes no other
# port, so nothing can reach the app directly and forge this). Without it every visitor
# shares one rate bucket.
MCA_TRUST_PROXY_HEADERS=true

# ---------------------------------------------------------------------------
# Exposure — both OFF, deliberately, on a public instance.
# ---------------------------------------------------------------------------
# Personal location-history uploads store real personal data against an anonymous session.
# OFF: the /uploads endpoints 404 and no upload UI renders.
MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=false
# The /internal/* tier is unauthenticated by design (it accepts a demo-identity fallback).
# OFF: it is blocked at the app edge. The app logs a loud warning at boot if this is true
# in a production-like environment.
MCA_INTERNAL_TIER_ENABLED=false

# ---------------------------------------------------------------------------
# Assistant (Tabby) — Claude primary, Groq fallback.
# If the active backend is unreachable, only the chat panel is affected; maps, analysis,
# compare and exports are unchanged.
# ---------------------------------------------------------------------------
MCA_LLM_PROVIDER=anthropic
MCA_ANTHROPIC_API_KEY=__your anthropic key__
MCA_ANTHROPIC_MODEL=claude-sonnet-5

# Failover: the OpenAI-compatible client pointed at Groq. Chosen independently of the
# primary, so this pair composes with the Anthropic block above.
MCA_LLM_FALLBACK_PROVIDER=openai
MCA_LLM_BASE_URL=https://api.groq.com/openai/v1
MCA_LLM_MODEL=llama-3.3-70b-versatile
MCA_LLM_API_KEY=__your groq key__
MCA_LLM_FALLBACK_API_KEY=__your groq key__

# Groq-only bring-up: if the Anthropic key does not exist yet, set MCA_LLM_PROVIDER=openai
# and leave MCA_ANTHROPIC_API_KEY blank — the Groq values above then serve as the primary.
# Swap the provider back (and restart) the moment the Anthropic key is in hand; nothing
# else in this file changes.

# ---------------------------------------------------------------------------
# Everything else
# ---------------------------------------------------------------------------
# Nominatim requires an identifiable contact in production; the app refuses to boot without
# one. Use an address you actually read — it is where OSM would write about traffic.
MCA_GEOCODER_CONTACT_EMAIL=__your email__

# Optional: raise Socrata ingest rate limits (the nightly sidecar works without it).
SOCRATA_APP_TOKEN=

# Optional: how many days a layer may lag before GET /health/data reports it stale (503) to
# the uptime monitor. Default 7. Uncomment only to widen or tighten that alert.
# MCA_DATA_STALENESS_DAYS=7

# Absolute URLs for link-preview metadata, baked into the frontend at image build time.
# Leave as-is for compcat.app; unset would render the OG tags with relative paths, which
# most link unfurlers ignore.
VITE_CANONICAL_ORIGIN=https://compcat.app
```

(`VITE_CANONICAL_ORIGIN` is wired in Task 6; keep the entry here so the file stays the single place
an operator fills in.)

- [ ] **Step 2: Verify it renders and boots the overlay**

Run from the worktree root:

```bash
cp .env.prod.example /tmp/env.prod.probe
sed -i '' 's/__run: openssl rand -hex 32__/0123456789abcdef0123456789abcdef/; s/__run: openssl rand -hex 24__/0123456789abcdef01234567/; s/__same password as above__/0123456789abcdef01234567/' /tmp/env.prod.probe
docker compose --env-file /tmp/env.prod.probe \
  -f docker-compose.yml -f docker-compose.prod.yml config >/dev/null && echo "renders OK"
rm -f /tmp/env.prod.probe
```

Expected: `renders OK` — every variable the overlay marks required is present.

Then confirm the posture actually boots the app (this is the combination slice 1 can refuse):

```bash
env -i PATH="$PATH" \
  MCA_ENVIRONMENT=production \
  MCA_SESSION_SECRET=0123456789abcdef0123456789abcdef \
  MCA_USER_HASH_SALT=0123456789abcdef0123456789abcdef \
  MCA_ANTHROPIC_API_KEY=sk-not-a-real-key \
  MCA_LLM_API_KEY=gsk-not-a-real-key \
  MCA_RATE_LIMIT_ENABLED=true \
  MCA_GEOCODER_CONTACT_EMAIL=ops@example.com \
  .venv/bin/python -c "from app.config import Settings; s=Settings(_env_file=None); print('boots:', s.is_production_like, s.rate_limit_enabled)"
```

Expected: `boots: True True`. Flip `MCA_RATE_LIMIT_ENABLED=false` and the same command must raise a
`ValidationError` naming `MCA_RATE_LIMIT_ENABLED` — that is slice 1's guard confirming this file's
posture is the one it wants.

- [ ] **Step 3: Check the copy invariant**

Run: `grep -niE 'safe|unsafe|safety|danger|risk' .env.prod.example`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add .env.prod.example
git commit -m "docs(deploy): production env example for the public instance"
```

---

## Task 4: Nightly `pg_dump` backups in the ops sidecar

Extends the slice-3 sidecar rather than adding a service: it already runs `crond` with the right TZ,
it already reaches the compose network, and one more crontab line is the whole scheduler.

**Files:**
- Modify: `deploy/ingest-cron.Dockerfile`
- Modify: `deploy/ingest-cron.crontab`
- Create: `deploy/backup-daily.sh`
- Modify: `docker-compose.prod.yml`
- Modify: `tests/test_compose_prod_overlay.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing tests**

In `tests/test_compose_prod_overlay.py`, add the constant beside the other deploy paths:

```python
_BACKUP = _DEPLOY / "backup-daily.sh"
```

Replace `test_crontab_fires_once_daily_and_holds_no_secret` (lines 156-166) with:

```python
def test_crontab_fires_ingest_then_backup_nightly_and_holds_no_secret() -> None:
    text = _CRONTAB.read_text(encoding="utf-8")
    schedule_lines = [
        line for line in text.splitlines() if line.strip() and not line.startswith("#")
    ]
    assert len(schedule_lines) == 2
    # Ingest at 03:10, backup at 03:40 — the dump captures the night's fresh data, and the
    # half-hour gap keeps the two jobs off each other's database connections.
    assert schedule_lines[0].startswith("10 3 * * *")
    assert "/etc/ingest/run.sh" in schedule_lines[0]
    assert schedule_lines[1].startswith("40 3 * * *")
    assert "/etc/ingest/backup.sh" in schedule_lines[1]
    # Secrets are env references resolved at run time; never written into this file.
    assert "MCA_ADMIN_INGEST_TOKEN" not in text
    assert "X-Admin-Token" not in text
    assert "POSTGRES_PASSWORD" not in text
    assert text.endswith("\n")  # crond ignores a crontab without a trailing newline


def test_backup_script_dumps_over_the_network_and_refuses_without_a_password() -> None:
    text = _BACKUP.read_text(encoding="utf-8")
    assert "pg_dump" in text
    assert "-Fc" in text  # custom format: pg_restore can select/parallelize
    assert "-h db -U mca -d mca" in text  # over the compose network, not a local socket
    assert "/backups" in text
    # Refuse-and-log rather than writing an unusable empty dump.
    assert "POSTGRES_PASSWORD" in text
    assert "refusing to run" in text


def test_backup_script_keeps_seven_daily_and_four_weekly_archives() -> None:
    text = _BACKUP.read_text(encoding="utf-8")
    assert "KEEP_DAILY=${KEEP_DAILY:-7}" in text
    assert "KEEP_WEEKLY=${KEEP_WEEKLY:-4}" in text
    # Sunday's dump is additionally linked under a weekly- name, so pruning the dailies
    # cannot take the weekly set with it.
    assert "weekly" in text
    assert "date +%u" in text


def test_sidecar_image_is_pinned_and_installs_its_tools() -> None:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    assert "FROM alpine:3.22" in text
    # tzdata is load-bearing: without it musl resolves TZ=America/Los_Angeles to UTC.
    assert "tzdata" in text
    assert "curl" in text
    # Client major must match the postgres:16 server image in docker-compose.yml.
    assert "postgresql16-client" in text
```

(The last one replaces `test_sidecar_image_is_pinned_and_installs_tzdata`, lines 183-188.)

Extend `test_sidecar_renders_under_the_ops_profile` (lines 141-153) with three assertions before its
final line:

```python
    assert "target: /etc/ingest/backup.sh" in rendered
    assert "target: /backups" in rendered
    assert "POSTGRES_PASSWORD" in rendered
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: FAIL — the three backup-script tests raise `FileNotFoundError`, the crontab test fails on
`len(schedule_lines) == 2`, the Dockerfile test fails on `postgresql16-client`, and the ops-render
test fails on `target: /etc/ingest/backup.sh`.

- [ ] **Step 3: Add the client to the sidecar image**

Replace `deploy/ingest-cron.Dockerfile` with:

```dockerfile
# Nightly ops sidecar (docker-compose.prod.yml, "ops" profile): SPD ingest at 03:10 and a
# pg_dump backup at 03:40. Alpine + curl for a readable failure cause in `docker logs`,
# + tzdata because musl silently resolves an unknown TZ name to UTC — which would drift the
# runs across DST — + postgresql16-client, whose major must match the postgres:16 server in
# docker-compose.yml (pg_dump refuses to dump a newer server than itself).
FROM alpine:3.22
RUN apk add --no-cache curl tzdata postgresql16-client
```

- [ ] **Step 4: Add the backup job**

Create `deploy/backup-daily.sh` (mirrors `ingest-daily.sh`: same shebang, `set -u`, same `log()`,
same refuse-and-log guard):

```sh
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
    # shellcheck disable=SC2012 -- names are ISO-stamped and shell-safe by construction
    ls -1 "${BACKUP_DIR}"/${pattern} 2>/dev/null | sort -r | tail -n "+$((keep + 1))" \
        | while read -r stale; do
            rm -f "${stale}" && log "pruned $(basename "${stale}")"
        done
}

prune "compcat-2*.dump" "${KEEP_DAILY}"
prune "compcat-weekly-*.dump" "${KEEP_WEEKLY}"

log "done ($(ls -1 "${BACKUP_DIR}" | wc -l | tr -d ' ') archives retained)"
```

Make it executable: `chmod +x deploy/backup-daily.sh`.

Append to `deploy/ingest-cron.crontab` (keep the trailing newline):

```
# Nightly logical backup, 03:40 — after the ingest above, so the dump holds the fresh data.
# Prunes itself to 7 daily + 4 weekly archives in the "backups" volume.
40 3 * * * /bin/sh /etc/ingest/backup.sh >> /proc/1/fd/1 2>&1
```

- [ ] **Step 5: Wire the volume and the password into the sidecar**

In `docker-compose.prod.yml`, update the `ingest-cron` block: extend its header comment's first line
to "Nightly ops automation: SPD ingest + database backup.", add the password to the environment list,
add the two new mounts, and declare the volume:

```yaml
    environment:
      - MCA_ADMIN_INGEST_TOKEN
      # The backup job dumps over the compose network and needs the same password the db
      # service was initialized with. List form (no interpolation) so a non-ops render never
      # requires it.
      - POSTGRES_PASSWORD
      - TZ=America/Los_Angeles
    volumes:
      - ./deploy/ingest-cron.crontab:/etc/crontabs/root:ro
      - ./deploy/ingest-daily.sh:/etc/ingest/run.sh:ro
      - ./deploy/backup-daily.sh:/etc/ingest/backup.sh:ro
      - backups:/backups
```

and add `backups:` to the top-level `volumes:` block created in Task 1:

```yaml
volumes:
  caddy-data:
  caddy-config:
  # Database dumps written nightly by deploy/backup-daily.sh. A named volume, not a bind
  # mount: `docker compose down` keeps it and `down -v` deliberately destroys it along with
  # the database it came from.
  backups:
```

- [ ] **Step 6: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: PASS (14 tests).

- [ ] **Step 7: Live-verify that crond actually fires the backup job**

Same recipe slice 3 used for the ingest job — short schedule, unreachable database, read the log.
Run from the worktree root:

```bash
docker build -f deploy/ingest-cron.Dockerfile -t compcat-ops-sidecar .
printf '* * * * * /bin/sh /etc/ingest/backup.sh >> /proc/1/fd/1 2>&1\n' > /tmp/backup-cron-smoke
# (a) the real path: password set, db unreachable -> pg_dump fails and says so
docker run -d --name compcat-backup-smoke \
  -e POSTGRES_PASSWORD=not-a-real-password -e TZ=America/Los_Angeles \
  -v /tmp/backup-cron-smoke:/etc/crontabs/root:ro \
  -v "$PWD/deploy/backup-daily.sh:/etc/ingest/backup.sh:ro" \
  compcat-ops-sidecar crond -f -d 8
# (b) the refusal path: no password at all
docker run -d --name compcat-backup-refuse \
  -e TZ=America/Los_Angeles \
  -v /tmp/backup-cron-smoke:/etc/crontabs/root:ro \
  -v "$PWD/deploy/backup-daily.sh:/etc/ingest/backup.sh:ro" \
  compcat-ops-sidecar crond -f -d 8
sleep 75
docker logs compcat-backup-smoke; echo "----"; docker logs compcat-backup-refuse
docker rm -f compcat-backup-smoke compcat-backup-refuse
```

Expected in (a): `crond … started`, one `USER root … cmd /bin/sh /etc/ingest/backup.sh` line, a
`backup-daily: dumping to /backups/compcat-YYYY-MM-DD.dump` line, a `pg_dump: error: connection to
server at "db" … failed` line, and `backup-daily: FAILED (pg_dump exit …)`. Expected in (b): the
two-line `POSTGRES_PASSWORD is not set — refusing to run` message and no dump attempt. Timestamps
must carry `-0700`/`-0800`, not `+0000` (tzdata working). Also confirm the client is present:

```bash
docker run --rm compcat-ops-sidecar pg_dump --version
```

Expected: `pg_dump (PostgreSQL) 16.x`. Record the actual log excerpts in the hand-back report.

- [ ] **Step 8: Add the CI assertion**

In `.github/workflows/ci.yml`, append to the "Ingest sidecar renders only under the ops profile"
step's `run:` block:

```yaml
          grep -q 'target: /etc/ingest/backup.sh' rendered-ops.yml
          grep -q 'target: /backups' rendered-ops.yml
```

- [ ] **Step 9: Commit**

```bash
git add deploy/ingest-cron.Dockerfile deploy/ingest-cron.crontab deploy/backup-daily.sh \
  docker-compose.prod.yml tests/test_compose_prod_overlay.py .github/workflows/ci.yml
git commit -m "feat(deploy): nightly pg_dump backups with 7-daily/4-weekly rotation"
```

---

## Task 5: `scripts/prod/` start and stop

Bash mirrors of the demo PowerShell pair, with two substitutions forced by the prod posture: the
health poll goes through the api container (no published port), and the ingest leg reuses the ops
sidecar's own script instead of re-implementing the three POSTs.

**Files:**
- Create: `scripts/prod/start-compcat.sh`
- Create: `scripts/prod/stop-compcat.sh`

- [ ] **Step 1: Write the start script**

Create `scripts/prod/start-compcat.sh`:

```bash
#!/usr/bin/env bash
# Bring up the public CompCat instance (https://compcat.app) and refresh SPD data if it is
# stale. Idempotent: re-running is the normal way to deploy a new commit.
#
#   scripts/prod/start-compcat.sh
#
# Runbook: docs/DEPLOY-VPS.md. Mirrors scripts/demo/start-demo.ps1, minus the tunnel — here
# the Caddy service is the ingress and it comes up with the stack.
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
```

- [ ] **Step 2: Write the stop script**

Create `scripts/prod/stop-compcat.sh`:

```bash
#!/usr/bin/env bash
# Stop the public CompCat instance. Keeps every named volume (database, TLS certificates,
# backups) — see docs/DEPLOY-VPS.md for the deliberate `down -v` teardown.
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root — the compose -f paths are repo-relative

ENV_FILE="${ENV_FILE:-.env.prod}"

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    --profile ops --env-file "${ENV_FILE}" down

echo "Stopped. Volumes kept: database, Caddy certificates, backups."
echo "To wipe them too (irreversible): ... down -v"
```

- [ ] **Step 3: Make them executable and syntax-check**

```bash
chmod +x scripts/prod/start-compcat.sh scripts/prod/stop-compcat.sh
bash -n scripts/prod/start-compcat.sh && bash -n scripts/prod/stop-compcat.sh && echo "syntax OK"
git ls-files -s scripts/prod/   # both must show mode 100755 after `git add`
```

Expected: `syntax OK`, and after `git add` both entries show `100755`.

Verify the embedded freshness program parses and behaves, without a running stack:

```bash
.venv/bin/python -c "import ast,sys; src=open('scripts/prod/start-compcat.sh').read(); \
body=src.split(\"<<'PY'\")[1].split('PY\n')[0]; ast.parse(body); print('embedded python OK')"
```

Expected: `embedded python OK`.

- [ ] **Step 4: Check the copy invariant**

Run: `grep -niE 'safe|unsafe|safety|danger|risk' scripts/prod/*.sh deploy/backup-daily.sh deploy/Caddyfile`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add scripts/prod/start-compcat.sh scripts/prod/stop-compcat.sh
git commit -m "feat(deploy): bash start/stop scripts for the production stack"
```

---

## Task 6: Absolute link-preview URLs at build time

**Files:**
- Modify: `frontend/vite.config.ts`
- Create: `frontend/tests/canonicalOrigin.test.ts`
- Modify: `Dockerfile`
- Modify: `docker-compose.prod.yml`
- Modify: `tests/test_compose_prod_overlay.py`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/canonicalOrigin.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { absolutizeSocialMeta, canonicalOriginMeta } from "../vite.config";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");

function metaContent(source: string, attr: "name" | "property", value: string): string[] {
  const pattern = new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*>`, "gi");
  return (source.match(pattern) ?? []).map(
    (tag) => /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "",
  );
}

afterEach(() => {
  delete process.env.VITE_CANONICAL_ORIGIN;
});

describe("absolutizeSocialMeta", () => {
  it("leaves the html untouched with no canonical origin", () => {
    expect(absolutizeSocialMeta(html, undefined)).toBe(html);
    expect(absolutizeSocialMeta(html, "")).toBe(html);
  });

  it("absolutizes the og and twitter images against the origin", () => {
    const out = absolutizeSocialMeta(html, "https://compcat.app");
    expect(metaContent(out, "property", "og:image")).toEqual([
      "https://compcat.app/assets/og-card.png",
    ]);
    expect(metaContent(out, "name", "twitter:image")).toEqual([
      "https://compcat.app/assets/og-card.png",
    ]);
  });

  it("adds an og:url the source html does not carry", () => {
    expect(metaContent(html, "property", "og:url")).toEqual([]);
    const out = absolutizeSocialMeta(html, "https://compcat.app");
    expect(metaContent(out, "property", "og:url")).toEqual(["https://compcat.app/"]);
  });

  it("tolerates a trailing slash on the origin", () => {
    const out = absolutizeSocialMeta(html, "https://compcat.app/");
    expect(metaContent(out, "property", "og:image")).toEqual([
      "https://compcat.app/assets/og-card.png",
    ]);
    expect(metaContent(out, "property", "og:url")).toEqual(["https://compcat.app/"]);
  });

  it("touches nothing but the social tags", () => {
    const out = absolutizeSocialMeta(html, "https://compcat.app");
    // Icons, manifest and the module script stay relative — they are same-origin fetches.
    expect(out).toMatch(/rel=["']icon["'][^>]*href=["']\/assets\/favicon\.svg["']/);
    expect(out).toMatch(/rel=["']manifest["'][^>]*href=["']\/assets\/site\.webmanifest["']/);
    expect(metaContent(out, "property", "og:image:width")).toEqual(["1440"]);
    expect(metaContent(out, "name", "description")).toEqual(
      metaContent(html, "name", "description"),
    );
  });
});

describe("canonicalOriginMeta plugin", () => {
  const transform = canonicalOriginMeta().transformIndexHtml as (input: string) => string;

  it("rewrites when VITE_CANONICAL_ORIGIN is set at build time", () => {
    process.env.VITE_CANONICAL_ORIGIN = "https://compcat.app";
    expect(transform(html)).toContain("https://compcat.app/assets/og-card.png");
  });

  it("is inert when the variable is unset (the repo default)", () => {
    delete process.env.VITE_CANONICAL_ORIGIN;
    expect(transform(html)).toBe(html);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/canonicalOrigin.test.ts`
Expected: FAIL — the import of `absolutizeSocialMeta` / `canonicalOriginMeta` from `../vite.config`
does not resolve.

- [ ] **Step 3: Implement the transform**

In `frontend/vite.config.ts`, add the exported helper and plugin factory directly after
`maplibreWorkerAssets` (which ends at line 26) and before `export default defineConfig({`:

```ts
// Link unfurlers (Slack, iMessage, Twitter/X, Discord) resolve og:image against the page URL
// unreliably or not at all, so a shared link renders without its card unless these are
// absolute. Absolutize at build time from VITE_CANONICAL_ORIGIN rather than hardcoding the
// domain: unset (the repo default, and every dev/CI build) keeps index.html's relative form,
// which is what the same-origin app actually wants.
export function absolutizeSocialMeta(html: string, origin: string | undefined): string {
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  if (!base) return html;
  const absolute = html.replace(
    /(<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["'])(\/[^"']*)/gi,
    (_match, head: string, path: string) => `${head}${base}${path}`,
  );
  // og:url has no relative form worth shipping, so it exists only in an absolutized build.
  return absolute.replace(
    /(<meta[^>]*property=["']og:type["'][^>]*>)/i,
    `$1\n    <meta property="og:url" content="${base}/" />`,
  );
}

export function canonicalOriginMeta(): Plugin {
  return {
    name: "canonical-origin-meta",
    apply: "build",
    // Read the env at call time, not module scope, so the build that sets it is the build
    // that gets it (and the test can exercise both branches).
    transformIndexHtml: (html: string) =>
      absolutizeSocialMeta(html, process.env.VITE_CANONICAL_ORIGIN),
  };
}
```

Register it in the plugins array (line 29):

```ts
  plugins: [react(), maplibreWorkerAssets(), canonicalOriginMeta()],
```

- [ ] **Step 4: Run to verify it passes, with the untouched guard suite**

Run: `cd frontend && npx vitest run tests/`
Expected: PASS — the 7 new cases plus `indexHtml.test.ts` (including its external-host guard,
which still reads the unmodified `index.html`), `viteProxy.test.ts` and `mapWorkspaceStyle.test.ts`.

If importing `../vite.config` from a test turns out to be unresolvable under this vitest/vite
combination, move both functions to `frontend/src/buildMeta.ts` and have `vite.config.ts` import
them — the test then imports from there. Record it as a deviation; do not weaken the test to a
text-scan of the config file.

- [ ] **Step 5: Prove the built output, both ways**

```bash
cd frontend
npm run build >/dev/null && grep -c 'content="/assets/og-card.png"' ../app/static/dashboard/index.html
VITE_CANONICAL_ORIGIN=https://compcat.app npm run build >/dev/null \
  && grep -oE '<meta property="og:(url|image)" content="[^"]*"' ../app/static/dashboard/index.html
cd ..
git status --porcelain app/static/dashboard | head -3
```

Expected: `2` for the default build (both social tags still relative), then `og:url` =
`https://compcat.app/` and `og:image` = `https://compcat.app/assets/og-card.png` for the second.
`app/static/dashboard` is a build artifact — confirm `git status` shows nothing tracked there (it is
gitignored); if anything does appear, restore it before committing.

**Then rebuild once more without the variable** so no absolutized artifact is left behind locally:
`cd frontend && npm run build >/dev/null && cd ..`.

- [ ] **Step 6: Pass the origin into the image build**

The image builds the frontend itself (`Dockerfile` stage 1), so a host-side build is discarded — the
value must arrive as a build arg. In `Dockerfile`, extend the frontend stage:

```dockerfile
FROM node:22-slim AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
# Absolute og:url / og:image in link previews. Empty (the default, and every CI build) keeps
# index.html's relative form; the production stack passes https://compcat.app.
ARG VITE_CANONICAL_ORIGIN=""
ENV VITE_CANONICAL_ORIGIN=$VITE_CANONICAL_ORIGIN
RUN npm run build
```

In `docker-compose.prod.yml`, add the build arg to the `api` service, above its `ports: !reset []`:

```yaml
  api:
    build:
      # List form (passthrough from the operator's environment / --env-file) rather than
      # "${VAR:-}": this overlay allows no dev fallback defaults. Unset simply drops the arg
      # and the frontend keeps relative metadata.
      args:
        - VITE_CANONICAL_ORIGIN
```

In `tests/test_compose_prod_overlay.py`, append to
`test_overlay_documents_its_own_usage_and_sources_secrets_from_env`:

```python
    assert "- VITE_CANONICAL_ORIGIN" in text  # list form: no ":-" default, see below
```

and add:

```python
def test_canonical_origin_reaches_the_frontend_build_when_set() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    env = {
        "POSTGRES_PASSWORD": _TEST_PASSWORD,
        "MCA_DATABASE_URL": _TEST_DATABASE_URL,
        "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
    }
    with_origin = _render({**env, "VITE_CANONICAL_ORIGIN": "https://compcat.app"})
    assert with_origin.returncode == 0, with_origin.stderr
    assert "VITE_CANONICAL_ORIGIN: https://compcat.app" in with_origin.stdout
    # Unset is a valid render too — the arg simply disappears and the build stays relative.
    without_origin = _render(env, drop=("VITE_CANONICAL_ORIGIN",))
    assert without_origin.returncode == 0, without_origin.stderr
    assert "VITE_CANONICAL_ORIGIN" not in without_origin.stdout
```

- [ ] **Step 7: Run both suites**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: PASS (15 tests).

Run: `cd frontend && npm test`
Expected: PASS, full frontend suite.

- [ ] **Step 8: Commit**

```bash
git add frontend/vite.config.ts frontend/tests/canonicalOrigin.test.ts Dockerfile \
  docker-compose.prod.yml tests/test_compose_prod_overlay.py
git commit -m "feat(frontend): absolutize link-preview metadata from VITE_CANONICAL_ORIGIN"
```

---

## Task 7: `docs/DEPLOY-VPS.md` — the runbook

The completion bar from the spec: "complete enough that re-provisioning from zero needs no outside
knowledge." Everything a human must do outside the box is a **USER STEP** heading; everything else is
a numbered operator section with a copy-pasteable command and an observable pass condition.

**Files:**
- Create: `docs/DEPLOY-VPS.md`
- Modify: `docs/DEPLOY.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Write `docs/DEPLOY-VPS.md`**

Structure (write it in this order; keep every command runnable as-is, and use `compcat.app`
literally throughout):

1. **Title + one-paragraph scope.** What this builds: an always-on public instance at
   `https://compcat.app` from a fresh Ubuntu 24.04 box — anonymous sessions, reported SPD incident
   context, no user accounts. Point at the spec and at `docs/DEPLOY.md` for the ThinkPad/trial story.
   State the shape up front: Docker Compose, four services (`db`, `api`, `caddy`, ops sidecar),
   three open ports.

2. **USER STEPS (do these before touching a terminal).** Marked clearly as things the operator must
   do in a browser, with an account, or with a credit card — none of them scriptable:
   - **U1. Create the server.** Any provider; Ubuntu 24.04 LTS, **2 vCPU / 4 GB RAM / 40 GB disk**,
     SSH key at creation (never a password). Note the public IPv4. Sizing rationale: the ~100 MB
     PMTiles extract, a Postgres holding a few million incident rows, and one Python process.
   - **U2. Point DNS.** An `A` record for `compcat.app` (and, if you want it, `www`) at that IP,
     TTL 300 while you are setting up. Verify with `dig +short compcat.app` **before** starting the
     stack — Caddy's certificate request fails if the name does not resolve to the box yet.
   - **U3. Have the keys ready.** A Groq key (bring-up), an Anthropic key (production Analyst), and
     a contact email for `MCA_GEOCODER_CONTACT_EMAIL` that you actually read.
   - **U4. Create an uptime-monitor account** (any service with a free tier) and, once §6 is
     reachable, add two checks: `https://compcat.app/` (expect 200) and
     `https://compcat.app/health/data` (expect 200; it returns 503 the moment any layer's data ages
     past `MCA_DATA_STALENESS_DAYS`). Alert to an address you read.

3. **§1 Host hardening.** As a numbered command list, run over SSH as root:
   - `adduser --disabled-password deploy && usermod -aG sudo,docker deploy` (docker group after §2)
     and copy the authorized key across.
   - `ufw default deny incoming` / `ufw default allow outgoing` / `ufw allow 22,80,443/tcp` /
     `ufw allow 443/udp` (HTTP/3) / `ufw enable`; show `ufw status` as the pass condition.
   - Key-only SSH: `PasswordAuthentication no`, `PermitRootLogin prohibit-password` in
     `/etc/ssh/sshd_config.d/10-compcat.conf`, `systemctl reload ssh`. **Open a second session
     before closing the first** — the standard lockout warning.
   - `unattended-upgrades`: `apt install unattended-upgrades` +
     `dpkg-reconfigure -plow unattended-upgrades`; pass condition is
     `systemctl status unattended-upgrades`.
   - Note what is deliberately absent (fail2ban, auditd) and why: three ports, key-only SSH.

4. **§2 Docker CE.** The official `get.docker.com` convenience script or the apt repo steps, then
   `usermod -aG docker deploy`, log out/in, pass condition `docker compose version` ≥ v2.24 (the
   overlay uses the `!reset` merge tag).

5. **§3 Clone and configure.** `git clone` into `/opt/compcat` (or `~/compcat`), `chown` to `deploy`;
   `cp .env.prod.example .env.prod`; generate the four secrets with the exact `openssl rand` lines;
   the POSTGRES_PASSWORD / MCA_DATABASE_URL agreement warning; `chmod 600 .env.prod`. Then
   `make fetch-tiles` (~100 MB; the app boots without it but the map renders flat, with a notice) —
   note the `SSL_CERT_FILE` workaround from `docs/DEPLOY.md` if the fetch hits
   `CERTIFICATE_VERIFY_FAILED`.

6. **§4 First bring-up.** `scripts/prod/start-compcat.sh`. Explain what it does in five bullets
   (compose up with the prod overlay and the `ops` profile → wait for `/health` inside the api
   container → check `/dashboard/freshness` → run the sidecar's ingest script when data is older
   than 14 days → print status). Note the build passes `VITE_CANONICAL_ORIGIN` from `.env.prod`, so
   link previews come out absolute. Certificate issuance: the first `https://compcat.app/` hit takes
   ~30 s; if it does not come up, `docker compose … logs caddy` and check the A record — Caddy
   retries on its own. Pass condition: `curl -sI https://compcat.app/ | head -1` → `HTTP/2 200`.

7. **§5 First ingest.** The start script covers it automatically on an empty database, but a full
   backfill of three layers takes a while — show how to watch it
   (`docker compose … logs -f ingest-cron`) and how to re-run it by hand
   (`docker compose … exec ingest-cron /bin/sh /etc/ingest/run.sh`). Pass condition:
   `/health/data` returns 200 and the dashboard's "Data through" pill shows a recent date. Note the
   nightly schedule: ingest 03:10, backup 03:40, both America/Los_Angeles.

8. **§6 Backup restore rehearsal (do this once, before launch).** Numbered, with commands:
   1. Force a dump now instead of waiting for 03:40:
      `docker compose … exec ingest-cron /bin/sh /etc/ingest/backup.sh`.
   2. Confirm the archive: `docker compose … exec ingest-cron ls -lh /backups`.
   3. Note the row-count truth to compare against — read `/dashboard/freshness` (via
      `https://compcat.app/dashboard/freshness` with a session cookie, or the `incident_count` in
      the same call the start script makes) and write down `incident_count` per layer.
   4. Start a scratch Postgres **on the same compose network** and restore into it:
      `docker run -d --name compcat-restore-rehearsal --network <project>_default -e POSTGRES_PASSWORD=… -e POSTGRES_USER=mca -e POSTGRES_DB=mca postgres:16`,
      then
      `docker compose … exec -T ingest-cron sh -c 'PGPASSWORD=… pg_restore -h compcat-restore-rehearsal -U mca -d mca --no-owner /backups/compcat-YYYY-MM-DD.dump'`.
   5. Row-count sanity: `psql -c "select count(*) from crime_incidents"` (and the arrests/calls
      tables) against the scratch container, compared with the `incident_count` values from step 3.
      They should match, modulo anything ingested since the dump.
   6. `docker rm -f compcat-restore-rehearsal`. State the pass condition explicitly: **a restore you
     have not rehearsed is not a backup.**
   Then the rotation policy (7 daily + 4 weekly Sunday archives in the `backups` volume) and the
   optional offsite step: `rclone copy` from a host-side mount of the volume to a remote **you
   provide** — documented, not required.

9. **§7 Launch checklist.** Each item with its observable pass condition:
   - DNS + TLS: `dig +short compcat.app` matches the box; `curl -sI https://compcat.app/` → 200; the
     certificate is Let's Encrypt and not self-signed (`openssl s_client -connect compcat.app:443`).
   - Ingress is only Caddy: from another machine, `nc -vz compcat.app 8000` and `… 5432` both refuse.
   - **Boot-guard negative test:** temporarily set `MCA_RATE_LIMIT_ENABLED=false` in `.env.prod`,
     `docker compose … up -d api`, confirm the container exits with the `ValidationError` naming
     `MCA_RATE_LIMIT_ENABLED`, then restore `true` and restart. This proves the slice-1 rail is armed
     on the real box.
   - End-to-end over the domain: address lookup → analyze → compare → CSV export; Analyst answers
     within the caps and shows the offline panel when the key is pulled; a 21st Analyst call in an
     hour is refused with the request-limit message.
   - Soak: `docs/soak-testing.md`, run on the box with `--env-file .env.prod` substituted for
     `.env.deploy` in the observer's psql command; record p50/p95/p99 against the thresholds there.
     This closes the pending H2 run.
   - Invariant panel sweep: click through every panel and confirm the fixed methodology caveat is the
     only occurrence of "risk" in the UI, and that nothing scores or ranks a place.
   - Only after all of the above: add the live link to `README.md`.

10. **§8 Teardown / compromise.** `scripts/prod/stop-compcat.sh` for a normal stop;
    `docker compose … down -v` to destroy the database, the certificates **and the backups volume**
    (say so plainly); revoke the Anthropic and Groq keys at their consoles; rotate
    `MCA_ADMIN_INGEST_TOKEN`; remove the SSH key and destroy the server; delete the `compcat.app` A
    record. Blast radius statement: public SPD data plus ephemeral anonymous sessions — no user
    accounts, no personal uploads (they are off), no payment data.

11. **Routine operations** appendix: deploying a new commit (`git pull` +
    `scripts/prod/start-compcat.sh`), reading logs per service, where the nightly jobs log, and the
    fact that `restart: unless-stopped` brings the stack back after a host reboot with the start
    script's ingest-if-stale covering the gap.

Write the full compose invocation once, near the top, and refer to it as `compose …` afterwards:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile ops --env-file .env.prod
```

- [ ] **Step 2: Cross-link the neighbouring docs**

In `docs/DEPLOY.md`, add a pointer directly under the H1 (before "This runs the whole app"):

```markdown
> **Public VPS instance?** This document is the single-host trial (ThinkPad, HTTP, ~5 testers).
> For the always-on public instance at compcat.app — TLS, hardening, nightly ingest and backups —
> see [`DEPLOY-VPS.md`](DEPLOY-VPS.md).
```

and one line at the end of its "Backup / restore" section:

```markdown
On the public VPS this is automated (nightly `pg_dump` with rotation) — see
[`DEPLOY-VPS.md`](DEPLOY-VPS.md) §6, which also carries the restore rehearsal.
```

In `docs/DEMO.md`, replace the "The 'for-real' launch (deferred)" section (lines 44-47) with:

```markdown
## The "for-real" launch (built)

The always-on public instance at **compcat.app** is now documented end to end in
[`DEPLOY-VPS.md`](DEPLOY-VPS.md): the same env vars and limiter on a small VPS, TLS via Caddy,
nightly ingest and backups. Nothing in this demo path changed — the ThinkPad quick tunnel remains
the two-minute option for showing CompCat to someone in person.
```

In `docs/README.md`, add after the `DEPLOY.md` entry (line 33):

```markdown
- **`DEPLOY-VPS.md`** — public-instance runbook: provisioning, hardening, TLS, nightly
  ingest/backup, restore rehearsal, launch checklist and teardown for compcat.app.
```

- [ ] **Step 3: Check the copy invariant and the links**

```bash
grep -niE '\b(safe|unsafe|safety|danger|dangerous|risk|risky)\b' docs/DEPLOY-VPS.md
```

Expected: no matches — with one permitted exception, the launch-checklist line that *names* the
invariant sweep ("the fixed methodology caveat is the only occurrence of 'risk' in the UI"). Quote
it there so the grep reads as deliberate, and note it in the hand-back.

Then verify every relative link resolves:

```bash
grep -oE '\]\(([^)]+)\)' docs/DEPLOY-VPS.md docs/DEPLOY.md docs/DEMO.md docs/README.md \
  | sed 's/.*(\(.*\))/\1/' | grep -v '^http' | sort -u \
  | while read -r target; do [ -e "docs/${target%%#*}" ] || echo "BROKEN: $target"; done
```

Expected: no `BROKEN:` lines.

- [ ] **Step 4: Commit**

```bash
git add docs/DEPLOY-VPS.md docs/DEPLOY.md docs/DEMO.md docs/README.md
git commit -m "docs(deploy): VPS bring-up runbook for the public instance"
```

---

## Task 8: Roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Update the Phase 8 block**

In `docs/ROADMAP.md` (lines 363-376), check off slices 1–3 with their PR numbers and restate slice 4
as repo-side shipped:

```markdown
- [x] **Slice 1 — Safety rails (#168):** LLM boot guard (prod-like + hosted key + limiter off →
  refuse boot), daily token budget (`MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY`) charged by every LLM
  client and enforced before each upstream call, boot-time posture warnings, and
  `docker-compose.prod.yml` (no published 5432, required DB password) with a CI render assertion.
- [x] **Slice 2 — Trust surface (#167):** in-app About/Privacy panel (ⓘ in topbar; invariant,
  scope, storage, honest limits), favicon + meta/OG tags, session-ephemerality hints,
  error-copy hygiene, "Export CSV" label unification, pinch-zoom restore, SPD/NIBRS glosses.
- [x] **Slice 3 — Freshness automation (#169):** compose `ops` cron sidecar driving the existing
  admin ingest daily per layer; `GET /health/data` staleness probe (200/503, schema-hidden) for
  external monitoring; container liveness stays on `/health`.
- [x] **Slice 4 — VPS bring-up — repo-side shipped; bring-up pending on the operator steps in
  `docs/DEPLOY-VPS.md`:** Caddy TLS edge as the only ingress (api no longer publishes 8000),
  `X-Forwarded-For` client identity, `.env.prod.example` (Anthropic primary + Groq fallback),
  `scripts/prod/` start/stop with ingest-if-stale, nightly `pg_dump` with 7-daily/4-weekly
  rotation, absolute link-preview metadata via `VITE_CANONICAL_ORIGIN`, and the full runbook.
  **Still manual, on the box:** create the server, point `compcat.app` DNS, fill `.env.prod` with
  real keys, run the start script, rehearse the restore, create the uptime monitor, run the soak
  (closes the pending H2 run), then add the live link to the README.
```

Also amend the Phase 8 header paragraph (line 361) so the domain is no longer open: replace
`new domain to register` with `compcat.app as the registered domain`.

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): tick Phase 8 slices 1-3 and record slice 4 as repo-side shipped"
```

---

## Task 9: Full gate

- [ ] **Step 1: Run `make test-all` from the worktree root**

Run: `make test-all`
Expected: green — pytest (backend: 802 baseline + ~13 new), `ruff check .` clean, frontend
`npm test` green (including the 7 new canonical-origin cases), `npm run build` succeeds.

If `make test` reports a stale-shebang error, run the suite as `.venv/bin/python -m pytest tests -q`
and treat that as the pytest leg.

- [ ] **Step 2: Confirm the working tree is clean of build artifacts**

Run: `git status --porcelain`
Expected: empty. In particular `app/static/dashboard/` (rebuilt during Tasks 6 and 9) is gitignored
and must not appear; `.env.prod` must not exist in the worktree.

- [ ] **Step 3: Confirm the slice completion criteria**

From the spec (parent-spec items 1, 2, 5, 6 plus this slice's own), restated as a checklist:

- [ ] **1. The prod render exposes only the Caddy edge.** `tests/test_compose_prod_overlay.py::
  test_rendered_overlay_publishes_only_the_caddy_edge` (no 5432, no 8000, 80 + 443 + 443/udp
  present) and `::test_rendered_caddy_mounts_the_repo_caddyfile_read_only`, plus the updated CI
  docker-lane step.
- [ ] **2. Behind the edge, each visitor gets their own rate bucket.**
  `tests/test_ratelimit.py::test_client_ip_uses_forwarded_for_with_trust` and
  `::test_forwarded_for_takes_the_leftmost_hop`; middleware parity by
  `tests/test_ratelimit_api.py::test_trusted_forwarded_for_separates_clients_through_the_middleware`;
  the untrusted case still refuses the header
  (`::test_spoofed_forwarded_for_ignored_without_trust`).
- [ ] **3. Backups run and are restorable.** Structurally by the three `backup-daily` tests and the
  ops-profile render; behaviorally by the Task 4 Step 7 live smoke (crond fires it; `pg_dump` failure
  and the no-password refusal both land in `docker logs`); the restore itself is the runbook's §6
  rehearsal, which is an operator step by design.
- [ ] **4. `.env.prod.example` is a complete, bootable posture.** Task 3 Step 2 renders the overlay
  from it and constructs `Settings` with the same combination, and flipping
  `MCA_RATE_LIMIT_ENABLED=false` reproduces the slice-1 refusal.
- [ ] **5. A shared link unfurls with an absolute card when the origin is set, and the repo default
  is unchanged.** `frontend/tests/canonicalOrigin.test.ts` (both branches) and the Task 6 Step 5
  built-output check; `frontend/tests/indexHtml.test.ts` is untouched and still green, which is the
  proof that `index.html` itself did not change.
- [ ] **6. `docs/DEPLOY-VPS.md` needs no outside knowledge.** Every user step is marked, every
  operator section has a command and a pass condition, and teardown is written down.
- [ ] **7. `make test-all` green** (Step 1).
- [ ] **Invariant:** no product copy changed — `git diff --stat` touches no file under
  `frontend/src/` and no assistant/agent module; the only rendered change is the OG/Twitter
  `content` attributes becoming absolute. The place-safety grep over
  `docs/DEPLOY-VPS.md`, `.env.prod.example`, `scripts/prod/*.sh`, `deploy/*` is clean except the one
  quoted invariant-sweep line in the launch checklist.

- [ ] **Step 4: Hand back to the orchestrator**

Do not push and do not open a PR from this worktree (per the delivery workflow). Report: the commit
list, `git diff --stat`, backend/frontend test counts before and after, the live-verification log
excerpts from Task 4 Step 7, any deviations, and — most importantly — the exact list of operator
steps that remain manual (the USER STEPS plus §4–§7 of the runbook).

---

## Deviations recorded up front

- **`VITE_CANONICAL_ORIGIN` needs a Dockerfile change.** The scope says "the runbook's build step
  sets `VITE_CANONICAL_ORIGIN`", but the image builds the frontend inside itself (`Dockerfile:1-7`),
  so a host-side `npm run build` is overwritten by the image build. The minimum that makes the
  runbook's instruction true is `ARG`/`ENV` in the frontend stage plus a list-form `build.args`
  entry in the overlay — both added in Task 6. Nothing else in the Dockerfile changes and the
  default (unset) build is byte-identical to today's.
- **The crontab test's "exactly one schedule line" assertion is replaced, not extended.**
  `tests/test_compose_prod_overlay.py::test_crontab_fires_once_daily_and_holds_no_secret` asserts
  `len(schedule_lines) == 1`; the backup job makes that false by construction. The replacement
  asserts both lines individually (schedule **and** target script), which is strictly stronger.
- **Sunday archives are hard links, not a second dump.** "Keep 7 daily + 4 weekly (keep Sundays)"
  is implemented by linking Sunday's archive under a `compcat-weekly-` name so the two prune passes
  are independent globs. Same inode, no extra space, and no date parsing back out of filenames
  (busybox `date -d` is too limited to rely on).
- **The start script's freshness check runs Python inside the api container.** The api image is
  `python:3.11-slim` with no `curl`, and the prod overlay publishes no app port, so the demo
  script's host-side `Invoke-RestMethod` has no bash equivalent. The embedded program is the same
  two calls (`POST /sessions`, `GET /dashboard/freshness`) with the same null-means-stale rule.
  `/health/data` was rejected for this: it is session-free but only reports layers already past
  `MCA_DATA_STALENESS_DAYS`, so it cannot answer a 14-day question.
- **The ingest leg reuses `deploy/ingest-daily.sh` via the ops sidecar** rather than re-implementing
  the three admin POSTs in bash. It means the bring-up path and the nightly path cannot drift, and
  it is why the start script always passes `--profile ops`.
- **Caddy's `depends_on` is the short form.** A `service_healthy` condition would hold the edge down
  while the api migrates — and the ACME HTTP challenge needs port 80 answered promptly.

## Out of scope (do not do here)

- Actually provisioning the box, buying anything, creating the uptime-monitor account, or running
  the soak. Those are the operator steps the runbook enumerates; this slice ships the instructions.
- Adding the live link to `README.md` — the spec gates that behind the launch checklist passing on
  the real box.
- Any change under `frontend/src/`, any user-facing string, any assistant/guard behavior.
- `docker-compose.yml` and `docker-compose.demo.yml`: the dev and demo paths must render and behave
  exactly as they do today (`git diff --stat` must show neither).
- CI/CD auto-deploy, multi-box/HA, CDN, IPv6-only setups, Kubernetes, offsite backup automation
  (the `rclone` step stays documented-but-manual).
- Migrating the ThinkPad personal instance or the demo-on-demand path.
