# Public instance, slice 4 — VPS bring-up — design

**Date:** 2026-07-27 · **Status:** approved design, pre-plan.
**Scope:** the ops slice — a provider-agnostic runbook plus in-repo scripts/config that take
a fresh Linux VPS to a hardened, TLS-terminated, backed-up CompCat at the registered domain.
Depends on slices 1–3 being merged. Parent: `2026-07-27-public-instance-design.md`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Provider | **Deliberately open** — runbook targets "any Ubuntu 24.04 LTS box, 2 vCPU / 4 GB / 40 GB"; the create-server step is a placeholder with per-provider pointers | User decision 2026-07-27 ("decide later"); the stack is plain Docker Compose and does not care |
| TLS | **Caddy container in the prod overlay** (ports 80/443, automatic Let's Encrypt, `reverse_proxy app:8000`) | Zero-config certificates, no Cloudflare dependency, one small image; a named tunnel remains a documented alternative for home-hosting scenarios |
| Client IP | Caddy sets `X-Forwarded-For`; limiter trusts it via the existing `MCA_TRUST_PROXY_HEADERS` mechanism (extended from `CF-Connecting-IP` to the standard header behind our own proxy) | Without it every visitor shares one rate bucket — the demo already solved this for cloudflared |
| LLM posture | `.env.prod.example` ships **Anthropic primary + Groq fallback**, keys blank; bring-up may start Groq-only until the Anthropic key is added | User decision: Groq wired for setup, Anthropic is prod; failover composes via existing config |
| Env posture | `MCA_ENVIRONMENT=production`, limiter ON (demo caps as the starting point), token budget set, uploads OFF, internal tier OFF, secure cookies on (automatic), fresh secrets | Slice-1 guards make the unsafe variants unbootable or loudly warned |
| Backups | Nightly `pg_dump` via the `ops` sidecar (03:40, after ingest) into a `backups/` volume; keep 7 daily + 4 weekly; restore rehearsed once in the runbook | "Cron it yourself" was the review's gap; offsite copy (rclone) documented as an optional step, not required |
| Monitoring | External uptime checks on `/` and `/health/data`; choosing the service and creating its account is a **user step** in the runbook | Free tiers (e.g. UptimeRobot) suffice; account creation isn't scriptable and shouldn't be |
| Docs | New **`docs/DEPLOY-VPS.md`**; `docs/DEPLOY.md` stays the ThinkPad/trial doc with cross-links both ways; `docs/DEMO.md`'s "for-real launch" note updated to point here | The two deploy stories serve different machines; don't force one doc to be both |
| Launch gate | Soak-harness run (`docs/soak-testing.md`) against the live box **before** the README link swap | The multi-hour Postgres soak has been pending since H2; the public box is the right place to finally run it |

## Prerequisites (user steps, listed at the top of the runbook)

1. Pick a provider; create the Ubuntu 24.04 box with an SSH key.
2. Register the chosen domain (shortlist delivered separately) and point an A record at the box.
3. Have keys ready: Groq (setup), Anthropic (prod), plus a `MCA_GEOCODER_CONTACT_EMAIL` value.
4. Create the uptime-monitor account when the runbook reaches monitoring.

## Components

### 1. Host hardening (runbook §1, scripted where safe)

`ufw` allow 22/80/443 deny-else; SSH key-only auth (`PasswordAuthentication no`);
`unattended-upgrades` for security patches; a non-root deploy user in the `docker` group.
Deliberately minimal — no fail2ban/auditd baseline; the attack surface is three ports.

### 2. Stack bring-up (runbook §2 + `scripts/prod/`)

Install Docker CE + compose plugin; clone the public repo; `cp .env.prod.example .env.prod`
and fill (fresh `openssl rand` secrets — the slice-1/existing validators refuse defaults);
`make fetch-tiles` on the box (~100 MB PMTiles); `scripts/prod/start-compcat.sh` — compose up
(`base + prod` overlays, `ops` profile) → wait `/health` → ingest-if-stale (ported from the
demo start script) → print status. A matching `stop-compcat.sh`. Both bash, mirroring the
demo scripts' shape.

### 3. Edge (`deploy/Caddyfile` + prod overlay service)

Caddy 2 service; the Caddyfile is three lines (domain, reverse_proxy, gzip). App container
stops publishing 8000 on the host in the prod overlay (Caddy is the only ingress).
`MCA_TRUST_PROXY_HEADERS=true` with the standard-header extension noted above (small backend
change, tested like the existing CF header path).

### 4. Backups (`ops` sidecar cron + runbook §4)

Nightly `pg_dump -Fc` to `backups/` with date-stamped names; prune to 7 daily + 4 weekly.
Restore rehearsal is a numbered runbook section (`pg_restore` into a scratch container,
row-count sanity vs `/dashboard/freshness`) executed once before launch. Optional offsite
rclone step documented with a "requires your own remote" caveat.

### 5. Launch checklist (runbook §6)

DNS resolves + HTTPS green; boot-guard negative test (limiter off → refuses); e2e pass over
the domain (lookup → analyze → compare → export; Analyst within caps; offline state when the
key is pulled); `/health/data` monitored; soak pass meets thresholds; then the README gets
the live link and the OG `url` meta lands (coordinated with slice 2's metadata).

## Error handling

- Cert issuance fails (DNS not propagated) → Caddy retries automatically; runbook notes the
  symptom and the `docker logs caddy` check.
- Box reboot → `restart: unless-stopped` brings the stack back; start script's
  ingest-if-stale covers the gap; monitoring catches anything that doesn't return.
- Compromise/teardown → runbook §7: `docker compose down -v`, revoke keys, delete DNS —
  the full blast radius is one box with public data + ephemeral sessions.

## Testing

- In CI: prod overlay + Caddyfile validated via `docker compose config` render; the
  `X-Forwarded-For` trust path unit-tested beside the existing CF-header tests.
- On the box (runbook-verified, like the demo slice): the launch checklist above **is** the
  test plan; each item has an observable pass condition.

## Invariant checkpoint

Runbook and Caddyfile contain no product copy. The e2e checklist reuses the live invariant
spot-check (panel sweep: the fixed caveat is the only "risk" occurrence).

## Non-goals

- Multi-box/HA, CDN, IPv6-only exotica, Kubernetes.
- CI/CD auto-deploy to the box (deploys stay `git pull` + restart via runbook; automation
  can be a later follow-up).
- Migrating the ThinkPad personal instance or demo-on-demand (both keep working as-is).

## Slice completion criteria

The phase completion criteria in the parent spec, items 1, 2, 5, 6 — this slice is where
they become checkable, plus: `docs/DEPLOY-VPS.md` complete enough that re-provisioning from
zero needs no outside knowledge, and `docs/DEMO.md`/`docs/DEPLOY.md` cross-links updated.
