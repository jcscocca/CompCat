# SPD Crime Analysis Suite

A Tableau toolkit for crime/call time-series analysis, in two parts:

1. **A viz extension** (`extension/`) — replaces a worksheet's chart with a time series
   showing an expected-value baseline (5-year weighted/seasonal moving average, EWMA, …)
   and an uncertainty band (Auto Poisson/Negative-Binomial, Poisson-exact, SPC, percentile),
   across Daily/Weekly/Monthly/Quarterly/Yearly breakdowns, with YTD / rolling-window
   filtering and incomplete-period detection. Settings open from a **gear button** on the
   chart.
2. **A TabPy statistical suite** (`tabpy/`) — Python functions for **forecasting**
   (Holt-Winters with prediction intervals) and **significance testing** (exact Poisson
   methods), called from Tableau via analytics-extension calc fields.

```
SPD Crime Analysis Suite/
├── README.md                     ← you are here
├── extension/                    the viz extension
│   ├── timeseries_extension.html
│   └── timeseries_extension.trex
├── tabpy/                        the statistical engine
│   ├── tabpy_crime_stats.py      forecast + significance functions (self-tests on run)
│   └── deploy_tabpy.py           deploys the endpoints to a TabPy server
└── docs/
    ├── Crime_Stats_Suite_Plan.md            architecture + on-prem Server runbook
    ├── TabPy_Home_Testing_Guide.md          run TabPy locally, step by step
    ├── Seattle_SPD_Socrata_Filtering_Guide.md   OData/SODA filtering for the data
    └── FUTURE_DIRECTIONS.md                  extension roadmap
```

**Requirements:** Tableau Desktop **2024.2+** (viz extensions; you're on 2025.x),
`python3`, and internet access the first time (to fetch the Tableau library + Python deps).

---

## Develop at home, run at work

The *same files* work in both places — you just substitute home-testable stand-ins for the
two things only the work setup provides (the Tableau data feed and the TabPy connection):

- **Extension — demo mode.** Add `?demo=1` to the URL to run the extension in a plain
  browser with built-in sample data, no Tableau needed. Serve the `extension/` folder
  (Part 1, step 1) and open:
  `http://localhost:8000/timeseries_extension.html?demo=1`
  You get a real chart you can drive with the **⚙ gear** — every baseline model, band
  method, breakdown, and series toggle — exactly as it behaves in Tableau. Without
  `?demo=1` the same file runs normally inside Tableau; nothing to convert.
- **TabPy — test the calc logic via `/evaluate`.** Tableau's `SCRIPT_REAL` just POSTs to
  TabPy's `/evaluate`; you can fire the identical payload at your local TabPy and see what
  Tableau would get (see `docs/TabPy_Home_Testing_Guide.md`, Step 3). The functions
  themselves test fully at home (`python3 tabpy_crime_stats.py`).

So at work the only differences are: the extension reads real Tableau fields instead of the
demo data, and `deploy_tabpy.py` / the Tableau connection point at the on-prem TabPy URL
instead of `localhost`.

---

## Part 1 — Run the viz extension

Tableau loads the extension from a URL, so a small local web server has to be running.

**1. Serve it** (and fetch the Tableau library it needs). In Terminal:

```bash
cd "$HOME/Downloads/SPD Crime Analysis Suite/extension" && \
  [ -s tableau.extensions.1.latest.js ] || curl -fsSL \
  "https://cdn.jsdelivr.net/gh/tableau/extensions-api/lib/tableau.extensions.1.latest.js" \
  -o tableau.extensions.1.latest.js; \
  python3 -m http.server 8000
```

Leave that window open. Sanity check: open `http://localhost:8000/timeseries_extension.html`
in a browser — you should see the extension's loading box (and the server log should show
`tableau.extensions.1.latest.js  200`, not 404).

**2. Add it in Tableau.** On a worksheet's **Marks card**, open the mark-type dropdown →
**Add Extension → Access Local Viz Extensions** → pick
`extension/timeseries_extension.trex`. Two tiles appear: **Date** and **Count**.

**3. Map fields.** Drop a **continuous, day-level** date on **Date**
(e.g. `DATE([offense_date])`, green pill) and a measure on **Count** (e.g.
`CNT([Offense ID])`). Day-level keeps the data small and fast.

**4. Set the time-window parameter.** Create a Tableau **String parameter** with allowable
values like `YTD`, `365`, `1095` (see the value table in the in-app setup), then pick it in
the extension's setup step. `YTD` = year-to-date; a number = that many days back.

**5. Configure the models.** Click the **⚙ gear** in the chart's top-right corner →
**Statistical Model** section → choose a Baseline and an Uncertainty Band → **Test** to
preview, **Apply** to save into the workbook.

---

## Part 2 — Run the TabPy statistical suite

Full walkthrough in `docs/TabPy_Home_Testing_Guide.md`. The short version:

```bash
cd "$HOME/Downloads/SPD Crime Analysis Suite/tabpy"
python3 -m venv .venv                 # one-time: isolated environment (required on macOS)
source .venv/bin/activate             # activate it (prompt shows "(.venv)")
pip install --upgrade pip
pip install numpy scipy statsmodels pandas tabpy
python3 tabpy_crime_stats.py          # 0) self-test — should print "ALL CHECKS PASSED"
PYTHONPATH="$PWD" tabpy               # 1) start the server (PYTHONPATH lets it import the module)
# in a NEW tab: cd here, run `source .venv/bin/activate`, then:
python3 deploy_tabpy.py               # 2) deploy the endpoints
```

> macOS note: a bare `pip3 install` fails with `externally-managed-environment` (PEP 668)
> on Homebrew Python — the venv above is the fix. Re-run `source .venv/bin/activate` in
> every new terminal tab (TabPy and the deploy step each need it).

Then connect Tableau Desktop: **Help → Settings and Performance → Manage Analytics
Extension Connection → TabPy**, host `localhost`, port `9004`. The calc-field wiring
(forecast + significance) is in `docs/Crime_Stats_Suite_Plan.md`, Section 3.

For the work server (on-prem), `docs/Crime_Stats_Suite_Plan.md` Section 4 covers TabPy
hardening, the TSM/site analytics-extension connection, and extension allowlisting.

---

## Things that trip people up

- **Endless loading screen** = the `tableau.extensions.1.latest.js` library isn't being
  served (404). The serve command above downloads it next to the HTML; check the server log.
- **Slow load (minutes)** = the date field is at full-timestamp granularity. Use a
  **day-level** `DATE(...)` and a window filter.
- **No Configure menu** = the gear button on the chart is the reliable way in; the manifest
  also now declares `<context-menu>` for Tableau's native Configure.
- **Significance p≈0 on citywide totals** = high-volume counts are overdispersed; run the
  significance tests at offense-type/beat level, or apply the φ / Negative-Binomial
  adjustment (see the plan and `FUTURE_DIRECTIONS.md`).

---

## Data

Seattle Open Data (Socrata). The eight major SPD datasets, their IDs, date fields, and
ready-made filtered URLs are in `docs/Seattle_SPD_Socrata_Filtering_Guide.md`.
