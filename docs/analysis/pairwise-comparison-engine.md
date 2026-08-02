# The pairwise / verdict comparison engine

**Status:** methodology reference (updated 2026-07-30). The durable, end-to-end record of the
live user-selected place-to-place comparison engine (`app/analysis/comparison.py` and
`app/analysis/rate_tests.py`) plus the legacy polygon-density neighborhood relations retained
temporarily in `app/services/neighborhood_service.py` for validation. The current single-place
detailed view instead uses
[empirical reference circles](empirical-reference-circles.md). Replaces the removed
`docs/analysis/statistical-route-place-comparison.md` (the routes feature was retired
2026-07; see the superseded design spec
`docs/superpowers/specs/2026-06-23-statistical-route-place-comparison-design.md`). Companion
to [overdispersion-and-rate-intervals.md](overdispersion-and-rate-intervals.md) (the variance
model this doc reuses), [exposure-model.md](exposure-model.md) (the denominator), and the
[statistical-methods audit (2026-07)](statistical-methods-audit-2026-07.md) that commissioned
this writeup.

## TL;DR

The active user-facing engine answers one question — **does one user-selected place have a
statistically lower reported-incident rate than another, for the selected filters?** — and it
answers conservatively. Sections about surrounding-area baselines document the retained legacy
payload, not the current single-place visualization.

- **One variance model everywhere.** Every verdict, every per-address interval, and every
  neighborhood-baseline relation rides a single **quasi-Poisson Wald** standard error on the
  log rate ratio, `se = sqrt(φ·(1/kₐ + 1/k_b))`. The confidence interval and the decision
  p-value are dual by construction, so the number line and the label can never visually
  contradict each other.
- **Significance is never sufficient.** A "lower" verdict requires a BH-adjusted p below
  α = 0.05 **and** an effect-size floor (rate ratio ≤ 0.80) **and** minimum-data floors
  (place count ≥ 3, combined ≥ 10, window ≥ 30 days).
- **Candidate selection is data-dependent and acknowledged.** The lowest observed-rate option
  is picked, then tested against all others; the resulting "winner's curse" is bounded — not
  corrected — by the all-pairs-must-pass rule plus the floors (§1).
- **Multiplicity is FDR-controlled.** Benjamini–Hochberg is applied within each per-request
  family (§4); the nested-baseline family is positively dependent and BH stays valid under
  PRDS.
- **The exact conditional-Poisson p-value is computed but never decides** (§3).
- Two paths that were **considered and rejected** — empirical-Bayes shrinkage and
  session-level multiplicity correction — are recorded in §7 so future audits read them as
  decisions, not omissions.

## 1. Candidate selection and the winner's curse

The Compare engine (`build_statistical_comparison`) selects the candidate as the option with
the **lowest observed incident rate**:

```
candidate = min(options, key=lambda o: o.incident_rate)
```

and then runs one pairwise test of the candidate against every other option (`k − 1` tests for
`k` options). Selecting on the same data that is then tested is **selective inference**: the
minimum of several noisy rates is biased low, so a per-pair adjusted p-value against the
selected candidate is mildly optimistic ("winner's curse"). Benjamini–Hochberg (§4) corrects
the multiplicity of the `k − 1` tests but **not** this selection step.

This is deliberate and safe here because the *decision* is conservative, not the per-pair
p-value:

- `_overall_decision` requires the candidate to be classified `statistically_lower` against
  **every** alternative — a single `not_statistically_clear` pair collapses the verdict to
  `not_statistically_clear`.
- On top of the FDR-adjusted p, the **effect-size floor** (rate ratio ≤ 0.80) and the
  **minimum-data floors** must also hold on every pair.

Selection alone therefore cannot manufacture a winner: it can only nominate a candidate that
still has to clear all three gates against all comparators. The in-code acknowledgment lives at
`app/analysis/comparison.py` (the block above `candidate = min(...)`). Should the product ever
present a *ranked* surface rather than a single conservative verdict, this selection bias would
need explicit correction (e.g. selective-inference-adjusted intervals) — not required by the
current one-winner design.

## 2. The quasi-Poisson Wald log rate-ratio test

For candidate *a* and comparator *b* with counts and exposures `(kₐ, Eₐ)`, `(k_b, E_b)`
(`compare_incident_rates` in `app/analysis/rate_tests.py`):

```
rate_a, rate_b  = kₐ/Eₐ , k_b/E_b
rate_ratio      = (safe_kₐ/Eₐ) / (safe_k_b/E_b)
se(log RR)      = sqrt( φ · (1/safe_kₐ + 1/safe_k_b) )        # Poisson delta method, φ-scaled
z               = |log(rate_ratio)| / se
ν               = n_periods − 1        # bins φ was estimated from; else use the normal
p_value         = two-sided t_{ν} tail of z          # erfc(z/√2) when φ is assumed (see below)
CI (95%)        = exp( log(rate_ratio) ± q · se ),   q = t_{ν,0.975}  (else 1.959963984540054)
```

- **φ-estimation noise ⇒ Student-t.** φ is *estimated* from `n_periods` monthly bins, so both
  the p-value and the CI reference **Student-t on ν = n_periods − 1 df** (quasi-likelihood
  convention; Wedderburn 1974). The engine threads `dispersion_periods` from the same
  `dispersion_status` result that produced φ, so ν matches the exact (post-trim) series φ came
  from. **Fallback to the normal quantile** (`erfc`, `Z_975`) in two cases: (a) φ was *assumed*,
  not estimated (`overdispersion_phi is None` — plain Poisson / too few bins); (b) ν ≥ 200,
  where t and z coincide. The *same* ν and *same* distribution feed the p-value and the CI, so
  duality is exact. Rationale and before/after coverage: [overdispersion-and-rate-intervals.md
  §5.1](overdispersion-and-rate-intervals.md).

- **Continuity correction.** When either count is zero, both counts are bumped by 0.5
  (`safe_k = k + 0.5`) so the log ratio and SE stay finite; `used_continuity_correction` and a
  caveat are set. The displayed `rate_a`/`rate_b` remain the *raw* `k/E` (so with a zero count
  the shown ratio is not exactly the ratio of the shown rates — a known cosmetic display
  inconsistency, flagged in the audit §3.3.7; the analytical payload exposes both).
- **Duality.** The CI and the decision p-value come from the *same* `se`, so `p < α` is
  equivalent to "the 95% CI excludes 1". This is the property that keeps the number line and
  the verdict consistent.
- **Method label.** `quasi_poisson_log_rate_ratio` when φ exceeds the dispersion threshold,
  else `wald_log_rate_ratio` (§3.1 of the overdispersion doc).

Why Wald-with-φ rather than the literature-ideal exact/mid-p test for small counts: to keep
**one** variance model shared by the pairwise verdict and the per-address interval, so the two
can never disagree visually. The trade-off, and the (as-yet unverified) small-count calibration
caveat, are covered in [overdispersion-and-rate-intervals.md §5](overdispersion-and-rate-intervals.md)
and audit §3.2.1 / §3.3.1.

## 3. The supplementary exact conditional-Poisson p-value

When the pair is in the non-overdispersed regime (`method = wald_log_rate_ratio`), the engine
also computes an **exact conditional-Poisson (binomial) p-value**
(`_exact_conditional_poisson_p_value`). Conditioning on the total `n = kₐ + k_b`, the count in
*a* is Binomial(`n`, `Eₐ/(Eₐ + E_b)`) under the equal-rate null; the two-sided p sums the
point-null probabilities no larger than the observed cell's:

```
p_a = Eₐ / (Eₐ + E_b)
exact_p = Σ_{s: P(s) ≤ P(observed)} Binom(n, s, p_a)
```

It is reported as `exact_p_value` **for transparency only** and is **never** the decisional
statistic — the verdict always rides the Wald p so it stays dual with the interval. In the
overdispersed regime the exact Poisson p (which assumes no overdispersion) would be
anticonservative, so it is not even computed there (`exact_p_value = None`).

## 4. Overdispersion φ and Benjamini–Hochberg

### 4.1 φ estimation, threshold, and floor

φ is the **index of dispersion** (sample variance ÷ mean, ddof = 1) of the two options'
**combined monthly count series** (`dispersion_status` over `_combined_dispersion`). The
monthly series is passed through `trim_partial_edge_months` first: a leading or trailing bin
that covers only part of a calendar month has a systematically depressed count that would
inflate the dispersion estimate, so at most one bin per edge is dropped (never below two bins).
**Only the dispersion estimate uses the trimmed series** — the rate, exposure, and displayed
monthly counts are untouched (`app/analysis/exposure.py`).

Two constants govern φ (both in `app/analysis/rate_tests.py`):

- **`DISPERSION_THRESHOLD = 1.2`** — above this the pair is labelled overdispersed and the
  quasi-Poisson method name is used.
- **1.0 floor** — `_effective_phi` floors the multiplier that enters the SE at 1.0 (plain
  Poisson). An estimated φ < 1 (apparent under-dispersion) is almost always noise in these
  small monthly-bin samples; flooring keeps inference conservative and can only ever *widen* an
  interval, never mislabel one.

The empirical justification for quasi-Poisson over negative binomial (the log–log
variance/mean slope diagnostic on the real SPD data) lives in
[overdispersion-and-rate-intervals.md](overdispersion-and-rate-intervals.md) and is not
restated here.

### 4.2 Where BH is applied, and the FDR level

Benjamini–Hochberg (`benjamini_hochberg`, returning adjusted p-values) runs the step-up
procedure. The comparison is against **α = 0.05**, so the effective FDR level is **q = 0.05**.
BH is applied **per request, one family at a time**:

| Family | Where | Members |
|---|---|---|
| **Across the `k − 1` pairwise tests** (multi-place result) | `app/analysis/comparison.py` | the candidate vs. each of the other `k − 1` options |
| **Within-place across the four nested baselines** | `app/services/neighborhood_service.py` (`_baselines_for_place`) | the place vs. its MCPP, beat, sector, and citywide baselines |
| **Across places** | `app/services/neighborhood_service.py` | each place's primary place-vs-(rest-of-beat) test, one p per place |

(The neighborhood surface's place-vs-place matrix is BH-adjusted within itself as well, exactly
like the multi-place result's pairwise family.)

**PRDS validity of the nested-baseline family.** The within-place family (MCPP ⊂ beat ⊂ sector
⊂ city) is *not* independent: the four baselines are strongly positively dependent (each larger
geography contains the smaller, and all share the same place numerator). BH controls the FDR
under **positive regression dependence (PRDS)**, not just independence (Benjamini & Yekutieli
2001), and a nested containment family of one-sided rate comparisons with a shared numerator is
a canonical PRDS case. So BH remains valid on this family without the more conservative
BH–Yekutieli `Σ1/i` penalty. No cross-family correction is attempted — BH families are
per-request and per-surface by design (§7.2).

## 5. Decision constants and classes

### 5.1 All decision constants (with values)

From `app/analysis/rate_tests.py` (and `HIGH_RATE_RATIO` derived in
`app/analysis/beat_baselines.py`):

| Constant | Value | Role |
|---|---|---|
| `ALPHA` | **0.05** | Significance threshold applied to the BH-adjusted p (also the FDR level q). |
| `DISPERSION_THRESHOLD` | **1.2** | φ above this ⇒ overdispersed / quasi-Poisson label. |
| `MAX_RATE_RATIO_FOR_RECOMMENDATION` | **0.80** | Effect-size floor for a "lower" verdict: the rate ratio must be ≤ 0.80. |
| `HIGH_RATE_RATIO` | **1.25** (`= 1 / 0.80`) | Symmetric floor for an "above" relation on the neighborhood surface. |
| `MIN_COMBINED_COUNT` | **10** | Candidate + comparator counts must sum to ≥ 10. |
| `MIN_PLACE_COUNT` | **3** | The candidate/place (the only option that can win) must have ≥ 3 incidents on its own. |
| `MIN_ANALYSIS_DAYS` | **30** | Analysis window must span ≥ 30 days. |
| `Z_975` | 1.959963984540054 | 97.5th normal quantile; the 95% CI multiplier when φ is *assumed* (φ=None) or ν ≥ 200. When φ is estimated the multiplier is `t_{ν,0.975}` (§2). |
| `MAX_T_DF` | **200** | At ν ≥ this the t and normal 0.975 quantiles coincide numerically, so the z path is used. |

**Why an effect-size floor at all.** With enough exposure a statistically significant but
trivially small rate difference (say a 3% lower rate) would clear a bare p < α test. The floor
requires the ratio to reach 0.80 (a 20% lower rate) before the engine will call a place
"statistically lower", directly implementing the literature's warning against
practically-meaningless significance (audit §3.1.2). `MIN_PLACE_COUNT` exists for a related
reason: the candidate is the lowest-rate option and the only one that can win, so a near-empty
candidate must not be crowned on a combined count the busy comparator satisfies on its own —
that would be a ranking on no signal from the place itself.

### 5.2 Decision-class vocabularies

**Compare** — `DecisionClass` (`app/analysis/schemas.py`), per pairwise result and for the
overall verdict:

| Value | Meaning |
|---|---|
| `statistically_lower` | BH-adjusted p < 0.05 **and** rate ratio ≤ 0.80. The candidate wins this pair. |
| `not_statistically_clear` | Tested, but p ≥ 0.05 or the effect is above the floor. |
| `insufficient_data` | `minimum_data_status` ≠ `met`; no test decided. |
| `model_warning` | Overdispersion could not be estimated (too few period bins); needs analytical review, no directional claim. |

**Neighborhood** — the per-baseline `relation` (from `neighborhood_decision`'s outputs
`above_clear | below_clear | not_clear | insufficient_data | model_warning`, mapped to plot
words in `app/services/neighborhood_service.py`):

| `decision` (internal) | `relation` (payload) | Meaning |
|---|---|---|
| `below_clear` | `below` | Place rate statistically below the baseline (p < 0.05, ratio ≤ 0.80). |
| `above_clear` | `above` | Place rate statistically above the baseline (p < 0.05, ratio ≥ 1.25). |
| `not_clear` | `similar` | Tested, neither direction is clear. |
| `insufficient_data` | `insufficient` | Minimum-data floor unmet. |
| `model_warning` | `insufficient` | Dispersion inestimable; the UI must not claim a direction the model can't support, so it reads as `insufficient`. |

### 5.3 Minimum-data status values

Gates whether a comparison is `met` before any directional class is assigned. Compare
(`comparison.py::_minimum_data_status`) and neighborhood
(`beat_baselines.py::_minimum_data_status`) share the set, differing only in the per-unit label:

| Value | Meaning |
|---|---|
| `met` | All floors satisfied; the test is decisional. |
| `date_range_too_short` | Window < `MIN_ANALYSIS_DAYS` (30 days). |
| `non_positive_exposure` | An option/place has zero or negative exposure; not tested. |
| `option_count_too_low` (Compare) / `place_count_too_low` (neighborhood) | Candidate/place count < `MIN_PLACE_COUNT` (3). |
| `combined_count_too_low` | Candidate + comparator count < `MIN_COMBINED_COUNT` (10). |

The neighborhood surface additionally emits two place-level `decision` sentinels *outside* this
set, both surfaced as `baseline_available: false`: `baseline_unavailable` (no beat/area could
be resolved for the place) and `baseline_too_small` (the rest-of-area baseline is empty or has
non-positive area).

## 6. End-to-end flow (Compare)

1. Require ≥ 2 options; pick the lowest-rate `candidate` (§1).
2. For each other option: compute `minimum_data_status`, estimate combined φ (trimmed monthly
   bins), run `compare_incident_rates` unless exposure is non-positive.
3. BH-adjust the `k − 1` raw p-values (§4.2).
4. Classify each pair via `classify_pairwise_result` (floors + adjusted p, §5).
5. `_overall_decision`: `model_warning` if any pair warns, else `insufficient_data` if any
   pair is under-data, else `statistically_lower` only if **all** pairs are lower, else
   `not_statistically_clear`.
6. Attach each option's own quasi-Poisson rate interval (`rate_confidence_interval`, its own
   monthly dispersion) so every rate ships with a margin of error.

The neighborhood surface follows the same statistical core against fixed geographies (rest-of-
beat, rest-of-MCPP, sector, citywide) instead of user-chosen options; geometry is in
[exposure-model.md](exposure-model.md).

## 7. Considered and rejected

### 7.1 Empirical-Bayes shrinkage of small-area rates

The disease-mapping tradition shrinks small-area rates toward a global (or local) mean because
unshrunk maps and league tables spotlight the noisiest small units as apparent extremes
(Marshall 1991; Gelman & Price 1999). **Rejected here**, on three grounds:

1. **There is no ranking surface to distort.** CompCat presents a single conservative verdict
   and per-place relations, never a map-of-rates or a league table. The failure mode shrinkage
   fixes does not exist in this product.
2. **Every rate already ships with an interval and is floored.** Uncertainty is shown directly
   (the per-address quasi-Poisson interval) and decisions are gated by effect-size and
   minimum-data floors, which already suppress the noisy-small-unit verdicts shrinkage targets.
3. **It would break the one-variance-model invariant.** A shrunk point estimate no longer
   matches the Wald interval and the pairwise SE, reintroducing exactly the interval-vs-label
   disagreement the engine is designed to preclude.

Revisit only if the product ever ranks or scores places.

### 7.2 Session-level multiplicity across a user's many scans

A user may run dozens of category/filter/radius scans in one session; across all of them the
family-wise error rate is uncontrolled. **Rejected as unsolvable for an exploratory tool**: BH
families are defined **per request** (the tests presented together on one screen), and there is
no principled, non-arbitrary boundary for a "session" family — correcting across every scan a
curious user ever runs would either require server-side tracking of an ill-defined family or
inflate every p-value by an unknowable factor. The honest response is **disclosure, not
correction**: the product's copy frames results as reported context under the selected filters,
not as a screened discovery, and never presents a "significant!" flag that a scanning user
could cherry-pick. (Audit §3.3.6.)

## 8. Product invariant

The engine reports **reported-incident context**. It computes whether one place's reported
rate is statistically lower than another's for the chosen filters — it does **not** score
safety, rank places as safe/unsafe/dangerous, claim a user was present at an incident, or
attribute cause. A `statistically_lower` verdict is a statement about counts and exposure with
an honest margin of error and conservative floors, nothing more.

## References

- Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate. *JRSS-B* 57(1).
- Benjamini, Y. & Yekutieli, D. (2001). The control of the false discovery rate in multiple
  testing under dependency. *Annals of Statistics* 29(4). (PRDS validity of BH.)
- Gelman, A. & Price, P.N. (1999). All maps of parameter estimates are misleading. *Stat. in
  Medicine* 18.
- Gu, K., Ng, H.K.T., Tang, M.L. & Schucany, W.R. (2008). Testing the ratio of two Poisson
  rates. *Biometrical J.* 50(2). (Conditional/exact two-rate test.)
- Marshall, R.J. (1991). Mapping disease and mortality rates using empirical Bayes estimators.
  *Applied Statistics* 40(2).
- Osgood, D.W. (2000). Poisson-based regression analysis of aggregate crime rates. *J. Quant.
  Criminology* 16(1).
- Schenker, N. & Gentleman, J.F. (2001). On judging the significance of differences by
  examining the overlap between confidence intervals. *American Statistician* 55(3).
- Ver Hoef, J.M. & Boveng, P.L. (2007). Quasi-Poisson vs. negative binomial regression.
  *Ecology* 88(11).
