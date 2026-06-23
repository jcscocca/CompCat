# Filtering Seattle Open Data (Socrata) — Field Guide

How to build filtered data-source URLs for **data.seattle.gov** (a Socrata site), for
Tableau or any tool. Covers OData v4 and the SODA API, filtering by data type, date-range
recipes, and a verified table of the major SPD data sources.

_Verified 2026-06-18 against the live portal._

---

## TL;DR — the one gotcha that causes `400 Bad Request`

Socrata date columns are **"floating timestamps"** (an instant with **no timezone**).
The OData v4 protocol dropped the no-timezone datetime type, so Socrata exposes these
columns as **plain text (`Edm.String`)**. That means in OData you must compare them to a
**quoted ISO-8601 string** — not a bare datetime, and **never with a `Z`**:

```
✅  offense_date ge '2023-06-18T00:00:00.000'      (quoted string — works)
❌  offense_date ge 2023-06-18T00:00:00Z            (datetime literal — 400 Bad Request)
```

It works because fixed-width ISO-8601 strings sort in chronological order, so a string
`ge '2023-06-18...'` returns everything on or after that instant.

---

## 1. The two endpoints

Every dataset has a 4-by-4 ID (e.g. `tazs-3rd5`). Two ways to query it:

| | URL pattern | Notes |
|---|---|---|
| **OData v4** | `https://data.seattle.gov/api/odata/v4/{id}` | Tableau "OData" connector. **Do not append `$format=json`** — Tableau negotiates format via headers and the explicit param can break it. |
| **SODA (JSON)** | `https://data.seattle.gov/resource/{id}.json` | Plain REST/JSON. What Tableau's dedicated **Socrata** connector uses under the hood. Often easier for big/filtered pulls. |

---

## 2. OData v4 `$filter` — by data type

Operators: `eq ne gt ge lt le` · combine with `and or not` · group with `( )`.

| Socrata type | OData type | Write the value as | Example |
|---|---|---|---|
| Text / Multiple choice | `Edm.String` | quoted `'...'` | `precinct eq 'West'` |
| **Floating timestamp (dates)** | **`Edm.String`** | **quoted ISO string** | `offense_date ge '2023-06-18T00:00:00.000'` |
| Number / Money / Percent | `Edm.Decimal` | bare number | `count_of_officers gt 1` |
| Checkbox | `Edm.Boolean` | `true` / `false` | `is_flagged eq true` |
| Fixed timestamp (with TZ) | `Edm.DateTimeOffset` | bare literal + `Z` | `ts ge 2023-06-18T00:00:00Z` *(rare on SPD data)* |

String helper functions (handy for text columns):

```
contains(offense_category,'PROPERTY')
startswith(beat,'K')
endswith(report_number,'2024')
tolower(precinct) eq 'west'
```

To include a literal apostrophe in a string, double it: `'O''Brien'`.

---

## 3. Date-range recipes (OData — quoted strings)

```
# Rolling last 3 years (update the date over time)
$filter=offense_date ge '2023-06-18T00:00:00.000'

# Since the start of a calendar year
$filter=offense_date ge '2024-01-01T00:00:00.000'

# A closed range  [start, end)
$filter=offense_date ge '2024-01-01T00:00:00.000' and offense_date lt '2025-01-01T00:00:00.000'

# Last 3 years AND drop junk placeholder dates (Crime/OPA have 1900-01-01 rows)
$filter=offense_date ge '2023-06-18T00:00:00.000' and offense_category ne 'ALL OTHER'
```

There is **no reliable `now()`** on Socrata's OData v4, so the cutoff date is literal —
edit it when you want the window to roll forward.

---

## 4. Selecting, sorting, limiting

```
$select=offense_date,offense_category,precinct     # only these columns
$orderby=offense_date desc                         # newest first
$top=1000                                          # first N rows
$skip=1000                                         # paging
```

Combine everything with `&`, e.g.:

```
https://data.seattle.gov/api/odata/v4/tazs-3rd5?$filter=offense_date ge '2023-06-18T00:00:00.000'&$orderby=offense_date desc
```

**URL-encoding:** spaces → `%20`, single quote → `%27`. Colons and commas can usually
stay literal. If you paste a readable URL into Tableau it will encode it for you; if you
build it by hand, the encoded date literal looks like `%272023-06-18T00:00:00.000%27`.

---

## 5. SODA alternative (`$where`) — often simpler

SODA treats dates as real datetimes; the **column is unquoted**, the **literal is quoted**,
and the syntax is SQL-like:

```
# Last 3 years
https://data.seattle.gov/resource/tazs-3rd5.json?$where=offense_date >= '2023-06-18T00:00:00'

# Range + another condition
...?$where=offense_date >= '2024-01-01' AND offense_date < '2025-01-01' AND precinct = 'West'

# Operators: = != < > <= >= , between ... and ... , IS NULL , IS NOT NULL , AND , OR
...?$where=offense_date between '2024-01-01' and '2024-12-31'
```

SODA also aggregates server-side (great for keeping extracts small):

```
# Monthly counts
...?$select=date_trunc_ym(offense_date) as month, count(*) as n&$group=month&$order=month

# date_trunc_ymd = daily, date_trunc_y = yearly
```

---

## 6. Tableau notes

- **OData connector:** paste the readable OData URL (with the quoted-string `$filter`),
  no `$format=json`.
- **Socrata connector:** uses SODA; usually more robust for large or heavily filtered pulls.
- These datasets are large (Crime ~1.5M rows, Calls ~7M+). Filter to a window and/or
  pre-aggregate (SODA `date_trunc_*`) so extracts stay fast. For the time-series viz
  extension, a day-level `DATE([offense_date])` on Columns plus a window filter is plenty.

---

## 7. Major SPD data sources (verified)

All are SPD-owned, public-domain, and update daily unless noted. Every primary date field
below is a floating timestamp → **filter with a quoted ISO string** in OData. "Rows since
2023-06-18" confirms each is live with recent data.

| Dataset | 4×4 ID | Primary date field | Latest record | Rows since 2023-06-18 |
|---|---|---|---|---|
| Crime Data: 2008–Present | `tazs-3rd5` | `offense_date` | 2026-06-17 | 239,480 |
| Call Data (Calls for Service) | `33kz-ixgy` | `cad_event_original_time_queued` | 2026-06-15 | 1,719,230 |
| Terry Stops | `28ny-9ts8` | `occurred_date` | 2026-06-17 | 11,609 |
| Use of Force | `ppi5-g2bj` | `occured_date_time` *(sic — misspelled)* | 2026-06-12 | 3,144 |
| Crisis Data | `i2q9-thny` | `occured_date_time` *(sic)* | 2026-06-17 | 25,179 |
| Arrest Data | `9bjs-7a7w` | `arrest_occurred_date_time` | 2026-06-17 | 57,912 |
| OPA Complaints | `hyay-5x7b` | `received_date` | 2026-06-16 | 7,128 |
| Officer-Involved Shootings | `mg5r-efcm` | `date_time` ⚠️ **TEXT, not a date** | ~2025 | n/a |

### Ready-made "last 3 years" OData URLs

```
https://data.seattle.gov/api/odata/v4/tazs-3rd5?$filter=offense_date ge '2023-06-18T00:00:00.000'
https://data.seattle.gov/api/odata/v4/33kz-ixgy?$filter=cad_event_original_time_queued ge '2023-06-18T00:00:00.000'
https://data.seattle.gov/api/odata/v4/28ny-9ts8?$filter=occurred_date ge '2023-06-18T00:00:00.000'
https://data.seattle.gov/api/odata/v4/ppi5-g2bj?$filter=occured_date_time ge '2023-06-18T00:00:00.000'
https://data.seattle.gov/api/odata/v4/i2q9-thny?$filter=occured_date_time ge '2023-06-18T00:00:00.000'
https://data.seattle.gov/api/odata/v4/9bjs-7a7w?$filter=arrest_occurred_date_time ge '2023-06-18T00:00:00.000'
https://data.seattle.gov/api/odata/v4/hyay-5x7b?$filter=received_date ge '2023-06-18T00:00:00.000'
```

### Per-dataset cautions

- **Crime (`tazs-3rd5`)** — one row per offense (a report can have several). `offense_date`
  = when it happened; `report_date_time` = when reported. Has `1900-01-01` placeholder dates
  for unknowns — exclude them for clean early-period counts.
- **Call Data (`33kz-ixgy`)** — one row per CAD event / dispatched call sign; highest volume.
  Many secondary timestamps: `cad_event_arrived_time`, `call_sign_dispatch_time`,
  `call_sign_at_scene_time`, `call_sign_in_service_time`, plus CARE/SPD/co-response times.
- **Terry Stops (`28ny-9ts8`)** — one row per stop; `reported_date` is the RMS filing date.
  (Subject demographic data was flagged temporarily unavailable due to a known bug.)
- **Use of Force (`ppi5-g2bj`)** — reportable force, Levels 1–3 + OIS. Note the **misspelled**
  field `occured_date_time` (one "r"); only one date column.
- **Crisis Data (`i2q9-thny`)** — denormalized one-to-many on disposition; **count `template_id`,
  not rows.** Same misspelled `occured_date_time`; `reported_date` is secondary.
- **Arrest Data (`9bjs-7a7w`)** — counts of arrest *reports* (12 types), distinct from physical
  custody events. `arrest_occurred_date_time` (when) vs `arrest_reported_date_time` (filed).
- **OPA Complaints (`hyay-5x7b`)** — denormalized one row per complaint-allegation-employee;
  **use caution counting.** Use `received_date` — `occurred_date` and `investigation_begin_date`
  are placeholder-heavy (`1900-01-01`).
- **Officer-Involved Shootings (`mg5r-efcm`)** ⚠️ — `date_time` is **free-form text**, not a date
  column, so it can't be filtered/sorted as a date. Small (~193 rows), updates ~twice a year.
  For OIS over time, parse the text client-side or use the Level-3-OIS records inside Use of
  Force (`ppi5-g2bj`), which have a proper `occured_date_time`.

---

## 8. Quick cheat sheet

```
OData date filter (Socrata):   field ge 'YYYY-MM-DDTHH:MM:SS.000'     (quoted, no Z)
OData ops:                     eq ne gt ge lt le | and or not | contains() startswith()
SODA date filter:              $where=field >= 'YYYY-MM-DDTHH:MM:SS'  (SQL-like)
SODA ops:                      = != < > <= >= between..and.. IS NULL AND OR
Trim columns:                  $select=a,b,c
Sort / limit:                  $orderby=field desc | $top=N | $skip=N
Aggregate (SODA):              $select=date_trunc_ym(field) as m,count(*) as n&$group=m
Encode:                        space=%20  quote=%27
Tableau OData:                 omit $format=json
```
