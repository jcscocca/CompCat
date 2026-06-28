# Waypoint Geocode Proxy — Design

**Status:** Approved in brainstorming — pending spec review
**Date:** 2026-06-26
**Implements:** Workstream 5 geocoding item from `docs/superpowers/plans/2026-06-26-waypoint-next-steps-roadmap.md`
**Resolves:** the open question flagged in `docs/superpowers/specs/2026-06-26-waypoint-hardening-consolidation-design.md` ("Geocoding location frontend vs backend is unconfirmed")

## Goal

Stop the public beta from depending on **client-side public Nominatim**. Today the browser
calls `https://nominatim.openstreetmap.org/search` directly; this won't survive public load
(Nominatim's usage policy forbids bulk browser traffic) and leaks every user's raw search
query to a third party. Replace it with a **session-required backend geocode proxy** that
caches results and is polite to the upstream — without changing the search UX.

Feature depth (commercial geocoders, reverse geocoding, typeahead) is explicitly deferred.

## Current state (verified 2026-06-26)

Geocoding is entirely client-side:

- `frontend/src/lib/geocoding.ts` defines a `GeocodingProvider` interface
  (`search(query, signal) → Promise<GeocodeResult[]>`) and a `createNominatimProvider()`
  that `fetch`es public Nominatim from the browser. The exported `geocodingProvider`
  singleton is that Nominatim provider.
- `frontend/src/components/PlaceSearch.tsx` consumes the interface via a `provider` prop;
  `MapWorkspace.tsx` wires the singleton in. On a thrown error it already renders
  *"Search is unavailable. Drop a pin on the map instead."* — a graceful manual-pin
  fallback we preserve.
- The code already carries a comment: *"Public production must move to a provider that
  permits browser traffic at volume."*

The interface is clean and swappable, so the backend proxy is simply a new implementation
of the **unchanged** `GeocodingProvider` interface.

## Decisions

### Upstream provider — cached Nominatim proxy (chosen)

**Considered:**

- **A — Cached server-side Nominatim proxy (chosen).** Backend calls public Nominatim with
  an identifying User-Agent + contact email, aggressive result caching, and a ≤1 req/s rate
  gate. Policy-compliant for low beta volume (unlike browser bulk use), zero cost, no new
  infra. A provider seam keeps a paid/self-hosted swap a config change. **Only this adapter
  is built now (YAGNI).**
- **B — Commercial geocoder now** (LocationIQ/Mapbox/Google/OpenCage). Reliable and
  scalable, but adds per-request cost, a secret to manage, and attribution/licensing terms.
  Deferred behind the provider seam.
- **C — Self-hosted Nominatim/Photon.** No external dependency, but heavy ops (data import,
  hosting). Too much for a beta.

### Cache strategy — persistent DB-backed (chosen)

**Considered:**

- **A — DB-backed `geocode_cache` table (chosen).** Shared across workers, survives
  restarts/deploys; repeated Seattle lookups hit cache instead of Nominatim. Fits the
  existing SQLAlchemy/Alembic stack. Cost: one model + one migration.
- **B — In-memory per-process LRU+TTL.** Zero schema, but not shared across workers and
  lost on every deploy → cold-start bursts upstream. Riskier against Nominatim's rate
  policy under multiple workers.
- **C — No cache.** Simplest, but every repeat hits upstream — slowest and most likely to
  trip throttling.

### Endpoint shape

`GET /dashboard/geocode?q=…`, session-required. GET (not POST like its `/dashboard/*`
siblings) because it takes a single `q` string and has search/cacheable semantics. The
endpoint is **synchronous**, matching the existing sync dashboard endpoints (FastAPI runs
it in a threadpool); no async/sync mixing.

## Design

### Request flow

```
PlaceSearch ──GET /dashboard/geocode?q=…──▶ dashboard_geocode (required_public_user_hash)
                                              │  geocoding_service.search_addresses()
                                              ├─ 1. normalize query (trim / lower / collapse ws)
                                              ├─ 2. geocode_cache lookup ──hit (fresh)──▶ return
                                              ├─ 3. miss → rate gate (≤1 req/s) → Nominatim (httpx)
                                              ├─ 4. upsert into geocode_cache
                                              └─ 5. return results
◀── GeocodeResult[] {label, latitude, longitude, source} ──┘
```

### Components

**`app/geocoding/providers.py`** *(new)*
- `GeocodeHit` dataclass `{label, latitude, longitude, source}` and a `GeocoderUpstreamError`
  exception — the internal types shared by providers and the service. API-schema conversion
  happens at the endpoint, keeping the geocoding package decoupled from `app/api`.
- `GeocodeProvider` protocol: `search(query: str) -> list[GeocodeHit]`.
- `NominatimProvider`: `httpx.Client` with `geocoder_timeout_s` timeout (mirrors the
  timeout discipline in `app/assistant/llm_client.py`); sends an identifying
  `User-Agent` built from `geocoder_user_agent` + `geocoder_contact_email`; requests
  `format=jsonv2&limit=<geocoder_max_results>`; maps rows to `GeocodeHit(label, latitude,
  longitude, source="nominatim")`. Raises `GeocoderUpstreamError` on non-2xx response or
  transport/timeout error.
- `build_provider(settings)` factory selects by `settings.geocoder_provider`. Unknown value
  → clear error. Only `"nominatim"` is implemented now.

**`app/services/geocoding_service.py`** *(new)*
- `search_addresses(session, settings, query, *, provider=None) -> list[GeocodeHit]`.
  Provider is injectable so tests pass a fake (no network). Steps: normalize → cache read
  (respecting `geocoder_cache_ttl_days`) → on miss, rate gate then `provider.search()` →
  upsert cache → return. The normalized string is the cache key only; the trimmed user
  query is what's sent upstream. `GeocoderUpstreamError` from the provider propagates
  uncaught (the endpoint maps it to 502).
- Empty/whitespace query short-circuits to `[]` (no cache, no upstream).
- Rate gate: a module-level `threading.Lock` + last-call timestamp enforcing
  `geocoder_min_interval_s` before each upstream call. Per-process (see Caveats).

**`GeocodeCache` model** *(in `app/models.py`)* + **`alembic/versions/0007_geocode_cache.py`**
```
id               str   (PK, new_id)
provider         str   (indexed)
query_normalized str   (indexed)
results_json     str
created_at       datetime (utc_now)
UNIQUE(provider, query_normalized)        # upsert / dedup key
```
Freshness = `created_at` within `geocoder_cache_ttl_days` (default 30; geocodes are
stable). Reuses the existing `new_id` / `utc_now` / `Base` helpers.

**`app/api/dashboard_schemas.py`** *(modified)* — add `GeocodeResultSchema {label: str,
latitude: float, longitude: float, source: str}` matching the frontend `GeocodeResult`.

**`app/api/routes_public_dashboard.py`** *(modified)* — add the endpoint alongside the
existing `/dashboard/*` family:
```python
@router.get("/dashboard/geocode")
def dashboard_geocode(
    q: str,
    user_hash: str = Depends(required_public_user_hash),
    session: Session = Depends(get_session),
) -> list[GeocodeResultSchema]:
    try:
        hits = geocoding_service.search_addresses(session, get_settings(), q)
    except GeocoderUpstreamError as exc:
        raise HTTPException(status_code=502, detail="Geocoding upstream unavailable.") from exc
    return [GeocodeResultSchema(**asdict(hit)) for hit in hits]
```

### Config additions (`app/config.py`, `MCA_` prefix)

```
geocoder_provider:       str   = "nominatim"
geocoder_base_url:       str   = "https://nominatim.openstreetmap.org/search"
geocoder_user_agent:     str   = "Waypoint/0.1"
geocoder_contact_email:  str   = ""        # required when environment=prod
geocoder_cache_ttl_days: int   = 30
geocoder_max_results:    int   = 5
geocoder_timeout_s:      float = 5.0
geocoder_min_interval_s: float = 1.0       # ≤1 req/s politeness
```
Extend the existing production validator (`require_production_secret_overrides` pattern) so
`environment=prod` **requires** `MCA_GEOCODER_CONTACT_EMAIL` — Nominatim's policy requires
an identifiable contact. Update `.env.example` and `.env.deploy.example`. Note `README.md`
that geocoding is now backend-proxied and prod requires the contact email.

### Frontend wiring (`frontend/src/lib/geocoding.ts`)

- Add `createBackendProvider(endpoint = "/dashboard/geocode")` implementing the unchanged
  `GeocodingProvider`: `fetch(\`${endpoint}?q=…\`, { signal, credentials: "include",
  headers: { Accept: "application/json" } })`, throw on `!response.ok`, return the JSON
  array (already in `GeocodeResult` shape).
- Switch the exported `geocodingProvider` singleton to `createBackendProvider()`.
- Remove `createNominatimProvider` (dead once the singleton swaps).
- `PlaceSearch.tsx` and `MapWorkspace.tsx` are unchanged — they consume the interface.
- The Vite dev proxy already forwards `/dashboard/*` (and the other public paths) to the
  backend, so `npm run dev` keeps working.

### Error handling & fallback

- Empty/whitespace `q` → `200 []` → frontend shows "No matches. Drop a pin…".
- Upstream timeout/error → provider raises `GeocoderUpstreamError`, the endpoint maps it to
  **502** → the frontend's existing `catch` path shows "Search is unavailable. Drop a pin on
  the map instead." The manual-pin fallback you already have is untouched.

### Testing

- `tests/test_geocoding_service.py`: cache hit returns cached without calling the provider;
  cache miss calls the (fake) provider and upserts; normalization collapses
  whitespace/case so equivalent queries share a cache row; expired row (beyond TTL)
  re-fetches; upstream error propagates; empty query short-circuits to `[]`.
- `tests/test_dashboard_geocode_api.py`: `401` without a session; `200` + results with a
  session (fake provider); `502` on upstream failure; `[]` on empty `q`.
- `frontend/src/lib/geocoding.test.ts`: retarget from Nominatim to `createBackendProvider`
  — correct URL, result mapping, throw on `!ok`, `[]` on empty query.
- `make test-all` green (pytest + ruff + frontend test + build).

## Out of scope (YAGNI)

Commercial/self-hosted provider adapters (provider seam only), shared cross-worker rate
limiter, reverse geocoding, typeahead/autocomplete.

## Caveats / risks / open questions

- **Per-process rate gate.** With N workers, a cache-miss burst could briefly reach
  N req/s upstream. The DB cache makes misses rare (Seattle queries repeat), so this is
  acceptable for a beta. A shared limiter (DB/Redis) is the documented scale-up step — not
  built now, and not pretended to be globally enforced.
- **Coordination.** `app/config.py` was a contention point with the assistant-failover
  work, but that has merged (PR #12), so config edits are now safe. New work goes in a
  dedicated worktree per project practice (`CLAUDE.md`).
- **Product invariant.** Geocoding is address→coordinate lookup only; it does not score or
  label places, so it does not touch the "reported incident context, never a safety score"
  invariant.

## Deferred to a later release

- **Cache lifecycle / invalidation.** The beta intentionally ships lazy, TTL-only
  invalidation — no active eviction and no manual purge — so the `geocode_cache` table
  accumulates freely during data collection (a deliberate choice for the beta, not an
  oversight). Before a broader/GA release this should be addressed: an active sweep that
  deletes rows past `geocoder_cache_ttl_days` to cap the otherwise-unbounded table growth,
  and a purge path so upstream address corrections don't have to wait out the full TTL.
  Flagged here so the work travels with the feature and isn't lost between releases.

## Release strategy

Single branch/PR (`codex/geocode-proxy` or similar). The PR states: user-facing behavior
(search now proxied, identical UX + fallback), tests run, the new migration (`0007`) with
rollback note, and the new required prod env var (`MCA_GEOCODER_CONTACT_EMAIL`).
