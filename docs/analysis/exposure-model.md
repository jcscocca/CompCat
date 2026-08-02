# The exposure model: the denominator behind every rate

**Status:** methodology reference (updated 2026-07-30). The durable record of how CompCat forms
the **exposure** (denominator) for reported-incident rate comparisons: the place buffer, the
`π·r²·days` space-time density, and the rest-of-area baseline geometry
(`app/analysis/exposure.py`, `app/analysis/beat_baselines.py`,
`app/normalization/geo.py`, and the assembly in `app/services/neighborhood_service.py`).
Companion to [pairwise-comparison-engine.md](pairwise-comparison-engine.md) (which consumes
these exposures), [overdispersion-and-rate-intervals.md](overdispersion-and-rate-intervals.md),
and the [statistical-methods audit (2026-07)](statistical-methods-audit-2026-07.md) that
commissioned this writeup.

The current single-place detailed view uses
[empirical equal-radius reference circles](empirical-reference-circles.md), which compare
counts with identical geometry and do not need a polygon-density denominator. This document
still governs user-selected place-vs-place rates and the legacy polygon-density fields retained
temporarily in the neighborhood API for validation.

## TL;DR

- **Exposure is a space-time volume**, `E = π·r²·days` in **km²·days**, and a rate is
  `count / E` — **incidents per km²·day, a spatial-temporal density**, not a per-person or
  per-visit risk.
- **Buffer membership is metric**: an incident counts toward a place iff its haversine distance
  to the place's display point is ≤ the radius, using a spherical Earth of radius
  **6,371,000 m**.
- **No population denominator, deliberately.** There is no trustworthy small-area,
  time-varying at-risk population for these geographies; adopting one would be false precision.
  Density comparisons are internally consistent at equal radius and window (§2).
- **Results are radius-dependent by construction** (a MAUP effect). The user-selectable
  250–1000 m radius is an *explicit multi-scale probe*, not a hidden analyst choice (§3).
- **Retained legacy baselines carve the place's own buffer out** of its surrounding area so a place is never
  compared with itself, via a grid-sampled buffer∩polygon overlap (41×41 grid, ≈3% area
  error); sector/city baselines are whole-area with a bounded self-inclusion approximation
  (§4).

## 1. The exposure formula and the buffer

### 1.1 `π·r²·days`

For a place with radius `r` metres over `[start, end]`
(`place_exposure_square_km_days` in `app/analysis/exposure.py`):

```
radius_km = radius_m / 1000
days      = (end - start).days + 1          # inclusive of both endpoints
E         = π · radius_km² · days            # km²·days
```

Day counting is **inclusive** (a Jan 1 → Jan 1 window is 1 day, not 0). The rate consumed by
every test is `count / E`.

### 1.2 Buffer membership (haversine)

An incident is inside a place's buffer iff (`count_incidents_in_place_buffer`,
`_incidents_in_radius`):

```
incident has non-null latitude AND longitude
AND haversine_m(place_lat, place_lon, incident_lat, incident_lon) ≤ radius_m
```

`haversine_m` (`app/normalization/geo.py`) uses a spherical Earth,
`EARTH_RADIUS_M = 6_371_000`. The membership test is metric and radius-exact; the
`π·r²` area assumes a flat disk, which is well within any other error at a 250–1000 m scale.

### 1.3 What the rate *is*

Because the denominator is area×time, the rate is a **density: reported incidents per square
kilometre per day**. It is emphatically **not**:

- a per-capita or per-resident risk (no population term),
- a per-visitor or per-exposure-hour risk (no ambient/foot-traffic term),
- a probability that any individual experiences an incident.

Two places compared at the **same radius and same window** share the same `π·r²·days`
denominator up to the (identical) area factor, so their rate ratio is just the count ratio
scaled by exposure — an internally consistent density comparison. The place-vs-baseline
comparison additionally assumes the baseline area's incident **density** is a fair reference
for the buffer; ambient differences (a nightlife corridor vs. a residential block) can strain
that assumption, which is one more reason the product reports context rather than risk (§5).

## 2. Why no population / ambient denominator

The spatial-epidemiology and environmental-criminology ideal is a **population-at-risk**
denominator — residential population, or an ambient/foot-traffic population — so that a rate
approximates individual risk (Andresen 2011; Malleson & Andresen 2015). CompCat deliberately
adopts **neither**, for one overriding reason: **no trustworthy small-area, time-varying
denominator exists** for 250–1000 m buffers over a five-year window. Residential census counts
are static, coarse, and wrong for non-residential land uses; ambient-population estimates are
themselves modelled products with their own large uncertainty. Bolting any of these onto a
buffer count would manufacture a per-capita *risk* number whose precision the underlying data
cannot support — exactly the false precision the product refuses (mirroring the trend doc's
refusal of per-capita time series, `trend-indexing-method.md §7`).

Andresen's line of work matters here as a **warning, not a recipe**: it shows residential and
ambient denominators produce *materially different* risk pictures, so there is no single
"correct" population denominator to reach for even if one were available. The density model
sidesteps the choice by not making a per-capita claim at all. **Should the product ever rank or
score places** (rather than present conservative reported-context comparisons), an
ambient-population denominator — and the Andresen / Malleson & Andresen literature on choosing
one — becomes the first thing to add. Under the current product invariant it is correctly
absent.

## 3. MAUP and radius sensitivity

Any areal-unit analysis is subject to the **Modifiable Areal Unit Problem** (Openshaw 1984):
results depend on the size and placement of the units. CompCat's units are the analysis
buffers, so:

- **Scale effect (radius).** A place's rate and its verdict are **radius-dependent by
  construction** — a 250 m buffer and a 1000 m buffer around the same point measure different
  things (a tight micro-place vs. a neighbourhood-ish catchment, ~16× the area). This is not a
  defect to be hidden but a property to be surfaced: the **user-selectable 250–1000 m radius is
  an explicit multi-scale probe**. A reader who wants to know whether a result is scale-robust
  can re-run at another radius; the choice is theirs and is visible, not an analyst's silent
  default. (Egohood-style multi-scale buffers, Hipp & Boessen 2013, are the same idea.)
- **Zoning/placement effect.** The buffer is centred on the place's *display point*; shifting
  that centre shifts membership near the boundary. Because membership is a hard `≤ radius_m`
  cutoff, incidents just inside/outside the edge flip in or out. At 250–1000 m with block-level
  coordinate fuzzing in the source, this is a real but bounded sensitivity — another reason the
  engine's floors and intervals (not point estimates) carry the verdict.

The honest disclosure is that a single radius is one slice of a scale-dependent surface, and
the UI's radius control is the intended way to explore it.

## 4. Rest-of-area baseline geometry

A place must be compared with its **surroundings, not with itself**. The neighborhood surface
builds four nested baselines (`_baselines_for_place`); their geometry differs by scale.

### 4.1 Rest-of-MCPP and rest-of-beat: buffer carved out

For the MCPP and beat baselines the place's own buffer is **removed** from the comparator:

- **Incidents**: fetch the attribute-bucketed incidents for the relevant MCPP(s)/beat(s)
  (`_area_incidents` on `CrimeIncident.mcpp` / `CrimeIncident.beat`), then keep only those
  **outside** the buffer (haversine > radius, or lacking a usable coordinate) as the "rest".
- **Area**: subtract the buffer∩polygon overlap from the polygon area. The overlap is estimated
  by `buffer_beat_overlap_km2`:

  ```
  overlap = π·r² × (fraction of the disk's grid samples that fall inside the polygon)
  ```

  over a deterministic **41×41** uniform grid on the buffer's bounding box
  (`_OVERLAP_SAMPLES_PER_AXIS = 41`; ~1300 in-disk samples ⇒ **≈3% area error**, far tighter
  than the up-to-100% error of assuming the whole disk sits inside the polygon). Distances are
  converted to degrees with a local flat-earth factor, well within the sampling error at a
  beat's scale. Determinism (a fixed grid, not random sampling) means a given place always
  yields the same overlap.

Carving out both the incidents and the area keeps a boundary place's rest from being
understated (which would bias its rate ratio low). A rest-of-area entry whose rest is empty or
whose rest area is non-positive is **omitted** rather than reported as a failed comparison
(mirroring the legacy `baseline_too_small` refusal).

### 4.2 Pooled multi-beat baselines

When a buffer spills past its own beat, `beats_intersecting_buffer` returns the per-beat overlap
for every beat the disk touches (with a bounding-box prefilter skipping the rest). The pooled
"surrounding area" baseline is then

```
rest_area = Σ (beat areas) − Σ (per-beat overlaps)
```

so the carve-out is correct even when the buffer straddles several beats. The same pooling
applies to the MCPP baseline across overlapping MCPP polygons.

### 4.3 Sector and citywide: whole-area, bounded self-inclusion

Sector and citywide baselines are **whole-area** — the buffer is *not* carved out, and counts
come from grouped SQL (`area_month_counts`) rather than materialized rows, since only counts
are needed at those scales. The place's own incidents therefore appear in **both** halves (the
place buffer and the sector/city baseline), a small self-inclusion. The bound is the place's
share of the sector/city — a 250–1000 m buffer against a sector or the whole city is a
negligible fraction of the area and the count, so the approximation does not move the verdict.
The same whole-area approximation applies to the dispersion input (the combined monthly counts
double-count the place's incidents for sector/city), equally negligible.

## 5. Partial-edge-month trim (dispersion input only)

The dashboard's initial current-year window ends at the active layer's `data_through` when
freshness is available (otherwise today), and a user-selected window can start or end on any
day. A partial edge month has a **systematically depressed count** that would inflate the
index-of-dispersion φ. `trim_partial_edge_months` (`app/analysis/exposure.py`) drops at most one
leading bin (if the window starts after the 1st) and one trailing bin (if the window ends before
the month's last day), never leaving fewer than two bins.

Crucially, **only the dispersion estimate uses the trimmed series.** The rate, the exposure
`π·r²·days`, and the displayed monthly counts all use the full, untrimmed window. Trimming a
partial month out of the *rate* would silently change the denominator the user selected; it is
correct only as a cleanup of the variance estimate that feeds φ.

## 6. Missing-coordinate incidents

The buffer path requires **both** a latitude and a longitude and a within-radius distance
(`_incidents_in_radius`, `count_incidents_in_place_buffer`), so an incident lacking usable
coordinates **cannot enter any place's numerator**. The attribute-bucketed baseline path
(`_area_incidents`) requires a non-null latitude and the matching area attribute, but **not**
that the point falls in the buffer — so an incident with coordinates that don't place it in the
buffer (including one missing only its longitude) can still land in a rest-of-area baseline.

The audit (§3.3.3) judges this asymmetry **conservative** for the place-vs-baseline verdict — a
missing-coordinate incident can only add to the comparator (the baseline), never to the place —
and notes the more important gap: it is **undisclosed per-analysis**. Ratcliffe's (2004) 85%
minimum-geocoding-hit-rate benchmark is the relevant standard, and a per-analysis "N of M
incidents in this area had usable coordinates" line would close it. (Surfacing that count is a
separate code slice, not part of this doc.)

## 7. Product invariant

The exposure model produces a **reported-incident density** and nothing more. It does not
estimate anyone's personal risk, does not divide by a population it cannot trust, and does not
license a safe/unsafe label. Every rate it feeds ships with an interval and conservative floors
(see [pairwise-comparison-engine.md](pairwise-comparison-engine.md)); the density framing is
what keeps the whole surface honest reported context rather than a risk score.

## References

- Andresen, M.A. (2011). The ambient population and crime analysis. *Prof. Geographer* 63(2).
- Hipp, J.R. & Boessen, A. (2013). Egohoods as waves washing across the city. *Criminology*
  51(2).
- Malleson, N. & Andresen, M.A. (2015). Spatio-temporal crime hotspots and the ambient
  population. *Crime Science* 4:10.
- Openshaw, S. (1984). *The Modifiable Areal Unit Problem*. CATMOG 38.
- Ratcliffe, J.H. (2004). Geocoding crime and a first estimate of a minimum acceptable hit
  rate. *IJGIS* 18(1).
