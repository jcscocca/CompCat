# Counting Without Keeping Score

CompCat answers one narrow question: how does the volume of *reported* SPD incidents around
one address compare with the volume around another address, or with the area surrounding it,
under the filters the reader picked. It is not a safety score and must never become one. Every
statistical choice below exists to keep those comparisons honest — and most of them exist
because the simpler choice would have been dishonest.

## Why can't you just count incidents?

The first version of anything like this counts. Forty-seven incidents here, a hundred and
twelve there, done. The problem is that a raw count conflates three different things: how many
reports exist, how much ground the question covers, and how long a window it covers. Widening
the radius or extending the window grows the count without saying anything about the place.

So every rate CompCat computes has an explicit denominator, and the denominator is a
space-time volume:

```
radius_km = radius_m / 1000
days      = (end - start).days + 1        # both endpoints inclusive
E         = π · radius_km² · days         # km²·days
```

An incident counts toward a place when its haversine distance from the place's display point
is at most the selected radius (spherical Earth, `EARTH_RADIUS_M = 6_371_000`). The rate is
`count / E` — reported incidents per square kilometre per day. A spatial-temporal density.

What that rate deliberately is *not* is a per-capita number. The spatial-epidemiology ideal is a
population-at-risk denominator — residential, or ambient/foot-traffic — so that a rate
approximates something about individuals. I adopted neither, for one overriding reason: no
trustworthy small-area, time-varying denominator exists for a 250–1000 m buffer over a five-year
window. Residential census counts are static, coarse, and wrong for non-residential land uses;
ambient-population estimates are modelled products with their own large uncertainty. Andresen's
line of work is the warning here rather than the recipe: it shows residential and ambient
denominators produce *materially different* pictures, so there is no single correct population
denominator to reach for even if one were available. Dividing a buffer count by a number I
don't trust would manufacture precision the underlying data cannot support.

The other honest disclosure is scale. Any areal-unit analysis is subject to the Modifiable
Areal Unit Problem, and CompCat's areal units are the buffers themselves, so results are
radius-dependent by construction. A 250 m buffer and a 1000 m buffer around the same point
measure different things — a tight micro-place versus a neighbourhood-ish catchment, roughly
16× the area. I chose to surface that rather than hide it: the radius control belongs to the
reader, and re-running at another radius is the intended way to check whether a result is
scale-robust. A fixed radius chosen by me would be the same modelling decision made invisibly.
The placement effect is real too — membership is a hard `≤ radius_m` cutoff on a block-fuzzed
coordinate, so incidents near the edge flip in and out — one more reason the verdicts ride
intervals and floors rather than point estimates.

Full detail: [the exposure model](../analysis/exposure-model.md).

## Compared to what?

A density on its own means nothing. The comparison is the product, and there are two kinds:
the other addresses a reader entered, and the area surrounding a single address.

For the second kind the honest local comparator is the **rest of the beat**. The place's beat
comes from a ray-casting point-in-polygon test of its display point against the vendored SPD
beat polygons (the published "Seattle Police Beats 2018-Present" layer) — real geography, not a
nearest-name guess. Then the place's own buffer is carved out of it, on both sides of the
fraction:

- **Incidents:** take the beat's incidents, keep only those *outside* the buffer.
- **Area:** subtract the buffer∩polygon overlap from the beat's polygon area.

Without the carve-out a place is partly compared against itself, which understates the "rest"
and biases the place's rate ratio low — precisely the direction that would flatter a place.

Computing that overlap exactly would mean real polygon clipping. Instead the estimate samples a
deterministic 41×41 grid over the buffer's bounding box and multiplies `π·r²` by the fraction
of in-disk samples falling inside the polygon. About 1,300 in-disk samples give roughly 3% area
error, against the up-to-100% error of the naive alternative (assuming the whole disk sits
inside the polygon). The grid is fixed rather than random, so a given place always yields the
same overlap. When a buffer straddles several beats, the per-beat overlaps are summed:
`rest_area = Σ(beat areas) − Σ(overlaps)`.

That is the first rung of a four-rung ladder — MCPP, beat, sector, citywide. The MCPP and beat
rungs carve the buffer out as above. The sector and citywide rungs are whole-area: the place's
own incidents appear in both halves. I took that approximation deliberately, because the bound
is obvious — a 250–1000 m buffer is a negligible share of a sector's or the city's area and
count, so the self-inclusion cannot move a verdict. Where a comparison genuinely can't be
formed — an empty rest, or a non-positive rest area — the entry is omitted rather than
reported as a failed comparison.

Geometry detail: [exposure model §4](../analysis/exposure-model.md).

## Is Poisson enough?

Counts of events in space and time invite a Poisson model, and Poisson asserts `Var = μ`. That
is an empirical claim, so I tested it — and the first thing I had to do was refuse to test it
on the convenient data. The local dev seed (`app/data/seed_crime.csv`) is generated as
`randint(1, 3)` incidents per beat per quarter: an *under*-dispersed uniform process with
Var/mean ≈ 0.33. Running the diagnostic on it would have produced a reassuring answer that was
entirely an artifact of my own seeding code.

So the measurement runs against the real source — SPD Crime Data, Socrata `tazs-3rd5` on
`data.seattle.gov`, 712,999 reported incidents since the app's 2018 data floor, current
through 2026-06 — aggregated server-side into unit × calendar-month counts with empty months
zero-filled.

Reported incidents are strongly overdispersed. At the beat scale (52 real beats, monthly means
36–241) the global Pearson dispersion is **φ̂ = 6.94** over 2018–2025 and **4.27** over the
shorter 2022–2025 window; 100% of beats exceed the 1.2 threshold. Naive Poisson would badly
understate uncertainty here, so a correction is not optional.

The interesting question was *which* correction. Applied crime work usually reaches for
negative binomial by default. But quasi-Poisson and NB2 make different claims about the shape
of the overdispersion — `Var = φ·μ` (linear) versus `Var = μ + α·μ²` (quadratic) — and Ver
Hoef & Boveng's discriminating diagnostic makes that a measurable question: regress log
variance on log mean across units and read the slope. About 1 means the quasi-Poisson family;
approaching 2 means NB2.

Measured slope: **1.20** at beat scale 2018–2025 (R² 0.44), **1.27** at beat scale 2022–2025
(R² 0.59), **1.13** at reporting-area scale (7,390 units with ≥ 6 incidents, R² 0.93). Every
scale lands in **1.1–1.3**. The relationship is linear, not quadratic.

The binned fit says the same thing more concretely. Observed variance by mean bin at beat
scale, against what each model predicts:

| bin mean μ | observed Var | quasi-Poisson φ̂·μ | NB2 μ + α·μ² |
|---|---|---|---|
| 82.9 | 504 | 575 | 339 |
| 116.2 | 887 | 806 | 619 |
| 157.4 | 989 | 1092 | 1081 |
| 209.8 | 1865 | 1456 | 1851 |

Quasi-Poisson tracks the data; NB2 under-predicts variance badly at low means and over-predicts
higher up, its quadratic term forcing variance to accelerate in a way the data don't. It is not
the more careful model here; it is the worse-fitting one. A second objection is purely
practical: in a two-count comparison α isn't identifiable from the pair, so it would have to be
estimated from the same handful of monthly bins where its MLE is noisy and boundary-prone.
Fragility for no fit gain.

So the engine is quasi-Poisson everywhere. The pairwise standard error is
`se(log RR) = sqrt(φ·(1/kₐ + 1/k_b))`, and the per-address interval is the same expression with
one term, `sqrt(φ/k)`. That sameness is the point: one variance model feeds both the verdict
and the number line, so the interval a reader sees can never visually contradict the label
beside it. φ itself is the index of dispersion over the monthly counts, floored at 1.0 before
it enters the SE — an estimated φ < 1 on a dozen small bins is almost always noise, and
flooring can only ever widen an interval. The method *label* still reflects the raw estimate
(above 1.2 reads as quasi-Poisson), so flooring never mislabels anything.

The honest coda is that these Wald forms use φ as if it were known, and it isn't. A seeded
Monte-Carlo calibration (`tests/test_rate_calibration.py`) found the consequence: with φ
estimated from a 12-month split and the normal quantile, the 95% single-rate interval
*under-covers* — down to 0.827 at true φ = 7, μ = 10, and about 0.90 at φ = 3. With the *true*
φ the same interval covers ~0.95, so the form is fine; the miss is entirely φ̂ noise. When φ̂
lands low, the interval comes out too narrow.

The fix is the standard quasi-likelihood convention (Wedderburn 1974; McCullagh & Nelder §4.5):
when φ is estimated from *n* period bins, reference the statistic to Student-t on **ν = n − 1**
instead of the normal. The CI half-width and the decision p-value use the same statistic and
the same distribution, so the exact duality — *p* < 0.05 ⇔ the 95% interval excludes 1 —
survives intact. The t is pure stdlib (regularized incomplete beta via a Lentz continued
fraction, quantile by bisection), and the normal quantile is kept where t would be wrong or
pointless: φ assumed rather than estimated, and ν ≥ 200 where the quantiles coincide.

Measured coverage before and after, at 95% nominal:

| true φ | μ = 5 | μ = 10 | μ = 15 |
|---|---|---|---|
| 3, normal | 0.966 | 0.910 | 0.902 |
| 3, t | 0.978 | 0.944 | 0.931 |
| 7, normal | 0.966 | 0.827 | 0.846 |
| 7, t | 0.978 | 0.891 | 0.886 |

Every cell improved, and the two-sample test became uniformly more conservative. It did *not*
close the gap: at φ = 7 with μ ∈ {10, 15}, coverage remains ~0.89 against a 0.92 target,
because a fixed-ν widening cannot absorb a φ̂ that is itself off by 2–3× on twelve tiny bins.
That residual is pinned in the test suite as an accepted, known shortfall rather than quietly
rounded away — and it sits outside the regime this surface actually occupies. The per-address
interval lives at reporting-area scale, where measured dispersion is mild (φ̂ ≈ 1.47) and
coverage is ≥ 0.93; φ ≈ 7 was only ever observed at beat scale, which feeds the pairwise path,
where the t correction leaves type-I error uniformly below nominal.

Full derivation and results: [overdispersion and rate
intervals](../analysis/overdispersion-and-rate-intervals.md).

## How do you avoid crowning a winner by chance?

On the Compare surface a reader supplies *k* addresses. The engine picks the option with the
lowest observed rate as the candidate, then tests it against every other option — *k* − 1
tests. That design has two distinct statistical hazards, and they need different answers.

The first is plain multiplicity. Benjamini–Hochberg step-up adjustment runs per request, one
family at a time: across the *k* − 1 pairwise tests; within a place across its four nested
baselines; and across places, over each place's primary place-vs-rest-of-beat test. The
comparison is against α = 0.05, so the effective FDR level is q = 0.05. The nested-baseline
family is emphatically *not* independent — MCPP ⊂ beat ⊂ sector ⊂ city, all sharing the same
place numerator — but BH controls FDR under positive regression dependence, not merely
independence (Benjamini & Yekutieli 2001), and a nested containment family of rate comparisons
with a shared numerator is a canonical PRDS case. So BH holds without the more conservative
`Σ1/i` penalty.

The second hazard is subtler and BH does nothing about it. Selecting the minimum of several
noisy rates and then testing that same minimum is selective inference: the minimum is biased
low, so the per-pair adjusted p-value against the selected candidate is mildly optimistic. The
winner's curse. I did not correct it, and the reason is that the *decision rule*, not the
p-value, is where the conservatism lives:

- The candidate must be classified `statistically_lower` against **every** alternative. One
  `not_statistically_clear` pair collapses the entire verdict.
- On top of the adjusted p, the rate ratio must reach `MAX_RATE_RATIO_FOR_RECOMMENDATION`
  = 0.80 — a 20% lower rate — so a statistically significant 3% difference on a large exposure
  cannot win anything.
- The minimum-data floors must hold on every pair.

The selective-inference review reached the conclusion I needed: selection alone cannot
manufacture a winner. It can only nominate a candidate that still has to clear all three gates
against every comparator. That acknowledgment lives in code, directly above
`candidate = min(...)`, with the condition attached: if CompCat ever presented a *ranked*
surface instead of one conservative verdict, this bias would need explicit correction. A
precondition, not a gap I'm hoping nobody notices.

For transparency the engine also computes an exact conditional-Poisson p-value: conditioning on
the total *kₐ* + *k_b*, the candidate's count is Binomial(*n*, Eₐ/(Eₐ + E_b)) under the
equal-rate null. It is reported and never decisional — deciding on it would break the duality
with the Wald interval that keeps the label and the number line consistent. In the overdispersed
regime it isn't even computed, because a test that assumes away the overdispersion I just
measured would be anticonservative there.

Two alternatives are recorded as rejected rather than quietly omitted. Empirical-Bayes shrinkage
fixes a failure mode this product doesn't have — no map-of-rates, no league table for noisy
small units to distort — and a shrunk point estimate would no longer match the interval drawn
beside it. Session-level multiplicity across a reader's dozens of scans has no principled family
boundary; the honest response is disclosure in the copy, not inflating every p-value by an
unknowable factor.

Full engine walkthrough: [the pairwise comparison
engine](../analysis/pairwise-comparison-engine.md).

## When should the answer be "not enough data"?

The hardest discipline in this project was building the paths that decline to answer. Before
any directional class is assigned, a comparison has to clear four floors:

| Floor | Value | Refusal |
|---|---|---|
| `MIN_ANALYSIS_DAYS` | 30 days | `date_range_too_short` |
| positive exposure | — | `non_positive_exposure` |
| `MIN_PLACE_COUNT` | 3 | `option_count_too_low` / `place_count_too_low` |
| `MIN_COMBINED_COUNT` | 10 | `combined_count_too_low` |

`MIN_PLACE_COUNT` earns its place for a specific reason. The candidate is the lowest-rate
option and the only one that can win, so without a floor on *its own* count a near-empty
candidate could be crowned on a combined count that a busy comparator satisfies single-handed —
a ranking derived from no signal at the place itself.

Then there is the case where the model can't be fit at all. `dispersion_status` returns
`insufficient_periods` when the monthly series has fewer than two bins, so φ cannot be
estimated; the engine emits `model_warning` and makes no directional claim. On the neighborhood
surface that warning maps onto the same `insufficient` relation the UI shows for unmet floors,
because a UI must not display a direction the model cannot support. The same instinct suppresses
output elsewhere rather than degrading it: rest-of-area baselines with an empty rest or
non-positive area are omitted; places whose baseline can't be resolved surface as
`baseline_available: false`; the trend overlay disappears entirely when the anchor window is
degenerate or fewer than thirteen complete months exist, because an under-12-month "trend" is
not a trend.

I had all of this audited against the literature — a three-track sweep of the docs, a
line-level inventory of the implemented statistics, and a benchmark drawn from quantitative
criminology, spatial epidemiology, and risk communication. The scorecard is useful precisely
because it is mixed. It marks the overdispersion work as *exceeding* standard practice, since
most applied work assumes NB by default while this measured the mean–variance relationship and
rejected NB2 on fit, and marks the effect-size floors and FDR control as meeting the benchmark.
It accepts three divergences as documented trade-offs: Wald-with-φ rather than an exact or mid-p
test as the decisional statistic (bought deliberately, to keep one variance model), spatial
density rather than population-at-risk exposure, and no empirical-Bayes shrinkage.

And it left genuine gaps on the board. There is no aoristic handling of interval-timed offenses
— burglary-style offenses with a start/end window get point-stamped at `offense_start_utc`,
biasing the hour-of-day profile toward window-opening times. There is no per-analysis
geocoding-completeness disclosure; Ratcliffe's 85% minimum-hit-rate benchmark is the standard,
and a line reading "N of M incidents in this area had usable coordinates" would close it.
Neither is written yet. That the audit was allowed to find things, and that its findings sit
unresolved in the repo rather than edited out, is the part I'd defend hardest: a methodology
record that only lists wins isn't an audit.

Full scorecard: [statistical methods audit,
2026-07](../analysis/statistical-methods-audit-2026-07.md).

## What the numbers still can't say

**Reported is not occurred.** Every count here is a count of *reports*. Reporting propensity
varies by offense type, by neighborhood, by year, and by circumstances no dataset records — a
new business with a report-everything policy, a camera installation, an organized reporting
drive. A local divergence from the citywide trend is equally compatible with changed reporting
behavior, changed police deployment, boundary or geocoding changes upstream, or a genuine
change in incidents. Nothing in the data separates those, so the copy describes and never
attributes.

**Enforcement is not incidence.** The arrests and 911-calls layers measure police activity and
requests for service respectively. A higher arrest count is a fact about enforcement, not a
measurement of what happened.

**And none of it is a score.** A `statistically_lower` verdict says one specific thing: under
these filters, at this radius, over this window, this address's reported-incident density came
in at least 20% below the comparator's, with a BH-adjusted *p* under 0.05, an interval that
excludes 1, and enough incidents on both sides to run the test at all. It does not say a place
is "safe" or "unsafe", does not rank anywhere as "dangerous", does not claim anyone was present
at an incident, and does not predict anything about any person. The statistics cannot support
those claims, which is the first reason the product refuses to make them.

The second reason is a product decision rather than a statistical one, and it's the subject of
the companion essay: [refusing the thing users most want](product-ethics.md).
