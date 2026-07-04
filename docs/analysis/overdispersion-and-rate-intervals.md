# Overdispersion, Poisson vs. Negative Binomial, and the per-address rate interval

**Status:** methodology reference (2026-07-04). Backs the per-address rate confidence
interval added to the site-comparison payload (`rate_confidence_interval` in
`app/analysis/rate_tests.py`).

## TL;DR

Waypoint's comparison engine already models reported-incident counts as **quasi-Poisson**
(a Poisson log-rate-ratio whose standard error is inflated by an empirically estimated
overdispersion factor φ). A recurring question is whether a **negative binomial (NB2)** model
would be more appropriate. We tested this against the real SPD source data.

- Incident counts are **strongly overdispersed** relative to Poisson (Pearson φ ≈ 7 at the
  beat scale), so naïve Poisson is wrong — but the engine is *not* naïve Poisson.
- The overdispersion is **linear in the mean** (Var ≈ φ·μ), not quadratic (Var ≈ μ + α·μ²).
  The log–log variance/mean slope is **≈ 1.1–1.3** at every spatial scale we measured;
  NB2 implies a slope approaching **2**. NB2 actively misfits the data.
- At the **per-address (small buffer) scale** counts are small (monthly mean ≈ 0.1–3), where
  Poisson, quasi-Poisson and NB2 are numerically indistinguishable anyway.

**Decision:** the per-address rate interval uses a **quasi-Poisson Wald interval on the log
rate**, reusing the exact overdispersion factor φ and continuity convention the pairwise test
already uses. Negative binomial is **not** adopted. See
[Decision and alternatives](#decision-and-alternatives-considered).

## 1. What the engine does today

The comparison core (`app/analysis/rate_tests.py::compare_incident_rates`) is a two-sample
**log rate-ratio** test, not a per-address interval. For a candidate option *a* and another *b*
with counts and exposures (kₐ, Eₐ), (k_b, E_b):

```
rate_ratio      = (kₐ/Eₐ) / (k_b/E_b)
se(log RR)      = sqrt( φ · (1/kₐ + 1/k_b) )          # Poisson delta method, φ-scaled
CI, p-value     derived from that one SE (so they are dual)
```

φ (`overdispersion_phi`) is an overdispersion multiplier estimated as the **index of
dispersion** (sample variance ÷ mean) over the options' monthly period counts
(`dispersion_status`). When φ > 1.2 the method is labelled `quasi_poisson_log_rate_ratio` and
the inflated SE widens the interval; otherwise it is a plain Wald log rate-ratio with an exact
conditional-Poisson p-value reported alongside for transparency.

So the engine is **Poisson baseline + quasi-Poisson overdispersion correction**. The real
question is therefore *quasi-Poisson vs. negative binomial*, not *Poisson vs. NB*.

## 2. Quasi-Poisson vs. negative binomial

Both handle overdispersion; they differ in the assumed **mean–variance relationship**:

| Model | Variance | log–log Var-vs-mean slope | Nature |
|-------|----------|---------------------------|--------|
| Poisson | Var = μ | 1 | one parameter |
| **Quasi-Poisson** | Var = **φ·μ** (linear) | **1** | moment/quasi-likelihood, one φ |
| **NB2** | Var = **μ + α·μ²** (quadratic) | **→ 2** (large μ) | full Poisson–Gamma mixture |

The discriminating diagnostic (Ver Hoef & Boveng 2007) is the **slope of log(variance) on
log(mean)** across units: ≈ 1 ⇒ the quasi-Poisson (constant variance/mean ratio) family;
≈ 2 ⇒ the NB2 (variance/mean ratio rising with the mean) family. This is a data question, not
a prior — crime-count literature often defaults to NB, but that default is for **regression
across many areas**, which is not the shape of Waypoint's pairwise two-count comparison.

## 3. Empirical method

**Source:** the same dataset the app ingests — SPD Crime Data (Socrata `tazs-3rd5` on
`data.seattle.gov`), 712,999 reported incidents since the app's 2018 data floor, current
through 2026-06. The local dev seed (`app/data/seed_crime.csv`) is **not** usable for this
question: it is generated as `randint(1,3)` incidents per beat per quarter, i.e. an *under*-
dispersed uniform process (Var/mean ≈ 0.33) that would fabricate a misleading answer. We query
the real source directly (`scripts/analyze_overdispersion.py`).

**Units & scales.** The choice matters most where counts are large, so we measured two scales:
- **Beat** (n = 52 of Seattle's real police beats): large areas, high monthly counts — the
  regime where quasi-Poisson and NB2 diverge.
- **Reporting area** (n = 7,390 with ≥ 6 incidents over the window): small, place-like units —
  the regime the per-address buffer actually lives in.

**Procedure.** Server-side aggregate incidents to unit × calendar-month counts (SoQL
`date_trunc_ym`); build each unit's full monthly vector over the window, **zero-filling** empty
months; compute per-unit mean and sample variance; then:
- **Global Pearson dispersion** φ̂ = Σ (y − μ_unit)² / μ_unit ÷ (cells − units).
- **Per-unit index of dispersion** distribution (Var/mean).
- **Method-of-moments NB α** (pooled regression of (Var − μ) on μ² through the origin).
- **log–log OLS** of Var on mean across units — the QP-vs-NB slope test.

Example query (beat scale):

```sql
SELECT beat AS u, date_trunc_ym(offense_date) AS ym, count(1) AS n
WHERE offense_date >= '2018-01-01T00:00:00' AND offense_date < '2026-01-01T00:00:00'
  AND beat IS NOT NULL
GROUP BY u, ym
```

## 4. Results

| Scale (window) | units | monthly mean (range) | Pearson φ̂ | per-unit φ median | % over-disp. (φ>1.2) | NB α (pooled) | **log–log slope** | R² |
|---|---|---|---|---|---|---|---|---|
| Beat, 2018–2025 | 52 | 36 – 241 | **6.94** | 5.68 | 100% | 0.037 | **1.20** | 0.44 |
| Beat, 2022–2025 | 52 | 45 – 230 | **4.27** | 4.11 | 100% | 0.021 | **1.27** | 0.59 |
| Reporting area, 2022–2025 | 7,390 | 0.1 – 3 (med 0.3) | **1.47** | 1.34 | 65% | 0.005 | **1.13** | 0.93 |

Observed vs. model-predicted variance by mean bin (beat, 2018–2025) — QP tracks the data;
NB2 under-predicts at low means and over-predicts at high means:

| bin mean μ | observed Var | quasi-Poisson φ̂·μ | NB2 μ + α·μ² |
|---|---|---|---|
| 82.9 | 504 | 575 | 339 |
| 116.2 | 887 | 806 | 619 |
| 157.4 | 989 | 1092 | 1081 |
| 209.8 | 1865 | 1456 | 1851 |

### Interpretation

1. **Overdispersion is real and large at the beat scale** (φ̂ ≈ 7). Naïve Poisson would badly
   understate uncertainty. The engine's quasi-Poisson correction is warranted.
2. **The mean–variance relationship is linear, not quadratic.** The log–log slope is ~1.1–1.3
   at every scale — close to the quasi-Poisson value of 1, far from the NB2 value of 2. NB2's
   quadratic term forces variance to accelerate with the mean in a way the data do not.
3. **φ is scale-dependent** (≈ 7 at beat, ≈ 1.5 at reporting-area) because aggregating larger
   areas folds in more between-place and temporal heterogeneity. The per-address buffer sits at
   the small-count end, where dispersion is mild and **Poisson ≈ quasi-Poisson ≈ NB2**.

### Caveats

- The per-unit variance mixes intrinsic Poisson–Gamma dispersion with **temporal structure**
  (trend, seasonality, the 2020–21 shift). That inflates φ but does not change the *slope*
  conclusion — the recent-window result (less drift) shows the same ~1.27 slope.
- `reporting_area` has data-quality noise (a few giant catch-all codes); the mass of real units
  is at low means where all three models agree, so this does not affect the decision.
- Method-of-moments α is unstable for tiny-mean units (μ² in the denominator); we rely on the
  pooled estimate and the slope, not per-unit α.

## 5. Decision and alternatives considered

**Chosen: quasi-Poisson Wald interval on the log rate**, for a single option's count *k* over
exposure *E*, reusing the engine's φ and continuity convention:

```
safe_k   = k if k > 0 else k + 0.5           # continuity correction, as in compare_incident_rates
se(log)  = sqrt( φ / safe_k )                 # single-rate analogue of the pairwise SE
rate     = k / E
CI       = exp( log(safe_k / E) ± z · se(log) )
```

φ is the option's own index of dispersion from its monthly counts (`dispersion_status`);
φ falls back to 1 (plain Poisson) when there are too few period bins. This is the **single-rate
analogue of the pairwise SE** `sqrt(φ·(1/kₐ+1/k_b))`, so the per-address interval and the
ranked verdict share **one identical variance model** — the number-line can never visually
contradict the authoritative comparison verdict.

**Rejected — negative binomial (NB2):** empirically misfits (§4); and in a two-count
comparison α is not identifiable from the pair, so it would have to be estimated from the same
handful of monthly bins, where the NB α MLE is noisy and boundary-prone. Fragility for no fit
gain.

**Rejected for now — exact Poisson (Garwood χ²) interval:** better small-count coverage, but
(a) there is no clean way to fold the empirical φ into an exact interval, and (b) it would use a
*different* method from the pairwise verdict, reintroducing the raw-interval-vs-label
disagreement that the comparison UI was deliberately designed to avoid. Worth revisiting only if
low-count calibration becomes a priority; the existing minimum-data floors already gate the
lowest-count decisions.

**Related, out of scope:** the engine currently propagates an *apparent under*-dispersion
(φ < 1 shrinks the SE below Poisson; `rate_tests.py` `phi = overdispersion_phi or 1.0`). In
sparse counts that is usually noise, and flooring φ at 1.0 would be more conservative. Left as a
separate change so the per-address interval stays byte-for-byte consistent with the pairwise
test.

## 6. Product invariant

The interval describes the **reported-incident rate** and its statistical uncertainty. It does
not score safety, rank places as safe/unsafe, or predict personal risk — it is the same
reported-context framing as the rest of the comparison surface, now with an honest margin of
error attached to each address's rate.

## References

- Ver Hoef, J. M., & Boveng, P. L. (2007). *Quasi-Poisson vs. negative binomial regression: how
  should we model overdispersed count data?* Ecology 88(11), 2766–2772.
- Osgood, D. W. (2000). *Poisson-based regression analysis of aggregate crime rates.* Journal of
  Quantitative Criminology 16(1), 21–43.
- Garwood, F. (1936). *Fiducial limits for the Poisson distribution.* Biometrika 28, 437–442.
