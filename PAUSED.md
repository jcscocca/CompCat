# Public deployment paused

**Effective 2026-10-27 (America/Los_Angeles), `compcat.app` is intentionally offline for an
indeterminate period. There is no scheduled restart.**

The owner requested a reversible pause of the **public** ThinkPad deployment. Preserve the
project, domain, tunnel configuration, database, and recovery materials for a possible return.
The private `compcat` instance is separate from the public `compcat-public` project.

## Instructions for maintainers and agents

- Do not start `compcat-public`, run `scripts/public/start-public.ps1` or
  `scripts/public/ensure-public.ps1`, or register/start the **CompCat public site** scheduled
  task without the owner's explicit request to resume public service.
- Treat an unavailable `compcat.app` as the intended state, not an incident to repair.
- Keep the public watchdog disabled or unregistered. Stopping containers alone is insufficient:
  the watchdog can recreate them at logon or on its repeating trigger.
- Preserve `compcat-public_mca-postgres` and `compcat-public_backups`. Do not run `down -v`,
  prune those volumes, or delete the Cloudflare tunnel as part of this pause.
- Keep credentials, database archives, task exports, and other private recovery files out of Git.

No placeholder page was requested. The domain may show Cloudflare's unavailable-origin page
while its tunnel connector is stopped.

## Verified shutdown

The public API and tunnel were stopped before the final database dump. All four public
containers and their network were then removed with `stop-public.ps1`, the public scheduled
task was removed, and both public named volumes were retained. An external check of
`https://compcat.app/` returned HTTP 530 after shutdown.

The fresh database archive is 103,790,035 bytes. It was fully restored into an isolated
Postgres container using the same database image; table row counts and the Alembic schema
revision matched the source database. The temporary restore container and volume were removed
after verification.

## Recovery materials

The pause archive is outside the repository on the ThinkPad:

```text
C:\Users\jacob\CompCat Backups\public-pause-2026-10-27-193725
```

It preserves the fresh public database dump, `.env.tunnel`, source bundle and working-tree
patch, basemap tiles and assets, scheduled-task definition, deployment metadata, Docker images,
checksums, and recovery instructions. The archive includes credentials and user data: keep it
private and retain an encrypted copy off the laptop. A retained Docker volume alone is not an
off-device backup.

The deployed source revision at the pause was:

```text
e20f6ec1955e9b4fc2ddcde17349b4381d2a4f2a
```

Use the archive's deployment metadata and recovery instructions when restoring. The source
bundle and patch preserve the checkout as it stood; this pause notice is a subsequent
documentation change.

## What is suspended

The public API/UI, tunnel connector, and nightly operations are stopped. Reported-incident
ingestion, new backups, and the retention sweep therefore do not run during the pause. The
retained database and existing backups remain on disk.

Saved places and other identity-owned data do **not** expire from storage while the sweep is
stopped. When operations resume, the usual retention window (30 days by default) can make
long-inactive user data eligible for deletion. Review retention and backup handling before
restarting nightly jobs. SPD incident data is outside that sweep.

## Before an explicitly requested return

1. Read the private archive's recovery instructions and verify its checksums and database
   restore. Confirm which source revision and environment should run.
2. Review retained user data and the retention policy before the next sweep. Check credentials,
   dependencies, the domain, and the tunnel configuration after the extended pause.
3. Use [docs/RUN-MODES.md](docs/RUN-MODES.md) and
   [docs/DEPLOY-TUNNEL.md](docs/DEPLOY-TUNNEL.md) for the public deployment procedure. Refresh
   reported data and verify the app's public posture and health before declaring service restored.
4. Re-enable the watchdog and monitoring only as part of that authorized return. Update this
   file and the pause notices in the README, agent guide, and deployment docs to record the
   actual resumed state.
