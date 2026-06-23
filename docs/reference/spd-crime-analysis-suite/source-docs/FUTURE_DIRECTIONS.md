# Time-Series Tableau Extension — Future Directions

A running list of enhancements and known limitations, captured while upgrading the
extension (`timeseries_extension.html`). Ordered roughly by value-to-effort. Nothing
here is required for current functionality; it's a roadmap.

_Last updated: 2026-06-18_

---

## 1. Statistical modeling

### 1a. Per-season dispersion (next step after the global NB2 switch)
The current overdispersion estimate is a **single global** value
(`alpha_hat = Σ[(y−μ)² − μ] / Σμ²`, NB2 method-of-moments) computed across every
displayed period. It works, but it has one important property: it absorbs *anything*
the baseline fails to track, including structural breaks.

On the Seattle Call Data, the 2020 COVID level-shift (~60k → ~33k calls/month) is
scatter the 5-year seasonal baseline can't follow, so the global Pearson dispersion
comes out very large (φ ≈ 1000+) and the NB2 band widens dramatically. That is
"correct" given the model, but it over-widens calm periods because of one historical
shock.

Refinements, in order of robustness:
- **Per-season dispersion** — estimate α separately per season slot (each month / each
  ISO week) so summer noise doesn't inflate winter bands. Needs ≥3–5 years per slot.
- **Trend-aware baseline** — if the baseline tracked level shifts (see Holt-Winters
  below), residuals shrink and the dispersion estimate stops absorbing trend.
- **Robust dispersion** — use a trimmed/median-based dispersion or a rolling window so a
  single shock (COVID) doesn't dominate the whole series.
- **Overdispersion score test** — replace the `φ > 1.2` threshold with the
  Cameron–Trivedi (1990) score/LR test for `H0: α = 0`, so the Poisson→NB switch is a
  principled significance decision rather than a hard cutoff.

### 1b. Exact NB2 interval (vs normal approximation)
The NB2 band currently uses a normal approximation: `μ ± z·√(μ + α·μ²)`. At high counts
this is fine, but for **low, skewed** NB counts the normal interval can still be slightly
off and can clip at zero asymmetrically. A proper fix is exact NB quantiles via the
regularized incomplete beta function (inverse NB CDF), or a parametric bootstrap /
simulated prediction interval. Heavier to implement; only matters for low-count + highly
overdispersed series.

### 1c. Confidence vs prediction interval
The bands today are **confidence** intervals for the expected baseline (μ). The question
"is *this period* anomalously high?" is really a **prediction** interval question, which
is wider because it adds the sampling noise of the new observation on top of uncertainty
in μ. Worth offering a "prediction band" toggle (Poisson: add the +μ sampling term;
NB2: `Var_pred = μ + α·μ² + μ`).

### 1d. Additional baseline models
- **Holt-Winters / triple exponential smoothing** — the strongest simple performer in the
  crime-forecasting literature (Gorr et al. 2003) for series with both trend and
  seasonality. Currently we only have seasonal MAs and a single-pass EWMA.
- **STL decomposition** — separate trend / seasonal / remainder; band from the remainder.
- **Change-point overlays** — CUSUM and EWMA control charts as optional overlays to flag
  *when* a sustained shift begins, not just outlier periods (NIST SPC handbook).

### 1e. Anomaly flagging
We compute the band but don't act on it. Add optional highlighting of periods whose
actual falls outside the band (color the marker, list them, or emit a count), which is
the actual operational use of a CompStat-style chart.

---

## 2. Time handling

The extension treats all timestamps as **floating local wall-clock** values (the Seattle
feeds carry no timezone offset), uses local date components throughout, and anchors every
synthetic period date at **local noon** to absorb DST and Plotly's UTC tick-formatting.
This is robust for the current data. Possible hardening:

- **Pass date strings to Plotly** instead of `Date` objects. Plotly formats ticks in UTC
  off the millisecond value; giving it `"2026-06-01"` strings removes the need for the
  noon-anchor trick entirely and eliminates the last (extreme-timezone, UTC+12…+14) edge
  case. Requires keeping an internal `Date[]` for hover/slicing logic and matching on a
  formatted key instead of `getTime()`.
- **Explicit timezone-interpretation setting** — "interpret timestamps as Pacific / UTC /
  browser-local." Only needed if the extension is ever fed data that *does* carry offsets.
- **Configurable week start** — weekly buckets assume **Sunday-start** (US convention).
  Add an ISO **Monday-start** option (and align `getWeekNumber` accordingly).
- **Sentinel / placeholder date filter** — the SPD Crime dataset contains placeholder
  `1900-01-01` rows and `-` values. Add a configurable minimum valid date so these are
  dropped explicitly rather than relying on the YTD/rolling-window parameter to hide them.

---

## 3. Features & UX

- **Export** — download the chart as PNG and the underlying processed series (period,
  actual, baseline, lower, upper, moving avg) as CSV.
- **Multi-series / category support** — currently one date + one measure. Allow a
  dimension (e.g. `Offense Category`, `Precinct`) to render small multiples or overlaid
  series.
- **Configurable incomplete-period handling** — let the author choose to drop, dot, or
  fully plot the current partial period instead of the fixed dot+annotation behavior.
- **Band/legend labeling** — show the active model + confidence level in the legend or a
  caption (the dispersion note is a start; generalize it).

---

## 4. Tableau integration

- **Support discrete date pills** — today the date should be a *continuous, day-level
  exact* date on Columns. Detect and gracefully handle a discrete/truncated pill (or warn
  the author) instead of silently mis-bucketing.
- **Explicit field pickers** — instead of relying solely on the `x`/`y` mark encodings,
  optionally let the author name the date and measure fields in settings (more robust to
  unusual worksheet layouts).
- **Large summary tables** — these datasets are ~1.5M rows at second-level granularity.
  Document (or enforce) day-level `DATE()` truncation, and consider server-side
  aggregation guidance to keep the summary-data read fast.

---

## 5. Engineering / maintenance

- **Bundle the test harness** — the Node-based unit tests (stat math, date/period logic,
  NB2 switch, real-data smoke tests) were run ad hoc during this upgrade. Commit them as a
  small test file so changes can be re-verified, ideally in CI.
- **Extract the JS** — the app is a single inline `<script>`. If it keeps growing,
  splitting the statistical library into its own module would improve testability (at the
  cost of the convenient single-file deployment).
- **Settings versioning** — stamp a schema version into saved workbook settings so future
  changes to setting names/types can migrate cleanly.

---

## Reference notes

Methods and formulas used in the current build are grounded in: Osgood (2000, Poisson
crime-count regression); Byar / Garwood exact Poisson intervals; Cameron & Trivedi
(NB2 overdispersion); NIST/SEMATECH SPC handbook (c-charts, EWMA, CUSUM); CDC/Stroup
historical-limits surveillance; Hyndman & Athanasopoulos (moving averages, Holt-Winters);
Gorr et al. (2003, short-term crime forecasting); IACA threshold/Poisson-Z guidance.
