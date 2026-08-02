# Public-release cleanup audit — 2026-08-01

**Status:** cleanup implemented on `codex/public-cleanup`; deployment and authenticated edge
settings remain operator actions.

## Scope and method

The review froze `origin/main` at `44656c9bcc9cb8a7f182ffc30e5558acb8ab6a21` and marked that
baseline locally as `v0.1.0-public.1`. Before changing it, the served JavaScript and CSS assets
at [compcat.app](https://compcat.app) matched that checkout byte-for-byte, and `/health` plus
`/health/data` were healthy. That establishes what was actually public at the start of the
review; this cleanup branch has not yet been deployed.

The audit covered the tracked tree, repository history, registered API surface, data model,
ingestion and retention paths, assistant policy boundary, frontend state/provenance, launch
configuration, current documentation, and a seeded built-UI exercise. Claude Opus 4.7 was
consulted in two read-only passes, then independent backend, frontend, stale-material, final-diff,
and documentation reviews challenged the resulting plan.

Claude's recommended order was used as the spine of the work:

1. Freeze and identify the public baseline.
2. Make the public launch posture fail closed.
3. Correct ingestion, analysis provenance, and stale-result behavior.
4. Close privacy-lifecycle and erasure gaps.
5. Strengthen the product-invariant guard at both model boundaries.
6. Delete or clearly archive obsolete material, then refresh canonical docs.
7. Run the complete gate, exercise the built product, deploy, and soak Postgres.

## Findings resolved

### Public release boundary and runtime

- Added a pre-launch validator used by the tunnel, VPS, and PowerShell public launchers. It
  validates the **effective** Compose environment (including exported overrides), requires the
  isolated `mca@db:5432/mca` Postgres target with a matching password, rejects example,
  weak/low-diversity, and unresolved Compose-interpolation credentials, validates the geocoder
  contact email, and requires uploads/internal routes off, secure cookies, rate limiting, and the
  correct proxy trust mode.
- Reduced browser policy to first-party execution, images, fonts, and connections. This removes
  obsolete CARTO allowances and blocks an edge-injected Cloudflare Web Analytics beacon even
  before the authenticated zone toggle is disabled.
- Fixed optional PMTiles handling: an unprovisioned tile directory now produces a clean 404 and
  flat-map fallback instead of raising a server-side 500 on the first HEAD/range request. Late
  tile provisioning still works without an app restart.
- Updated ignored paths and Docker context rules for agent artifacts, local env files, and other
  non-release material.

### Data accuracy and provenance

- Replaced date-only Socrata paging with an exclusive `(source timestamp, Socrata :id)` keyset,
  explicitly selecting the system row ID. This reaches every row when more than one page shares
  a timestamp and avoids offset drift. The query shape was exercised against the configured
  Seattle crime, arrests, and 911 datasets.
- Repeated ingestion now upserts source-owned mutable fields instead of permanently preserving
  the first snapshot. Automatic backfills also revisit a floor-clamped, configurable 14-day
  window behind each source watermark so recent late arrivals and corrections are not stranded.
  Explicit date-window requests are not widened, and insert/update/skip counts are explicit
  through the admin and backfill paths.
- Dashboard summaries now publish the exact `AnalysisRun` scope that owns persisted aggregates.
  The frontend checks run ID, places, dates, radii, layer, and supported offense filters before
  reusing a count; missing or mismatched provenance fails closed instead of relabeling stale data.
- Incident dots and their disclosures clear immediately on filter/layer/window changes and stay
  empty on load failure. The citywide unmappable count now includes both null coordinates and
  SPD's `(-1, -1)` sentinel, while detail limits apply globally by nearest distance.
- Browser date validation now matches the API's 2018 floor, 366-day future ceiling, ordering, and
  3,000-day maximum span. Trend copy and calculations use the actual selected window, including
  honest partial-month handling.

### Privacy lifecycle and erasure

- Recent address searches moved from persistent `localStorage` to tab-scoped `sessionStorage`;
  invalid/out-of-Seattle entries are discarded, the legacy key is purged, and both search and
  clear-all surfaces provide deletion.
- The default public upload path now treats import, normalization, raw-row disposal, and batch
  receipt disposal as one transaction. A failure cannot strand exact staging rows, stops,
  filenames, hashes, or time bounds.
- `DELETE /uploads` remains session-authenticated and available when new uploads are disabled, so
  an operator cannot strand existing personal data by turning the feature flag off. Erasure now
  removes upload-dependent run/comparison/summary rows in foreign-key order while preserving
  manually entered places and unrelated manual-only analysis/comparison history.
- The retention sweep now treats all session-owned cluster origins and retained upload rows as
  expirable, detects activity across imports/staging/stops, and deletes children and parents in
  bounded foreign-key-safe order.

### Assistant and product invariant

- Consolidated deterministic policy checks in `app/assistant/output_guard.py` and applied them to
  incoming text, model output, and deterministic summaries.
- Added place-anchored and compact named-place numeric/star/grade/livability proxy ratings,
  stronger English and Spanish presence/refusal coverage, and narrow unambiguous French coverage.
  Rating context is bound to the local sentence/connector so unrelated quality metrics and later
  pronouns do not trigger a document-global false positive; incident rates and proper names remain
  regression-tested.
- A malformed `done` event or clean EOF without a terminal SSE event is now treated as a truncated
  assistant response, not success.
- Removed transient assistant-result place chips and kept the dashboard usable when the language
  model is unavailable.

### Old material and documentation

- Deleted the seven-file `docs/reference/spd-crime-analysis-suite/` tree. It described a retired
  parallel product and stale TabPy workflow; all files remain recoverable from Git history.
- Replaced the accumulated implementation ledger in `docs/ROADMAP.md` with a current operating
  roadmap and preserved the shipped record under
  [`../history/2026-08-01-public-release-record.md`](../history/2026-08-01-public-release-record.md).
  Added an explicit archive warning for `docs/superpowers/` so old specs are no longer mistaken
  for current architecture.
- Removed the unused frontend `analysisReceipt` module and obsolete CARTO raster-style export.
  The sweep found no additional clear orphan in production code, direct dependencies, or shipped
  assets.
- Corrected endpoint inventories, upload deletion semantics, retention behavior, the 12-entity
  data model, assistant call flow, runtime versions, deployment examples, model environment names,
  privacy wording, and remaining old-tab terminology. Replaced both README screenshots with the
  current Tabby-rail UI.

No history rewrite was warranted: a Gitleaks scan of 576 commits (about 13.7 MB) reported two
example commands only—an obvious dummy session secret and `local-admin-token`. The current
working tree was then scanned separately (about 19.7 MB) with no findings. Repository history
contains example env files, but no committed non-example `.env`, database, or private-key path was
found.

## Verification evidence

| Check | Result |
|---|---|
| Backend suite | `1236 passed, 4 skipped` |
| Python static check | `ruff check .` passed |
| Frontend suite | 77 files, `776 passed` |
| Frontend type check | `npm run lint` passed |
| Production frontend build | `npm run build` passed; only the existing chunk-size advisory |
| Dependency sanity | `pip check` clean; `npm audit --omit=dev` found 0 vulnerabilities |
| Secret scan | Current tree clean; full-history findings manually confirmed as example values |
| Compose render | Production and tunnel overlays rendered successfully without contacting the unavailable daemon |
| Built UI | Seeded analysis exercised at the exact 1280 px compact boundary in both themes; no old Analyze/Compare tabs, and `risk` appeared only in the required “not a personal risk prediction” caveat |
| Seattle source query | Composite-cursor projection/query accepted by the configured [crime](https://dev.socrata.com/foundry/data.seattle.gov/tazs-3rd5), [arrests](https://dev.socrata.com/foundry/data.seattle.gov/9bjs-7a7w), and [911](https://dev.socrata.com/foundry/data.seattle.gov/33kz-ixgy) datasets |
| Live pre-change baseline | Public assets matched baseline commit; `/health` and `/health/data` healthy |

The local Docker CLI was present but its daemon was not running, so the Python 3.14 locked-image
build/import smoke was not duplicated locally. CI's Docker lane remains the release gate for the
image and Compose rendering; adding an explicit post-build Python 3.14 boot smoke remains on the
roadmap.

## Remaining release work and residual risks

1. Review and deploy this branch; the live site still serves the frozen baseline described above.
2. After deploy, verify the served asset revision plus `/health` and `/health/data`, then exercise
   address search, one-place analysis, multi-place comparison, export, map ranges, and Tabby over
   the real domain.
3. Disable Cloudflare Web Analytics in the authenticated zone dashboard. The new CSP already
   blocks its browser beacon, but the edge setting should not attempt injection.
4. Run the production Postgres soak in [`../soak-testing.md`](../soak-testing.md) and retain
   p50/p95/p99, connection, lock, and nightly ingest/backup/retention evidence.
5. Keep the documented residuals visible: policy matching is strongest in English/Spanish rather
   than language-general; the automatic Socrata reconciliation window is bounded, so corrections
   older than 14 days require an explicit wider backfill; share links deliberately contain exact
   locations; health does not yet expose build revision metadata; and public uploads must remain
   off until stronger shared-tenant isolation and encryption-at-rest decisions are made.
