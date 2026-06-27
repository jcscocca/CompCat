# OpenTripPlanner Routing Provider + Analysis Query Performance

**Date:** 2026-06-26
**Status:** Approved for implementation
**Related:** roadmap epics **B** (live routing provider, WS6) and **C** (real-data
performance, WS4) in `docs/superpowers/plans/2026-06-26-waypoint-next-steps-roadmap.md`.

## Goal

Two contained backend changes that ready Waypoint for real-data routing/analysis without
building any UI:

1. **B1 — OpenTripPlanner provider.** Implement OTP behind the existing `RoutingProvider`
   interface, selectable by config, with the deterministic mock remaining the default.
   No live OTP instance yet — built against OTP's REST API and verified with mocked HTTP.
2. **C — analysis query performance.** Replace the three full-table `CrimeIncident` loads on
   the analysis/route paths with SQL bounding-box + date + offense prefilters, keeping the
   exact Python geometry checks on the narrowed candidate set.

**Explicitly deferred (not this spec):** the route UI (B2) and promoting `/internal/routes*`
+ `/internal/analysis/routes*` to public endpoints; a live OTP deployment + smoke test;
personal upload (epic A).

## Background / current state

- `app/routing/providers.py` has a `RoutingProvider` Protocol (`get_routes(request) ->
  list[RouteAlternativeData]`) and a factory `get_routing_provider(name)` that only knows
  `"mock"`. `app/services/route_service.py` selects the provider from
  `request_payload.provider` (default `"mock"` in `RouteRequestCreate`). `app/config.py` has
  no routing settings.
- Three code paths load the **entire** `crime_incidents` table into Python and filter there:
  - `analysis_service.compare_site_options` (`_incident_rows`, line ~52) — place buffers.
  - `analysis_service.compare_route_request` (`_incident_rows`, line ~135) — route corridors.
  - `route_service.create_route_alternatives` (line ~130, inline `select(CrimeIncident)`) —
    route context summaries via `summarize_route_context`.
  The geometry/date/offense filtering lives in `app/analysis/exposure.py`
  (`count_incidents_in_place_buffer`, `count_incidents_in_route_corridor`) and
  `app/routing/context.py` (`summarize_route_context`); all three **re-apply** date and
  geometry filters on whatever list they are given.

## Decisions (approved in brainstorming)

1. Scope = B1 (provider backend) + C (query perf), UI deferred, no live OTP instance.
2. OTP via the **REST `/plan`** API (simpler/stabler than GraphQL).
3. Provider selection: a config default (`MCA_ROUTING_PROVIDER`) that a request can override.
4. Perf via **SQL bbox + date + offense prefilter**, feeding the unchanged `exposure.py` /
   `context.py` filters so results are identical — a shared `incident_query_service` module.
5. Fold the `route_service.py` route-context full-load into C (all three call sites).

## Architecture

### B1 — OpenTripPlanner provider

**Config** (`app/config.py`, on `Settings`):
```python
routing_provider: str = "mock"            # MCA_ROUTING_PROVIDER = mock | opentripplanner
opentripplanner_base_url: str = ""        # MCA_OPENTRIPPLANNER_BASE_URL
opentripplanner_timeout_s: float = 10.0
```

**Provider** (`app/routing/opentripplanner_provider.py`): `OpenTripPlannerProvider` with
`__init__(self, base_url: str, *, timeout_s: float = 10.0, client: httpx.Client | None =
None)` and `get_routes(request) -> list[RouteAlternativeData]`. It issues
`GET {base_url}/plan` with `fromPlace=lat,lon`, `toPlace=lat,lon`, `mode`, optional
`date`/`time`, and `numItineraries`. Mode map: `transit→"TRANSIT,WALK"`, `walk→"WALK"`,
`bike→"BICYCLE"`, `drive→"CAR"`. Each `plan.itineraries[i]` →
`RouteAlternativeData(rank=i+1, duration_minutes=duration/60, distance_m=sum(leg.distance),
transfer_count=transfers, walking_distance_m=walkDistance, mode_mix=<distinct leg modes>,
summary_geometry=<joined decoded legs>, provider="opentripplanner", provider_metadata_json=
{"otp_itinerary_index": i})`; each `leg` → `RouteSegmentData` (segment_type from leg:
transit leg → `"ride"`, access/egress walk → `"access"`/`"egress"`, else the mode;
start/end from `leg.from`/`leg.to`; `distance_m`, `duration_minutes`, and `geometry` from a
decoded `legGeometry.points`). A small Google **encoded-polyline decoder** converts OTP
geometry to the mock's `"lat,lon;lat,lon"` string format. The injectable `client` makes the
HTTP layer testable with `httpx.MockTransport`.

**Factory** (`app/routing/providers.py`):
```python
def get_routing_provider(provider_name: str, *, opentripplanner_base_url: str = "") -> RoutingProvider:
    if provider_name == "mock":
        return MockRoutingProvider()
    if provider_name == "opentripplanner":
        if not opentripplanner_base_url:
            raise UnsupportedRoutingProviderError("OpenTripPlanner base URL is not configured.")
        return OpenTripPlannerProvider(opentripplanner_base_url)
    raise UnsupportedRoutingProviderError(f"Unsupported routing provider: {provider_name}")
```
Add `class RoutingProviderError(RuntimeError)` for HTTP/parse failures at request time.

**Selection** (`app/routing/schemas.py` + `app/services/route_service.py`):
`RouteRequestCreate.provider` default changes `"mock"` → `None`. `create_route_alternatives`
resolves `provider_name = request_payload.provider or settings.routing_provider`, passes
`opentripplanner_base_url=settings.opentripplanner_base_url` to the factory, and persists the
resolved `provider_name` on `RouteRequest.provider` / `RouteRequestData.provider`.
Backward-compatible: a request without a provider still resolves to the configured default
(`"mock"`).

**Endpoint** (`app/api/routes_routes.py`): catch `RoutingProviderError` → HTTP 502.

### C — analysis query performance

**New module** `app/services/incident_query_service.py`:
```python
@dataclass(frozen=True)
class BoundingBox:
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float

def bounding_box_for_points(points: list[tuple[float, float]], radius_m: int) -> BoundingBox: ...
    # expands the lat/lon extent of the points by radius_m converted to degrees
    # (lat: radius/111_320; lon: radius/(111_320*cos(mean_lat)), guarded near the poles).

def incidents_in_bbox(
    session, *, box: BoundingBox, analysis_start_date, analysis_end_date,
    offense_category=None, offense_subcategory=None, nibrs_group=None,
) -> list[CrimeIncidentData]: ...
    # SQL: latitude/longitude non-null and within box; coalesce(offense_start_utc,
    # report_utc) within [start 00:00, end 23:59:59.999999] (tz-aware UTC); optional
    # offense_category/subcategory/nibrs_group equality. Returns CrimeIncidentData
    # (reuses crime_service._incident_data).
```

**Call sites** (each computes a union bbox, loads via `incidents_in_bbox`, then calls the
**unchanged** downstream filter):
- `compare_site_options`: `points = [(o.latitude, o.longitude) for o in options]`,
  `box = bounding_box_for_points(points, radius_m)`; load with date + offense filters; pass
  to `count_incidents_in_place_buffer` (re-applies date/offense + haversine).
- `compare_route_request`: `points` = all `parse_route_geometry(alt.summary_geometry)` across
  alternatives, `box = bounding_box_for_points(points, request.radius_m)`; load with date +
  offense filters; pass to `count_incidents_in_route_corridor`.
- `route_service.create_route_alternatives`: `points` = all route-alternative segment
  start/end coords, `box = bounding_box_for_points(points, max(radii_m))`; load with date
  filters (no offense filter — context summaries group by offense); pass to
  `summarize_route_context`.

`exposure.py` and `context.py` are unchanged. Because they re-apply the exact date and
geometry checks, the prefilter only shrinks the candidate set; output is identical.

## Data flow

1. **Routing:** request → `route_service` resolves provider (config default or request
   override) → `get_routing_provider` → mock or OTP `get_routes` → persisted alternatives;
   then context summaries + statistical comparison run over a bbox-narrowed incident set.
2. **Analysis:** site/route comparison computes a union bbox, loads the narrowed incident set
   in SQL, and runs the existing exposure/statistics pipeline.

## Error handling / edge cases

- **OTP unreachable / non-200 / malformed JSON / timeout** → `RoutingProviderError` → 502.
- **`opentripplanner` selected without a base URL** → `UnsupportedRoutingProviderError`.
- **Empty/degenerate geometry** for the route bbox → falls back to the existing
  `_require_route_corridor_points` validation (≥2 points) before bbox use.
- **Bounding box near ±180° longitude** is not a concern (Seattle data); the lon expansion
  guards against `cos(lat)=0`.
- **No incidents in box** → empty list → the existing pipeline yields zero counts as today.

## Testing

- **B1:** contract tests feed a representative OTP `/plan` JSON through `httpx.MockTransport`
  and assert the mapped alternatives/segments (duration, distance, transfers, walking
  distance, mode mix, decoded geometry, segment types); polyline-decoder unit tests; factory
  tests (unknown provider; `opentripplanner` without URL raises); a `route_service` test that
  config `routing_provider="opentripplanner"` + a stubbed provider is selected, and that a
  `RoutingProviderError` surfaces as 502. Mock stays the default in all existing route tests.
- **C:** `incident_query_service` unit tests (bbox math; SQL date/offense/bbox filtering;
  incidents just inside vs. just outside the box and date range). **Parity tests** asserting
  `compare_site_options`, `compare_route_request`, and the route-context summaries return the
  same counts/sets as the pre-change full-load implementation on a fixture with incidents
  both inside and outside the relevant area.
- **Gate:** `make test-all`.

## Out of scope

- A live OpenTripPlanner deployment and an end-to-end live smoke test.
- The route UI (B2) and public route/analysis endpoints (stay internal-gated).
- OTP GraphQL API; non-Seattle geographies; personal upload (epic A).
