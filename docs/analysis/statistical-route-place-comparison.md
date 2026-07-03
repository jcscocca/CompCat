# Statistical Route And Place Comparison

## What The App Can Claim

The app can say that one route or site has a statistically lower reported-incident rate
than another route or site for the selected date range, geography, radius, offense filter,
and method. For routes, the claim is further scoped to the divergent corridors — the
segments where the compared routes actually differ. This claim is scoped to the public SPD
incident records and the exact analysis inputs used for the comparison.

The app cannot say that a route is safe, unsafe, dangerous, risk-free, or that a route prevents crime.

## Why Raw Counts Are Not Enough

Raw incident counts do not account for route length, buffer size, or analysis period. A
longer route corridor or larger place buffer can include more incidents simply because it
covers more area. A longer analysis period can include more incidents simply because it has
more days. The app compares exposure-adjusted rates so that each option is evaluated against
the amount of area and time included in that option's analysis.

## Exposure

Place exposure is the selected place buffer area in square kilometers multiplied by the
number of analysis days.

Route *context* (the per-option rows shown alongside a comparison) uses the whole
corridor's area:

```text
route_corridor_area_square_km = (route_length_km * 2 * radius_km) + pi * radius_km^2
```

The route *statistical test* instead uses each side's divergent-corridor area:

```text
divergent_corridor_area_square_km = divergent_length_km * 2 * radius_km
```

There is no end-cap term because divergent runs border the shared corridor, so the caps
largely fall inside area that is already shared.

The exposure unit for both place and route comparisons is square-kilometer-days.

## Incident Inclusion

An incident is included only when it has coordinates, falls within the selected date range,
matches the selected offense filters, and falls inside the selected place buffer or route
corridor. Incidents outside the selected geography, dates, or offense filters are excluded
from the count and rate calculation.

## Route Comparisons Test Divergent Corridors

![Two routes share most of their corridor; incidents in the shared corridor drop out of
the test and only the divergent corridors are compared](img/route-divergence-corridors.svg)

Route alternatives between the same origin and destination share most of their corridor.
An incident in the shared corridor would land in both routes' counts, which drags the
rate ratio toward 1.0 and lets the shared stretch mask a real difference on the segments
that actually differ. It also violates the rate test's assumption that the two counts are
independent — the same physical incidents would be counted on both sides.

Route comparisons therefore partition incidents per pair of routes:

- within the radius of route A's divergent segments and not within the radius of route B
  → counts for A
- within the radius of route B's divergent segments and not within the radius of route A
  → counts for B
- within the radius of both routes, or near neither route's divergent segments →
  excluded from the test entirely

Each side's exposure is its divergent corridor's area multiplied by the analysis days.
Divergent length is measured by sampling each route's geometry every ~25 meters and
keeping the spans that are farther than the radius from the other route; the counts are
restricted to incidents within the radius of those same spans. The length-based exposure
area approximates the region the counts are drawn from, with two residual imperfections.
The span rule and the omitted end-caps slightly under-measure the divergent area, which
slightly inflates both sides' rates. And where a divergent segment runs within two radii
of the other route, part of its exposure band lies within the radius of both routes —
incidents there are excluded from the count, so the band over-measures the countable
region and deflates that side's rate by a bounded amount. Incidents on a route's outer
flank along a shared stretch — within that route's radius but not the other's — are near
no divergent segment and are not counted at all.

The shared corridor is traversed either way, so it carries no information for the choice
between the routes; the whole-corridor counts remain visible as descriptive context, but
they are not tested. When both routes' divergent share is under 2% the options are
reported as following essentially the same corridor, and no test is run.

A known limitation of the same kind remains on the site path: two *place* buffers that
overlap also double-count the incidents in their intersection. Site comparisons are
usually between well-separated places, so the effect is second-order there; a future
change may apply the same disjoint-region treatment.

## Statistical Test

The default test is an exact conditional Poisson comparison of exposure-adjusted incident
rates. If period counts are overdispersed, the app uses a quasi-Poisson log-rate-ratio
adjustment so the uncertainty estimate reflects extra variation in the observed counts.

## Multiple Comparisons

When more than two options are compared, the app applies a Benjamini-Hochberg adjustment to
control the false discovery rate across pairwise comparisons. An option is recommended only
when it passes the conservative threshold against every relevant alternative.

### Candidate Selection And Selective Inference

The compared option that is tested is chosen from the data: the app selects the option with
the lowest observed exposure-adjusted rate and tests it against each of the others. For
route comparisons the selection rate is the aggregate divergent-corridor rate — the
option's summed disjoint counts over its summed divergent exposure across all of its
pairs — not the whole-corridor context rate shown in the option rows. The
Benjamini-Hochberg step corrects for the multiplicity of those pairwise comparisons, but it
does not add a penalty for the act of selecting the lowest-rate option in the first place.
Considered alone, that selection biases the result toward finding a "lower" option (a
winner's-curse / selective-inference effect), so a reported per-pair adjusted p-value is
slightly optimistic.

The overall procedure is nonetheless conservative, because a recommendation requires the
selected option to clear every guard against every alternative at once:

- it must be statistically lower than every other option, not just one, and
- the adjusted rate ratio against each must be at or below 0.80 — a materially lower rate, not
  a marginal one, and
- the data floors (at least 30 analysis days, positive exposure for every option, a per-option
  minimum count, and a combined count of at least 10) must hold.

Because the selected option must dominate all alternatives by a material margin, selection
alone cannot manufacture a recommendation; the design errs toward `not_statistically_clear`
rather than toward over-claiming a lower-incident option.

### Small Samples And Temporal Dispersion

The overdispersion factor is estimated from per-month incident counts. With fewer than two
months in the analysis window the factor cannot be estimated at all, and the comparison (or the
place-vs-beat neighborhood verdict) is reported as a model warning rather than a clear claim.
With only two or three months the estimate is noisy and can understate the true overdispersion,
which would narrow the confidence interval more than the data warrant.

This residual small-sample risk is bounded by the other guards: a recommendation still requires
a material effect size (a rate ratio at or below 0.80, or at or above 1.25 for the place-vs-beat
verdict) and must clear the minimum-count and minimum-window floors, so a noisy dispersion
estimate alone cannot produce a confident verdict. A longer analysis window — more monthly
periods — is the way to obtain a firmer dispersion estimate.

## Recommendation Threshold

- adjusted p-value below 0.05
- adjusted rate ratio less than or equal to 0.80
- at least 30 analysis days
- positive exposure for every compared option
- combined incident count of at least 10
- no unhandled model warning

For route comparisons, the counts and exposures above are the divergent-corridor values —
the floors apply to the segments being tested, not to the whole corridors.

## Dashboard Modes

Overview is the public summary view. It shows the reader-facing summary text, the decision
class, exposure-adjusted rates, and a short caveat that keeps the claim tied to reported
incidents and the selected inputs.

Analytical is the audit view. It shows the supporting counts, exposure, rate ratio,
confidence interval, p-values, method, overdispersion status, minimum-data status, filters,
and full caveats.

Both modes read the same backend result. They differ only in how much of the result they
show.

## Decision Classes

`statistically_lower` means one compared option has a statistically lower reported-incident
rate under the selected filters and threshold.

`not_statistically_clear` means the comparison does not identify a statistically clear
lower reported-incident rate.

`insufficient_data` means the selected inputs do not meet the minimum data requirements.

`model_warning` means the model produced a warning that should prevent a recommendation
claim.
