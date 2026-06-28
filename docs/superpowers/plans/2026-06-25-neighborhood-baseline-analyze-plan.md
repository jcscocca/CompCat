# Neighborhood-Relative Analyze Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score each selected place against its own SPD police beat (2018-present) as an exposure-adjusted incident rate, surface the existing statistical engine (ratio, CI, significance, dispersion), rebuild the Analyze tab around one verdict block per place, and add an always-accessible Methods appendix.

**Architecture:** A new pure stats module (`app/analysis/beat_baselines.py`) and a new orchestration service (`app/services/neighborhood_service.py`) compute results **on demand** via a new `POST /dashboard/neighborhood` route. This path imports existing query/stat helpers read-only and **never reads or writes `place_crime_summaries`**, so it is decoupled from the existing analyze path and from roadmap Workstream 2 (provenance) and 4 (query perf). The frontend fetches after Run, renders verdict blocks, and opens a shared `MethodsAppendix` (reusing `BottomSheet` styling) from one definition source used by Analyze and Compare.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, React, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-25-analyze-neighborhood-baseline-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/analysis/beat_baselines.py` (new) | Pure: load `beat → area_km²`, coverage check, place↔beat decision logic. No DB. |
| `app/data/seattle_police_beats_2018_area.csv` (new) | Static beat areas (generated offline). |
| `scripts/generate_beat_areas.py` (new) | One-off generator: fetch 2018 beat polygons, geodesic area, write the CSV. |
| `app/services/neighborhood_service.py` (new) | DB orchestration: beat assignment, counts, exposures, calls stats, BH, pairwise. |
| `app/crime/seattle_socrata.py` (modify) | Floor ingestion `start_date` at 2018-01-01. |
| `app/api/routes_public_dashboard.py` (modify) | Add `POST /dashboard/neighborhood` + response schemas. |
| `frontend/src/types.ts` (modify) | `NeighborhoodAnalysis*` types. |
| `frontend/src/api/client.ts` (modify) | `getNeighborhoodAnalysis()`. |
| `frontend/src/lib/methodsDefinitions.ts` (new) | Single source of measure definitions. |
| `frontend/src/components/MethodsAppendix.tsx` (new) | Glossary sheet + inline ⓘ + Methods button. |
| `frontend/src/components/AnalyzeTab.tsx` (rewrite result area) | Verdict blocks; remove bar charts + per-visit/dwell. |
| `frontend/src/components/MapWorkspace.tsx` (modify) | Fetch neighborhood after Run; invalidate; pass down. |
| `frontend/src/lib/analysisDefaults.ts` (modify) | Floor analysis window start at 2018-01-01. |

**Deviation from roadmap WS3 file list (intentional):** the orchestration lives in a **new** `neighborhood_service.py`, not in `dashboard_analysis_service.py`, to keep it collision-free with WS2/WS4. We import existing helpers from `dashboard_analysis_service` read-only.

---

## Task 1: Beat-area reference data + loader

**Files:**
- Create: `app/analysis/beat_baselines.py`
- Create: `tests/test_beat_baselines.py`
- Create: `scripts/generate_beat_areas.py`
- Create: `app/data/seattle_police_beats_2018_area.csv`

- [ ] **Step 1: Write the failing loader test**

```python
# tests/test_beat_baselines.py
import pytest

from app.analysis.beat_baselines import load_beat_areas, missing_beat_areas


def _write_csv(tmp_path, rows):
    path = tmp_path / "areas.csv"
    path.write_text("beat,area_km2\n" + "".join(f"{b},{a}\n" for b, a in rows), encoding="utf-8")
    return path


def test_load_beat_areas_returns_positive_floats(tmp_path):
    path = _write_csv(tmp_path, [("K3", "3.10"), ("Q3", "2.04")])
    areas = load_beat_areas(path)
    assert areas == {"K3": 3.10, "Q3": 2.04}


def test_load_beat_areas_rejects_nonpositive(tmp_path):
    path = _write_csv(tmp_path, [("K3", "0")])
    with pytest.raises(ValueError):
        load_beat_areas(path)


def test_missing_beat_areas_reports_uncovered():
    areas = {"K3": 3.1}
    assert missing_beat_areas(["K3", "Q3", None, "Q3"], areas) == {"Q3"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_beat_baselines.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.analysis.beat_baselines'`.

- [ ] **Step 3: Implement the loader**

```python
# app/analysis/beat_baselines.py
from __future__ import annotations

import csv
from collections.abc import Iterable
from math import isfinite
from pathlib import Path

DEFAULT_AREA_CSV = Path(__file__).resolve().parent.parent / "data" / "seattle_police_beats_2018_area.csv"


def load_beat_areas(path: Path | None = None) -> dict[str, float]:
    source = path or DEFAULT_AREA_CSV
    areas: dict[str, float] = {}
    with Path(source).open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            beat = (row.get("beat") or "").strip()
            if not beat:
                continue
            area = float(row["area_km2"])
            if not isfinite(area) or area <= 0:
                raise ValueError(f"Beat {beat} has non-positive area {area}.")
            areas[beat] = area
    return areas


def missing_beat_areas(incident_beats: Iterable[str | None], area_lookup: dict[str, float]) -> set[str]:
    return {beat for beat in incident_beats if beat and beat not in area_lookup}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_beat_baselines.py -q`
Expected: PASS.

- [ ] **Step 5: Add the offline generator script**

```python
# scripts/generate_beat_areas.py
"""Generate app/data/seattle_police_beats_2018_area.csv from the published SPD
2018-present beat polygons. Geodesic area (spherical excess), no GIS deps.

    .venv/bin/python scripts/generate_beat_areas.py --out app/data/seattle_police_beats_2018_area.csv
"""
from __future__ import annotations

import argparse
import csv
import json
from math import radians, sin
from urllib.request import urlopen

EARTH_RADIUS_M = 6_371_008.8
# ArcGIS FeatureServer for "Seattle Police Beats 2018-Present"; outFields=beat, GeoJSON, WGS84.
DEFAULT_URL = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/"
    "Seattle_Police_Beats_2018Present/FeatureServer/0/query"
    "?where=1%3D1&outFields=beat&outSR=4326&f=geojson"
)


def ring_area_m2(ring: list[list[float]]) -> float:
    total = 0.0
    n = len(ring)
    for i in range(n):
        lon1, lat1 = ring[i][0], ring[i][1]
        lon2, lat2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        total += radians(lon2 - lon1) * (2 + sin(radians(lat1)) + sin(radians(lat2)))
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)


def polygon_area_km2(coords: list) -> float:
    # coords = list of rings; first is outer, rest are holes.
    if not coords:
        return 0.0
    outer = ring_area_m2(coords[0])
    holes = sum(ring_area_m2(r) for r in coords[1:])
    return max(0.0, outer - holes) / 1_000_000.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--out", default="app/data/seattle_police_beats_2018_area.csv")
    args = parser.parse_args()

    with urlopen(args.url, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))

    areas: dict[str, float] = {}
    for feature in data.get("features", []):
        beat = (feature.get("properties", {}).get("beat") or "").strip()
        geom = feature.get("geometry") or {}
        if not beat or geom.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        areas[beat] = areas.get(beat, 0.0) + sum(polygon_area_km2(p) for p in polys)

    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["beat", "area_km2"])
        for beat in sorted(areas):
            writer.writerow([beat, round(areas[beat], 4)])
    print(f"wrote {len(areas)} beats to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Generate the CSV and verify coverage against the dev DB**

Run:
```bash
SSL_CERT_FILE=$(.venv/bin/python -c "import certifi;print(certifi.where())") \
  .venv/bin/python scripts/generate_beat_areas.py --out app/data/seattle_police_beats_2018_area.csv
.venv/bin/python - <<'PY'
import sqlite3
from app.analysis.beat_baselines import load_beat_areas, missing_beat_areas
con = sqlite3.connect("dev-output/mobility.sqlite3")
db_beats = [r[0] for r in con.execute("SELECT DISTINCT beat FROM crime_incidents WHERE beat IS NOT NULL AND beat<>''")]
missing = missing_beat_areas(db_beats, load_beat_areas())
print("missing beat areas:", sorted(missing))
PY
```
Expected: `missing beat areas: []`. If non-empty, the `beat` field name or URL in the generator needs adjusting (the dataset may label it `beat` or `first_prec`/`beat_`); fix the generator's `outFields`/property key, re-run, and re-check before proceeding. **Do not hand-edit area numbers.**

- [ ] **Step 7: Commit**

```bash
git add app/analysis/beat_baselines.py tests/test_beat_baselines.py scripts/generate_beat_areas.py app/data/seattle_police_beats_2018_area.csv
git commit -m "feat: add SPD beat-area reference and loader"
```

---

## Task 2: Floor crime ingestion at 2018-01-01

**Files:**
- Modify: `app/crime/seattle_socrata.py`
- Test: `tests/test_seattle_socrata_floor.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_seattle_socrata_floor.py
from datetime import date

from app.crime.seattle_socrata import CRIME_DATA_FLOOR, floor_start_date


def test_floor_lifts_pre_2018_dates():
    assert floor_start_date(date(2015, 5, 1)) == CRIME_DATA_FLOOR


def test_floor_keeps_dates_on_or_after_2018():
    assert floor_start_date(date(2020, 3, 4)) == date(2020, 3, 4)


def test_floor_defaults_none_to_floor():
    assert floor_start_date(None) == CRIME_DATA_FLOOR
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_seattle_socrata_floor.py -q`
Expected: FAIL with `ImportError: cannot import name 'floor_start_date'`.

- [ ] **Step 3: Implement the floor and apply it in `fetch_page`**

In `app/crime/seattle_socrata.py`, add near the top:

```python
from datetime import date

CRIME_DATA_FLOOR = date(2018, 1, 1)


def floor_start_date(start_date: date | None) -> date:
    if start_date is None or start_date < CRIME_DATA_FLOOR:
        return CRIME_DATA_FLOOR
    return start_date
```

In `SeattleSocrataClient.fetch_page`, replace the first body line so the window always starts at or after the floor:

```python
    def fetch_page(self, limit=5000, offset=0, start_date=None, end_date=None):
        start_date = floor_start_date(start_date)
        query_params = {"$limit": limit, "$offset": offset}
        query_params["$order"] = "offense_date DESC"
        query_params["$where"] = _date_window_where(start_date, end_date)
        # ...unchanged below...
```

(Since `start_date` is now always set, the `$order`/`$where` are always applied.)

- [ ] **Step 4: Run it to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_seattle_socrata_floor.py -q`
Expected: PASS.

- [ ] **Step 5: Run the existing ingestion tests for regressions**

Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py -q`
Expected: PASS (or update any test that asserted no `$where` when `start_date` was omitted — the window is now always present).

- [ ] **Step 6: Commit**

```bash
git add app/crime/seattle_socrata.py tests/test_seattle_socrata_floor.py
git commit -m "feat: floor crime ingestion window at 2018-01-01"
```

---

## Task 3: Pure place-vs-beat statistics

**Files:**
- Modify: `app/analysis/beat_baselines.py`
- Modify: `tests/test_beat_baselines.py`

- [ ] **Step 1: Write the failing tests**

```python
# add to tests/test_beat_baselines.py
from app.analysis.beat_baselines import neighborhood_decision, place_vs_beat


def test_decision_above_when_significant_and_high_ratio():
    assert neighborhood_decision(rate_ratio=4.0, adjusted_p_value=0.002,
                                 minimum_data_met=True, model_warning=False) == "above_clear"


def test_decision_below_when_significant_and_low_ratio():
    assert neighborhood_decision(rate_ratio=0.5, adjusted_p_value=0.01,
                                 minimum_data_met=True, model_warning=False) == "below_clear"


def test_decision_not_clear_when_insignificant():
    assert neighborhood_decision(rate_ratio=4.0, adjusted_p_value=0.20,
                                 minimum_data_met=True, model_warning=False) == "not_clear"


def test_decision_insufficient_data_dominates():
    assert neighborhood_decision(rate_ratio=4.0, adjusted_p_value=0.001,
                                 minimum_data_met=False, model_warning=False) == "insufficient_data"


def test_place_vs_beat_reports_ratio_and_above():
    result = place_vs_beat(
        place_count=12, place_exposure=18.0,
        beat_count=60, beat_exposure=360.0,
        combined_monthly_counts=[6, 7, 5, 8, 6, 9, 7, 8, 6, 7, 8, 5],
        analysis_days=180,
    )
    assert round(result.rate_ratio, 1) == 4.0
    assert result.decision == "above_clear"
    assert result.ci_lower > 1.0
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_beat_baselines.py -q`
Expected: FAIL with `ImportError: cannot import name 'place_vs_beat'`.

- [ ] **Step 3: Implement the decision + stats wrapper**

```python
# add to app/analysis/beat_baselines.py
from dataclasses import dataclass

from app.analysis.rate_tests import (
    ALPHA,
    MAX_RATE_RATIO_FOR_RECOMMENDATION,
    MIN_ANALYSIS_DAYS,
    MIN_COMBINED_COUNT,
    compare_incident_rates,
    dispersion_status,
)

HIGH_RATE_RATIO = 1.0 / MAX_RATE_RATIO_FOR_RECOMMENDATION  # 1.25


def neighborhood_decision(*, rate_ratio, adjusted_p_value, minimum_data_met, model_warning) -> str:
    if not minimum_data_met:
        return "insufficient_data"
    if model_warning:
        return "model_warning"
    if adjusted_p_value < ALPHA and rate_ratio >= HIGH_RATE_RATIO:
        return "above_clear"
    if adjusted_p_value < ALPHA and rate_ratio <= MAX_RATE_RATIO_FOR_RECOMMENDATION:
        return "below_clear"
    return "not_clear"


@dataclass(frozen=True)
class PlaceVsBeat:
    place_rate: float
    beat_rate: float
    rate_ratio: float
    ci_lower: float
    ci_upper: float
    p_value: float
    adjusted_p_value: float
    method: str
    overdispersion_status: str
    minimum_data_status: str
    decision: str


def minimum_data_status(*, analysis_days, place_count, beat_count, place_exposure, beat_exposure) -> str:
    if analysis_days < MIN_ANALYSIS_DAYS:
        return "date_range_too_short"
    if place_exposure <= 0 or beat_exposure <= 0:
        return "non_positive_exposure"
    if place_count + beat_count < MIN_COMBINED_COUNT:
        return "combined_count_too_low"
    return "met"


def place_vs_beat(*, place_count, place_exposure, beat_count, beat_exposure,
                  combined_monthly_counts, analysis_days, adjusted_p_value=None) -> PlaceVsBeat:
    status = minimum_data_status(
        analysis_days=analysis_days, place_count=place_count, beat_count=beat_count,
        place_exposure=place_exposure, beat_exposure=beat_exposure,
    )
    dispersion = dispersion_status(combined_monthly_counts)
    test = compare_incident_rates(
        count_a=place_count, exposure_a=max(place_exposure, 1e-9),
        count_b=beat_count, exposure_b=max(beat_exposure, 1e-9),
        overdispersion_phi=dispersion.phi,
    )
    p_adjusted = test.p_value if adjusted_p_value is None else adjusted_p_value
    decision = neighborhood_decision(
        rate_ratio=test.rate_ratio, adjusted_p_value=p_adjusted,
        minimum_data_met=status == "met",
        model_warning=dispersion.status == "insufficient_periods",
    )
    return PlaceVsBeat(
        place_rate=test.rate_a, beat_rate=test.rate_b, rate_ratio=test.rate_ratio,
        ci_lower=test.ci_lower, ci_upper=test.ci_upper, p_value=test.p_value,
        adjusted_p_value=p_adjusted, method=test.method,
        overdispersion_status=test.overdispersion_status,
        minimum_data_status=status, decision=decision,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_beat_baselines.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/analysis/beat_baselines.py tests/test_beat_baselines.py
git commit -m "feat: add place-vs-beat statistics and decision"
```

---

## Task 4: Neighborhood orchestration service

**Files:**
- Create: `app/services/neighborhood_service.py`
- Create: `tests/test_neighborhood_service.py`

This service does the DB work: resolve each place's beat, count place-buffer and beat incidents under the active filters, build exposures, call `place_vs_beat`, Benjamini–Hochberg-adjust across the request, and (for ≥2 places) compute place-vs-place pairwise. It imports existing helpers read-only.

- [ ] **Step 1: Write the failing integration test**

Build on the existing `_client_with_places_and_crime`/session fixtures used in `tests/test_dashboard_analysis_api.py`. Seed at least one place whose buffer contains beat-tagged incidents, and a `beat → area` lookup covering those beats.

```python
# tests/test_neighborhood_service.py
from datetime import date

from app.services.neighborhood_service import neighborhood_analysis_for_places
from tests.helpers_dashboard import session_with_places_and_beat_crime  # see Step 3 note


def test_known_beat_returns_place_and_beat_rates(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id],
        radius_m=250, analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M2": 3.0},
    )
    place = result["places"][0]
    assert place["beat"] == "M2"
    assert place["baseline_available"] is True
    assert place["place_rate"] > 0 and place["beat_rate"] > 0


def test_unknown_beat_marks_baseline_unavailable(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id],
        radius_m=250, analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={},  # no area for the place's beat
    )
    assert result["places"][0]["baseline_available"] is False


def test_short_range_returns_insufficient_data(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id],
        radius_m=250, analysis_start_date=date(2026, 6, 1), analysis_end_date=date(2026, 6, 10),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M2": 3.0},
    )
    assert result["places"][0]["decision"] == "insufficient_data"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.neighborhood_service'` (and a missing test helper).

- [ ] **Step 3: Add the test helper, then implement the service**

Add `tests/helpers_dashboard.py` with `session_with_places_and_beat_crime(tmp_path)` that creates an in-memory/temp DB session (reuse the engine setup from existing dashboard tests), inserts one `PlaceCluster` with display coords, and several `CrimeIncident` rows inside 250 m carrying `beat="M2"`, dated within 2026-01..06, plus a handful of beat-`M2` incidents outside the buffer. Return `(session, user_id_hash, place_id)`. (Mirror the construction already used in `tests/test_dashboard_analysis_api.py`.)

```python
# app/services/neighborhood_service.py
from __future__ import annotations

from collections import Counter
from datetime import date
from math import pi
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import place_vs_beat
from app.analysis.rate_tests import benjamini_hochberg, compare_incident_rates
from app.models import CrimeIncident
from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.crime_service import _cluster_data, _incident_data
from app.services.dashboard_analysis_service import (
    _analysis_datetime_bounds,
    _filtered_incidents,
    _incident_bounding_boxes,
    _selected_clusters,
    _validate_date_range,
)

LOW_RATIO = 0.80


def _analysis_days(start: date, end: date) -> int:
    return (end - start).days + 1


def _place_exposure_km2_days(radius_m: int, days: int) -> float:
    return (pi * radius_m * radius_m / 1_000_000.0) * days


def _month_key(incident: CrimeIncidentData) -> tuple[int, int]:
    observed = incident.offense_start_utc or incident.report_utc
    return (observed.year, observed.month)


def _months(start: date, end: date) -> list[tuple[int, int]]:
    months, year, month = [], start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def _monthly_counts(incidents: list[CrimeIncidentData], start: date, end: date) -> list[int]:
    keys = [_month_key(i) for i in incidents]
    return [keys.count(m) for m in _months(start, end)]


def _incidents_in_radius(cluster: PlaceClusterData, incidents: list[CrimeIncidentData], radius_m: int):
    lat, lon = cluster.display_latitude, cluster.display_longitude
    out = []
    for incident in incidents:
        if incident.latitude is None or incident.longitude is None:
            continue
        if haversine_m(lat, lon, incident.latitude, incident.longitude) <= radius_m:
            out.append(incident)
    return out


def _assign_beat(session: Session, cluster: PlaceClusterData, radius_m: int) -> str | None:
    # Beat is fixed geography: assign from ALL incidents near the place, ignoring date/offense filters.
    box = _incident_bounding_boxes([cluster], radius_m)
    if not box:
        return None
    rows = session.scalars(select(CrimeIncident).where(or_(*box))).all()
    near = _incidents_in_radius(cluster, [_incident_data(r) for r in rows], radius_m)
    beats = Counter(i.beat for i in near if i.beat)
    return beats.most_common(1)[0][0] if beats else None


def _beat_incidents(session: Session, beat: str, start: date, end: date,
                    offense_category, offense_subcategory, nibrs_group) -> list[CrimeIncidentData]:
    start_at, end_at = _analysis_datetime_bounds(start, end)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.beat == beat)
        .where(observed >= start_at).where(observed <= end_at)
        .where(CrimeIncident.latitude.is_not(None))
    )
    if offense_category is not None:
        stmt = stmt.where(CrimeIncident.offense_category == offense_category)
    if offense_subcategory is not None:
        stmt = stmt.where(CrimeIncident.offense_subcategory == offense_subcategory)
    if nibrs_group is not None:
        stmt = stmt.where(CrimeIncident.nibrs_group == nibrs_group)
    return [_incident_data(r) for r in session.scalars(stmt).all()]


def _type_mix(incidents: list[CrimeIncidentData]) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    for incident in incidents:
        label = incident.offense_subcategory or incident.offense_category or "Uncategorized"
        counter[label] += 1
    return [{"label": label, "count": count} for label, count in counter.most_common(6)]


def neighborhood_analysis_for_places(*, session, user_id_hash, place_ids, radius_m,
                                     analysis_start_date, analysis_end_date,
                                     offense_category, offense_subcategory, nibrs_group,
                                     area_lookup) -> dict[str, Any]:
    _validate_date_range(analysis_start_date, analysis_end_date)
    days = _analysis_days(analysis_start_date, analysis_end_date)
    clusters = [_cluster_data(r) for r in _selected_clusters(session, user_id_hash, place_ids)]
    buffered = _filtered_incidents(
        session, clusters=clusters, radii_m=[radius_m],
        analysis_start_date=analysis_start_date, analysis_end_date=analysis_end_date,
        offense_category=offense_category, offense_subcategory=offense_subcategory, nibrs_group=nibrs_group,
    )

    # Pass 1: gather raw inputs per place (counts/exposures/p-values) so we can BH-adjust together.
    raw, p_values = [], []
    for cluster in clusters:
        if cluster.display_latitude is None or cluster.display_longitude is None:
            raw.append({"cluster": cluster, "beat": None})
            continue
        place_incidents = _incidents_in_radius(cluster, buffered, radius_m)
        beat = _assign_beat(session, cluster, radius_m)
        area = area_lookup.get(beat) if beat else None
        if beat is None or area is None:
            raw.append({"cluster": cluster, "beat": beat, "place_incidents": place_incidents})
            continue
        beat_incidents = _beat_incidents(
            session, beat, analysis_start_date, analysis_end_date,
            offense_category, offense_subcategory, nibrs_group,
        )
        place_exposure = _place_exposure_km2_days(radius_m, days)
        beat_exposure = area * days
        place_test = compare_incident_rates(
            count_a=len(place_incidents), exposure_a=max(place_exposure, 1e-9),
            count_b=len(beat_incidents), exposure_b=max(beat_exposure, 1e-9),
        )
        p_values.append(place_test.p_value)
        raw.append({
            "cluster": cluster, "beat": beat, "area": area,
            "place_incidents": place_incidents, "beat_incidents": beat_incidents,
            "place_exposure": place_exposure, "beat_exposure": beat_exposure,
        })

    adjusted = benjamini_hochberg(p_values) if p_values else []
    adjusted_iter = iter(adjusted)

    places = []
    for entry in raw:
        cluster = entry["cluster"]
        base = {
            "place_id": cluster.id, "place_label": cluster.display_label or "Selected place",
            "beat": entry.get("beat"), "radius_m": radius_m,
        }
        if entry.get("beat") is None or entry.get("area") is None:
            places.append({**base, "baseline_available": False, "decision": "baseline_unavailable",
                           "place_incident_count": len(entry.get("place_incidents", [])),
                           "type_mix": _type_mix(entry.get("place_incidents", []))})
            continue
        place_incidents, beat_incidents = entry["place_incidents"], entry["beat_incidents"]
        combined_monthly = [
            p + b for p, b in zip(
                _monthly_counts(place_incidents, analysis_start_date, analysis_end_date),
                _monthly_counts(beat_incidents, analysis_start_date, analysis_end_date),
                strict=True,
            )
        ]
        result = place_vs_beat(
            place_count=len(place_incidents), place_exposure=entry["place_exposure"],
            beat_count=len(beat_incidents), beat_exposure=entry["beat_exposure"],
            combined_monthly_counts=combined_monthly, analysis_days=days,
            adjusted_p_value=next(adjusted_iter),
        )
        nearest = min((haversine_m(cluster.display_latitude, cluster.display_longitude, i.latitude, i.longitude)
                       for i in place_incidents), default=None)
        places.append({
            **base, "baseline_available": True,
            "place_incident_count": len(place_incidents), "beat_incident_count": len(beat_incidents),
            "place_rate": result.place_rate, "beat_rate": result.beat_rate,
            "rate_ratio": result.rate_ratio, "ci_lower": result.ci_lower, "ci_upper": result.ci_upper,
            "adjusted_p_value": result.adjusted_p_value, "method": result.method,
            "overdispersion_status": result.overdispersion_status,
            "minimum_data_status": result.minimum_data_status, "decision": result.decision,
            "nearest_incident_m": nearest, "monthly_counts": _monthly_counts(place_incidents, analysis_start_date, analysis_end_date),
            "type_mix": _type_mix(place_incidents),
        })

    return {
        "radius_m": radius_m,
        "analysis_start_date": analysis_start_date.isoformat(),
        "analysis_end_date": analysis_end_date.isoformat(),
        "offense_category": offense_category,
        "places": places,
        "pairwise": _pairwise(clusters, buffered, radius_m, days),
    }


def _pairwise(clusters, buffered, radius_m, days):
    sized = [c for c in clusters if c.display_latitude is not None and c.display_longitude is not None]
    if len(sized) < 2:
        return []
    exposure = _place_exposure_km2_days(radius_m, days)
    counts = {c.id: len(_incidents_in_radius(c, buffered, radius_m)) for c in sized}
    pairs, p_values = [], []
    for i in range(len(sized)):
        for j in range(i + 1, len(sized)):
            a, b = sized[i], sized[j]
            test = compare_incident_rates(
                count_a=counts[a.id], exposure_a=max(exposure, 1e-9),
                count_b=counts[b.id], exposure_b=max(exposure, 1e-9),
            )
            p_values.append(test.p_value)
            pairs.append({"a_place_id": a.id, "a_label": a.display_label or "A",
                          "b_place_id": b.id, "b_label": b.display_label or "B",
                          "rate_ratio": test.rate_ratio, "ci_lower": test.ci_lower,
                          "ci_upper": test.ci_upper, "p_value": test.p_value})
    adjusted = benjamini_hochberg(p_values)
    for pair, adj in zip(pairs, adjusted, strict=True):
        pair["adjusted_p_value"] = adj
    return pairs
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/neighborhood_service.py tests/test_neighborhood_service.py tests/helpers_dashboard.py
git commit -m "feat: add neighborhood analysis service"
```

---

## Task 5: `/dashboard/neighborhood` endpoint

**Files:**
- Modify: `app/api/routes_public_dashboard.py`
- Test: `tests/test_dashboard_neighborhood_api.py` (new)

- [ ] **Step 1: Write the failing API test**

```python
# tests/test_dashboard_neighborhood_api.py
def test_neighborhood_endpoint_returns_place_block(neighborhood_client):  # fixture seeds places + beat crime + area csv
    client, place_id = neighborhood_client
    response = client.post("/dashboard/neighborhood", json={
        "place_ids": [place_id], "analysis_start_date": "2026-01-01",
        "analysis_end_date": "2026-06-30", "radii_m": [250], "offense_category": None,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["radius_m"] == 250
    assert body["places"][0]["place_id"] == place_id
    assert "decision" in body["places"][0]
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_dashboard_neighborhood_api.py -q`
Expected: FAIL with 404 for `/dashboard/neighborhood`.

- [ ] **Step 3: Add the route**

In `app/api/routes_public_dashboard.py`, reuse `DashboardAnalyzeRequest` (it already has place_ids, dates, radii_m, offense filters) and add:

```python
from functools import lru_cache
from app.analysis.beat_baselines import load_beat_areas
from app.services.neighborhood_service import neighborhood_analysis_for_places


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@router.post("/dashboard/neighborhood")
def dashboard_neighborhood(
    request: DashboardAnalyzeRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return neighborhood_analysis_for_places(
            session=session, user_id_hash=user_id_hash, place_ids=request.place_ids,
            radius_m=request.radii_m[0],
            analysis_start_date=request.analysis_start_date, analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category, offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group, area_lookup=_beat_areas(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_dashboard_neighborhood_api.py -q`
Expected: PASS.

- [ ] **Step 5: Run backend suite + commit**

```bash
.venv/bin/python -m pytest tests -q
git add app/api/routes_public_dashboard.py tests/test_dashboard_neighborhood_api.py
git commit -m "feat: add dashboard neighborhood endpoint"
```

---

## Task 6: Frontend types + client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add types**

```typescript
// frontend/src/types.ts (append)
export type NeighborhoodPlace = {
  place_id: string;
  place_label: string;
  beat: string | null;
  radius_m: number;
  baseline_available: boolean;
  decision: "above_clear" | "below_clear" | "not_clear" | "insufficient_data" | "model_warning" | "baseline_unavailable";
  place_incident_count: number;
  beat_incident_count?: number;
  place_rate?: number;
  beat_rate?: number;
  rate_ratio?: number;
  ci_lower?: number;
  ci_upper?: number;
  adjusted_p_value?: number;
  method?: string;
  overdispersion_status?: string;
  minimum_data_status?: string;
  nearest_incident_m?: number | null;
  monthly_counts?: number[];
  type_mix: { label: string; count: number }[];
};

export type NeighborhoodPair = {
  a_place_id: string; a_label: string; b_place_id: string; b_label: string;
  rate_ratio: number; ci_lower: number; ci_upper: number; adjusted_p_value: number;
};

export type NeighborhoodAnalysis = {
  radius_m: number;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category: string | null;
  places: NeighborhoodPlace[];
  pairwise: NeighborhoodPair[];
};
```

- [ ] **Step 2: Add the client call**

```typescript
// frontend/src/api/client.ts
import type { /* ...existing... */ NeighborhoodAnalysis } from "../types";

export function getNeighborhoodAnalysis(
  payload: AnalyzePlacesPayload,
): Promise<NeighborhoodAnalysis> {
  return request("/dashboard/neighborhood", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 3: Type-check + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

```bash
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat: add neighborhood analysis types and client"
```

---

## Task 7: Methods definitions + appendix component

**Files:**
- Create: `frontend/src/lib/methodsDefinitions.ts`
- Create: `frontend/src/components/MethodsAppendix.tsx`
- Test: `frontend/src/components/MethodsAppendix.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/MethodsAppendix.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MethodsAppendix } from "./MethodsAppendix";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

describe("MethodsAppendix", () => {
  it("opens from the Methods button and lists every definition", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    for (const def of METHODS_DEFINITIONS) {
      expect(screen.getByText(def.term)).toBeInTheDocument();
    }
  });

  it("every measure id is unique", () => {
    const ids = METHODS_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm test -- MethodsAppendix`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement definitions + component**

```typescript
// frontend/src/lib/methodsDefinitions.ts
export type MethodDefinition = {
  id: string;
  term: string;
  shownAs: string;
  plain: string;
  howToRead: string;
  formula?: string;
};

export const METHODS_DEFINITIONS: MethodDefinition[] = [
  { id: "reportedIncidentRate", term: "Exposure-adjusted rate", shownAs: "0.67 /km²·day",
    plain: "Incidents per square kilometer per day — counts divided by how much area and time you're viewing, so places of different sizes compare fairly.",
    howToRead: "A density of reports, not your personal odds.", formula: "rate = incidents ÷ (area_km² × days)" },
  { id: "beatBaselineRate", term: "Beat baseline", shownAs: "Beat M2",
    plain: "Your place's surrounding SPD police beat (2018-present), used as the 'normal for this area' reference. The same filters apply to the beat.",
    howToRead: "Only the count moves when you filter; the beat's area is fixed." },
  { id: "rateRatio", term: "Rate ratio", shownAs: "4.0×",
    plain: "How many times the place's density sits above or below its beat.",
    howToRead: "Above 1× = busier than the beat; below 1× = quieter." },
  { id: "confidenceInterval", term: "95% confidence interval", shownAs: "2.1–7.6×",
    plain: "The plausible range for the ratio given the sample size.",
    howToRead: "A range entirely above (or below) 1× is what makes a result 'clear.' Wider = less certain." },
  { id: "adjustedPValue", term: "Statistically clear", shownAs: "the verdict badge",
    plain: "Whether the difference is large and reliable enough to flag, after adjusting for testing several places at once (Benjamini–Hochberg).",
    howToRead: "Clear means adjusted p < 0.05 and the ratio is past 1.25× / 0.8×." },
  { id: "overdispersion", term: "Dispersion φ / quasi-Poisson", shownAs: "φ 1.4",
    plain: "Whether incidents cluster in time more than chance. If they do (φ > 1.2), we widen the math (quasi-Poisson).",
    howToRead: "Higher φ = burstier reports, wider intervals." },
  { id: "minimumDataStatus", term: "Data adequacy", shownAs: "insufficient data",
    plain: "We won't call a result unless there are at least 30 days and 10 combined incidents.",
    howToRead: "Below that, the verdict reads 'insufficient data' rather than guessing." },
  { id: "nearestIncident", term: "Nearest incident", shownAs: "42 m",
    plain: "Distance to the closest matching reported incident.",
    howToRead: "Proximity only — not severity." },
  { id: "monthlyTrend", term: "Monthly trend", shownAs: "the sparkline",
    plain: "Reported incidents per month across the selected range.",
    howToRead: "Shape over time, not a forecast." },
];
```

```tsx
// frontend/src/components/MethodsAppendix.tsx
import { useState } from "react";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

export function MethodsAppendix({ openId }: { openId?: string }) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="mc-methods">
      <button type="button" className="mc-methods-btn" onClick={() => setOpen(true)}>
        ⓘ Methods
      </button>
      {open ? (
        <div className="mc-methods-sheet" role="dialog" aria-label="Methods and definitions">
          <div className="mc-methods-head">
            <h5>Methods &amp; definitions</h5>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="mc-methods-body">
            {METHODS_DEFINITIONS.map((def) => (
              <div className="mc-method" id={`method-${def.id}`} key={def.id}
                   data-highlight={def.id === openId ? "true" : undefined}>
                <div className="mc-method-term">{def.term} <span>{def.shownAs}</span></div>
                <p>{def.plain}</p>
                <p className="mc-method-read">{def.howToRead}</p>
                {def.formula ? <code>{def.formula}</code> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm test -- MethodsAppendix`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/methodsDefinitions.ts frontend/src/components/MethodsAppendix.tsx frontend/src/components/MethodsAppendix.test.tsx
git commit -m "feat: add methods appendix and definitions"
```

---

## Task 8: Rebuild Analyze tab around verdict blocks

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx`
- Modify: `frontend/src/components/AnalyzeTab.test.tsx`

The tab keeps its current props (`selected, analysis, summary, availableRadii, running, incidentDetails, error, panelWidthPx, onChange, onRun`) and **adds** `neighborhood: NeighborhoodAnalysis | null`. The result area renders one verdict block per `neighborhood.places` entry; the two bar charts (`IncidentCharts`, `buildCrimeMixRows`, `buildOffenseRows`) and any per-visit/per-dwell display are removed. The filter controls (date/radius/category) move **above** the result blocks. `MethodsAppendix` mounts once and each measure gets a coverage-tested label.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/AnalyzeTab.test.tsx (add)
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

it("renders a verdict block and exposes every measure’s definition", () => {
  render(
    <AnalyzeTab
      selected={[home]} analysis={analysis} summary={analyzedSummary}
      availableRadii={[250]} running={false} incidentDetails={null} error=""
      panelWidthPx={360}
      neighborhood={{
        radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30",
        offense_category: null, pairwise: [],
        places: [{ place_id: "p1", place_label: "Home", beat: "M2", radius_m: 250,
          baseline_available: true, decision: "above_clear", place_incident_count: 12,
          beat_incident_count: 60, place_rate: 0.67, beat_rate: 0.17, rate_ratio: 4.0,
          ci_lower: 2.1, ci_upper: 7.6, adjusted_p_value: 0.002, method: "exact_conditional_poisson",
          overdispersion_status: "poisson_ok", minimum_data_status: "met",
          nearest_incident_m: 42, monthly_counts: [1,2,1,3,2,3], type_mix: [{ label: "ASSAULT", count: 7 }] }],
      }}
      onChange={vi.fn()} onRun={vi.fn()}
    />,
  );
  expect(screen.getByText(/above its beat/i)).toBeInTheDocument();
  expect(screen.getByText("4.0×")).toBeInTheDocument();
  // appendix coverage: every measure id has a definition entry
  const ids = new Set(METHODS_DEFINITIONS.map((d) => d.id));
  for (const id of ["reportedIncidentRate","beatBaselineRate","rateRatio","confidenceInterval","adjustedPValue","overdispersion","minimumDataStatus","nearestIncident","monthlyTrend"]) {
    expect(ids.has(id)).toBe(true);
  }
});

it("no longer renders the retired crime-mix chart", () => {
  render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary}
    availableRadii={[250]} running={false} incidentDetails={null} error="" panelWidthPx={360}
    neighborhood={null} onChange={vi.fn()} onRun={vi.fn()} />);
  expect(screen.queryByText("Crime mix")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm test -- AnalyzeTab`
Expected: FAIL (`neighborhood` not a prop; "Crime mix" still present).

- [ ] **Step 3: Implement the rebuild**

Replace `IncidentCharts`/`buildCrimeMixRows`/`buildOffenseRows`/`BarList` and the findings block with verdict blocks. Add the prop and a `VerdictBlock` renderer:

```tsx
import type { /* existing */ NeighborhoodAnalysis, NeighborhoodPlace } from "../types";
import { MethodsAppendix } from "./MethodsAppendix";

const DECISION_COPY: Record<NeighborhoodPlace["decision"], { label: string; tone: string }> = {
  above_clear: { label: "above its beat · statistically clear", tone: "hot" },
  below_clear: { label: "below its beat · statistically clear", tone: "ok" },
  not_clear: { label: "not statistically clear", tone: "muted" },
  insufficient_data: { label: "insufficient data", tone: "muted" },
  model_warning: { label: "needs analytical review", tone: "muted" },
  baseline_unavailable: { label: "neighborhood baseline unavailable", tone: "muted" },
};

function VerdictBlock({ place }: { place: NeighborhoodPlace }) {
  const copy = DECISION_COPY[place.decision];
  return (
    <section className={`mc-verdict tone-${copy.tone}`} aria-label={`Verdict for ${place.place_label}`}>
      <div className="mc-verdict-head">
        {place.rate_ratio != null ? <span className="mc-ratio">{place.rate_ratio.toFixed(1)}×</span> : null}
        <span className="mc-verdict-label">{copy.label}</span>
      </div>
      {place.baseline_available ? (
        <>
          <p className="mc-verdict-sub">
            {place.place_label} vs beat {place.beat}: {place.place_rate?.toFixed(2)} vs {place.beat_rate?.toFixed(2)} /km²·day
            {place.ci_lower != null ? ` · 95% CI ${place.ci_lower.toFixed(1)}–${place.ci_upper?.toFixed(1)}×` : null}
          </p>
          {place.monthly_counts?.length ? (
            <div className="mc-spark" aria-hidden="true">
              {place.monthly_counts.map((n, i) => (
                <span key={i} style={{ height: `${barHeight(n, place.monthly_counts!)}%` }} />
              ))}
            </div>
          ) : null}
          <details className="mc-analytical">
            <summary>Analytical detail</summary>
            <dl>
              <div><dt>Adjusted p-value</dt><dd>{place.adjusted_p_value?.toFixed(3)}</dd></div>
              <div><dt>Dispersion</dt><dd>{place.overdispersion_status}</dd></div>
              <div><dt>Method</dt><dd>{place.method}</dd></div>
              <div><dt>Adequacy</dt><dd>{place.minimum_data_status}</dd></div>
              <div><dt>Nearest</dt><dd>{place.nearest_incident_m != null ? `${Math.round(place.nearest_incident_m)} m` : "—"}</dd></div>
            </dl>
          </details>
        </>
      ) : (
        <p className="mc-verdict-sub">{place.place_incident_count} reported incidents in range; no beat baseline.</p>
      )}
    </section>
  );
}

function barHeight(value: number, all: number[]) {
  const max = Math.max(1, ...all);
  return Math.round((value / max) * 100);
}
```

In the exported `AnalyzeTab`, add `neighborhood` to `Props`, render the filter controls **first**, then `{neighborhood?.places.map((p) => <VerdictBlock key={p.place_id} place={p} />)}`, then a **pairwise section** when `neighborhood?.pairwise.length` (one line per pair: `{a_label} vs {b_label}: {rate_ratio.toFixed(1)}× · 95% CI {ci_lower}–{ci_upper}× · adj p {adjusted_p_value.toFixed(3)}`), then the existing `IncidentDetailsTable`, then `<MethodsAppendix />`, then the run footer. Inside `VerdictBlock`'s analytical `<details>`, also render the `type_mix` as a short list (`{place.type_mix.map((t) => <li>{t.label} · {t.count}</li>)}`) so the retired charts' one useful signal survives there. Delete `IncidentCharts`, `buildCrimeMixRows`, `buildOffenseRows`, `BarList`, `ChartRow`, `percentOf`, `offenseLabel`, and the old `buildFindings` findings block. Keep `IncidentDetailsTable` and the time/distance formatters it uses.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm test -- AnalyzeTab`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx
git commit -m "feat: rebuild analyze tab around neighborhood verdict blocks"
```

---

## Task 9: Wire neighborhood fetch into MapWorkspace

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Modify: `frontend/src/components/MapWorkspace.test.tsx`

Mirror the existing `incidentDetails` lifecycle: state + version ref, invalidate on selection/filter change, fetch after Run, pass to `AnalyzeTab`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/MapWorkspace.test.tsx (add)
vi.mocked(getNeighborhoodAnalysis).mockResolvedValue({
  radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30",
  offense_category: null, places: [], pairwise: [],
});
fireEvent.click(screen.getByRole("checkbox", { name: "Select Home" }));
fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
  expect.objectContaining({ place_ids: ["p1"], radii_m: [250] }),
));
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm test -- MapWorkspace`
Expected: FAIL (`getNeighborhoodAnalysis` not imported/called).

- [ ] **Step 3: Implement the wiring**

```tsx
// imports
import { /* ...existing... */ getNeighborhoodAnalysis } from "../api/client";
import type { /* ...existing... */ NeighborhoodAnalysis } from "../types";

// state
const [neighborhood, setNeighborhood] = useState<NeighborhoodAnalysis | null>(null);
const neighborhoodVersionRef = useRef(0);

// in invalidateAnalysisContext(): also clear neighborhood
function invalidateNeighborhood() {
  neighborhoodVersionRef.current += 1;
  setNeighborhood(null);
}
// add invalidateNeighborhood() inside invalidateAnalysisContext()

// in handleAnalyze(), after the incident-details fetch, fetch neighborhood under the same version guard:
const nVersion = neighborhoodVersionRef.current + 1;
neighborhoodVersionRef.current = nVersion;
const neighborhoodResult = await getNeighborhoodAnalysis(payload);
if (neighborhoodVersionRef.current === nVersion) setNeighborhood(neighborhoodResult);

// pass to AnalyzeTab
<AnalyzeTab /* ...existing props... */ neighborhood={neighborhood} />
```

Add `invalidateNeighborhood();` inside `invalidateAnalysisContext()` (alongside `invalidateComparison()` and `invalidateIncidentDetails()`), and reset `setNeighborhood(null)` at the top of `handleAnalyze` next to `setIncidentDetails(null)`.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm test -- MapWorkspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat: fetch neighborhood analysis after run"
```

---

## Task 10: Floor the analysis date window at 2018 (frontend)

**Files:**
- Modify: `frontend/src/lib/analysisDefaults.ts`
- Modify: `frontend/src/lib/analysisDefaults.test.ts` (create if absent)
- Modify: `frontend/src/components/AnalyzeTab.tsx` (date input `min`)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/analysisDefaults.test.ts
import { describe, expect, it } from "vitest";
import { ANALYSIS_MIN_DATE, currentYearAnalysisWindow } from "./analysisDefaults";

describe("analysis window", () => {
  it("exposes a 2018-01-01 floor", () => {
    expect(ANALYSIS_MIN_DATE).toBe("2018-01-01");
  });
  it("never starts before the floor", () => {
    const w = currentYearAnalysisWindow(new Date("2017-05-01T00:00:00"));
    expect(w.analysis_start_date >= ANALYSIS_MIN_DATE).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm test -- analysisDefaults`
Expected: FAIL (`ANALYSIS_MIN_DATE` undefined).

- [ ] **Step 3: Implement the floor**

```typescript
// frontend/src/lib/analysisDefaults.ts (add + adjust)
export const ANALYSIS_MIN_DATE = "2018-01-01";

export function currentYearAnalysisWindow(now = new Date()) {
  const start = `${now.getFullYear()}-01-01`;
  return {
    analysis_start_date: start < ANALYSIS_MIN_DATE ? ANALYSIS_MIN_DATE : start,
    analysis_end_date: localDateString(now),
  };
}
```

In `AnalyzeTab.tsx`, add `min={ANALYSIS_MIN_DATE}` to both date inputs (import `ANALYSIS_MIN_DATE`).

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm test -- analysisDefaults AnalyzeTab`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/analysisDefaults.ts frontend/src/lib/analysisDefaults.test.ts frontend/src/components/AnalyzeTab.tsx
git commit -m "feat: floor analysis date window at 2018"
```

---

## Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Backend**

Run: `.venv/bin/python -m pytest tests -q && .venv/bin/ruff check .`
Expected: all pass, ruff clean.

- [ ] **Step 2: Frontend**

Run: `cd frontend && npm test && npm run build`
Expected: all Vitest pass; Vite build succeeds.

- [ ] **Step 3: Manual smoke against real data**

With both servers running and the dev DB (30k 2026 incidents) loaded, select a place downtown, Run, and confirm a verdict block shows a beat, a rate ratio, a CI, the monthly sparkline, the analytical drawer, and the Methods sheet opens. Confirm date pickers won't go before 2018.

- [ ] **Step 4: Final commit (if any styling/CSS was added)**

```bash
git add frontend/src/styles
git commit -m "style: neighborhood verdict + methods sheet"
```

---

## Notes for the implementer

- **CSS:** verdict/sparkline/methods classes (`mc-verdict`, `mc-spark`, `mc-methods*`, `mc-analytical`) need styles in `frontend/src/styles/mapWorkspace.css`, following existing `mc-*` conventions. Add them alongside Task 8/7.
- **Beat label friendliness:** beats render as codes ("M2"); a friendly-name map is out of scope (future).
- **Independence:** do not edit `dashboard_analysis_service.py` beyond reading its helpers via import; do not touch `place_crime_summaries`. This keeps the branch mergeable against Codex's WS2/WS4.
- **Share the appendix with Compare:** in Task 7's commit, also mount `<MethodsAppendix />` in `CompareTab.tsx` (one-line addition near its caveat) so both tabs open the same glossary from one definition source — the spec calls for it.
- **Inline ⓘ deep-links:** `MethodsAppendix` already accepts `openId` to highlight a term; wiring a per-measure ⓘ button next to each evidence value (that opens the sheet at that term) is a light follow-on. The persistent Methods button + the coverage test satisfy the "always accessible + every measure defined" core for v1.
- **Test fixtures:** `session_with_places_and_beat_crime` / the `neighborhood_client` fixture mirror the existing `_client_with_places_and_crime` construction in `tests/test_dashboard_analysis_api.py` — read that file first and copy its engine/session + seeding pattern, adding `beat="M2"` and 2026 dates to the incident rows.
