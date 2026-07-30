# CompCat pre-launch audit — 2026-07-28

Seven lanes: live UX walkthrough, assistant interaction battery (16 live Groq turns),
frontend code audit, backend audit (defects reproduced and measured), statistical-communication
audit, security/abuse re-check with DoS/privacy and API-robustness sub-audits.

**Disposition: every fix-now item below is merged.** PR #173 (assistant quality),
PR #174 (backend hardening), PR #183 (frontend), PR #184 (identity-scoped retention sweep) —
each implemented under TDD and gated by an independent fresh-context review. Reviews earned
their keep: their blocking findings included a guard bypass constructed live, a commands-path
cap bypass, and an age-based sweep that would have deleted a returning visitor's saved places
(caught before it ever ran). Final counts: 920 backend / 671 frontend tests, up from 811/588
at audit start; CI green on main throughout.

## The one-paragraph verdict

The deliberate surfaces are launch-grade: the statistical engine is more conservative than its
own copy claims, the invariant enforcement is layered and real, the privacy engineering is
genuine, and the Phase 8 rails (boot guard, budget, probe, edge) held up under adversarial
re-review. What the audit found instead: the unspecced surfaces (first-minute UX, chat scroll,
dark-mode contrast), a set of single-request DoS vectors in request models that bound shape but
not work, honesty gaps where copy lags the engine, an assistant narrator that garbles what it
was handed, and a session model that silently walls out every user 24h after first visit.
None of it is architectural. Roughly three days of fixes, most of them small.

## Fix-now (in flight across three batches)

### Batch: backend hardening
- DoS: `radii_m` unbounded (5,000 legal values; measured ~815s CPU + ~6 GB RSS at max; OOM
  restart resets the LLM budget) → cap + date-span cap [reproduced]
- Event-loop freeze: async assistant routes run sync geocode + `time.sleep` on the loop —
  one POST stalls the entire process up to 60s → threadpool [confirmed]
- Delete-after-analyze 500: FK without cascade makes analyzed places undeletable forever —
  the delete-my-data control failing closed [reproduced]
- CSV formula injection in the Tableau export (`=cmd|…` lands raw) [reproduced]
- Bulk import: no row cap, one commit per row (~16,600 rows/commits per request)
- Prod overlay doesn't require `MCA_RATE_LIMIT_ENABLED` (keyless deploys boot unlimited)
- `/health/data` UTC-vs-Seattle day boundary → false stale pages a third of every day
- Swagger `/docs` live on prod + pulls jsdelivr (third-party request) → off in prod-like
- Geocoder rate gate sleeps holding a global lock → threadpool starvation at 120 req/min
- Assistant per-IP bucket (one IP could mint sessions and drain the global daily cap)
- Session sliding expiry: tokens die 24h after FIRST mint, resume never re-signs; observed
  live: mid-use 401 wall, wrong copy, reload orphans the user's places [reproduced live]
- Searched addresses land verbatim in unrotated access logs → `--no-access-log` + log rotation
- Points-path compare persists rows it never reads → skip (largest garbage source)
- DB pool: `pool_pre_ping`; manual places get Seattle bounds; command validation errors
  no longer echo pydantic internals
- Absolute date bounds (end=9999-12-31 → OverflowError 500 in exposure math) [reproduced]
- Lone-surrogate payloads 500 inside the validation-error handler → sanitizing handler
  [reproduced]
- Caddy `request_body max_size` (uploads spool the full multipart to disk before the app's
  413 fires; the edge cap is the real bound); filter strings capped at 80 chars

### Batch: assistant quality
- Invariant hardening: output guard applied to every emission path (place labels could
  previously ride unguarded summaries into Tabby's voice); grounding block fenced
- Honest summaries: no more "88.9× above Citywide" for places the engine ruled
  insufficient_data; no fabricated 1.00×/CI 1.00–1.00 rows in copy
- Compact grounding replaces mid-JSON truncation (payloads were cut to 17–30%; the narrator
  then denied having data it was handed, dropped CIs, and re-typed a 6.1 ratio as "count is 6")
- Narration rules: no ids/enums/tool mechanics; state CIs and significance plainly; Tabby voice
- Relative-date backstop ("last 12 months" resolved a year off; deterministic recompute)
- Presence guard gains "near" arm; Spanish asks get a Spanish refusal
- Tool arg bounds (`AnalyzePlacesArgs.radii_m` was unbounded from /assistant/commands)

### Batch: frontend fixes
- BROKEN FLOW: saving a searched address always 422s (`visit_count: 0` vs a `ge=1` schema;
  masked by a mocked client in tests) → fixed + contract test [reproduced]
- First-minute: Enter in search; chat auto-scroll; "Test location" default gone; `make`
  command out of user copy; layer-aware legend; theme flash bootstrap
- Theme-toggle map regression (night tiles under light chrome; fresh load fine) [observed live]
- Trust: About uploads line from runtime flag; caveat on collapsed cards; session-expiry
  copy actually shown (was "Tabby is offline"); incident-layer errors surfaced; retry for
  failed first session; `?view=` cleared after open
- Statistical copy: "similar" → "no clear difference" everywhere (asserting the null was the
  single biggest credibility risk); Methods entries corrected (φ always widens, real floors,
  /yr unit + extrapolation note, four-baseline truth, BH family, exact-p entry deleted,
  "approximate 95%"); radius-dependence + many-looks disclosures added; fabricated stats
  render as "not tested"
- A11y/CSS: dark-mode trend line was 1.5:1 (invisible) → themed tokens; text-dim contrast;
  no-data badge legible + announced; sr-only h1; reduced-motion selectors fixed (were
  targeting classes that no longer exist); label-in-name on Edit; unsaved state announced;
  mobile banner/safe-area collisions; dvh modal; drag transition

## Fast-follow (recommended, not launch-blocking)
- Data retention sweep: analysis/summary/comparison rows grow ~10⁵/day unaddressably once
  sessions expire; needs an index migration + ops-sidecar cron; `geocode_cache` never evicts
  and survives delete-my-data (address corpus, not user-scoped — still prune by age)
- Combobox full ARIA pattern; DOM/tab order (map before chrome); aria-live restructuring;
  focus loss on pin re-render; mobile keyboard crush at half-snap; keyboard sheet snaps
- Numeric safety-score patterns for the output guard ("2/10 for this neighborhood")
- Session-level multiplicity + selective-inference disclosure line on the ranked compare
  surface (repo docs themselves call for it)
- Python lockfile (deps re-resolve every build); ErrorBoundary; share-link `#fragment`
  migration (labels out of server logs); assistant narration A/B against the deterministic
  path before enabling on prod

## Product decisions (yours, not fixes)
1. Dead locator subsystem (LocatorChip + mosaic geometry ships but can never render) —
   revive or delete?
2. Naming: the core object is "place", "location", "address", and "pin" in different
   surfaces ("Add location" opens "Manage places"); bulk import has five names in one modal.
3. Mobile hides the map legend and the session/trust pill entirely — acceptable?
4. Assistant global daily cap vs availability trade (raised to 500 + per-IP bucket in the
   hardening batch; token budget is the true spend guard).

## Verified sound (adversarially checked, no action)
- SQL injection (all bind-parameterized), SoQL construction, SSRF/egress (config-only URLs),
  session token crypto (HMAC + compare_digest + expiry), auth coverage on every public route,
  upload size limiting, map popup XSS discipline, git history secrets (clean), CI posture,
  migration concurrency on the prod path, beats/mcpp/freshness caching, incident-points caps,
  error responses (no stack traces/SQL/paths anywhere), unicode round-tripping, budget
  enforcement mechanics (charges verified honest, including aborted streams)
- The demo-posture rate caps, the boot guard, the staleness probe TTL economics
- One reported bug disproved: the duplicate-Save-button theory (6/6 key computations match)

## Accepted risks (unchanged from Phase 8, re-affirmed)
- In-process limiter/budget state resets on restart (single host by design; restart primitive
  closed by the radii cap)
- Deterministic guard is English+Spanish; other languages ride prompt-level instruction
- Single uvicorn worker assumption (caches/limiter fragment if workers are ever added — noted
  in runbook)
- Groq key: rotate before launch; prod uses its own keys via .env.prod
