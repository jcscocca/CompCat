# Crime Analysis Statistical Suite — Architecture & Build Plan

Turning the single-sheet viz extension into a team-facing analytics service inside
Tableau, using **TabPy (Python) on on-prem Tableau Server**, focused on **forecasting**
and **significance testing**.

Companion file: `tabpy_crime_stats.py` — the tested statistical core (forecast +
significance), ready to deploy to TabPy.

---

## 1. The shape of the service

Three layers, each doing what it's best at:

```
  Analyst  ──>  Tableau dashboard (the app)
                   │
     ┌─────────────┼──────────────────────────┐
     │             │                           │
 Driver         Dashboard extension        Native worksheets +
 parameters     (app shell / UI:           calc fields that call
 (dataset,      tabs, report, export)      TabPy via SCRIPT_*()
 precinct,          │                           │
 category,          └─────────► TabPy server ◄───┘
 window)                    (Python: statsmodels,
                             scipy — the real stats)
```

- **Native worksheets + calc fields** are where the statistics actually execute. A
  calculated field calls `SCRIPT_REAL(...)`, Tableau ships the aggregated vectors to
  TabPy, Python runs the test/forecast, and the result returns inline as a normal field
  you can plot, table, or color by. This is the canonical "real statistics in Tableau"
  path and it keeps results reusable across the workbook.
- **The dashboard extension** is the *app shell* — a single object on the dashboard with
  tabs (Forecast, Significance, Report), the driver controls, and export. Unlike the viz
  extension you have now (locked to one sheet), a dashboard extension reads summary data
  from any worksheet, reads/writes parameters, and orchestrates the views. Your existing
  JS chart can live inside it as the "trend & band" panel.
- **Driver parameters** let analysts point the whole suite at a dataset / precinct /
  offense category / time window without editing anything.

Why this split: the team gets statistically defensible Python (forecast PIs, exact
Poisson tests) *and* a single guided surface, while you keep the heavy code server-side
where it's governed and versioned.

---

## 2. The statistics (tested, in `tabpy_crime_stats.py`)

### Forecasting — `holt_winters_forecast(counts, season_length, horizon, ci)`
ETS / Holt-Winters with additive trend + seasonality (additive is safest for counts),
returning point forecast plus a **prediction interval** (not just a confidence interval —
it includes the noise of the future observation). Lower bound is clamped at 0. Verified on
real Seattle call data: a 6-month forecast tracked the seasonal shape with sane ±~16% 95%
intervals.

### Significance — Poisson methods (not percent-change)
- `poisson_vs_baseline(observed, expected)` — is a period anomalous vs its 5-year
  baseline λ? Exact one-sample Poisson p-value + a variance-stabilized z-score.
- `poisson_period_compare(now, prev)` — period-over-period (e.g. this month vs last, or
  vs same month last year). Exact **conditional binomial** test for the ratio of two
  Poisson rates — valid at low counts.
- `poisson_etest(...)` — Krishnamoorthy-Thomson **E-test** (via scipy) for unequal
  exposures, with the conditional test as fallback.

> **Critical caveat (from testing on real data).** At citywide volumes (~47k/month) these
> Poisson tests flag a 12% change as p≈0, because aggregate call/crime data is
> **overdispersed** (variance >> mean). Pure-Poisson tests over-reject at high counts.
> Use them where Poisson roughly holds — **specific offense types, beats, or
> categories** (low-to-moderate counts) — or apply the overdispersion adjustment: scale
> the test variance by the dispersion factor φ (quasi-Poisson) or switch to
> Negative-Binomial. This is the same φ the viz extension already estimates for its
> Auto/NB2 band, so reuse it as the suite's dispersion input.

---

## 3. Wiring the stats into Tableau (calc fields → TabPy)

### 3a. Significance — returns one value per partition
Significance tests fit Tableau cleanly: they return a scalar per group. Recommended
pattern — deploy the function to TabPy once, then keep the calc field thin:

```
// Calculated field:  Anomaly p-value (vs baseline)
SCRIPT_REAL("
return tabpy.query('tableau_anomaly_pvalue', _arg1, _arg2)['response']
",
  SUM([Count]),            // _arg1  observed-per-period column
  SUM([Baseline Expected]) // _arg2  the 5-yr seasonal baseline column
)
```

`tableau_anomaly_pvalue` is the **vectorized** endpoint (verified): it takes the whole
column and returns one p-value per row — which is exactly the `SCRIPT_*` contract. Then
color marks red where this `< 0.05`, or build a "flagged periods" table. Use
`tableau_period_pvalue` the same way for period-over-period.

### 3b. Forecasting — the future-row scaffolding pattern
`SCRIPT_*` returns one value **per existing row**, so a forecast needs future rows to
land in. Standard approach:

1. Build a **scaffold** of future dates — union your fact table with a small "future
   calendar" table (one row per future period, null counts), or use a date-spine /
   `MAKEDATE` densification. Add a boolean `[Is Future]`.
2. Pass the historical counts (with nulls for future rows) to TabPy; return the fitted
   values for history and the forecast for future rows:

```
// Calculated field:  Forecast (mean)   — the scaffolding/alignment is done server-side
SCRIPT_REAL("
return tabpy.query('tableau_forecast_bands', _arg1, _arg2, 12, 0.95)['response']['mean']
",
  SUM([Count]),        // _arg1  count column (history = numbers, future rows = null)
  MAX([Is Future])     // _arg2  0/1 flag marking the scaffolded future rows
)
```

The deployed `tableau_forecast_bands` endpoint (verified end-to-end) fits the history,
forecasts `SUM([Is Future])` periods, and returns three row-aligned vectors. Add two more
one-line calcs for the band — identical but ending in `['lower']` and `['upper']` (history
rows come back null, future rows carry the interval). All three are **table calculations**:
set *Compute Using* along the date axis. The `[Is Future]` scaffold = your fact rows
unioned with a small future-calendar table (one null-count row per future period).

> Note: Tableau also has a built-in forecast (Analytics pane). Use TabPy here only because
> you want a *specific* model (ETS with controllable seasonality and proper PIs) and the
> same engine the rest of the suite uses.

---

## 4. Deploying TabPy on on-prem Tableau Server

### 4a. Stand up TabPy
On a server the Tableau Server box can reach over the network (ideally a dedicated host):

```
pip install tabpy
tabpy            # starts on port 9004 by default
```

Harden it: run behind the firewall, enable **auth** (TabPy supports basic auth — set a
username/password), and put it behind HTTPS (reverse proxy or TabPy's TLS config) so
Tableau↔TabPy traffic is encrypted. Install the analysis deps on that host:
`pip install numpy scipy statsmodels`.

### 4b. Deploy the functions (thin calc fields, governed code)
From a machine that can reach TabPy:

```python
from tabpy.tabpy_tools.client import Client
import tabpy_crime_stats as cs
c = Client("https://your-tabpy-host:9004/")
c.deploy("holt_winters_forecast", cs.holt_winters_forecast,
         "ETS forecast with PI", override=True)
c.deploy("poisson_vs_baseline", cs.poisson_vs_baseline,
         "One-sample Poisson anomaly test", override=True)
c.deploy("poisson_period_compare", cs.poisson_period_compare,
         "Two-sample Poisson rate test", override=True)
```

Redeploying is how you ship updates — calc fields don't change.

### 4c. Connect Tableau Server to TabPy (admin/TSM)
- In **TSM** (or Server Settings), configure the **Analytics Extensions** connection:
  host, port, the auth credentials, and SSL. (`tsm security maestro-rserve-ssl`-style
  config, or the Analytics Extensions tab in TSM Web UI.)
- Enable Analytics Extensions for the **site** (Settings → Extensions / Analytics
  Extensions) and add the TabPy connection there.
- In **Tableau Desktop** (for authors): Help → Settings and Performance → Manage Analytics
  Extension Connection → TabPy → host/port/credentials → Test Connection.

### 4d. Deploy the *dashboard extension* itself
- Host the extension's web files (HTML/JS) on an **internal HTTPS** server — not
  `localhost`. Keep the Tableau Extensions API library file alongside it (the thing that
  was 404'ing locally).
- Build the dashboard-extension `.trex` (this is a `<dashboard-extension>` manifest with
  `<context-menu><configure-context-menu-item/></context-menu>` — the piece we just learned
  matters) pointing `<source-location>` at that HTTPS URL.
- **Allowlist it**: Server admins add the extension's URL to the site's allowed
  Network-Enabled extensions list (Settings → Extensions), and grant **Download Summary
  Data** permission on the published workbook so the extension can read the view.

---

## 5. Making it feel like a service

- **Driver parameters**: `Dataset` (Crime / Calls / Arrests / Use of Force…), `Precinct`,
  `Offense Category`, `Time window` (the YTD/rolling switcher you already built). The
  extension and calc fields read these so one dashboard runs any combination.
- **Report tab**: a layout that runs the whole battery for the current selection and
  renders a formatted summary — forecast chart + PI, the flagged-anomaly list, the
  period-over-period verdicts in plain language. Export to PDF/PNG/CSV from the extension
  (client-side) and/or schedule it with native **Tableau Server subscriptions** to email
  the team on a cadence.
- **Reuse**: the viz extension becomes the interactive "trend & band" panel inside the
  app; the suite adds the forecast and significance panels around it.

---

## 6. Recommended build order

1. **TabPy up + functions deployed** (Section 4a/4b) and the Desktop connection tested.
2. **Significance calcs** (3a) on a low-count cut (offense type or beat) — fastest win,
   immediately useful, and sidesteps the overdispersion caveat.
3. **Forecast calcs + scaffold** (3b) with the PI band.
4. **Dashboard-extension app shell**: tabs + driver parameters + report/export, embedding
   the existing chart.
5. **Server deployment + allowlist + subscriptions** (4c/4d) and hand the team a template
   workbook wired to the SPD sources.

---

## 7. Governance & gotchas

- **Overdispersion** (Section 2 caveat): apply significance tests at the right granularity
  or adjust the variance by φ / use NB. Don't ship citywide-total p-values.
- **Security**: TabPy executes Python — lock it down (auth, TLS, firewall, no public
  exposure), and review deployed code. Calc fields that call deployed endpoints (not
  inline code) are easier to govern.
- **Data permissions**: published workbooks need **Download Summary Data** for the
  extension; full-data permission only if you read underlying rows.
- **Performance**: TabPy calls are synchronous per refresh — pre-aggregate (day/period
  level) and scope the window so vectors stay small, same as the extension guidance.
- **Versions**: viz + dashboard extensions and Analytics Extensions are supported on your
  Tableau 2025.x; confirm the TabPy/Analytics-Extension settings location in your exact
  Server build with your admin.
