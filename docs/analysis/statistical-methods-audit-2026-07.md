# Statistical methods audit — implemented practice vs. academic literature

**Status:** audit report (2026-07-17), snapshot at `origin/main` b785f2c. Produced from a
three-track sweep: (1) full documentation review, (2) line-level inventory of the implemented
statistics, (3) a literature benchmark drawn from quantitative criminology, spatial
epidemiology, and risk communication. Companion to
[overdispersion-and-rate-intervals.md](overdispersion-and-rate-intervals.md) and
[trend-indexing-method.md](trend-indexing-method.md).

> **Point-in-time record.** The implementation and documentation-drift findings below describe
> the named 2026-07-17 snapshot. As of the 2026-08-01 public-release cleanup, the §3.4 drift
> items are resolved or explicitly archived; use the current analysis docs and
> [`../architecture/`](../architecture/) as the source of truth.

## TL;DR

CompCat's statistical core is unusually rigorous for a product of its size: overdispersion
handling is *empirically diagnosed* rather than assumed, multiplicity is FDR-controlled,
effect-size floors prevent significance-only verdicts, and the trend display was designed
around seasonality from the start. The deliberate divergences from the literature ideal
(Wald rather than exact intervals, spatial rather than ambient-population exposure, no
shrinkage) are each documented with defensible rationale. The genuine gaps are narrower:
no small-count calibration evidence for the Wald machinery, no aoristic handling of
interval-timed offenses, no per-analysis geocoding-completeness disclosure, a subtle
area/citywide denominator mismatch in the trend endpoint, and several documentation-drift
issues (a superseded spec still presenting the old decision method, undocumented constants).

## 1. What is implemented (inventory)

| # | Method | Where |
|---|--------|-------|
| 1 | Two-sample **quasi-Poisson Wald log rate-ratio test**; `se = sqrt(φ·(1/kₐ+1/k_b))`; CI and p dual by construction | `app/analysis/rate_tests.py:24` |
| 2 | **Exact conditional-Poisson (binomial) p-value** — supplementary only, never decisional | `app/analysis/rate_tests.py:169` |
| 3 | **Single-rate quasi-Poisson Wald interval**, same φ/continuity conventions as the pairwise test | `app/analysis/rate_tests.py:101` |
| 4 | **Overdispersion φ** = index of dispersion (sample var/mean, ddof=1) over monthly bins; floored at 1.0 in the SE; threshold 1.2 for the quasi-Poisson label | `app/analysis/rate_tests.py:207,150` |
| 5 | **Benjamini–Hochberg step-up** across pairwise tests and across the four nested baselines within a place | `app/analysis/rate_tests.py:221`; `app/services/neighborhood_service.py` |
| 6 | **Decision floors**: α=0.05, effect floor RR ≤ 0.80 (or ≥ 1.25 for "above"), ≥ 30 days, place count ≥ 3, combined ≥ 10 | `app/analysis/rate_tests.py:13-20,236`; `app/analysis/beat_baselines.py:228` |
| 7 | **Lowest-rate candidate selection** with acknowledged (uncorrected) selective inference, guarded by all-pairs-must-pass + floors | `app/analysis/comparison.py:42-51` |
| 8 | **Exposure** = π·r²·days (area × time density, no population denominator); haversine buffer membership; partial-edge-month trim for the dispersion input only | `app/analysis/exposure.py` |
| 9 | **Baseline geographies**: rest-of-MCPP / rest-of-beat with grid-sampled (41×41) buffer-overlap carve-out; whole-area sector/city | `app/analysis/beat_baselines.py:124`; `app/analysis/area_baselines.py` |
| 10 | **Anchored trend overlay**: k = ΣA/ΣC over the first 12 months, trailing 12-month rolling mean, descriptive only (no per-bucket inference, by design) | `app/services/trends_service.py`; `frontend/src/lib/trendMath.ts` |
| 11 | **Temporal profile**: descriptive 7×24 hour/day-of-week counts, no tests | `app/analysis/temporal.py` |

## 2. Scorecard against the literature checklist

Benchmark distilled from Osgood (2000), Berk & MacDonald (2008), Garwood (1936),
Fay & Feuer (1997), Gu et al. (2008), Andresen (2011), Malleson & Andresen (2015),
Openshaw (1984), Weisburd (2015), McDowall et al. (2012), Marshall (1991),
Gelman & Price (1999), Benjamini & Hochberg (1995), Ratcliffe (2004),
Ratcliffe & McCullagh (1998), Spiegelhalter et al. (2005, 2017).

| Audit question (literature ideal) | CompCat | Verdict |
|---|---|---|
| Model counts with exposure, not OLS-on-rates (Osgood 2000) | Counts + explicit exposure everywhere; inference on log rates | ✅ meets |
| Overdispersion-aware tests (Berk & MacDonald 2008) | Quasi-Poisson φ, **empirically validated against NB2** via the Ver Hoef & Boveng (2007) log–log slope diagnostic on the real SPD data | ✅ **exceeds** — most applied work assumes NB by default; CompCat measured the mean–variance relationship (slope ≈ 1.1–1.3, linear) |
| Exact/gamma small-count intervals (Garwood 1936; Fay–Feuer 1997) | Wald log intervals with continuity correction, φ-floor, count floors; exact interval considered and rejected for verdict/interval consistency | ⚠️ documented divergence, **calibration unverified** (§3.3.1) |
| Conditional exact / mid-p two-rate test (Gu et al. 2008; Przyborowski–Wilenski 1940) | Exact conditional test implemented but demoted to supplementary; decisions ride the Wald SE for CI/p duality | ⚠️ documented divergence (same trade-off as above) |
| Ambient-population / at-risk denominator (Andresen 2011) | Deliberately none: area×days density, per-capita explicitly refused as false precision (trend doc §7) | ⚠️ deliberate divergence, disclosed; density comparisons remain internally consistent at equal radius (§3.2.2) |
| MAUP / radius sensitivity (Openshaw 1984; Hipp & Boessen 2013) | User-selectable 250–1000 m radius is an implicit multi-scale probe; no formal sensitivity discussion anywhere | 🔶 gap in documentation, not necessarily in method (§3.3.5) |
| Buffer counts ≠ hotspot tests (Weisburd 2015; Getis-Ord 1992) | App never claims cluster significance; no KDE/Gi* and no need given product scope | ✅ consistent with scope |
| Seasonality-aware trends (McDowall et al. 2012) | 12-month anchor chosen precisely for seasonal cancellation; trailing 12-month mean annihilates stable seasonality exactly | ✅ meets |
| Percent-change suppression on small counts | "Prefer count-data framing over raw percent-change" is a standing product rule; indexed-to-100 display explicitly rejected | ✅ meets |
| EB shrinkage of small-area rates (Marshall 1991; Gelman & Price 1999) | None — raw rates with intervals and floors; no ranking/league-table surface exists to be distorted by extreme noisy rates | ⚠️ deliberate divergence, mostly mitigated by design (§3.2.3) |
| FDR control for scanning (BH 1995; Caldas de Castro & Singer 2006) | BH in two families; selection effect acknowledged; per-bucket trend tests withheld citing multiplicity | ✅ meets, with caveats (§3.3.4) |
| Geocoding hit rate ≥ 85% disclosed (Ratcliffe 2004); aoristic times (Ratcliffe & McCullagh 1998) | No per-analysis missing-coordinate disclosure; interval-timed offenses point-stamped at `offense_start` | 🔶 genuine gap (§3.3.2, §3.3.3) |
| "Reported ≠ occurred" caveat (Mosher et al. 2011) | Reporting confound documented (trend doc §5.2) and embedded in the product invariant | ✅ meets |
| Uncertainty display, no league tables (Spiegelhalter 2005) | Intervals everywhere, no rankings, "similar/above/below" with effect floors — funnel-plot spirit without the plot | ✅ meets |

## 3. Findings

### 3.1 Where CompCat meets or exceeds the literature

1. **The quasi-Poisson-vs-NB decision is empirically grounded.** The overdispersion doc runs
   the Ver Hoef & Boveng (2007) discriminating diagnostic on the actual ingest dataset
   (712,999 incidents) at two spatial scales, finds a linear mean–variance relationship, and
   rejects NB2 on fit rather than fashion. This inverts the usual applied-crime default
   (NB assumed) with data. Few production tools do this at all.
2. **Significance is never sufficient.** Every verdict path requires an effect-size floor
   (RR ≤ 0.80 / ≥ 1.25) *and* minimum-data floors on top of an FDR-adjusted p — directly
   implementing the literature's warning against practically-meaningless significance.
3. **Selective inference is acknowledged in-code.** The winner's-curse comment at
   `app/analysis/comparison.py:42-51` names the uncorrected selection step and the reasons
   the conservative decision rule bounds it. The literature mostly documents this failure
   mode in tools that don't know they have it.
4. **The trend display refuses inference it can't support.** No per-bucket significance
   (multiplicity + small counts, §5.1 of the trend doc), no confidence band whose error
   structure would be wrong (the anchor error is a global scalar), "direction, not
   magnitude" copy. This is Spiegelhalter-style honesty applied unusually consistently.
5. **The CI-overlap claim in the compare spec is correct** (verified during this audit
   against Goldstein & Healy 1995 / Schenker & Gentleman 2001): two just-touching 95% CIs
   with comparable SEs correspond to p ≈ 2·Φ(−2·1.96/√2) ≈ 0.006, which is exactly the
   spec's stated reason for rejecting overlapping-interval visuals.

### 3.2 Deliberate divergences the audit accepts (documented trade-offs)

1. **Wald-with-φ instead of exact/mid-p as the decisional statistic.** The literature ideal
   for small counts is the exact conditional (or mid-p) test and Garwood/gamma intervals.
   CompCat chose one φ-aware Wald variance model for both the pairwise verdict and the
   per-address interval so the two can never visually contradict — a real UX-integrity
   argument the literature does not weigh. The exact p is still computed and shown as
   supplementary. Accepted, *conditional on* §3.3.1 below.
2. **Spatial density instead of population-at-risk exposure.** Andresen's line of work shows
   residential and ambient denominators produce materially different pictures; CompCat's
   answer is to use neither and refuse the implied per-capita claim. At equal radius and
   equal window, density comparisons are internally consistent; the place-vs-baseline
   comparison does embed an assumption that the baseline area's incident density is a fair
   reference for the buffer, which ambient-population differences (nightlife corridor vs.
   residential block) can strain. The product invariant (context, not risk) is what makes
   this acceptable. Should the product ever rank or score, this becomes the first thing to fix.
3. **No empirical-Bayes shrinkage.** The disease-mapping tradition shrinks small-area rates
   because unshrunk maps/league tables spotlight noise (Gelman & Price 1999). CompCat has no
   map-of-rates or ranking surface; every rate ships with an interval and decisions are
   floored. Shrinkage would also complicate the "one variance model" invariant. Reasonable —
   worth an explicit one-paragraph "considered and rejected" note in the docs, which does
   not currently exist.
4. **Descriptive-only temporal profile.** No χ²/expected-vs-observed test on the 7×24
   matrix. Consistent with the section's orientation-not-adjudication framing.

### 3.3 Genuine gaps (ranked by importance)

1. **No calibration evidence for the small-count Wald machinery.** Verdicts can fire at
   place count 3 / combined 10 — the regime where Wald log-rate intervals are known to
   under-cover (Brown, Cai & DasGupta 2001 for the binomial analogue; Gu et al. 2008 for
   two-rate tests). The φ-floor and continuity correction push conservative, but nothing in
   the repo *demonstrates* adequate coverage at the floors: there is no simulation test, and
   the exact p-value's own numeric correctness is untested (only its presence/absence is
   asserted). A small Monte-Carlo coverage test at k ∈ {3..15} would either validate the
   floors or motivate raising them / switching the low-count branch to mid-p.
   **Resolved 2026-07-17:** `tests/test_rate_calibration.py` now pins both the exact p-value
   and seeded coverage/type-I at the floors. The simulation found the estimated-φ single-rate
   interval under-covers (φ̂ noise, not the Wald form); fixed with the quasi-likelihood
   Student-t correction (ν = n_periods − 1) — see
   [overdispersion-and-rate-intervals.md §5.1](overdispersion-and-rate-intervals.md). One
   residual remains pinned: heavy overdispersion with small monthly counts (φ = 7, μ ∈ {10, 15})
   still covers ~0.89.
2. **No aoristic handling of interval-censored offense times.** Burglary/vehicle-theft-style
   offenses have a start/end window, not a moment; assigning `offense_start_utc` alone
   biases the hour-of-day/day-of-week profile toward window-opening times (Ratcliffe &
   McCullagh 1998). At minimum the temporal-profile UI should disclose the convention; the
   literature-ideal fix is aoristic weighting across the offense interval.
3. **No geocoding-completeness disclosure.** Incidents with redacted/missing coordinates
   silently drop out of buffer counts; whether they reach baseline counts depends on the
   exact predicate (the rest-of-area queries also require a non-null latitude, so fully
   redacted rows drop from both — see docs/analysis/exposure-model.md §6 for the precise
   split).
   Ratcliffe's (2004) 85% minimum-hit-rate benchmark is the standard here; CompCat reports
   nothing per-analysis. A "N of M incidents in this area had usable coordinates" line would
   close it. Note the asymmetry is *conservative* for the place-vs-baseline verdict
   (missing-coordinate incidents can only inflate the baseline), but it is undisclosed.
4. **Trend denominator mismatch (area ⊄ citywide partition).** The trend area series buckets
   on the `mcpp` attribute while the citywide series sums over `beat` values
   (`app/services/trends_service.py`). Rows with a valid MCPP but a placeholder/NULL beat
   enter the area series but not the "citywide" one, so the C = A + B identity assumed in
   trend-doc §5.3 does not hold exactly and the anchor share k carries a small bias. Also,
   trend-doc §5.4 says area counts are "MCPP point-in-polygon" when the code does attribute
   bucketing (the service docstring itself says so). Likely immaterial in magnitude but
   currently unbounded and untested — measure it once, then either align the universes or
   state the bound in the doc.
5. **MAUP / radius sensitivity is undiscussed.** The 250–1000 m user-selectable radius is a
   de-facto multi-scale probe, but no doc tells users (or maintainers) that results are
   radius-dependent by construction (Openshaw 1984; egohood-style buffers per Hipp &
   Boessen 2013). One paragraph in an exposure-model doc (see §3.4) covers it.
6. **Nested-BH correlation is unanalyzed.** The within-place family (MCPP ⊂ beat ⊂ sector ⊂
   city) is strongly positively dependent; BH remains valid under PRDS, but nothing in the
   docs makes that argument. Also, nothing corrects across a *user's session* of many
   category/filter scans — the literature's "scanning" multiplicity. The latter is
   effectively unsolvable in an exploratory tool and should simply be a documented caveat.
7. **Minor code-level display inconsistency.** With a zero count, `rate_ratio` uses
   continuity-corrected counts while the displayed `rate_a`/`rate_b` stay raw
   (`app/analysis/rate_tests.py:43-55`), so the shown ratio doesn't equal the ratio of the
   shown rates. Cosmetic, but the analytical-mode payload exposes both.

### 3.4 Documentation-drift findings (from the doc sweep)

1. **The superseded 2026-06-23 spec still reads as the method of record.**
   `docs/superpowers/specs/2026-06-23-statistical-route-place-comparison-design.md` describes
   an E-test/exact-conditional *decision* procedure that the 2026-06-26 methodology plan
   replaced with the unified Wald approach. It is not marked superseded; a reader following
   it alone would describe the wrong live method. Add a superseded banner pointing at
   `overdispersion-and-rate-intervals.md`.
2. **The pairwise-engine methodology doc is a dangling reference.**
   `app/analysis/comparison.py:49` and the ROADMAP both point at
   `docs/analysis/statistical-route-place-comparison.md`, removed with the routes feature.
   No current analysis-tier doc covers the pairwise engine end-to-end (candidate selection,
   BH, decision classes, floors). Either restore a places-only version or fold it into the
   overdispersion doc.
3. **Key constants exist only in code.** No current doc states the BH/FDR level, α = 0.05,
   `MIN_PLACE_COUNT = 3`, `MIN_COMBINED_COUNT = 10`, the 0.80/1.25 effect floors, or the
   1.2 dispersion threshold. The only numeric floors documented anywhere live in the
   superseded 06-23 spec.
4. **No exposure-model doc.** The π·r²·days model — the denominator for every rate the app
   shows — has no analysis-tier writeup analogous to the other two methodology docs. It
   should cover: the density interpretation, the refusal of population denominators (§3.2.2),
   MAUP/radius sensitivity (§3.3.5), and the buffer-overlap carve-out geometry.
5. **The reference suite's "avoid v1 p-values" guidance is stale** relative to the shipped
   product and should be dated or annotated as historical.
6. **Decision-class vocabularies are documented nowhere central.** Compare uses
   `statistically_lower | not_statistically_clear | insufficient_data | model_warning`;
   the neighborhood surface uses `above_clear | below_clear | not_clear | …` plus a
   `relation` field. Only scattered specs enumerate them; `docs/architecture/api.md` should.

### 3.5 One docs-sweep finding overturned

The sweep flagged the compare spec's "overlap ≈ p 0.006, not 0.05" as a suspected
miscitation. Verified correct (see §3.1.5) — no action needed beyond optionally adding the
Schenker & Gentleman (2001) citation to the spec.

## 4. Recommendations (ranked)

Cheap documentation fixes first; substantive statistical work after.

1. **Docs:** mark the 06-23 spec superseded; write the exposure-model analysis doc
   (density interpretation, population-denominator refusal, MAUP paragraph, overlap
   geometry); state the decision constants and BH level in one place; fix trend-doc §5.4
   ("attribute bucketing", not point-in-polygon); enumerate decision-class vocabularies in
   `docs/architecture/api.md`. (§3.4)
2. **Calibration test:** add a Monte-Carlo coverage test for `compare_incident_rates` /
   `rate_confidence_interval` at the decision floors (k = 3…15, φ ∈ {1, 3, 7}); pin the
   exact conditional p-value against known values while there. Raise floors or adopt mid-p
   at low counts only if the simulation says so. (§3.3.1)
3. **Trend universe alignment:** measure the mcpp-vs-beat universe mismatch once; align the
   citywide series to the same attribute universe or add the measured bound to the trend
   doc and a regression test. (§3.3.4)
4. **Geocoding disclosure:** surface per-analysis usable-coordinate counts ("N of M
   incidents had usable coordinates") in the analyze payload and UI note. (§3.3.3)
5. **Temporal honesty:** disclose the `offense_start` point-stamping convention on the
   temporal profile; consider aoristic weighting as a follow-up if interval-heavy offense
   categories matter to users. (§3.3.2)
6. **Considered-and-rejected notes:** add short EB-shrinkage and session-level-multiplicity
   paragraphs to the methodology docs so future audits read them as decisions, not
   omissions. (§3.2.3, §3.3.6)

## References (audit benchmark)

- Andresen, M.A. (2011). The ambient population and crime analysis. *Prof. Geographer* 63(2).
- Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate. *JRSS-B* 57(1).
- Berk, R. & MacDonald, J. (2008). Overdispersion and Poisson regression. *J. Quant. Criminology* 24.
- Brown, L., Cai, T. & DasGupta, A. (2001). Interval estimation for a binomial proportion. *Statistical Science* 16(2).
- Fay, M.P. & Feuer, E.J. (1997). Confidence intervals for directly standardized rates. *Stat. in Medicine* 16.
- Garwood, F. (1936). Fiducial limits for the Poisson distribution. *Biometrika* 28.
- Gelman, A. & Price, P.N. (1999). All maps of parameter estimates are misleading. *Stat. in Medicine* 18.
- Goldstein, H. & Healy, M.J.R. (1995). The graphical presentation of a collection of means. *JRSS-A* 158(1).
- Gu, K., Ng, H.K.T., Tang, M.L. & Schucany, W.R. (2008). Testing the ratio of two Poisson rates. *Biometrical J.* 50(2).
- Hipp, J.R. & Boessen, A. (2013). Egohoods as waves washing across the city. *Criminology* 51(2).
- Malleson, N. & Andresen, M.A. (2015). Spatio-temporal crime hotspots and the ambient population. *Crime Science* 4:10.
- Marshall, R.J. (1991). Mapping disease and mortality rates using empirical Bayes estimators. *Applied Statistics* 40(2).
- McDowall, D., Loftin, C. & Pate, M. (2012). Seasonal cycles in crime, and their variability. *J. Quant. Criminology* 28.
- Mosher, C., Miethe, T. & Hart, T.C. (2011). *The Mismeasure of Crime*, 2nd ed. Sage.
- Openshaw, S. (1984). *The Modifiable Areal Unit Problem*. CATMOG 38.
- Osgood, D.W. (2000). Poisson-based regression analysis of aggregate crime rates. *J. Quant. Criminology* 16(1).
- Ratcliffe, J.H. (2004). Geocoding crime and a first estimate of a minimum acceptable hit rate. *IJGIS* 18(1).
- Ratcliffe, J.H. & McCullagh, M.J. (1998). Aoristic crime analysis. *IJGIS* 12(7).
- Schenker, N. & Gentleman, J.F. (2001). On judging the significance of differences by examining the overlap between confidence intervals. *American Statistician* 55(3).
- Spiegelhalter, D., Sherlaw-Johnson, C. et al. (2005). Funnel plots for comparing institutional performance. *Stat. in Medicine* 24.
- Spiegelhalter, D. (2017). Risk and uncertainty communication. *Annu. Rev. Stat. Appl.* 4.
- Ver Hoef, J.M. & Boveng, P.L. (2007). Quasi-Poisson vs. negative binomial regression. *Ecology* 88(11).
- Weisburd, D. (2015). The law of crime concentration and the criminology of place. *Criminology* 53(2).

*Citation caveat: canonical anchors were verified during the sweep; page/issue details for a
few secondary entries should be spot-checked before citing externally.*
