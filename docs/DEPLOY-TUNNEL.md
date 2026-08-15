# Public instance runbook — compcat.app from the ThinkPad, via a named Cloudflare tunnel

This document takes the **Windows ThinkPad to an always-on public CompCat at
<https://compcat.app>** for **zero recurring cost**: TLS-terminated by Cloudflare, rate-limited,
ingesting SPD data nightly, backing itself up nightly, and monitored from outside. It assumes no
prior knowledge of the deployment — following it top to bottom is enough to re-provision from
zero.

It is the **zero-cost alternative to [`DEPLOY-VPS.md`](DEPLOY-VPS.md)**, not a replacement for it.
Everything except the edge is identical: the same images, the same `.env` posture, the same
production overlay, the same nightly ops sidecar, the same backup and restore drill. What changes
is how traffic arrives — Cloudflare terminates TLS at its own edge and a `cloudflared` container
dials **out** to reach it, so there is no Caddy, no certificate to renew, no published host port,
no inbound firewall hole and no public IP. The trade-offs are stated plainly in
[§8](#8-what-this-trades) and the migration path back to the VPS is unchanged.

What this is *not*: an operated multi-user service. CompCat stays anonymous-session-based (no
accounts, no sign-in), reports **reported Seattle SPD incident context**, and keeps personal
location-history uploads switched off.

For the private ThinkPad instance over plain HTTP on the LAN, see [`DEPLOY.md`](DEPLOY.md). The
public site is a separate deployment on the same machine, with its own database and secrets.

## The shape of it

Four containers under one `docker compose` project, **zero open ports on the host**:

| Service | Image | Reachable from | What it does |
|---|---|---|---|
| `cloudflared` | `cloudflare/cloudflared:2026.7.3` | nothing (outbound only) | Holds the tunnel to Cloudflare's edge and forwards requests to `api:8000`. The **only** ingress. |
| `api` | built from this repo | compose network only | FastAPI + the built React UI on `api:8000`. |
| `db` | `postgres:16` | compose network only | Data. Never published on the host. |
| `ingest-cron` | built from `deploy/ingest-cron.Dockerfile` | compose network only | 03:10 SPD ingest, 03:40 `pg_dump` backup, 03:50 retention sweep. `ops` profile. |

`caddy` is defined by the production overlay but parked on a profile nothing activates, so it
never starts here and 80/443 are never bound. `docker-compose.tunnel.yml` explains the mechanic.

### Two instances, one laptop

The ThinkPad runs two CompCat stacks. **They must stay isolated**, and the Compose
project name is what does it:

| Project | Env file | Exposure | Personal uploads |
|---|---|---|---|
| `compcat` | `.env.deploy` | host `:8000`, LAN only | **ON** — real personal data. Never expose this one. |
| `compcat-public` | `.env.tunnel` | named tunnel only, no host port | off |

Each project gets its own prefixed volumes (`compcat-public_mca-postgres`,
`compcat-public_backups`, …), so no database, backup archive or network is ever shared.
`scripts/public/start-public.ps1` always passes `-p compcat-public`; do not run these compose
files without it.

Every command below uses one compose invocation. Define it once per PowerShell session:

```powershell
function compose {
    docker compose -p compcat-public `
        -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml `
        --profile ops --env-file .env.tunnel @args
}
```

`scripts/public/start-public.ps1` and `stop-public.ps1` wrap the same invocation, so you rarely
need it directly — but the log/exec commands in this runbook do.

---

## USER STEPS — do these first

These need a browser, an account, or a registrar login. None of them is scriptable, and the
operator sections below assume all seven are done, in this order.

### U1. Create a free Cloudflare account

<https://dash.cloudflare.com/sign-up>. Email + password, then confirm the verification email. No
payment method is required for this step. Use an address you actually read — expiry and abuse
notices go there.

### U2. Add `compcat.app` as a zone

In the dashboard: **Add a site** → enter `compcat.app` → choose the **Free** plan. Cloudflare
scans the existing DNS records and shows you **two nameservers** assigned to your account (they
look like `xxx.ns.cloudflare.com`). Write them down.

### U3. Point the registrar at those nameservers

At whoever `compcat.app` is registered with, replace the current nameservers with the two from
U2. This hands DNS for the whole domain to Cloudflare — it is the step that makes everything else
possible, and it is the only change at the registrar.

Cloudflare emails you when the zone goes **Active**; it usually takes minutes but can take up to
24 hours. Verify from any machine:

```bash
dig +short NS compcat.app        # must list the two Cloudflare nameservers
```

Do not continue until the zone is Active — a tunnel route added before then has nothing to
attach to.

### U4. Create the named tunnel and copy its token

In the dashboard: **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → connector
type **Cloudflared** → name it `compcat` → **Save**.

The next screen shows install snippets per platform. Pick **Docker**. The command it displays
ends with `--token eyJhIjoi…` — **copy that token string** (just the token, not the whole
command). That is `CLOUDFLARE_TUNNEL_TOKEN` in §2.

Leave the tunnel page open; U5 finishes the configuration.

> **If the Zero Trust onboarding demands a payment method** (Cloudflare sometimes asks for a card
> to activate the Free Zero Trust plan), use the CLI path instead. It creates a *locally managed*
> tunnel, which needs a credentials file and an ingress config rather than a dashboard-managed
> token:
>
> ```powershell
> winget install Cloudflare.cloudflared
> cloudflared tunnel login                          # browser → authorize compcat.app → writes cert.pem
> cloudflared tunnel create compcat                 # writes %USERPROFILE%\.cloudflared\<UUID>.json
> cloudflared tunnel route dns compcat compcat.app  # creates the CNAME (this replaces U5)
> ```
>
> Then, next to `%USERPROFILE%\.cloudflared\<UUID>.json`, write `config.yml`:
>
> ```yaml
> tunnel: compcat
> credentials-file: /etc/cloudflared/<UUID>.json
> ingress:
>   - hostname: compcat.app
>     service: http://api:8000
>   - service: http_status:404
> ```
>
> and add a fourth overlay file (`docker-compose.tunnel.local.yml`, kept out of git) that swaps
> the container onto it:
>
> ```yaml
> services:
>   cloudflared:
>     command: tunnel --no-autoupdate --config /etc/cloudflared/config.yml run compcat
>     volumes:
>       - ${USERPROFILE}/.cloudflared:/etc/cloudflared:ro
> ```
>
> Compose interpolates every file **before** it merges them, so `CLOUDFLARE_TUNNEL_TOKEN` must
> still be set for the render to succeed even though the command that used it is replaced — put
> `CLOUDFLARE_TUNNEL_TOKEN=unused-locally-managed` in `.env.tunnel`. Add
> `-f docker-compose.tunnel.local.yml` after the tunnel overlay in every compose invocation
> (including the two scripts). Keep the credentials JSON out of the repo: it is equivalent to the
> token.

### U5. Add the public hostname `compcat.app` → `http://api:8000`

On the tunnel's **Public Hostname** tab: **Add a public hostname**.

| Field | Value |
|---|---|
| Subdomain | *(leave empty — this is the apex)* |
| Domain | `compcat.app` |
| Path | *(leave empty)* |
| Type | `HTTP` |
| URL | `api:8000` |

Save. Cloudflare creates the proxied DNS record for you; there is no A record to manage and no IP
anywhere in this setup.

`api:8000` is not a typo and not `localhost`: `cloudflared` runs **inside the compose network**,
where `api` is the service's DNS name. Plain HTTP is correct — that hop never leaves the Docker
bridge, and the tunnel itself is encrypted.

*(If you took the CLI fallback in U4, that ingress lives in your `config.yml` instead and this
step is already done.)*

### U6. Have the credentials ready

- An **Anthropic** API key — <https://console.anthropic.com>. This is the production Analyst
  backend.
- A **Groq** API key — <https://console.groq.com/keys>. Free tier; the failover backend, and the
  bring-up backend if the Anthropic key does not exist yet (see the Groq-only note in
  `.env.tunnel.example`).
- A **contact email** for `MCA_GEOCODER_CONTACT_EMAIL`. Nominatim's usage policy requires an
  identifiable contact in production and the app refuses to boot without one.

### U7. Create an uptime-monitor account

Any service with a free tier (UptimeRobot, Better Stack, Healthchecks.io, …). Once §4 is
reachable, add two checks:

| URL | Expect | Catches |
|---|---|---|
| `https://compcat.app/` | 200 | the laptop is asleep/off, Docker is down, or the tunnel dropped |
| `https://compcat.app/health/data` | 200 | data aged past `MCA_DATA_STALENESS_DAYS` (default 7) — a missed 03:10 ingest (laptop off overnight), a rejected admin token, or a Socrata outage |

Point alerts at an address you read. `/health/data` is deliberately **not** the container health
check: stale data must page a human, never restart-loop the app. On this posture the first check
is the one that matters most — see [§8](#8-what-this-trades).

---

## §1 The ThinkPad side

1. **Docker Desktop**, started at login (Settings → General → *Start Docker Desktop when you sign
   in*). Then:

   ```powershell
   docker compose version
   ```

   Pass condition: **v2.24 or newer**. The overlays use the `!reset` merge tag, which older
   Compose versions ignore silently — which would leave Postgres published on the host.

2. **Sleep is the enemy of uptime.** A sleeping laptop is a down site. On AC power, set *Sleep →
   Never* and *Hard disk → Never* in Windows power settings, and leave the lid-close action as
   *Do nothing* if it stays docked. Nothing in this stack can work around a suspended host.

3. **The checkout.** Use the ThinkPad's existing pull-only clone (the same one
   `scripts/start-compcat.ps1` runs from) and update it before a deploy:

   ```powershell
   cd <repo>
   git pull --ff-only
   ```

4. **Basemap tiles** (~100 MB, one time). `start-public.ps1` fetches them if they are missing, but
   they are probably already there from the personal instance:

   ```powershell
   python scripts\fetch_tiles.py
   ```

   Pass condition: `app\data\tiles\seattle.pmtiles` exists and is ~100 MB. The app boots without
   it — the map renders flat with a notice — so this is not blocking.

---

## §2 Configure

```powershell
copy .env.tunnel.example .env.tunnel
```

Fill in `.env.tunnel`. Every placeholder reads `__like this__`; the file's own comments explain
each value. Generate fresh secrets (Git Bash, WSL, or the Python one-liner in the file):

```bash
openssl rand -hex 32     # MCA_SESSION_SECRET
openssl rand -hex 32     # MCA_USER_HASH_SALT
openssl rand -hex 24     # MCA_ADMIN_INGEST_TOKEN
openssl rand -hex 24     # POSTGRES_PASSWORD
```

> **The two database values must agree.** `POSTGRES_PASSWORD` initializes the Postgres container
> on its very first boot; `MCA_DATABASE_URL` is how the app connects. Paste the same generated
> password into both, and paste it before the first `up` — changing `POSTGRES_PASSWORD` after the
> volume exists does **not** change the password already stored in it.

> **Fresh secrets, not the personal instance's.** `.env.tunnel` is a different instance with a
> different database. Reusing `.env.deploy`'s salt or session secret would tie the public site's
> anonymous identities to your own.

Then paste the **tunnel token from U4** into `CLOUDFLARE_TUNNEL_TOKEN`, the Anthropic key, the
Groq key and the geocoder contact from U6. Leave `MCA_RATE_LIMIT_ENABLED=true`,
`MCA_TRUST_PROXY_HEADERS=true`, `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=false` and
`MCA_INTERNAL_TIER_ENABLED=false` exactly as shipped — the first is enforced at boot (the app
refuses to start with a hosted LLM key and the limiter off), the second is what makes the limiter
see real client IPs, and the last two are the public posture.

**Why `MCA_TRUST_PROXY_HEADERS=true` is safe here and the Caddyfile does the opposite.** The
limiter reads `CF-Connecting-IP` first (`app/ratelimit.py`). On this posture Cloudflare **is** the
edge: it sets that header itself, every request arrives through `cloudflared`, and nothing else
can reach the app because no port is published — so the header is authoritative. On the VPS
posture Caddy is the edge and `deploy/Caddyfile` deliberately **strips** `CF-Connecting-IP`
(`header_up -CF-Connecting-IP`), because there a client could set it themselves and mint a fresh
rate bucket per request. Same header, opposite treatment, because the trusted hop is different.

`VITE_CANONICAL_ORIGIN=https://compcat.app` is baked into the frontend **at image build time**
(the production overlay passes it as a build arg), so link previews come out with absolute URLs.
It only takes effect on a build — which `start-public.ps1` always does.

**Zone settings:** keep *Always Use HTTPS* on. Disable **Web Analytics** so Cloudflare does not
inject a browser beacon; the app's `script-src 'self'` CSP is a backstop, not a substitute for
the account setting. If you ever enable *Rocket Loader*, turn it back off — it rewrites script
loading and can break the SPA.

---

## §3 First bring-up

```powershell
pwsh -File scripts\public\start-public.ps1
```

The script:

1. Validates `.env.tunnel` against the fail-closed public posture before Docker starts: production
   mode, secure cookies, rate limiting on, uploads/internal tier off, correct proxy trust, and
   every required secret/token present without example placeholders.
2. Waits for the Docker engine, and fetches basemap tiles if they are missing.
3. Builds and starts the stack with base + production + tunnel overlays and the `ops` profile
   (`db`, `api`, `ingest-cron`, `cloudflared`) under the project name `compcat-public`. The image
   build receives `VITE_CANONICAL_ORIGIN` from `.env.tunnel`.
4. Waits up to five minutes for `/health` — probed **inside** the api container, because this
   stack publishes no host port at all.
5. Mints a session, reads `/dashboard/freshness`, and backfills **each** layer that is missing or
   more than 14 days stale (`-SkipIngest` to skip; `-FreshnessMaxAgeDays` to change the window).
6. Prints service status, the tunnel's registered connections, the project's volume names, and
   the public URLs.

It is idempotent: `git pull` then re-running it is the normal way to deploy a new commit.

`git pull` does not overwrite the gitignored `.env.tunnel`. When adopting the deeper-testing
hourly limits, update the existing file once to
`MCA_RATE_LIMIT_ASSISTANT_PER_HOUR=60` and
`MCA_RATE_LIMIT_ASSISTANT_PER_IP_PER_HOUR=90`; keep the 500/day global ceiling and 2,000,000/day
token budget unchanged. Subsequent starts retain those explicit values.

**The tunnel.** `cloudflared` connects within a few seconds and logs four connections (one per
Cloudflare edge colo):

```powershell
compose logs cloudflared | Select-String 'Registered tunnel connection'
```

Pass condition:

```powershell
curl.exe -sI https://compcat.app/ | Select-Object -First 1     # HTTP/2 200
```

Common failures, in order of likelihood:

| Symptom | Cause |
|---|---|
| Cloudflare **Error 1033** / "Argo Tunnel error" | `cloudflared` is not running or not registered — check its logs; a bad token logs an auth failure and the container restarts. |
| Cloudflare **502** | The tunnel is up but the origin is not: the api is still migrating, or the U5 public hostname does not say exactly `http://api:8000`. |
| `DNS_PROBE_FINISHED_NXDOMAIN` | The zone is not Active yet (U3), or the U5 hostname was never saved. |

TLS needs no attention: Cloudflare issues and renews the certificate for the zone. There is no
ACME challenge to answer and no port 80 to keep open.

---

## §4 First ingest

On an empty database the start script backfills all three SPD layers (reported → arrests →
calls, sequentially). It takes a while — the 911-calls layer has a rolling 24-month window. Watch
it:

```powershell
compose logs -f ingest-cron
```

To run every layer by hand at any time:

```powershell
compose exec ingest-cron /bin/sh /etc/ingest/run.sh
```

Pass conditions:

- `curl.exe -s -o NUL -w "%{http_code}" https://compcat.app/health/data` → `200`
- the dashboard's "Data through" pill shows a recent date.

From here it is automatic: **03:10** ingest, **03:40** backup and **03:50** retention sweep, every
night, America/Los_Angeles (the sidecar sets `TZ` and ships `tzdata`, so the times do not drift
across DST). All three jobs log to the container log:

```powershell
compose logs ingest-cron | Select-String 'ingest-cron:|backup-daily:|retention-sweep:'
```

> A laptop that is off at 03:10 simply misses that night. The next `start-public.ps1` catches the
> data up, and `/health/data` (U7) is what tells you it lagged.

---

## §5 Backup restore rehearsal

Identical to the VPS path — same sidecar, same `pg_dump -Fc` archives in the `backups` volume,
same 7-daily + 4-weekly rotation. **Follow [`DEPLOY-VPS.md` §6](DEPLOY-VPS.md#6-backup-restore-rehearsal)**
with two substitutions:

- use the `compose` function defined at the top of this document (project `compcat-public`,
  three `-f` files, `--env-file .env.tunnel`) everywhere it says `compose`;
- the network name filter finds `compcat-public_default` — `docker network ls --format "{{.Name}}" | Select-String compcat-public`.

Do it **once before launch** and again after any Postgres upgrade. On this posture it matters
more than on the VPS: the dumps live on the same laptop as the database *and* the same laptop as
you, so a lost or reimaged ThinkPad loses everything at once. The optional offsite `rclone` copy
in that section is worth actually doing here.

**A restore you have not rehearsed is not a backup.**

---

## §6 Launch checklist

Every item has an observable pass condition. Work through it before advertising the URL.

1. **DNS and TLS are green.** From any machine with `dig` (the Mac, or WSL):
   ```bash
   dig +short NS compcat.app                            # the two Cloudflare nameservers
   dig +short compcat.app                               # Cloudflare anycast IPs (not your IP)
   curl -sI https://compcat.app/ | head -1              # HTTP/2 200
   echo | openssl s_client -connect compcat.app:443 -servername compcat.app 2>/dev/null \
     | grep -E 'issuer|Verify return code'
   ```
   Pass: the resolved addresses are Cloudflare's, **your home IP appears nowhere**, and
   `Verify return code: 0 (ok)`.

2. **Nothing is exposed but the tunnel.** On the ThinkPad:
   ```powershell
   compose ps                                     # no PORTS column entries at all
   compose config | Select-String 'published'     # no matches
   ```
   And from another machine on the LAN: `nc -vz <thinkpad-lan-ip> 8000` must be refused — that
   port belongs to the *personal* instance if anything answers, which is exactly why the public
   project publishes nothing.

3. **Isolation from the personal project.**
   ```powershell
   docker volume ls | Select-String compcat
   ```
   Pass: `compcat-public_mca-postgres` and `compcat-public_backups` exist and are **distinct**
   from `compcat_mca-postgres`. Then confirm the public site has no upload UI and
   `/input-modes` omits `personal_timeline`. For an authenticated session, `POST /uploads`
   returns 404; `DELETE /uploads` deliberately remains available for erasure.

4. **Boot-guard negative test.** Prove the spend rail is armed on this machine, not just in CI:
   ```powershell
   (Get-Content .env.tunnel) -replace '^MCA_RATE_LIMIT_ENABLED=true','MCA_RATE_LIMIT_ENABLED=false' | Set-Content .env.tunnel
   compose up -d api
   compose logs api | Select-Object -Last 20     # ValidationError naming MCA_RATE_LIMIT_ENABLED;
                                                 # with restart: unless-stopped the container
                                                 # crash-loops (Restarting in `compose ps`)
   (Get-Content .env.tunnel) -replace '^MCA_RATE_LIMIT_ENABLED=false','MCA_RATE_LIMIT_ENABLED=true' | Set-Content .env.tunnel
   compose up -d api
   ```
   Pass: the container refuses to start with the limiter off and a hosted LLM key configured, and
   comes back cleanly once restored.

5. **End-to-end over the real domain**, in a browser at `https://compcat.app` (not the LAN IP):
   - address lookup → a place renders with reported incident context;
   - analyze → the analysis card and baseline plot render;
   - compare → two or more places are compared with intervals;
   - export → the CSV downloads and opens;
   - the map draws real basemap tiles (this exercises the PMTiles range requests through
     Cloudflare, which is the one heavy asset — see §8);
   - Tabby answers a free-text question, and shows the offline panel when you temporarily remove
     the LLM keys and restart;
   - a 61st Analyst call in one session within one hour is declined with the request-limit
     message (the caps in `.env.tunnel` are 60/hour/session, 90/hour/IP, 500/day global).

6. **Rate limiting keys on real client IPs.** Cloudflare sets `CF-Connecting-IP` and the limiter
   reads it first; nothing can bypass the tunnel to forge it. Check from **two networks** (e.g.
   laptop on wifi and phone on cellular): both can create a session even after one of them has
   burned its hourly allowance, and burning the per-IP Analyst cap on one does not throttle the
   other. Deeper check: a request that *sends its own* `CF-Connecting-IP: 1.2.3.4` must still land
   in the sender's own bucket (Cloudflare overwrites the header at its edge), so repeating it past
   the cap still yields 429s.

7. **Invariant panel sweep.** Click through every panel and confirm CompCat still reports
   *reported incident context* only: nothing scores a place, nothing ranks places as good or bad
   to be in, and the fixed methodology caveat is the only occurrence of the word "risk" anywhere
   in the UI.

8. **Only then**, record the deployed revision, verify the existing live link in `README.md`,
   and share the release.

---

## §7 Teardown and compromise response

**Normal stop** (keeps the database and the backups; the hostname stays yours and starts serving
again on the next `start-public.ps1`):

```powershell
pwsh -File scripts\public\stop-public.ps1
```

**Full teardown / suspected compromise.** In this order:

```powershell
compose down -v            # destroys the database volume AND the backups for this project only
```

Then, off the machine:

1. **Delete the tunnel** in Zero Trust → Networks → Tunnels. This invalidates the token
   immediately — it is the one credential that publishes your machine to the internet. (A leaked
   token alone cannot reach your data: it authorizes *becoming* the tunnel, not connecting to it.)
2. Revoke the **Anthropic** key at <https://console.anthropic.com> and the **Groq** key at
   <https://console.groq.com/keys>.
3. Rotate every other secret in `.env.tunnel` if you plan to rebuild.
4. Remove the `compcat.app` public-hostname record in the Cloudflare DNS tab if you want the name
   to stop resolving entirely.

**Blast radius, stated plainly:** one compose project holding public SPD open data, anonymous
ephemeral sessions, and the saved places those sessions created. There are no user accounts, no
passwords, no payment data, and no new personal location-history uploads
(`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` is false, so `POST /uploads` returns 404 while erasure
remains available). The **personal**
instance's database is a different volume in a different project and is not reachable from the
tunnel at all. The credentials worth rotating are the tunnel token, the two LLM keys, the admin
ingest token, the session secret, the hash salt, and the database password.

---

## §8 What this trades

The VPS posture costs ~$5/month and this one costs nothing. Three things pay for that.

**1. Uptime follows the ThinkPad.** There is no redundancy and no SLA. The laptop sleeping, being
rebooted, losing wifi, or being carried out of the house takes the site down, and visitors see
Cloudflare's error page instead of CompCat. `restart: unless-stopped` covers container crashes,
and [§9](#9-keeping-it-up-by-itself)'s logon task plus its 10-minute watchdog covers reboots and a
Docker Desktop that dies or refuses to start — but nothing covers a suspended host, or a reboot
after which nobody signs in, which is why §1 step 2 (sleep off) and the U7 uptime check exist.
Honest framing for a portfolio link: it is a personal instance that is usually up, not a service.

**2. Cloudflare's free tier is for websites, not file hosting.** Cloudflare's self-serve terms
discourage using the free CDN to serve a disproportionate share of non-HTML content — large
files, video, big archives. CompCat has exactly one heavy asset: the ~100 MB
`seattle.pmtiles` basemap extract. Mitigations, and they are real ones: the file is **range
requested**, so a browser pulls only the few tens of KB of tiles its viewport needs rather than
the whole archive; those ranges are cacheable at the edge; and portfolio-scale traffic is a
handful of visitors a day. But state it plainly — if the site ever saw sustained traffic, or
someone scraped the archive in a loop, this is the term that would be cited. If that happens, move
the PMTiles to Cloudflare R2 (also free at this scale) or move the whole instance to the VPS.

**3. The Caddy edge body cap is gone, so the app is the first enforceable byte limit.**
`deploy/Caddyfile` rejects bodies above 1 MiB before they cross the compose network. The tunnel has
no equivalent local edge, but the API now enforces `MCA_MAX_REQUEST_BYTES=1048576` before routing,
including requests with no `Content-Length`; `/uploads` gets `MCA_MAX_UPLOAD_BYTES` only when
personal uploads are explicitly enabled. Keep uploads off here.

For a second, bandwidth-saving layer, check **Cloudflare dashboard → Security → WAF → Custom
rules** and add a block rule for request bodies over 1 MiB *if the account exposes a request-body
size field*. Do not assume the free plan does: Cloudflare currently documents
[`http.request.body.size`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/http.request.body.size/)
as Enterprise-only, and managed-rule inspection limits do not themselves stop the full request
from reaching the origin. The application cap is therefore mandatory, not a substitute for a
plan-dependent WAF rule.

Not a trade, but worth naming: this posture **hides your home IP** rather than exposing it.
`cloudflared` only makes outbound connections, so there is no port forward, no inbound firewall
rule, and no address for anyone to scan.

**Migration to the VPS is unchanged.** [`DEPLOY-VPS.md`](DEPLOY-VPS.md) still works exactly as
written: provision the box and follow it top to bottom, restore the newest dump from the `backups`
volume into the new database (that runbook's §6 is the same procedure in reverse), then swap DNS —
delete the tunnel's CNAME in the Cloudflare DNS tab and add the `A` record from its U2. Nothing in
the application, the env posture, or the ops sidecar changes; only which of the two edge overlays
you layer.

---

## §9 Keeping it up by itself

Everything above brings the site up **once, by hand**. This section makes the ThinkPad being
switched on the only thing the site needs. Install it once:

```powershell
pwsh -File scripts\public\install-public-autostart.ps1
```

That registers a Scheduled Task named **CompCat public site** under your user, enables Docker
Desktop's own autostart entry, and turns off sleep-on-AC. No elevation required.

### Why a Scheduled Task and not a Windows service

Docker Desktop **cannot run as a Windows service** — it needs an interactive user session, so
anything driving it has to live in one too. A logon-triggered task is therefore the strongest
honest guarantee available on this host, and the limit is worth stating plainly:

> The site returns when **you sign in**, not at the login screen. An unattended reboot — a
> Windows Update at 03:00 — leaves compcat.app down until the next sign-in.

Closing that last gap needs auto-logon (`AutoAdminLogon`), which stores the account password as an
LSA secret. That trade has not been made here.

### The three pieces

| Piece | Covers |
|---|---|
| Docker Desktop autostart (`Run` key) | the engine itself, without which nothing else matters |
| Task trigger: at logon, +2 min | the initial bring-up after a reboot |
| Task trigger: every 10 min | everything a logon trigger structurally cannot — Docker Desktop quit or crashed, the tunnel dropping registration, a `compose down` left undone, a half-alive resume from sleep |

Both triggers run the same idempotent [`scripts/public/ensure-public.ps1`](../scripts/public/ensure-public.ps1).

### Supervisor, not deployer

`ensure-public.ps1` runs `compose up -d` with **no `--build`**, so an existing image is reused
verbatim. A checkout ahead of the running image is **reported in the log, never deployed** —
nothing running unattended every 10 minutes should be able to push code to compcat.app because a
`git pull` was left on disk. Deploying stays a deliberate `start-public.ps1`. It does not ingest
either; that is the 03:10 sidecar's job.

It still runs `validate_public_env.py` before touching Docker, for a stronger reason than the
manual path: a hand-edited `.env.tunnel` that re-enables uploads or the internal tier must never be
published automatically at the next logon.

Each run appends to `%LOCALAPPDATA%\CompCat\logs\ensure-public.log` (rolled at 5 MB).

### The failure mode it exists for

On **2026-08-13** a reboot took compcat.app down for ~2 days 19 hours. Docker Desktop was crashing
at startup:

```
backend crashed: starting services: initializing Inference manager:
listening on unix://<HOME>\AppData\Local\Docker\run\dockerInference:
remove ...\dockerInference: The file cannot be accessed by the system.
```

Docker's services each bind an AF_UNIX socket under `%LOCALAPPDATA%`. After an unclean shutdown
those files survive as 0-byte reparse points that Windows can no longer touch — `Remove-Item`,
`del` and `fsutil reparsepoint delete` all return **error 1920**, and **a reboot does not clear
them**. Docker then crashes because it cannot remove the stale socket before rebinding.

Renaming the *containing directory* is the only thing that works. Two directories are involved
(`Docker\run`, `docker-secrets-engine`) and **each failed start leaves a fresh orphan**, so
clearing one at a time never converges — the sweep must cover every known socket directory before
each start attempt. `ensure-public.ps1` does exactly that, up to two repair passes, and refuses to
relocate any directory containing something other than zero-byte sockets. Swept directories are
kept as `<name>.broken-<timestamp>` next to the original; they are safe to delete.

### Operating it

```powershell
Start-ScheduledTask -TaskName 'CompCat public site'                      # run now
Get-Content "$env:LOCALAPPDATA\CompCat\logs\ensure-public.log" -Tail 30  # what it has been doing
Get-ScheduledTaskInfo -TaskName 'CompCat public site'                    # last run time and result
pwsh -File scripts\public\install-public-autostart.ps1 -Uninstall        # remove
```

Uninstalling removes only the task — Docker Desktop's autostart and the running containers are
left alone. To take the site down, use `stop-public.ps1`; note that while the task is installed
the watchdog will bring it back within 10 minutes, so uninstall first for a deliberate outage.

---

## Routine operations

**Deploy a new commit:**

```powershell
cd <repo>; git pull --ff-only; pwsh -File scripts\public\start-public.ps1
```

If a stale asset survives the deploy, purge it at Cloudflare (Caching → Configuration → Purge
Everything). Hashed asset filenames make this rare.

**Logs:**

```powershell
compose logs -f api            # application
compose logs -f cloudflared    # tunnel registration, edge connection churn
compose logs ingest-cron       # nightly ingest (03:10), backup (03:40), retention sweep (03:50)
compose logs db
```

**Data retention:** identical to the VPS path — the 03:50 sidecar job posts
`/admin/maintenance/retention-sweep`, which deletes rows belonging to identities with no recent
session create/resume, analysis/report creation, place creation/update, upload, staging write, or
stop creation in
`MCA_SESSION_DATA_RETENTION_DAYS` days (default 30, `0` disables). It covers abandoned clusters of
every origin and old upload metadata, and evicts expired `geocode_cache` entries. Read-only
returning visitors are preserved through `session_activity`; SPD incident data is never touched. See
[`DEPLOY-VPS.md`](DEPLOY-VPS.md#routine-operations) for the full description.

**After a reboot:** with [§9](#9-keeping-it-up-by-itself) installed this is automatic — sign in and
the task brings the stack back. Docker Desktop starts at logon and `restart: unless-stopped` does
most of the work: the containers come back the moment the engine is ready, and the tunnel
re-registers on its own. The task's job is the two cases that policy cannot cover — the engine not
starting at all, and the tunnel being up but unregistered. If the machine was down long enough for
data to age, the next 03:10 cron catches it up (the watchdog deliberately does not ingest).

Do not assume `restart: unless-stopped` alone is enough. It only restores containers **once the
engine is running**; a Docker Desktop that will not start leaves the site down indefinitely, which
is exactly what happened on 2026-08-13.

**Where things live:**

| Path / volume | Contents |
|---|---|
| `<repo>\.env.tunnel` | every secret, including the tunnel token; never committed |
| `compcat-public_mca-postgres` volume | the public instance's database |
| `compcat-public_backups` volume | nightly `pg_dump` archives (7 daily + 4 weekly) |
| `app\data\tiles\seattle.pmtiles` | self-hosted basemap extract (shared with the other projects, mounted read-only) |
| Cloudflare dashboard | the tunnel, its token, and the `compcat.app` → `http://api:8000` route |
