# Anchored indexing for the area-vs-citywide trend overlay

**Status:** methodology reference (2026-07-16). Backs an expanded analysis card's
"Reported incident volume over time" section (`GET /dashboard/trends` + the frontend
indexing/rolling-mean computation). Companion to
[Overdispersion, Poisson vs. NB, and the per-address rate interval](overdispersion-and-rate-intervals.md),
whose quasi-Poisson variance model this doc reuses.

## TL;DR

The trend chart shows three series on **one real y-axis** (incidents per month in the
analyzed area):

1. the area's raw monthly counts `A_t`,
2. a trailing 12-month mean `R_t` of those counts, and
3. the citywide monthly counts `C_t` rescaled by a **single constant**
   `k = mean(A over the first 12 months) / mean(C over the first 12 months)`.

- Multiplying by a constant preserves every relative (percent) change in the citywide
  series exactly; anchoring on one full seasonal cycle at the *start* of the window lets
  area-vs-city drift **accumulate** instead of being averaged away.
- The visible gap between the area line and the indexed city line has an exact
  interpretation: it is the deviation of the area's *share of citywide volume* from its
  anchor-window share, scaled by citywide volume (§2, P5). Flat gap ⟺ constant share.
- The indexed city line's *level* carries the anchor's sampling noise (≈ a single global
  ±10–15% scalar for a mid-size area; §3.3), which is why the UI copy says the overlay
  shows **direction, not magnitude**, and why we draw no confidence band on it.
- This is a **descriptive** display: no per-bucket significance, no rate/exposure claim,
  no safety inference. The inferential version (per-bucket rate ratios with φ-scaled
  intervals) is a deliberately deferred follow-up (§5.1).
- Rejected alternatives — both-series-indexed-to-100, dual axes, share-of-city line,
  per-capita rates — and why, in §7.

## 1. Setting and estimand

Let `A_t` and `C_t`, `t = 1..T`, be monthly reported-incident counts for the analyzed
area (its assigned MCPP) and for the whole city, on the same layer (reported / arrests /
911 calls) and category filter, bucketed by calendar month in Seattle local time, ending
at the last **complete** calendar month (§8). For the reports and arrests layers `T = 60`
(fixed five-year window); for the 911-calls layer `T ≤ 24` (the rolling data floor, §6).

The section answers one question: **did this area's reported volume move differently
than the city's?** Formally, with anchor window `W = {1..L}` (the first `L = 12` months)
and anchor means

```
Ā = (1/L) Σ_{t∈W} A_t          C̄ = (1/L) Σ_{t∈W} C_t
```

the estimand is the **relative divergence**

```
δ_t = A_t/Ā − C_t/C̄
```

i.e. the difference between the two series' trajectories after each is normalized to its
own anchor level. The chart displays `δ_t` in the area's natural units (§2, P4) rather
than as a unitless index, so the area's real counts — the primary content on an Analyze
surface — stay on the axis.

## 2. The transform and its exact properties

Define the index factor and the indexed citywide series:

```
k   = Ā / C̄
Ĉ_t = k · C_t
```

**P1 — Scale equivariance (shape preservation).** For any two months `t, s`:
`Ĉ_t / Ĉ_s = (k·C_t)/(k·C_s) = C_t / C_s`. Every ratio — month-over-month change,
year-over-year change, peak-to-trough amplitude — of the citywide series survives the
rescaling exactly. The transform cannot manufacture or hide any relative movement.

**P2 — Anchor identity.** `mean_{t∈W}(Ĉ_t) = k·C̄ = Ā`. Over the anchor window the two
displayed series have the same mean by construction; they start "together."

**P3 — Log translation.** `log Ĉ_t = log C_t + log k`. On a log scale the transform is a
pure vertical shift — it has no shape degrees of freedom. This is the formal sense in
which anchored rescaling is the *least* manipulable overlay: the only choice made is one
scalar, and §3 pins that scalar down.

**P4 — The gap is the estimand.** The visible vertical gap between the lines is

```
g_t = A_t − Ĉ_t = A_t − (Ā/C̄)·C_t = Ā·(A_t/Ā − C_t/C̄) = Ā · δ_t
```

— the relative divergence `δ_t`, rescaled into incidents-per-month by the constant `Ā`.
Reading the gap off the chart *is* reading the estimand; nothing is distorted between
the statistic and the picture. If the area drops 20% from its anchor level while the
city is flat, the gap is `0.20·Ā` incidents/month — the actual size of the local change.

**P5 — Equivalence with share-of-city.** Let `S_t = A_t/C_t` be the area's share of
citywide volume in month `t`, and note that

```
k = Ā/C̄ = (Σ_{t∈W} A_t) / (Σ_{t∈W} C_t) = S_W
```

is exactly the anchor window's **pooled share** (count-weighted, not the mean of monthly
shares). Then

```
g_t = A_t − k·C_t = C_t·(S_t − S_W)
```

The gap is the deviation of the area's current share from its anchor share, scaled by
citywide volume. Corollaries:

- `g_t = 0 ⟺ S_t = S_W`: the lines touch exactly when the area holds its anchor share.
- A **flat zero gap over time ⟺ constant share**: "this area tracks the city."
- The anchored-overlay chart and a share-of-city line chart (§7) are mathematically the
  same reading; the overlay is chosen purely because it keeps real counts on the axis.

## 3. Why this anchor

### 3.1 Why a 12-month anchor, not a shorter one

Reported-incident series are strongly seasonal. Model the seasonality multiplicatively:
`A_t ≈ a·s_m(t)`, `C_t ≈ c·σ_m(t)` where `m(t)` is the calendar month and the seasonal
factors average 1 over a cycle. Anchoring on a single month `t₀` gives

```
k(1-month) ≈ (a/c) · s_{m(t₀)} / σ_{m(t₀)}
```

— the index factor absorbs the *ratio of seasonal factors at the anchor month*. Areas do
not share the city's seasonal profile (a nightlife corridor peaks differently than a
residential MCPP), so a July-anchored overlay and a January-anchored overlay would sit at
visibly different levels for the same data. Averaging over one full cycle removes the
first-order seasonal dependence: `mean_{one cycle}(s_m) = 1` by construction, so
`k(12-month) ≈ a/c` regardless of which month the window starts on. Any anchor shorter
than a full cycle re-introduces phase dependence; longer anchors (24 months) buy little
additional stability (§3.3) while eating the window in which drift can accumulate.

### 3.2 Why the *first* 12 months, not the whole window

Anchoring `k` on the full window (`k' = mean(A_{1..T}) / mean(C_{1..T})`) forces

```
Σ_{t=1..T} g'_t = Σ A_t − k'·Σ C_t = 0
```

— the gaps sum to zero by construction, so the lines are forced to cross and any
monotone drift is split into a "below early, above late" picture that visually averages
away the very signal the chart exists to show. Start-of-window anchoring makes the
display answer a specific, natural question — "**since five years ago**, has this area
moved differently than the city?" — and lets a real divergence accumulate monotonically
to its full size at the right edge, where the reader's eye is.

The trailing mean interacts nicely with this choice: `R_L = Ā` exactly (the first
defined point of the rolling line *is* the anchor level, §4), so the bold line begins on
the level the comparator was pinned to.

### 3.3 Anchor noise: what uncertainty the overlay carries

`k` is a ratio of two sample means of overdispersed counts. Using the quasi-Poisson
variance `Var(A_t) = φ·μ_A` established for this data (linear mean–variance; see the
companion doc), the delta method gives

```
Var(log k) ≈ Var(Ā)/Ā² + Var(C̄)/C̄²  =  φ_A/(L·Ā) + φ_C/(L·C̄)
```

(The covariance term from `A ⊆ C` is negative and of relative order `Ā/C̄`, i.e.
second-order; §5.3.) Illustratively, for a mid-size MCPP with `Ā = 40`/month and beat-scale
`φ ≈ 7`: `sd(log k) ≈ sqrt(7/(12·40)) ≈ 0.12` — the anchor is uncertain by roughly
±12% (one sd), while the citywide term (`C̄ ≈ 4,000`, even with a larger effective φ) is
negligible. Two consequences for the display:

- The dominant uncertainty is a **single global scalar**: it shifts the entire dashed
  line up or down as a block, and does not perturb its shape (P1/P3). A per-point
  confidence band would misrepresent this error structure — the honest disclosure is the
  copy line "**direction, not magnitude**," plus no band.
- Small areas (`Ā ≲ 10`) have anchor noise of ±25% or worse. The implementation floors
  the overlay: if the anchor mean of either series is too small to index meaningfully
  (in particular `Ā = 0`, where `k = 0` would draw a degenerate flat comparator), the
  overlay is omitted and a short note shown (§8).

## 4. The trailing 12-month mean

```
R_t = (1/12) Σ_{i=0..11} A_{t−i},        defined for t ≥ 12
```

**Seasonal annihilation.** Decompose `A_t = τ_t + ψ_{m(t)} + ε_t` (trend + stable
period-12 seasonal with `Σ_m ψ_m = 0` + noise). Any 12 consecutive months contain each
calendar month exactly once, so the seasonal component sums to exactly zero inside every
window: `R_t` is seasonal-free whenever the seasonal pattern is stable. (Under
multiplicative seasonality the cancellation is first-order rather than exact — adequate
at the amplitudes seen in this data.)

**Variance reduction.** `Var(R_t) = φ·μ/12` — the rolling line is √12 ≈ 3.5× less noisy
than the raw line in sd terms. At `μ = 40`, `φ = 7`: raw monthly sd ≈ 16.7 (±42% swings
are unremarkable), rolling sd ≈ 4.8. This is why the raw series is drawn recessive and
the rolling series bold: at monthly quasi-Poisson noise levels, the raw line alone
invites overreading of wiggles.

**Lag — the honest cost.** A trailing window's centroid sits 5.5 months behind `t`: a
step change appears in `R_t` with a ~6-month delay and takes 12 months to be fully
absorbed. A centered window would halve the apparent lag but cannot be computed for the
6 most recent months — exactly the months an analysis-card viewer cares most about. The design
keeps the trailing mean *and* draws the raw counts, so the most recent months are
visible in raw form while the smoothed line catches up. The first 11 months of the
window show no rolling value (no zero-padding, no partial windows).

## 5. Inference limits — what this display must not claim

### 5.1 No per-bucket significance (deliberate)

The natural inferential upgrade is a per-window rate ratio `RR_t = (A_t/Ā)/(C_t/C̄)`
with a φ-scaled interval, reusing `app/analysis/rate_tests.py` machinery — the deferred
"comparative/baseline temporal" follow-up noted in the roadmap after C1. It is not in
v1 because: (a) 60 buckets pose a real multiplicity problem (the app's BH-correction
convention would need extending to the time axis, and a per-month "significant!"
flag is exactly the over-claiming the product avoids); (b) monthly per-area counts sit in
the small-count regime where the intervals are wide enough to add ink but not
information; (c) the section's job is orientation, not adjudication. The descriptive
display makes no error-rate claims, and its copy must not imply any.

### 5.2 The reporting confound

`A_t` counts *reports*, not events. A local divergence is compatible with: changed
reporting behavior (a new business with a report-everything policy, a camera
installation, an organized reporting drive), changed police deployment (especially on
the arrests and calls layers, which measure enforcement activity and requests for
service respectively), boundary/geocoding changes in the source data, or a genuine
change in incidents. The chart cannot distinguish these, therefore the UI copy
*describes* ("reported volume diverged from the citywide trend") and never *attributes*
or *evaluates* ("got safer/worse" is barred — product invariant). This is the same
posture the layer framing already takes (calls = "requests for service, not confirmed
incidents").

### 5.3 Denominator self-inclusion

The area is part of the city: `C_t = A_t + B_t`. If the area alone changes by `ΔA` with
the rest of the city flat, the comparator moves by `k·ΔA ≈ S_W·ΔA`, so the displayed gap
change is `(1 − S_W)·ΔA` — attenuated by the area's citywide share. MCPP shares are
~1–4% of citywide volume, so the attenuation is ≤ 4%, far below the noise floor of §3.3.
Excluding the area from the citywide series would fix this at the cost of making the
citywide series per-area (destroying the endpoint's area-independent cacheability) for
no visible gain. **Decision: do not subtract; state the bound.** This decision should be
revisited if trends are ever computed for large sub-geographies (e.g. whole precincts,
share ≥ 10%).

### 5.3.1 Series-universe mismatch (A ⊆ C is not exact)

`C_t = A_t + B_t` (§5.3) additionally assumes the two series are bucketed on the same
universe of rows. They are not: the area series buckets on the `CrimeIncident.mcpp`
**attribute** (`trends_for_mcpp`, `column=CrimeIncident.mcpp`), while the citywide series
sums rows whose `CrimeIncident.beat` is in the vendored beat-area list
(`_beat_names()` ← `load_beat_areas()`, `app/services/trends_service.py`) — the same
geographic-beats-only list `beat_baselines.py` uses for beat exposure areas, which excludes
non-geographic/placeholder beat values. A row with a valid `mcpp` but a beat outside that
list (or blank) is counted in `A_t` but not in `C_t`: it enters the area series without
entering its own denominator, biasing `k = ΣA/ΣC` upward by at most the mismatch's share of
citywide volume.

Measured directly against the live source (2026-07-17, `data.seattle.gov`) over the
production windows: crime layer (`tazs-3rd5`), rows with a valid neighborhood since
2021-07, 1 mismatched row of ≈399,000 (the sole `beat = '-'` row; the 4 `beat = '99'` rows
*are* in the vendored list and so are already counted citywide); calls layer (`33kz-ixgy`),
rows with a valid dispatch neighborhood since 2024-07, 45 mismatched rows of ≈1,150,000
across eight non-geographic beat codes (`SP`, `E`, `CTY`, `INV`, `SPVDD`, `H3`, `N`, `S`).
Both ratios are ≤ 0.005% — several orders of magnitude below the ≈±10–15% anchor sampling
noise quantified in §3.3, so the bias this mismatch adds to `k` is not distinguishable from
zero at any practical precision.

**Decision: universes deliberately not aligned; state the bound instead of reconciling the
predicates.** Reconciling them (e.g. bucketing the citywide series on `mcpp` too, or
filtering the area series to beats in the vendored list) would trade a negligible, measured
bias for extra query complexity and a second dependency between the two series. Revisit only
if the source's beat/mcpp tagging quality degrades enough to move the mismatch share
materially — e.g. a data-provider change that stops populating `beat` for a large slice of
rows.

### 5.4 Geography basis

Area counts are bucketed by the source's `mcpp` **attribute** (`CrimeIncident.mcpp`), not
by a spatial point-in-polygon join — the same attribute bucketing the `_area_incidents`
service helper uses (`app/services/neighborhood_service.py`), chosen because it is robust to
SPD's block-level coordinate fuzzing. This is a **neighborhood-level** series, not
radius-buffer counts around the address. It is close to but not identical with the
neighborhood-baseline basis: the neighborhood baseline *rates* use polygon-based place
assignment plus a haversine buffer carve-out to separate the place from its surrounding
area, while the monthly *count series* backing those baselines are — like this trend
series — attribute-bucketed on `mcpp`/`beat`. The trend is a property of the
*neighborhood*, not of the 250–1000 m analysis buffer; mixing the two bases in one section
would invite false precision about the address itself.

## 6. The 911-calls layer (rolling 24-month floor)

The calls layer is floored at a rolling first-of-month 24-month window
(`calls_data_floor`), so `T ≤ 24`:

- The anchor is the first 12 available months; divergence then has only ~12 months to
  accumulate and the rolling line has ~13 points. The display is honest but shallow, and
  the section labels the window explicitly ("last 24 months — data floor") rather than
  silently showing a shorter chart.
- Because the floor *rolls* with each ingest, the anchor window itself slides month to
  month: `k` is re-estimated on a moving base, so long-lived bookmarks of the calls-layer
  view will legitimately show slightly different overlay levels over time. This is a
  property of the data floor, not a bug; it does not affect the reports/arrests layers,
  whose 60-month window slides the same way for both series and re-anchors identically.
- If fewer than `L + 1` complete months are available for any layer (fresh deploys,
  aggressive floors), the overlay and rolling line are suppressed and raw counts shown
  alone with a note — an under-12-month "trend" is not a trend.

## 7. Decision and alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| **Anchored constant rescale (chosen)** | ✅ | Real counts stay on the one axis; exact properties P1–P5; single-scalar error structure honestly summarized as "direction, not magnitude". |
| Both series indexed to 100 | ❌ | Honest but discards the area's absolute counts (the primary content of Analyze); percent framing over-dramatizes small areas (12 → 18 incidents reads "+50%"); unitless axis weakens the incident-context surface. Right form for an economist, wrong form here. |
| Dual y-axes | ❌ outright | Two free scales let the author render any two series as convergent or divergent at will; there is no principled choice of the second scale. Categorically excluded. |
| Share-of-city line `S_t` | ❌ for v1 | By P5 it is the same reading as the chosen gap (flat ⟺ tracks city) and is arguably the cleanest single-line statistic — but it hides the area's own volume and seasonality and is an unfamiliar read for a public audience. Noted as the right form for a future *citywide* trends surface, where per-area axes don't exist. |
| Per-capita / exposure-adjusted rates over time | ❌ | No trustworthy small-area, time-varying population/exposure series exists for these geographies; the app's exposure model is spatial, not temporal. Adopting a fabricated denominator would be false precision of exactly the kind the product refuses. |
| Poisson GLM (area × time interaction) | ❌ for this surface | The correct *inferential* machinery, but it yields coefficients and p-values, not an orientation display; multiplicity and small-count caveats of §5.1 apply. Belongs to the deferred comparative-temporal follow-up. |

## 8. Implementation contract

The math above assumes these data-contract details, which the endpoint and frontend must
honor (they are pinned by tests in the implementing PR):

1. **Raw series over the wire.** `GET /dashboard/trends` returns the two *raw* monthly
   series (`area[]`, `citywide[]`, aligned month labels). Indexing (`k`), the rolling
   mean, and gap rendering are frontend computations — this keeps the endpoint reusable
   (e.g. by a future citywide surface) and the cache per `(area, layer, category)`.
2. **Calendar-month buckets, complete months only.** Buckets are Seattle-local calendar
   months on the same timestamp convention as the analyze path
   (`offense_start_utc`-as-local, with the established fallback). The series ends at the
   last *complete* month — a partial current month would render as a spurious cliff.
3. **Zero-filling.** Months with no matching rows are explicit zeros, not gaps; every
   month in the window appears exactly once in each series.
4. **Anchor definition.** `L = 12`; `k = ΣA/ΣC` over the first `L` months (the pooled
   form of P5 — identical to the ratio of means, and well-defined when individual months
   are zero).
5. **Degenerate-anchor guard.** If `Σ_{t∈W} A_t = 0` or fewer than `L + 1` complete
   months exist, suppress the overlay (and rolling line, in the short-window case)
   rather than draw a degenerate comparator (§3.3, §6).
6. **Display rounding.** Axis ticks and tooltips show integers for counts; indexed
   citywide values round to integers in tooltips (they are not integers after scaling
   and must not pretend to be exact counts — tooltip labels them "citywide, indexed").

## 9. Worked example

Toy window, `T = 6`, anchor `L = 3` (for hand-checkable arithmetic; production uses
`L = 12`):

| t | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Area `A_t` | 30 | 42 | 36 | 33 | 27 | 24 |
| City `C_t` | 3000 | 4200 | 3600 | 3450 | 3750 | 3900 |

Anchor: `ΣA = 108`, `ΣC = 10800` over t ∈ {1,2,3} ⇒ `k = 108/10800 = 0.01` (the area's
pooled anchor share is 1%). Indexed city: `Ĉ = (30, 42, 36, 34.5, 37.5, 39)`.

- Over the anchor the lines coincide in mean (P2): `mean(A) = mean(Ĉ) = 36`.
- At `t = 6`: `g_6 = 24 − 39 = −15`. Check via P5: `S_6 = 24/3900 ≈ 0.615%`,
  `C_6·(S_6 − k) = 3900·(0.00615 − 0.01) = −15` ✓. The area's share fell from 1% to
  0.62% of citywide volume; scaled by `Ā = 36` (P4), the relative divergence is
  `δ_6 = g_6/Ā ≈ −0.42` — the area sits ~42% below where tracking the city would have
  put it.
- Note the city *rose* over the window while the area *fell*: a naive two-number
  comparison ("area down 20% since t=1") would understate the divergence; the anchored
  overlay shows the full 42% relative gap.

## 10. Placement and survival

This document is the durable record of the method; the spec
(`docs/superpowers/specs/2026-07-16-analyze-trend-section-design.md`) references it
rather than restating the math, and UI copy claims nothing this document does not
support. If the transform, anchor, or windows change, update this file in the same PR —
it is listed in `docs/README.md` alongside the overdispersion reference.
