# Statistical Route And Place Comparison Design

## Status

Approved design direction from product discussion. This document is the design handoff for
an implementation plan.

## Goal

Integrate criminological count-data methods from the extracted SPD Crime Analysis Suite
references into this repository so the app can compare two or more sites or route
alternatives and make a conservative, auditable statement when one option has a
statistically lower reported-incident rate than another.

The intended public claim is:

> Route A has a statistically lower reported-incident rate than Route B for this corridor,
> date range, offense filter, and analysis method.

The app must not claim that a route, site, neighborhood, or person is safe or unsafe.

## Decisions Already Made

- Compare both places/sites and route alternatives.
- Allow route recommendation language only when statistical evidence clears a conservative
  threshold.
- Use a frequentist method first, designed so Bayesian probabilities can be added later.
- Use exposure-adjusted rates rather than raw incident counts.
- Use conservative v1 recommendation rules:
  - adjusted p-value below 0.05,
  - adjusted rate ratio less than or equal to 0.80,
  - minimum data and exposure thresholds met,
  - overdispersion handled explicitly.
- Document the data-analysis method thoroughly in a dedicated analysis document.

## Source References

The design draws from the extracted SPD Crime Analysis Suite reference docs:

- `docs/reference/spd-crime-analysis-suite/source-docs/Methods_and_References.md`
- `docs/reference/spd-crime-analysis-suite/source-docs/Crime_Stats_Suite_Plan.md`
- `docs/reference/spd-crime-analysis-suite/source-docs/Seattle_SPD_Socrata_Filtering_Guide.md`
- `docs/reference/spd-crime-analysis-suite/README.md`

Important principles from those references:

- Crime and call counts are count data. Avoid raw percent-change claims.
- Exact Poisson and E-test style comparisons are appropriate for low-to-moderate count
  comparisons.
- Pure Poisson tests can overstate significance when counts are overdispersed.
- Negative-Binomial or quasi-Poisson adjustments should be used when variance is much
  larger than the mean.
- Results should be shown with caveats about reported incidents, data completeness, and
  model assumptions.

## Non-Goals

- Do not integrate TabPy as a runtime dependency for the public app.
- Do not import the Tableau extension into the React app.
- Do not forecast crime or render formal anomaly time-series charts in this first
  statistical-comparison slice.
- Do not implement Bayesian recommendations in v1.
- Do not claim personal safety, dangerousness, or causality.

## Analysis Objects

### Place Option

A place option is a generalized Seattle location with:

- label,
- latitude and longitude,
- display coordinates,
- selected radius in meters,
- offense/date filters,
- workspace or user scope.

The analysis geometry is a circular buffer around the generalized coordinate. The exposure
measure is:

```text
place_exposure = buffer_area_square_km * analysis_days
```

When comparing two places with the same radius and date range, exposure is equal, but it is
still stored and reported so the method remains auditable.

### Route Option

A route option is a route alternative with:

- route label,
- mode mix,
- duration, walking distance, and transfers,
- segment geometry or summary geometry,
- selected corridor radius in meters,
- offense/date filters,
- workspace or user scope.

The analysis geometry is a route corridor, not only route points. The route corridor is the
set of points within the selected radius of the route polyline.

The first implementation can compute corridor exposure without a heavyweight GIS database:

- parse route segment geometry into ordered latitude/longitude vertices,
- compute route length from geodesic segment distances,
- count incidents whose projected point-to-segment distance is less than or equal to the
  corridor radius,
- approximate corridor area as a dissolved-corridor estimate when possible, or as:

```text
route_corridor_area_square_km = (route_length_km * 2 * radius_km) + pi * radius_km^2
route_exposure = route_corridor_area_square_km * analysis_days
```

If overlapping route segments make the approximation suspect, the result should include a
`model_warning` and the later implementation can swap in Shapely/GEOS or PostGIS without
changing the result schema.

## Count Inputs

Each option produces a counted incident set:

- source dataset, initially Seattle SPD crime incidents,
- analysis date range,
- offense category/subcategory/NIBRS filters,
- spatial inclusion rule,
- count of unique incidents,
- count period bins for overdispersion checks.

Counting rules must preserve SPD dataset cautions from the extracted Socrata guide:

- exclude placeholder dates such as `1900-01-01`,
- avoid counting denormalized rows incorrectly when future datasets are added,
- keep source dataset and counting key explicit,
- store the snapshot or query time when live SPD ingestion is added.

## Statistical Method

### Core Rate Comparison

For each pair of options:

```text
rate_a = incident_count_a / exposure_a
rate_b = incident_count_b / exposure_b
rate_ratio = rate_a / rate_b
```

The option with the lower observed exposure-adjusted rate becomes the candidate lower-rate
option. The pairwise test evaluates whether that difference is statistically clear.

The preferred v1 test is a two-rate count comparison:

- Use Poisson means E-test when available.
- Fall back to exact conditional binomial Poisson test when E-test support is unavailable.
- Report p-value, rate ratio, confidence interval, method name, and caveat text.

Use a two-sided p-value for the formal difference test. Direction comes from the adjusted
rate ratio and confidence interval, not from changing the hypothesis after seeing the data.

### Overdispersion Handling

For each comparison, periodize incidents inside each option by the selected aggregation
grain, initially month. For each option and for the combined comparison context:

```text
phi = observed_variance / observed_mean
```

If there are too few period bins to estimate dispersion, mark the dispersion check as
`insufficient_periods` and use the exact Poisson result with a visible caveat.

If `phi <= 1.2`, the Poisson/E-test result can be treated as the primary method.

If `phi > 1.2`, the app must not rely on an unadjusted Poisson p-value. In v1, use a
quasi-Poisson log-rate-ratio adjustment:

```text
se_log_rr = sqrt(phi * (1 / count_a + 1 / count_b))
z = abs(log(rate_ratio)) / se_log_rr
```

Then compute an adjusted confidence interval and p-value from that statistic. If either
count is zero, use a documented continuity correction and include a caveat, or classify the
result as `insufficient_data` when the correction would drive the conclusion.

Future versions can replace this with a full Negative-Binomial comparison while preserving
the same result schema.

### Multiple Comparisons

When more than two options are compared, the app should control false discoveries.

For route recommendations:

- Identify the candidate option with the lowest exposure-adjusted rate.
- Compare it pairwise against every other route alternative.
- Apply Benjamini-Hochberg adjustment to the pairwise p-values.
- Recommend the candidate only if it passes the conservative threshold against every
  relevant alternative.

For place/site comparisons:

- Return pairwise results.
- Highlight statistically lower sites only after p-value adjustment.
- Avoid ranking many places as if every small difference is meaningful.

### Minimum Data Rules

The app should classify the result as `insufficient_data` unless all are true:

- analysis date range is at least 30 days,
- each option has positive exposure,
- combined incident count across the compared options is at least 10,
- comparison geometries are valid,
- date and offense filters are explicit.

These defaults should be configurable constants and documented in the analysis methods
guide. They are deliberately conservative; exact count tests can handle small counts, but
public recommendations should avoid fragile low-volume claims.

## Decision Classes

Each pairwise result returns one of:

- `statistically_lower`: the candidate option has lower adjusted rate, adjusted p-value
  below 0.05, adjusted rate ratio <= 0.80, valid exposure, and no unhandled model warning.
- `not_statistically_clear`: one option may have fewer incidents, but the evidence does not
  clear the conservative threshold.
- `insufficient_data`: counts, date range, or exposure are too sparse for a claim.
- `model_warning`: the model detected overdispersion, geometry approximation risk, or data
  quality limitations that require caveated interpretation.

For route recommendation, only `statistically_lower` can produce recommendation wording.

## Product Language

Allowed language:

- "lower reported-incident rate"
- "statistically clear lower-incident alternative"
- "no statistically clear lower-incident alternative"
- "insufficient data for a statistical comparison"
- "reported incidents within the selected route corridor"
- "reported incidents within the selected place buffer"

Disallowed language:

- "safe"
- "unsafe"
- "dangerous"
- "risk-free"
- "you should take this route"
- "this route prevents crime"

Preferred route wording when the threshold passes:

> In this analysis, Route A has a statistically lower reported-incident rate than Route B
> for the selected corridor radius, date range, and offense filter. It is the
> lower-incident alternative in this comparison.

Preferred wording when the threshold does not pass:

> The routes differ in reported incident counts, but this analysis does not find a
> statistically clear lower-incident alternative under the selected filters.

## UI Integration And Audience Modes

The statistical comparison should be computed entirely by the backend analysis service.
The frontend should not recompute rates, p-values, exposure, confidence intervals, or
decision classes. Its job is to render the backend result clearly, preserve caveats, and
let different audiences choose the level of detail they need.

Use two user-facing modes:

- `Overview`: public-facing comparison summary.
- `Analytical`: detailed method and audit view.

Do not use "research review" or "research view" as product labels.

### Overview Mode

Overview is the default public experience. It should answer:

- Which options were compared?
- Is there a statistically clear lower-incident alternative?
- What is the plain-language reason?
- What filters and date range does the statement depend on?

Overview should show:

- map overlays for compared place buffers or route corridors,
- compact cards for each option,
- incident count and adjusted rate for each option,
- decision class,
- plain-language result text,
- one short caveat sentence,
- route alternatives even when no statistical recommendation is available.

Overview must avoid method-heavy language unless the user opens details. For example, it
can say "no statistically clear lower-incident alternative" without showing the full
p-value calculation inline.

### Analytical Mode

Analytical is for researchers, agencies, and users who want to inspect the basis for the
claim. It should expose the same backend result without changing it.

Analytical should show:

- source dataset and snapshot/query timestamp,
- date range and offense filters,
- geometry type and corridor or buffer radius,
- incident counts,
- exposure values and exposure unit,
- adjusted rates,
- rate ratio,
- confidence interval,
- raw p-value and adjusted p-value,
- test method name,
- overdispersion statistic and status,
- minimum-data status,
- multiple-comparison adjustment status,
- all caveat text,
- export/share metadata.

Analytical can include expanded method notes pulled from the dedicated analysis
documentation, but the numbers themselves should come from the persisted comparison
result. This keeps the public dashboard, Analytical panel, share link, and Tableau export
aligned.

## API And Data Model Design

### New Service Boundary

Add a statistical comparison package, likely:

- `app/analysis/schemas.py`
- `app/analysis/exposure.py`
- `app/analysis/rate_tests.py`
- `app/analysis/comparison.py`

Responsibilities:

- Build analysis geometries and exposures.
- Count incidents inside site buffers and route corridors.
- Run pairwise rate tests.
- Apply multiple-comparison adjustment.
- Classify the result and generate caveat text.

### Suggested API Surface

Add endpoints after the service is implemented:

```text
POST /analysis/sites/compare
POST /analysis/routes/compare
GET /analysis/comparisons/{comparison_id}
GET /exports/tableau/statistical-comparisons.csv
```

Route comparison can also be embedded in:

```text
GET /routes/requests/{request_id}/comparison
```

so the route dashboard can show statistical decision cards without making a separate
frontend request.

### Result Schema

Every result should include:

- comparison ID,
- option IDs and labels,
- geometry type (`place_buffer` or `route_corridor`),
- radius in meters,
- analysis date range,
- offense filters,
- incident counts,
- exposure values and exposure unit,
- incident rates,
- rate ratio,
- confidence interval,
- raw p-value,
- adjusted p-value,
- method name,
- overdispersion statistic and status,
- minimum-data status,
- decision class,
- recommendation target, if any,
- overview summary text,
- overview caveat text,
- full caveat text,
- created timestamp.

### Persistence

Persist comparison metadata so a public dashboard, share link, or Tableau export can be
audited later. Proposed tables:

- `statistical_comparisons`
- `statistical_comparison_options`
- `statistical_pairwise_results`

These tables should be scoped by the same user/workspace identifier used for the rest of
the app. When anonymous public workspaces are added, use workspace scope rather than
`X-Demo-User-Id`.

## Map And Dashboard Behavior

The dashboard should default to `Overview` and provide an `Analytical` tab or panel for
users who want the full method details. Both modes should read from the same persisted
comparison result.

The Overview map should show:

- place buffers,
- route corridors,
- incident points or aggregated markers depending on privacy/performance setting,
- comparison badges,
- model-warning badges.

The Overview dashboard should show:

- incidents and adjusted rates for each option,
- practical difference in rate ratio,
- statistical decision class,
- short caveat text,
- "lower-incident alternative" only when the result passes.

The Analytical panel should show:

- confidence interval,
- raw and adjusted p-values,
- method details,
- exposure calculation fields,
- overdispersion status,
- minimum-data checks,
- source data and filter details,
- full caveat text.

Route recommendation cards should sort by:

1. statistically lower decision,
2. adjusted incident rate,
3. route duration,
4. transfers/walking burden.

If no route passes the statistical threshold, the app should still show route alternatives
and comparison context, but with "no statistically clear lower-incident alternative."

## Tableau Export Design

Add a Tableau-ready export for statistical comparisons. Suggested columns:

```text
comparison_id
comparison_type
option_a_id
option_a_label
option_b_id
option_b_label
winner_option_id
winner_label
decision_class
method
radius_m
analysis_start_date
analysis_end_date
offense_category
offense_subcategory
incident_count_a
incident_count_b
exposure_a
exposure_b
exposure_unit
rate_a
rate_b
rate_ratio
ci_lower
ci_upper
p_value
adjusted_p_value
overdispersion_phi
overdispersion_status
caveat_text
created_at
```

This lets Tableau reproduce the same claim shown in the app without recomputing the
statistics.

## Required Analysis Documentation

Add a dedicated public-facing technical document:

`docs/analysis/statistical-route-place-comparison.md`

It must explain:

- what the app can and cannot claim,
- why raw counts and percent change are not enough,
- why exposure-adjusted rates are used,
- how place buffers are built,
- how route corridors are built,
- which incidents are counted and filtered,
- how Poisson/E-test comparisons work,
- how overdispersion is detected,
- how quasi-Poisson or Negative-Binomial adjustment changes the conclusion,
- what p-values, rate ratios, confidence intervals, and adjusted p-values mean,
- why the recommendation threshold is conservative,
- minimum data requirements,
- exact dashboard wording rules,
- example interpretations for each decision class.

No implementation plan should proceed without this documentation task.

## Testing Strategy

Unit tests:

- exact Poisson/E-test wrapper returns expected direction and p-value shape,
- low-count comparisons do not produce inverted intervals,
- overdispersion detection switches method status,
- quasi-Poisson adjustment weakens significance when phi is high,
- Benjamini-Hochberg adjustment is correct,
- minimum-data rules classify sparse cases as `insufficient_data`,
- disallowed recommendation language is not emitted.

Integration tests:

- two place buffers produce a persisted comparison result,
- two route corridors produce a persisted comparison result,
- route comparison response includes statistical decision metadata,
- statistically clear route gets "lower-incident alternative" wording,
- non-significant route comparison does not recommend a route,
- Tableau export includes all audit fields.

Geometry tests:

- incidents near a route segment are counted,
- incidents outside the corridor are excluded,
- route length/exposure is stable for deterministic fixtures,
- zero-length or malformed geometry returns `insufficient_data`.

## Risks And Mitigations

Risk: Users interpret "lower reported-incident rate" as "safe."

Mitigation: Enforce product language rules in API caveats, UI copy, docs, and tests.

Risk: Pure Poisson tests overstate significance with overdispersed data.

Mitigation: Estimate dispersion, switch method status, adjust p-values/intervals, and
surface model warnings.

Risk: Route corridor geometry is approximate in v1.

Mitigation: Store exposure method, caveat the approximation, test point-to-segment
distance logic, and keep schema compatible with a later GIS-backed corridor implementation.

Risk: Multiple route/site comparisons create false positives.

Mitigation: Apply Benjamini-Hochberg adjustment and require the conservative practical
threshold.

Risk: Small counts create fragile recommendations.

Mitigation: Minimum data rules plus exact count tests; default to `insufficient_data` or
`not_statistically_clear` when evidence is weak.

## Implementation Phases

1. Documentation and statistical core:
   - write `docs/analysis/statistical-route-place-comparison.md`,
   - port pure count-data test functions into backend-owned modules,
   - add unit tests for statistical behavior.

2. Geometry and exposure:
   - implement place buffer exposure,
   - implement route corridor exposure and point-to-segment incident inclusion,
   - add geometry tests.

3. Comparison service and persistence:
   - add schemas, service functions, and database models,
   - persist comparison options and pairwise results,
   - add site and route comparison APIs.

4. Route/dashboard integration:
   - include statistical decisions in route comparison responses,
   - add Tableau export rows,
   - update public dashboard copy once the frontend exists.

5. Review and calibration:
   - compare output against known synthetic fixtures,
   - review wording against the documentation,
   - decide whether thresholds need configuration before public launch.
