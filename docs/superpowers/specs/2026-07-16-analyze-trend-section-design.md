# Analyze trend section — "Reported incident volume over time"

**Date:** 2026-07-16 · **Status:** approved design, ready for plan
**Methodology:** the math (anchored indexing, rolling mean, inference limits) lives in
[`docs/analysis/trend-indexing-method.md`](../../analysis/trend-indexing-method.md) — this
spec references it and does not restate it. UI copy may claim nothing that document does
not support.

## Goal

A descriptive monthly time-series section on the Analyze tab: the analyzed address's
assigned MCPP's reported-incident volume over the last 5 years (24 months on the calls
layer), with a trailing 12-month mean and a citywide comparator indexed per the
methodology doc. Answers "did reported volume around here move differently than the
city?" with zero verdict language.

## Non-goals (v1)

- No per-bucket significance / rate-ratio intervals (deferred comparative-temporal
  follow-up; methodology §5.1).
- No standalone/browse-any-neighborhood surface (that's the future citywide companion).
- No beat-level trend, no window picker, no assistant (Tabby) trends tool.
- No new map layers, no changes to the analyze payload or existing endpoints.

## Product invariant checkpoint

The section describes reported volume; it never scores, ranks, or evaluates safety.
Deterministic copy contains none of: safe/unsafe/dangerous/risk/improving/worsening/
better/worse (a test pins this, mirroring the compare-summary output check). The one
guard follow-up below *broadens* refusals, never narrows them.

## Backend — `GET /dashboard/trends`

New handler in `app/api/routes_public_dashboard.py`, session-gated with
`required_public_user_hash`, returning `dict[str, object]` (house convention).

**Query params**

- `mcpp` (required, `Query(max_length=80)`) — normalized via `normalize_mcpp()`; 404 if
  not a key of the cached `_mcpp_areas()` asset (bounds cache cardinality).
- `layer` (optional, default `reported`) — validated with `sources_for_layer()` inside
  `try/except ValueError → HTTPException(400)`.
- `category` (optional, `Query(max_length=80)`) — exact-match `offense_category` filter,
  mirroring the analyze path's category filter semantics.

**Window** (computed server-side; methodology §8.2)

- Months are Seattle-local calendar buckets on the canonical
  `coalesce(offense_start_utc, report_utc)` column with the Postgres
  `func.timezone("UTC", …)` wrap — reuse/mirror `_area_month_counts` in
  `app/services/neighborhood_service.py` exactly (its filter set is load-bearing:
  `source_dataset.in_(...)`, `latitude IS NOT NULL`, optional category).
- Series end at the last **complete** calendar month (relative to `date.today()`,
  injectable for tests). Length: 60 months for `reported`/`arrests`; for `calls`, the
  window starts no earlier than `calls_data_floor()` (≤ 24 months).
- Zero-filled via the existing `_months(start, end)` + `counts.get(key, 0)` pattern.

**Series**

- `area_counts`: `_area_month_counts(column=CrimeIncident.mcpp, values=[name], …)`.
- `citywide_counts`: same definition of "citywide" as the neighborhood baselines —
  `column=CrimeIncident.beat, values=sorted(beat area_lookup)` — so "citywide" means one
  thing everywhere.

**Response shape**

```json
{
  "layer": "reported",
  "mcpp": "BALLARD",
  "mcpp_label": "Ballard",
  "category": null,
  "months": ["2021-08", "…", "2026-06"],
  "area_counts": [31, "…"],
  "citywide_counts": [4102, "…"]
}
```

Raw series only — indexing and rolling mean are frontend computations (methodology §8.1),
keeping the payload reusable by a future citywide surface.

**Caching** — clone the H1 freshness TTL-cache pattern (`app/services/crime_service.py`):
module-level dicts, injectable `now=monotonic`, TTL 3600 s, key
`f"{layer}:{mcpp}:{category or ''}"` plus a shared `f"city:{layer}:{category or ''}"`
entry so every MCPP request reuses the citywide computation. Ship `reset_trends_cache()`
and an autouse reset fixture in `tests/conftest.py` (required — per-test SQLite DBs leak
otherwise).

New service module: `app/services/trends_service.py` (query + window + cache);
route stays thin.

## Frontend

**Placement** — new top-level block in `AnalyzeTab.tsx` between the per-place verdict
cards and `PairwiseSection`, rendered only when `neighborhood` exists and not `running`.

**MCPP selection** — the section derives the set of unique assigned MCPPs from
`neighborhood.places[].baselines` (`kind === "mcpp"`); the API param is
`normalize`-compatible (backend normalizes). One chart; when analyzed places span
multiple MCPPs, a small chip row switches between them (first MCPP selected by default).
Places with no assigned MCPP contribute nothing; if no place has one, the section
doesn't render.

**Data flow** — self-contained hook `useTrends(mcpp, layer, category)` in
`frontend/src/lib/useTrends.ts`, mirroring `useIncidentPoints` mechanics verbatim:
300 ms trailing debounce, one `AbortController` per request in a ref, abort-before-refire
and on unmount, `signal.aborted` guards before state writes. No `MapWorkspace` glue
needed: the section only renders under a non-null `neighborhood`, which invalidation
already nulls. Client wrapper `getTrends(params, signal)` in `api/client.ts` using
`new URLSearchParams(...)` (first GET-with-querystring wrapper; follow
`getIncidentPoints`'s signal-threading).

**Math** — pure functions in `frontend/src/lib/trendMath.ts` with unit tests:
`anchorFactor(area, city)` (pooled `ΣA/ΣC` over first 12; `null` when degenerate —
methodology §8.4–8.5), `rollingMean12(series)` (`null` for t < 12),
`indexCitywide(city, k)`. Suppression rules from §8.5: window < 13 complete months →
raw counts only + note; zero anchor → no overlay + note.

**Chart** — a real SVG (`TrendChart.tsx`, fixed `viewBox`, pure projection helpers —
`LocatorChip`/`locatorGeometry.ts` is the precedent). Marks use the **neutral data-mark
tokens**, identical in light/dark per the existing CSS invariant comment: raw monthly =
thin `--slate-soft` line, rolling mean = bold `--graphite`, citywide = dashed
`--text-dim`. (Deviation from the design mockup, which used blue: the codebase's
one-neutral-palette rule wins.) Y-axis zero-anchored with 5% headroom (`plotDomainMax`
convention); x-axis ticks at Januaries; `data-testid` hooks, no pixel assertions.
Hover: a nearest-month readout — `pointermove` over the SVG snaps a thin vertical rule
to the nearest month and shows its three values in a small text row above the chart
(no floating tooltip element; keyboard/touch degrade to nothing gracefully).

**Copy** (pinned by tests)

- Title: `{Noun} volume over time` via the existing `incidentNoun(layer)` helper;
  subtitle `{MCPP label} · last 5 years · monthly` (calls: `last 24 months — data floor`).
- Legend: "Monthly count", "12-month average", "Citywide, indexed".
- Footnotes: "Citywide series is indexed to this area's scale — it shows direction, not
  magnitude." / "Counts are reported incidents, not verified events." (layer-appropriate
  variants for arrests/calls, reusing the established framing.)
- Section does not follow the analyze date-range control and says so ("Fixed window").

**Styles** — `.mc-trend*` block in `mapWorkspace.css`, following `.mc-bplot`/`.mc-temporal`
rhythm (10.5–12 px labels, `var(--text-dim)`, `border-top: 1px solid var(--border)`).

## Guard follow-up (small, rides along)

Trend-flavored safety asks ("is this neighborhood getting worse?") should refuse.
Extend the H4 ambiguous-term arm (`_AMBIGUOUS_TERM_PATTERN` in `app/assistant/agent.py`)
with `worse|worsening` (EN) and `peor|empeorando` (ES) — ambiguous terms already trip
only with place context, which keeps "my code is getting worse" safe. Tests both ways
(trips with place word, not without). Do not touch the English `bad/worst` exclusion.

## Testing

- **Backend:** monthly bucketing + zero-fill (month-spread seed à la
  `session_with_places_and_beat_crime`), window end at last complete month, calls-floor
  truncation, layer/category filtering, unknown MCPP → 404, bad layer → 400,
  no session → 401, empty DB → zero-filled series (not an error), TTL cache hit +
  reset fixture, citywide cache shared across MCPPs.
- **Frontend:** `trendMath` unit tests (anchor pooled form, degenerate anchor → null,
  rolling window edges); `useTrends` debounce/abort (mirror `useIncidentPoints.test`);
  `TrendChart`/section render states (loading, error, calls window, suppressed overlay,
  multi-MCPP chips); copy-pinning test asserting title/footnotes and absence of verdict
  vocabulary.
- **Docs:** ROADMAP gets a shipped entry when this lands; `docs/architecture/api.md`
  gains the endpoint row.

## Shipped deviations

- **Placement: `CompareTab.tsx`, not `AnalyzeTab.tsx`.** The unified-Compare refactor
  (#145/#146) landed on `main` between this spec's code survey and implementation,
  removing `AnalyzeTab`/`PairwiseSection`. `<TrendSection>` renders at the structural
  equivalent: after the per-place verdict cards, before `IncidentDetailsSection`, gated
  on a non-null `neighborhood`.
- **Cache clock threading:** `trends_for_mcpp` reads `now()` once per call and threads
  the value through the shared/citywide cache checks (the spec's inline-reads version
  double-advances injectable test clocks); semantics unchanged.
- **`TrendChart` gained an optional `label` prop** feeding only the `aria-label`.
- Guard tests written as plain functions (matching the guard test module's existing
  style) rather than parametrize tuples.
