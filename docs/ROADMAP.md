# CompCat roadmap

**Last updated:** 2026-08-10 · **Status:** public release, current priorities.

CompCat is live as a privacy-first tool for exploring **reported Seattle SPD incident
context** around places. It does not score safety, rank places as safe or dangerous, or infer
that someone was present at an incident. Preserve that invariant in every new surface.

The shipped phase-by-phase record through the public launch is archived at
[`history/2026-08-01-public-release-record.md`](history/2026-08-01-public-release-record.md).
Canonical current-state detail lives in [`architecture/`](architecture/) and the release audit
under [`reviews/`](reviews/).

## Now — operate the public release

- Verify each deploy by matching `/health`'s non-sensitive `revision` to the deployed Git commit,
  then confirm `/health/data` is current.
- Disable Cloudflare Web Analytics in the authenticated dashboard. The application CSP blocks
  the injected beacon, but the zone setting should still be off so the edge does not attempt it.
- Run the production Postgres soak recipe in [`soak-testing.md`](soak-testing.md) after deploy;
  retain p50/p95/p99 and lock/connection evidence with the release record.
- Watch nightly Socrata ingest, backup, and retention logs. Paging uses a composite source date
  + unique Socrata row ID cursor, a configurable 14-day reconciliation overlap catches recent
  late rows/corrections, and repeated ingest updates mutable upstream fields.
- Keep public uploads and the internal tier off. The public launcher validates the effective
  Compose environment, isolated database target, proxy posture, and non-placeholder secrets
  before Docker starts.
- Treat browser screenshot changes as product changes: review the desktop light, modal, and
  mobile dark baselines before accepting them, then run the live checklist in
  [`ui-regression-testing.md`](ui-regression-testing.md).

## Next — hardening with clear acceptance criteria

- Add a Python 3.14 locked-image smoke step that imports and boots the built Docker image; Python
  3.11 remains the minimum/direct backend CI runtime.
- Complete the combobox ARIA pattern and a keyboard/screen-reader pass across search, filters,
  the Tabby rail, analysis-card expansion, and the three mobile sheet snaps.
- Add a top-level React error boundary with a privacy-safe recovery screen and no raw error-body
  disclosure.
- Decide whether share-link locations should move from the query string to the URL fragment.
  Either way, keep the current explicit warning that links contain exact locations and labels.

## Later — research, not promises

- Replace lexical multilingual safety/presence backstops with a language-general deterministic
  policy classifier only if it can remain auditable and fail closed. Current regex coverage is
  strongest in English/Spanish, includes narrow French patterns and place-anchored proxy ratings,
  and still relies on prompt/stream defenses for novel euphemisms and other scripts.
- Revisit spatial/index performance only after Postgres measurements identify a real bottleneck;
  prefer PostGIS or a maintained aggregate over speculative caches.
- Evaluate stronger account isolation and encryption at rest before any shared deployment ever
  enables personal location-history uploads.

## Done means

For every roadmap change: update the canonical doc, add a regression at the lowest durable
boundary, run `make test-all`, exercise the built UI, and confirm the product invariant still
holds. `tests/test_documentation_contract.py` keeps the canonical API table, README route
inventory, model count, and maintained local links synchronized with code. Deployment or
external-dashboard actions must be recorded separately when local code cannot perform them.
