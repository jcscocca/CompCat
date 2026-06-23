# Testing the Crime-Stats Functions with TabPy at Home (macOS)

A self-contained way to run and test `tabpy_crime_stats.py` on your own Mac, before
touching the on-prem server at work. Five steps, increasing in scope.

Files used: `tabpy_crime_stats.py` (the functions) and `deploy_tabpy.py` (the deployer).
Keep them both in the same folder; `cd` there for every command below.

---

## Step 0 — Check the math works (no TabPy, no Tableau)

The module has a built-in self-test. This is the fastest confidence check:

```bash
python3 -m venv .venv            # one-time: create an isolated environment
source .venv/bin/activate        # activate it — prompt now shows "(.venv)"
pip install --upgrade pip
pip install numpy scipy statsmodels pandas tabpy
python3 tabpy_crime_stats.py
```

> **macOS:** a bare `pip3 install ...` fails with `externally-managed-environment`
> (PEP 668) on Homebrew/system Python. The virtual environment above is the fix and is the
> standard way to run TabPy. **Re-run `source .venv/bin/activate` in every new Terminal
> tab** — TabPy and the deploy step each need the venv active. (We install `tabpy` here too,
> so Step 1 is ready.)

You should see a 6-month forecast with prediction intervals, the significance tests, and
`ALL FORECAST + SIGNIFICANCE + TABLEAU-ENDPOINT CHECKS PASSED`. If that prints, the
statistics are good in your Python environment.

---

## Step 1 — Start TabPy locally

With the venv active (`tabpy` was installed in Step 0), start it **with this folder on the
import path** so the server can load the deployed functions:

```bash
PYTHONPATH="$PWD" tabpy
```

> Why `PYTHONPATH="$PWD"`: TabPy stores deployed functions by *reference*, so the server
> process must be able to `import tabpy_crime_stats`. A bare `tabpy` started from elsewhere
> fails at deploy time with `No module named 'tabpy_crime_stats'`. (On the work server,
> put the module on the server's `PYTHONPATH` the same way.)

That starts the server at `http://localhost:9004`. Leave it running in this Terminal
window. Quick check (new Terminal tab — remember to `source .venv/bin/activate` there too):

```bash
curl http://localhost:9004/info
```

You should get a JSON blob describing the server. (If `tabpy` isn't found, it installed to
a scripts dir not on your PATH — run `python3 -m tabpy` instead.)

---

## Step 2 — Deploy the endpoints

In a second Terminal tab, from the folder with both `.py` files (activate the venv first):

```bash
source .venv/bin/activate
python3 deploy_tabpy.py
```

It deploys the four Tableau-facing endpoints and runs smoke tests, ending with
`Deployment OK`. Re-run this any time you edit the functions — your Tableau calc fields
won't need to change.

---

## Step 3 — Test an endpoint the way Tableau will call it

Tableau's `SCRIPT_REAL` sends a POST to TabPy's `/evaluate` with `_arg1`, `_arg2`… as
columns. You can replicate that exact call with curl:

```bash
curl -s -X POST http://localhost:9004/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "data": { "_arg1": [10, 25, 5], "_arg2": [8, 8, 8] },
    "script": "return tabpy.query(\"tableau_anomaly_pvalue\", _arg1, _arg2)[\"response\"]"
  }'
```

You'll get back a list of p-values, one per element — proving the column-in/column-out
contract works. Swap in `tableau_forecast_bands` to test the forecast similarly.

---

## Step 4 — Connect Tableau Desktop and round-trip a calc

1. In Tableau Desktop: **Help → Settings and Performance → Manage Analytics Extension
   Connection**.
2. Choose **TabPy / External API**, host `localhost`, port `9004`, SSL off, no sign-in
   (local only). Click **Test Connection** → it should succeed.
3. Open any worksheet, create a calculated field, and paste a minimal round-trip test:

   ```
   SCRIPT_REAL("return [x*2 for x in _arg1]", SUM([Number of Records]))
   ```

   Put it on a shelf with a date to form a partition; if it returns doubled values, the
   Desktop↔TabPy link is live. Then switch it to a real endpoint:

   ```
   SCRIPT_REAL("
   return tabpy.query('tableau_anomaly_pvalue', _arg1, _arg2)['response']
   ", SUM([Count]), SUM([Baseline Expected]))
   ```

   (This is a **table calculation** — set *Compute Using* along your date axis.)

---

## Moving to the work server

Everything above is identical on-prem, with three differences:

- TabPy runs on a dedicated host with **auth + TLS** (`https://`, a username/password),
  not bare `localhost`.
- An admin registers that TabPy connection in **TSM / site settings** (Analytics
  Extensions) so published workbooks can use it — not just your Desktop.
- `tabpy_crime_stats.py` must be importable by the server process (same folder you launch
  TabPy from, or on its `PYTHONPATH`), because `deploy_tabpy.py` pickles the functions by
  reference.

---

## Troubleshooting

- **`tabpy` won't start with an OpenSSL/`X509` error** — your Python has a stale
  `pyOpenSSL`/`cryptography` mismatch. Fix with
  `pip3 install --upgrade pyopenssl cryptography`, then start TabPy again.
- **Test Connection fails in Desktop** — confirm `curl http://localhost:9004/info`
  responds, and that host/port match exactly (no `https` for the local server).
- **Calc returns an error about lengths** — `SCRIPT_*` must get a vector and return a
  vector of the same length; these endpoints already do, so check that the field is a
  table calc with the right *Compute Using*.
- **Forecast rows are blank** — you need scaffolded future date rows with an `Is Future`
  flag (see the suite plan, Section 3b); the forecast lands in those rows.
