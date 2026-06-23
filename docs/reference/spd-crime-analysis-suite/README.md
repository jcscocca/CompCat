# SPD Crime Analysis Suite Reference Extract

This folder preserves useful documents from:

`/Users/jscocca/Downloads/SPD Crime Analysis Suite`

The original folder contained Tableau extension files, TabPy runtime files, a Python
virtual environment, logs, pycache, and documentation. Only durable reference documents
were extracted into this repo. Runtime artifacts were intentionally left out.

## Extracted Documents

| File | Why it matters |
|---|---|
| `source-docs/README.md` | Overview of the Tableau extension and TabPy statistical suite. Useful for future Tableau integration planning. |
| `source-docs/Methods_and_References.md` | Strongest reusable artifact. Captures criminology/statistical methods, cautions against raw percent change, and documents Poisson, Negative-Binomial, EWMA, Holt-Winters, SPC, and related methods. |
| `source-docs/Seattle_SPD_Socrata_Filtering_Guide.md` | Directly useful for live Seattle SPD ingestion. Includes Socrata OData/SODA filtering gotchas, dataset IDs, date fields, and counting caveats. |
| `source-docs/Crime_Stats_Suite_Plan.md` | Useful later for Tableau/TabPy architecture, especially if embedded Tableau becomes a statistical dashboard layer. |
| `source-docs/FUTURE_DIRECTIONS.md` | Roadmap ideas for time-series uncertainty bands, incomplete-period handling, exports, and Tableau hardening. |
| `source-docs/TabPy_Home_Testing_Guide.md` | Useful only if/when TabPy is revived. Keep as operational reference, not as v1 public-product dependency. |

## Verification Performed Before Extraction

The original analysis code was tested before these documents were retained:

```bash
cd "/Users/jscocca/Downloads/SPD Crime Analysis Suite/extension"
node stats_tests.js
# 26 passed, 0 failed

cd "/Users/jscocca/Downloads/SPD Crime Analysis Suite/tabpy"
./.venv/bin/python tabpy_crime_stats.py
# ALL FORECAST + SIGNIFICANCE + TABLEAU-ENDPOINT CHECKS PASSED
```

## How This Should Influence This Product

Use now:

- Prefer count-data framing over raw percent-change language.
- Use the Socrata filtering guide for Seattle SPD ingestion work.
- Preserve dataset-specific cautions, especially placeholder dates, denormalized rows, and
  correct counting keys.
- Keep public dashboard language grounded in reported incident context, not safety labels.

Use soon:

- Add time-series context cards for places and routes:
  - current period count
  - prior comparable period count
  - same-season historical baseline
  - expected interval
  - clear caveat when counts are low or periods are incomplete

Use later:

- Port pure statistical functions into this FastAPI backend if forecasting or formal
  anomaly tests become product requirements.
- Use Tableau/TabPy material for a future embedded Tableau or analyst-facing workbook,
  not for the first public self-service app.

Avoid for v1:

- Do not require TabPy for the public app.
- Do not ship formal p-values or forecasting in the first self-service release.
- Do not label neighborhoods, places, or routes as safe/unsafe.
- Do not import the Tableau extension wholesale into the React app.

## Runtime Artifacts Intentionally Not Extracted

- `tabpy/.venv/`
- `tabpy/tabpy_log.log`
- `tabpy/__pycache__/`
- `extension/tableau.extensions.1.latest.js`
- `extension/timeseries_extension.html`
- `extension/timeseries_extension.trex`
- `extension/stats_tests.js`
- `extension/start-server.command`
- `tabpy/deploy_tabpy.py`
- `tabpy/tabpy_crime_stats.py`

Those files are useful as source material, but the public self-service product should
integrate the ideas through its own backend and frontend architecture.
