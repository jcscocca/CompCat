# Statistical Methods & References

The criminological / statistical literature behind the suite's models, and where each one
is implemented. This is the research that drove which methods to integrate; it's recorded
here so the reasoning and citations stay with the project.

Cross-cutting principle: crime and call counts are **count data** (Poisson-like), so the
methods are built on Poisson/Negative-Binomial foundations rather than raw percent-change,
which is unstable at low counts.

---

## 1. Poisson baseline with an EXACT interval (and Negative-Binomial for overdispersion)

**Idea.** A period's count is modeled as Poisson(λ), so its uncertainty is a function of
the count itself (variance = mean). The naive `mean ± z·√mean` interval breaks at low
counts (goes negative / degenerates at x=0); the **exact** interval does not.

**Formulas.**
- Garwood exact: `lower = ½·χ²(α/2; 2x)`, `upper = ½·χ²(1−α/2; 2x+2)`.
- **Byar's** closed-form approximation (what the extension uses, no χ² needed):
  `lower = x·(1 − 1/(9x) − z/(3√x))³`, `upper = (x+1)·(1 − 1/(9(x+1)) + z/(3√(x+1)))³`.
- Negative-Binomial (NB2) for overdispersion: `Var = μ + α·μ²`; α→0 recovers Poisson.

**Where implemented.** Extension band methods **Poisson exact (Byar)**, **Poisson normal**,
**NB2**, and **Auto** (φ-based switch). TabPy `poisson_vs_baseline`.

**Sources.**
- Osgood (2000), "Poisson-Based Regression Analysis of Aggregate Crime Rates," *J. Quantitative Criminology* 16(1):21–43. https://link.springer.com/article/10.1023/A:1007521427059
- Garwood exact interval (GraphPad). https://www.graphpad.com/support/faq/how-quickcalcs-computes-the-confidence-interval-of-a-count
- Byar's method (APHEO). https://www.apheo.ca/confidence-intervals
- Patil & Kulkarni (2012), survey of Poisson interval methods, *REVSTAT* 10:211–227. http://www.ine.pt/revstat/pdf/rs120203.pdf
- Cameron & Trivedi — NB2 / overdispersion (negative binomial regression).

---

## 2. SPC control charts — Poisson c-chart / u-chart (3-sigma)

**Idea.** Treat the series like a monitored process: a center line from history, flag
points beyond control limits as "special cause." Increasingly recommended over CompStat
percent-change charts.

**Formulas.** c-chart: `UCL/LCL = c̄ ± 3√c̄`. u-chart (variable exposure): `ū ± 3√(ū/nₜ)`.
NIST caveat: the normal approximation needs mean ≳ 5; for low counts use a
variance-stabilizing transform or exact limits.

**Where implemented.** Extension band method **SPC control limits** (configurable k).

**Sources.**
- NIST/SEMATECH e-Handbook §6.3.3.1 Counts Control Charts. https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc331.htm
- Mitchell, Boehme & Fulmer (2025), Process Behavior Charts vs CompStat, *J. Experimental Criminology*. https://link.springer.com/article/10.1007/s11292-025-09673-w

---

## 3. EWMA control chart (small-drift detection)

**Idea.** Exponentially weight recent periods; better than a c-chart at catching small,
sustained drifts. `EWMAₜ = λ·Yₜ + (1−λ)·EWMAₜ₋₁`, limits `±k·s·√(λ/(2−λ))`, λ≈0.2–0.3.

**Where implemented.** Extension baseline model **EWMA**. (As a control chart with limits:
future direction.)

**Sources.**
- NIST/SEMATECH §6.3.2.4 EWMA. https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm
- Lucas & Saccucci (1990), "EWMA Control Schemes," *Technometrics* 32(1):1–12.

---

## 4. CUSUM (change-point detection)

**Idea.** Accumulate deviations from target to detect *when* a sustained shift began — the
most efficient classical method for small persistent changes.
`S⁺ₜ = max(0, S⁺ₜ₋₁ + (xₜ − μ₀ − k))`, signal when `S⁺ₜ > h` (k≈0.5σ, h≈4–5σ).

**Where implemented.** Not yet — listed in `FUTURE_DIRECTIONS.md` as a change-point overlay.

**Source.** NIST/SEMATECH §6.3.2.3 CUSUM. https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm

---

## 5. Seasonal moving-average / seasonal-naïve baseline

**Idea.** The expected value for a period = the same calendar period averaged over prior
years (your original "5 years of the same month"). Simple, transparent, strong when
seasonality is stable.

**Where implemented.** Extension baseline models **5-Year Weighted MA**, **Simple MA**,
**Seasonal Median**, **Seasonal Naive**; the per-period band wraps this in the Poisson
interval (Method 1).

**Source.** Hyndman & Athanasopoulos, *Forecasting: Principles and Practice* — Moving
Averages / simple methods. https://otexts.com/fpp2/moving-averages.html

---

## 6. Exponential smoothing / Holt-Winters (trend + seasonality)

**Idea.** Update level, trend, and seasonal indices with exponentially decaying weights;
the best simple performer in the canonical crime-forecasting study. Forecast with
prediction intervals `ŷₜ₊ₕ ± c·σₕ`.

**Where implemented.** TabPy `holt_winters_forecast` / `tableau_forecast_bands` (ETS with
prediction intervals).

**Sources.**
- Hyndman & Athanasopoulos — Holt-Winters. https://otexts.com/fpp2/holt-winters.html
- Gorr, Olligschlaeger & Thompson (2003), "Short-term forecasting of crime," *Int. J. Forecasting* 19(4):579–594. https://www.sciencedirect.com/science/article/abs/pii/S016920700300092X

---

## 7. Historical-limits / percentile "envelope" (CDC-style surveillance)

**Idea.** The public-health analog: compare the current period to the distribution of the
same (and adjacent) period in prior years. Normal-theory (Stroup historical limits,
mean+2σ over a 15-value baseline) or distribution-free (percentile band) — the latter is
robust for skewed/low counts.

**Where implemented.** Extension band method **Historical percentile envelope** (and
**Normal ± z·SD**).

**Sources.**
- Stroup et al. (1989), "Detection of aberrations in notifiable disease surveillance data," *Statistics in Medicine* 8(3):323–329. https://pubmed.ncbi.nlm.nih.gov/2540519/
- CDC NNDSS historical-limits method; EARS C1/C2/C3; Farrington/Noufaily (overdispersed surveillance).

---

## 8. Crime-analyst threshold / Poisson Z-score (IACA practice)

**Idea.** Flag a period when it exceeds the mean by k SD. The key low-count refinement is
the **Poisson Z-score** `Z = 2·(√current − √past)` (variance-stabilizing), which avoids the
instability of percent-change. Example: 4→9 is "+125%" but Z = 2·(3−2) = 2, i.e. within
normal variation.

**Where implemented.** Extension tooltip z-score and TabPy significance functions
(`poisson_vs_baseline`, `poisson_period_compare`, `poisson_etest` — conditional/E-test for
two-period comparisons).

**Sources.**
- IACA, "Identifying High Crime Areas: Standards, Methods & Technology" (2013).
- Wheeler, "Don't use percent change for crime counts" (CRIME De-Coder). https://crimede-coder.com/blogposts/2023/NoPercentChange
- RAND (2013), "Predictive Policing: The Role of Crime Forecasting." https://www.rand.org/pubs/research_reports/RR233.html
- BJS, Criminal Victimization (significance-testing methodology).

---

## How the menu maps to the literature

| Suite control | Method(s) above |
|---|---|
| Band: Poisson exact / normal | 1 |
| Band: Negative Binomial / Auto | 1 (NB2 + overdispersion switch) |
| Band: SPC control limits | 2 |
| Band: Normal ± SD / Percentile | 7 |
| Baseline: 5Y weighted/simple/median/naive | 5 |
| Baseline: EWMA | 3 |
| TabPy forecast | 6 |
| TabPy significance tests | 1, 8 |
| Change-point (CUSUM/EWMA overlay) | 3, 4 — future |

Cross-cutting rules baked in: never use `mean ± z·√mean` at low counts (use Byar /
percentile); test for overdispersion (variance/mean ≫ 1) and switch Poisson→NB; run
significance tests at a granularity where Poisson roughly holds (offense type / beat),
not on overdispersed citywide totals.

---
---

# Part 2 — Criminology-Focused Expansion (Monte Carlo & methods previously missed)

Part 1 leaned on the statistics literature (NIST, Hyndman). This part adds **criminology-
specific** sources and the **simulation / Monte Carlo** family. Tags: **INTEGRATE-NOW**
(fits the time-series tool directly), **FUTURE** (relevant roadmap), **OUT-OF-SCOPE
(spatial)** (belongs in a mapping sister-tool; listed for completeness).

_Verification: the Wheeler Poisson e-test source below was fetched and read directly (it
benchmarks the e-test vs the Poisson Z-score via Monte Carlo and discusses overdispersion);
the Wheeler–Ratcliffe WDD page also resolved. The remaining citations come from a focused
research pass — worth a click-through before formal/team use._

## A. Monte Carlo / simulation methods (priority)

### A1. Simulation-based Poisson/NB prediction bands — **INTEGRATE-NOW**
Instead of an analytic normal band, **simulate many Poisson (or Negative-Binomial) futures**
from the fitted rate and take empirical percentiles for the band ("fan chart"). Correct
coverage at low counts where Gaussian intervals fail. This is the single most relevant new
method — it slots beside the existing exact-Poisson/NB bands and the Holt-Winters forecast
as an alternative band generator, and reuses the φ/overdispersion we already estimate.
- Wheeler, A. P. (2016). Tables and graphs for monitoring temporal crime trends. *Int. J. Police Science & Management* 18(3):159–172. https://journals.sagepub.com/doi/abs/10.1177/1461355716642781 (SSRN: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2551472)
- Wheeler, "Plotting Predictive Crime Curves." https://andrewpwheeler.com/2019/04/15/plotting-predictive-crime-curves/
- `ptools` R package (Poisson tools for crime counts). https://cran.r-project.org/web/packages/ptools/ptools.pdf

### A2. Poisson e-test for short-run count comparisons — **INTEGRATE-NOW** (already in TabPy)
A more powerful exact two-Poisson-means test than the Z-score for "is this period's count a
real change?" We already ship `poisson_etest`; this is its criminological grounding. Wheeler
shows via simulation the e-test holds its false-positive rate where the Z-score over-rejects.
- Wheeler, "Testing changes in short run crime patterns: The Poisson e-test." https://andrewpwheeler.com/2018/04/29/testing-changes-in-short-run-crime-patterns-the-poisson-e-test/
- Krishnamoorthy & Thomson (2004), "A more powerful test for comparing two Poisson means," *J. Statistical Planning & Inference* 119:23–35.

### A3. Permutation / shuffle significance — **INTEGRATE-NOW** (technique)
Distribution-free testing: permute/shuffle the observed counts across time bins (999×) to
build an empirical null for "is this spike/run beyond chance," with no Poisson assumption.
This is the engine behind the Knox/near-repeat test, applied temporally.
- Ratcliffe & Rengert (2008), "Near-repeat patterns in Philadelphia shootings," *Security Journal* 21:58–76. https://doi.org/10.1057/palgrave.sj.8350068
- Near Repeat Calculator (Ratcliffe). https://www.jerryratcliffe.net/near-repeat-analysis ; R port: https://www.woutersteenbeek.nl/software/nearrepeat/

### A4. Temporal / prospective scan statistic (Monte Carlo) — **FUTURE**
Kulldorff's scan statistic scans windows, takes the max likelihood-ratio, and gets
significance by **Monte Carlo randomization** (also solving multiple testing). The
**temporal/prospective** 1-D variant is a legitimate "which recent window is a significant
cluster" anomaly detector.
- Kulldorff (1997), "A spatial scan statistic," *Comm. Statistics* 26(6):1481–1496. https://www.satscan.org/papers/k-cstm1997.pdf

### A5. Spatial Point Pattern Test (SPPT), Crime Increase Dispersion — **OUT-OF-SCOPE / FUTURE**
Canonical Monte Carlo crime methods for comparing two patterns (e.g. year-over-year); mostly
areal, included for completeness.
- Andresen (2016), area-based nonparametric SPPT. https://www.sfu.ca/~andresen/spptest/Andresen_SPPT_MI2016.pdf
- Wheeler, Steenbeek & Andresen (2018), *Transactions in GIS* 22(3). https://onlinelibrary.wiley.com/doi/abs/10.1111/tgis.12341

## B. Other crime methods previously missed

### B1. Interrupted Time Series (ITS) / intervention evaluation — **INTEGRATE-NOW**
Segmented regression (often with ARIMA noise + seasonal control) estimating an intervention's
level shift and slope change. The workhorse criminology design for evaluating a policy/
operation against a crime trend. Natural feature: an "intervention marker" the user drops on
a date, with estimated effect + CI.
- "Time Series Designs," *Encyclopedia of Research Methods in Criminology and Criminal Justice* (Wiley). https://onlinelibrary.wiley.com/doi/abs/10.1002/9781119111931.ch69
- de Vocht et al. (2013), alcohol trading hours & violence ITS, *PLOS ONE*. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0055581

### B2. ARIMA / SARIMA — **FUTURE** (and a citation we already rely on)
Gorr et al. is the criminological justification for choosing **exponential smoothing over
ARIMA** for small-count precinct series (simpler often matches/beats ARIMA; accuracy is driven
by count magnitude — need ~30+/period for <20% error). Keep for documentation; add a SARIMA
"bake-off" only if desired.
- Gorr, Olligschlaeger & Thompson (2003), "Short-term forecasting of crime," *Int. J. Forecasting* 19(4):579–594.
- Forecasting seasonal criminality with SARIMA (arXiv). https://arxiv.org/pdf/2306.03053

### B3. Self-exciting / Hawkes (ETAS) — **FUTURE**
Each event raises the short-term probability of follow-on events ("contagion"/near-repeat);
basis of PredPol. A purely temporal Hawkes process forecasts bursty series (retaliatory
violence). Heavier than Holt-Winters; advanced roadmap.
- Mohler et al. (2011), "Self-exciting point process modeling of crime," *JASA* 106(493):100–108. https://www.tandfonline.com/doi/abs/10.1198/jasa.2011.ap09546
- Mohler et al. (2015), RCT of predictive policing, *JASA* 110(512):1399–1411.

### B4. Bayesian methods — **FUTURE** (empirical-Bayes smoothing is INTEGRATE-NOW-feasible)
(a) Empirical-Bayes / hierarchical **rate smoothing** shrinks noisy low-count series toward a
global/neighbor mean — same small-N problem our low-count CI work targets. (b) **Bayesian
change-point** gives posterior probabilities on *when* a break occurred (upgrade to CUSUM).
- Bayesian hierarchical spatial analysis of neighborhood crime, *PMC*. https://pmc.ncbi.nlm.nih.gov/articles/PMC9517077/
- "Trend Detection in Crime-Related Time Series with Change Point Detection Methods," Springer. https://link.springer.com/chapter/10.1007/978-3-031-42448-9_7
- BEAST (Bayesian change-point + season + trend). https://github.com/zhaokg/Rbeast

### B5. Weighted Displacement Quotient / Difference (WDQ / WDD) — **FUTURE**
Evaluate displacement/diffusion around an intervention area. The **WDD** adds a Poisson-based
**significance test**, so it's a clean before/after count comparison you could expose beside
the e-test.
- Bowers & Johnson (2003), *J. Quantitative Criminology* 19(3):275–301. https://link.springer.com/article/10.1023/A:1024909009240
- Wheeler & Ratcliffe (2018), "A simple weighted displacement difference test," *Crime Science* 7:11. https://link.springer.com/article/10.1186/s40163-018-0085-5

### B6. Synthetic control & Group-Based Trajectory Modeling — **FUTURE**
Synthetic control builds a weighted "synthetic" comparison area to estimate the counterfactual
trend absent an intervention (time-series counterfactual; pairs with ITS). GBTM (Nagin) sorts
*many* series into trajectory groups — useful if analyzing many beats/categories at once.
- Saunders et al. (2015), synthetic control for place-based crime interventions, *J. Quantitative Criminology* 31(3):413–434. https://link.springer.com/article/10.1007/s10940-014-9226-5
- Nagin & Odgers (2010), group-based trajectory modeling, *J. Quantitative Criminology*. https://link.springer.com/article/10.1007/s10940-010-9113-7

### B7. Spatial / case-level methods — **OUT-OF-SCOPE (spatial sister-tool)**
Noted per request: Risk Terrain Modeling (Kennedy, Caplan & Piza 2011), prospective hotspot
mapping (Bowers, Johnson & Pease 2004), KDE hotspots + Predictive Accuracy Index (Chainey,
Tompson & Uhlig 2008), and Conjunctive Analysis of Case Configurations (Miethe, Hart &
Regoeczi 2008). Strong methods, but areal/case-level rather than count-time-series.

## C. What to add next (recommended, all criminologically backed)

1. **Simulation-based Poisson/NB prediction bands** (A1) — a new band method; empirical fan
   charts that beat Gaussian bands at low counts.
2. **Permutation/shuffle significance** (A3) — distribution-free anomaly/run testing.
3. **Interrupted Time Series intervention marker** (B1) — flag a date, estimate the effect.
4. **Empirical-Bayes rate smoothing** (B4a) — stabilize low-count series.

The Poisson e-test (A2) is already implemented in TabPy; this expansion supplies its (and the
forecast's) criminological provenance.
