# Public instance runbook — compcat.app on a VPS

This document takes a **fresh Ubuntu 24.04 box to an always-on public CompCat at
<https://compcat.app>**: TLS-terminated, rate-limited, ingesting SPD data nightly, backing itself
up nightly, and monitored from outside. It assumes no prior knowledge of the deployment — following
it top to bottom is enough to re-provision from zero.

What this is *not*: an operated multi-user service. CompCat stays anonymous-session-based (no
accounts, no sign-in), reports **reported Seattle SPD incident context**, and keeps personal
location-history uploads switched off. Design:
[`superpowers/specs/2026-07-27-public-instance-slice4-vps-bringup-design.md`](superpowers/specs/2026-07-27-public-instance-slice4-vps-bringup-design.md).

For the single-host ThinkPad trial over plain HTTP, see [`DEPLOY.md`](DEPLOY.md). For the
two-minute shareable demo over a Cloudflare quick tunnel, see [`DEMO.md`](DEMO.md). Both keep
working unchanged; this is a third, independent deployment.

## The shape of it

Four containers under one `docker compose` project, three open ports:

| Service | Image | Reachable from | What it does |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | host :80, :443, :443/udp | TLS termination + reverse proxy. The **only** ingress. |
| `api` | built from this repo | compose network only | FastAPI + the built React UI on `api:8000`. |
| `db` | `postgres:16` | compose network only | Data. Never published on the host. |
| `ingest-cron` | built from `deploy/ingest-cron.Dockerfile` | compose network only | 03:10 SPD ingest, 03:40 `pg_dump` backup. `ops` profile. |

Every command below uses one compose invocation. Define it once per shell session:

```bash
compose() {
  docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    --profile ops --env-file .env.prod "$@"
}
```

`scripts/prod/start-compcat.sh` and `stop-compcat.sh` wrap the same invocation, so you rarely need
it directly — but the log/exec commands in this runbook do.

---

## USER STEPS — do these first

These need a browser, an account, or a payment method. None of them is scriptable, and the
operator sections below assume all four are done.

### U1. Create the server

Any provider (Hetzner, DigitalOcean, Vultr, Linode, Scaleway, a spare box — the stack is plain
Docker Compose and does not care). Create:

- **Ubuntu 24.04 LTS**
- **2 vCPU / 4 GB RAM / 40 GB disk**
- **SSH key at creation time** — never a password login

Sizing rationale: the self-hosted basemap extract is ~100 MB, Postgres holds a few million incident
rows plus indexes, and the app is one Python process. 2 GB is tight once ingest and Postgres run
together; 40 GB leaves room for the database, the tiles, Docker images and a week of dumps.

Write down the public IPv4 address. Everything below refers to it as `<BOX_IP>`.

### U2. Point DNS at the box

At your registrar or DNS host, create an **A record**:

```
compcat.app.   300   IN   A   <BOX_IP>
```

(Add `www.compcat.app` the same way only if you want it; the Caddyfile serves the apex name alone
as written.) Keep the TTL at 300 while setting up.

**Verify before you start the stack** — Caddy's certificate request fails if the name does not yet
resolve to this box:

```bash
dig +short compcat.app        # must print <BOX_IP>
```

DNS propagation can take minutes to hours. Waiting here costs nothing; a premature start burns
Let's Encrypt failure attempts.

### U3. Have the credentials ready

- A **Groq** API key — <https://console.groq.com/keys>. Free tier; used for bring-up and as the
  failover backend.
- An **Anthropic** API key — <https://console.anthropic.com>. This is the production Analyst
  backend. If you do not have one yet, see the Groq-only note in `.env.prod.example`; you can bring
  the instance up on Groq and swap later.
- A **contact email** for `MCA_GEOCODER_CONTACT_EMAIL`. Nominatim's usage policy requires an
  identifiable contact in production and the app refuses to boot without one. Use an address you
  actually read.

### U4. Create an uptime-monitor account

Any service with a free tier (UptimeRobot, Better Stack, Healthchecks.io, …). Once §5 is reachable,
add two checks:

| URL | Expect | Catches |
|---|---|---|
| `https://compcat.app/` | 200 | the box, Docker, Caddy, or TLS is down |
| `https://compcat.app/health/data` | 200 | data has aged past `MCA_DATA_STALENESS_DAYS` (default 7) — a dead cron, a rejected admin token, or an upstream Socrata outage |

Point alerts at an address you read. `/health/data` is deliberately **not** the container health
check: stale data must page a human, never restart-loop the app.

---

## §1 Host hardening

Over SSH as `root@<BOX_IP>`. Deliberately minimal — the attack surface is three ports and key-only
SSH, so there is no fail2ban/auditd baseline here.

1. **Create the deploy user** (the `docker` group is added in §2, after Docker exists):

   ```bash
   adduser --disabled-password --gecos "" deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
   chown deploy:deploy /home/deploy/.ssh/authorized_keys
   chmod 600 /home/deploy/.ssh/authorized_keys
   usermod -aG sudo deploy
   ```

   Pass condition: `ssh deploy@<BOX_IP>` works from your machine in a **second terminal**. Do not
   close the first one until it does.

2. **Firewall** — deny inbound by default, allow SSH, HTTP, HTTPS, and HTTP/3:

   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 443/udp
   ufw --force enable
   ufw status verbose
   ```

   Pass condition: `ufw status` shows exactly those four rules and `Default: deny (incoming)`.
   Nothing else — in particular not 8000 or 5432, which the production overlay does not publish.

3. **Key-only SSH**:

   ```bash
   cat > /etc/ssh/sshd_config.d/10-compcat.conf <<'EOF'
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin prohibit-password
   EOF
   sshd -t && systemctl reload ssh
   ```

   `sshd -t` validates the config before the reload. **Keep your current session open** and confirm
   a fresh `ssh deploy@<BOX_IP>` still works before disconnecting — a bad SSH config plus a closed
   session means a console rescue.

4. **Automatic security updates**:

   ```bash
   apt update && apt install -y unattended-upgrades
   dpkg-reconfigure -plow unattended-upgrades      # answer "Yes"
   systemctl status unattended-upgrades --no-pager
   ```

   Pass condition: `active (running)`. This patches the OS; container images are updated by you
   (`compose up -d --build --pull always`).

---

## §2 Docker CE

Still as root:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
systemctl enable --now docker
```

Log out and back in as `deploy` (group membership only applies to new sessions), then:

```bash
docker compose version
```

Pass condition: **v2.24 or newer**. The production overlay uses the `!reset` merge tag, which older
Compose versions ignore silently — which would leave Postgres published on the host.

---

## §3 Clone and configure

As `deploy`:

```bash
sudo install -d -o deploy -g deploy /opt/compcat
git clone https://github.com/<owner>/compcat.git /opt/compcat
cd /opt/compcat
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Fill in `.env.prod`. Every placeholder reads `__like this__`; the file's own comments explain each
value. Generate the secrets on the box:

```bash
openssl rand -hex 32     # MCA_SESSION_SECRET
openssl rand -hex 32     # MCA_USER_HASH_SALT
openssl rand -hex 24     # MCA_ADMIN_INGEST_TOKEN
openssl rand -hex 24     # POSTGRES_PASSWORD
```

> **The two database values must agree.** `POSTGRES_PASSWORD` initializes the Postgres container on
> its very first boot; `MCA_DATABASE_URL` is how the app connects. Paste the same generated password
> into both, and paste it before the first `up` — changing `POSTGRES_PASSWORD` after the volume
> exists does **not** change the password already stored in it.

Then paste the Anthropic key, the Groq key and the geocoder contact from U3. Leave
`MCA_RATE_LIMIT_ENABLED=true`, `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=false` and
`MCA_INTERNAL_TIER_ENABLED=false` exactly as shipped — the first is enforced at boot (the app
refuses to start with a hosted LLM key and the limiter off), and the other two are the public
posture.

**Fetch the basemap tiles** (~100 MB, one time):

```bash
sudo apt install -y python3-venv make
make install          # creates .venv
make fetch-tiles
```

Pass condition: `app/data/tiles/seattle.pmtiles` exists and is ~100 MB. The app boots without it —
the map just renders flat with a notice — so this is not blocking, but do it now.

> If the fetch fails with `CERTIFICATE_VERIFY_FAILED`, the invoking Python has no usable CA bundle.
> Run it through the venv with
> `SSL_CERT_FILE="$(.venv/bin/python -c 'import certifi; print(certifi.where())')" make fetch-tiles`.
> Same note as [`DEPLOY.md`](DEPLOY.md).

---

## §4 First bring-up

```bash
cd /opt/compcat
scripts/prod/start-compcat.sh
```

The script:

1. Builds and starts the stack with the base + production overlays and the `ops` profile
   (`db`, `api`, `caddy`, `ingest-cron`). The image build receives `VITE_CANONICAL_ORIGIN` from
   `.env.prod`, so link previews come out with absolute URLs.
2. Waits up to five minutes for `/health` — probed **inside** the api container, because the
   production overlay publishes no app port on the host.
3. Mints a session and reads `/dashboard/freshness`.
4. Runs the ingest sidecar's own nightly script if reported data is missing or older than 14 days.
5. Prints service status and the public URLs.

It is idempotent: re-running it is the normal way to deploy a new commit.

**Certificates.** Caddy requests the Let's Encrypt certificate on first start; the first
`https://compcat.app/` typically works within ~30 seconds. If it does not:

```bash
compose logs caddy | tail -40
dig +short compcat.app        # must still be <BOX_IP>
```

The usual cause is DNS not yet resolving to the box (U2), or port 80 blocked so the ACME challenge
cannot complete. Caddy retries on its own with backoff — fix the cause and wait rather than
restarting in a loop, which burns Let's Encrypt rate limits.

Pass condition:

```bash
curl -sI https://compcat.app/ | head -1        # HTTP/2 200
```

---

## §5 First ingest

On an empty database the start script triggers a full backfill of all three SPD layers
(reported → arrests → calls, sequentially). It takes a while. Watch it:

```bash
compose logs -f ingest-cron
```

To run it again by hand at any time:

```bash
compose exec ingest-cron /bin/sh /etc/ingest/run.sh
```

Pass conditions:

- `curl -s -o /dev/null -w '%{http_code}\n' https://compcat.app/health/data` → `200`
- the dashboard's "Data through" pill shows a recent date.

From here it is automatic: **03:10** ingest and **03:40** backup, every night, America/Los_Angeles
(the sidecar sets `TZ` and ships `tzdata`, so the times do not drift across DST). Both jobs log to
the container log:

```bash
compose logs ingest-cron | grep -E 'ingest-cron:|backup-daily:'
```

---

## §6 Backup restore rehearsal

Do this **once before launch**, and again after any Postgres upgrade. Backups are written nightly
to the `backups` named volume as date-stamped `pg_dump -Fc` archives, pruned to **7 daily + 4
weekly** (Sunday archives are additionally hard-linked under a `compcat-weekly-` name, so pruning
the dailies cannot take the weekly set with it).

1. **Force a dump now** instead of waiting for 03:40:

   ```bash
   compose exec ingest-cron /bin/sh /etc/ingest/backup.sh
   ```

   Expect `backup-daily: dumping to /backups/compcat-YYYY-MM-DD.dump` then `backup-daily: ok (N bytes)`.

2. **Confirm the archive exists** and note its name:

   ```bash
   compose exec ingest-cron ls -lh /backups
   ```

3. **Record the row counts you expect back.** Read them from the live database:

   ```bash
   compose exec -T db psql -U mca -d mca -c \
     "select source_dataset, count(*) from crime_incidents group by 1 order by 1;"
   ```

   Write the numbers down. (The same counts back the `incident_count` values in
   `/dashboard/freshness`, which is what the UI's freshness pill reads.)

4. **Restore into a scratch container** — a throwaway Postgres on the same compose network, so the
   real database is never touched:

   ```bash
   NET="$(docker network ls --format '{{.Name}}' | grep compcat | head -1)"
   PGPW="$(grep '^POSTGRES_PASSWORD=' .env.prod | cut -d= -f2-)"
   ARCHIVE=compcat-YYYY-MM-DD.dump          # from step 2

   docker run -d --name compcat-restore-rehearsal --network "$NET" \
     -e POSTGRES_USER=mca -e POSTGRES_DB=mca -e POSTGRES_PASSWORD="$PGPW" postgres:16
   sleep 10

   compose exec -T ingest-cron sh -c \
     "PGPASSWORD='$PGPW' pg_restore -h compcat-restore-rehearsal -U mca -d mca --no-owner /backups/$ARCHIVE"
   ```

5. **Row-count sanity** against the scratch container — the same query as step 3:

   ```bash
   docker exec -e PGPASSWORD="$PGPW" compcat-restore-rehearsal \
     psql -U mca -d mca -c "select source_dataset, count(*) from crime_incidents group by 1 order by 1;"
   ```

   Pass condition: the counts match step 3, modulo anything ingested since the dump was taken.

6. **Clean up:**

   ```bash
   docker rm -f compcat-restore-rehearsal
   ```

**A restore you have not rehearsed is not a backup.** Do not skip this section.

### Optional: an offsite copy

The dumps live on the same box as the database they came from, so a lost box loses both. If you
want an offsite copy, mount the volume and sync it to a remote **you provide**:

```bash
docker run --rm -v compcat_backups:/backups -v ~/.config/rclone:/config/rclone:ro \
  rclone/rclone copy /backups your-remote:compcat-backups
```

Documented, not required — it needs an rclone remote and its credentials, which are yours to set
up. Put it in the deploy user's crontab at, say, 04:10 if you do.

---

## §7 Launch checklist

Every item has an observable pass condition. Work through it before advertising the URL.

1. **DNS and TLS are green.**
   ```bash
   dig +short compcat.app                              # <BOX_IP>
   curl -sI https://compcat.app/ | head -1              # HTTP/2 200
   echo | openssl s_client -connect compcat.app:443 -servername compcat.app 2>/dev/null \
     | grep -E 'issuer|Verify return code'
   ```
   Pass: issuer is Let's Encrypt (not a self-signed placeholder) and `Verify return code: 0 (ok)`.

2. **Caddy is the only ingress.** From a *different* machine:
   ```bash
   nc -vz compcat.app 8000     # must be refused/filtered
   nc -vz compcat.app 5432     # must be refused/filtered
   ```

3. **Boot-guard negative test.** Prove the spend rail is armed on this box, not just in CI:
   ```bash
   sed -i 's/^MCA_RATE_LIMIT_ENABLED=true/MCA_RATE_LIMIT_ENABLED=false/' .env.prod
   compose up -d api
   compose logs api | tail -20        # ValidationError naming MCA_RATE_LIMIT_ENABLED; container exits
   sed -i 's/^MCA_RATE_LIMIT_ENABLED=false/MCA_RATE_LIMIT_ENABLED=true/' .env.prod
   compose up -d api
   ```
   Pass: the container refuses to start with the limiter off and a hosted LLM key configured, and
   comes back cleanly once restored.

4. **End-to-end over the real domain**, in a browser at `https://compcat.app`:
   - address lookup → a place renders with reported incident context;
   - analyze → the analysis card and baseline plot render;
   - compare → two or more addresses rank with intervals;
   - export → the CSV downloads and opens;
   - Tabby answers a free-text question, and shows the offline panel when you temporarily remove
     the LLM keys and restart;
   - a 21st Analyst call within one hour is declined with the request-limit message (the caps in
     `.env.prod` are 20/hour/session, 100/day global).

5. **Rate limiting keys on real client IPs.** With the Caddy edge in front, the limiter reads the
   leftmost `X-Forwarded-For` hop, so two different visitors get two buckets. Sanity check from two
   networks (e.g. laptop and phone on cellular): both can create a session even after one of them
   has burned its hourly allowance.

6. **Soak.** Run the harness on the box per [`soak-testing.md`](soak-testing.md), substituting
   `--env-file .env.prod` wherever it says `.env.deploy` (the observer shells
   `docker compose … exec -T db psql`). Record p50/p95/p99 and the Postgres observations against the
   thresholds in that document. This closes the soak run that has been pending since H2.

7. **Invariant panel sweep.** Click through every panel and confirm CompCat still reports *reported
   incident context* only: nothing scores a place, nothing ranks places as good or bad to be in, and
   the fixed methodology caveat is the only occurrence of the word "risk" anywhere in the UI.

8. **Only then**, add the live link to `README.md` and share it.

---

## §8 Teardown and compromise response

**Normal stop** (keeps the database, the certificates and the backups):

```bash
scripts/prod/stop-compcat.sh
```

**Full teardown / suspected compromise.** In this order:

```bash
compose down -v            # destroys the database volume, Caddy's certificates, AND the backups
```

Then, off the box:

1. Revoke the **Anthropic** key at <https://console.anthropic.com> and the **Groq** key at
   <https://console.groq.com/keys>.
2. Rotate `MCA_ADMIN_INGEST_TOKEN` (and every other secret in `.env.prod`) if you plan to rebuild.
3. Remove your SSH key from the box and destroy the server at the provider.
4. Delete the `compcat.app` A record.

**Blast radius, stated plainly:** one box holding public SPD open data, anonymous ephemeral
sessions, and the saved places those sessions created. There are no user accounts, no passwords, no
payment data, and no personal location-history uploads (`MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS` is
false, so those endpoints 404). The credentials worth rotating are the two LLM keys, the admin
ingest token, the session secret, the hash salt, and the database password.

---

## Routine operations

**Deploy a new commit:**

```bash
cd /opt/compcat && git pull && scripts/prod/start-compcat.sh
```

**Logs:**

```bash
compose logs -f api          # application
compose logs -f caddy        # TLS, certificate renewal, HTTP errors
compose logs ingest-cron     # nightly ingest (03:10) and backup (03:40)
compose logs db
```

**After a host reboot:** nothing to do. `restart: unless-stopped` brings `db`, `api`, `caddy` and
the sidecar back automatically; if the box was down long enough for data to age, the next
`start-compcat.sh` (or the next 03:10 cron) catches it up, and `/health/data` tells your monitor in
the meantime.

**Where things live:**

| Path / volume | Contents |
|---|---|
| `/opt/compcat/.env.prod` | every secret; mode 600, never committed |
| `mca-postgres` volume | the database |
| `backups` volume | nightly `pg_dump` archives (7 daily + 4 weekly) |
| `caddy-data`, `caddy-config` | TLS certificates and ACME state |
| `app/data/tiles/seattle.pmtiles` | self-hosted basemap extract |
