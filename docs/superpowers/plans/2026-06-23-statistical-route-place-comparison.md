# Statistical Route Place Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an exposure-adjusted statistical comparison layer that can compare Seattle places and route alternatives, persist the result, expose public `Overview` and detailed `Analytical` payloads, and export the same audit fields to Tableau.

**Architecture:** Add a focused `app/analysis` package for geometry, exposure, rate tests, decision classes, and result schemas. Add SQLAlchemy/Alembic persistence for comparison runs and pairwise results, then wire it through FastAPI routes, route dashboard payloads, and Tableau CSV exports. The frontend/dashboard consumes backend-computed results only; it never recomputes p-values, rates, exposure, or recommendation decisions.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic, pytest, Ruff, SQLite/Postgres-compatible migrations, Python standard-library `math` statistics.

---

## Spec And Existing Code References

- Approved spec: `docs/superpowers/specs/2026-06-23-statistical-route-place-comparison-design.md`
- SPD analysis references:
  - `docs/reference/spd-crime-analysis-suite/source-docs/Methods_and_References.md`
  - `docs/reference/spd-crime-analysis-suite/source-docs/Crime_Stats_Suite_Plan.md`
  - `docs/reference/spd-crime-analysis-suite/source-docs/Seattle_SPD_Socrata_Filtering_Guide.md`
- Existing route context code:
  - `app/routing/context.py`
  - `app/routing/schemas.py`
  - `app/services/route_service.py`
  - `app/api/routes_routes.py`
  - `app/exports/routes.py`
  - `app/services/route_export_service.py`
- Existing model and migration patterns:
  - `app/models.py`
  - `alembic/versions/0002_route_alternatives.py`
  - `tests/test_route_models_migration.py`

## File Structure

- Create `app/analysis/__init__.py`: package marker and stable import surface.
- Create `app/analysis/schemas.py`: Pydantic/dataclass result and request models used by services and tests.
- Create `app/analysis/rate_tests.py`: count-rate comparison, exact conditional Poisson fallback, quasi-Poisson adjustment, Benjamini-Hochberg correction, decision constants.
- Create `app/analysis/exposure.py`: date exposure, place buffer area, route geometry parsing, route length, route corridor exposure, point-to-route distance, incident inclusion.
- Create `app/analysis/comparison.py`: pure comparison orchestration from counted options into pairwise results and recommendation summary text.
- Create `app/api/routes_analysis.py`: `POST /analysis/sites/compare`, `POST /analysis/routes/compare`, and `GET /analysis/comparisons/{comparison_id}`.
- Create `app/services/analysis_service.py`: SQLAlchemy adapters for counting incidents, persisting comparisons, fetching public payloads, and route-request integration.
- Create `app/exports/statistical.py`: Tableau CSV builder for statistical comparison rows.
- Create `app/services/statistical_export_service.py`: SQLAlchemy-to-export adapter for comparison rows.
- Create `alembic/versions/0003_statistical_comparisons.py`: comparison persistence migration.
- Create `docs/analysis/statistical-route-place-comparison.md`: public analysis method documentation.
- Modify `app/models.py`: add `StatisticalComparison`, `StatisticalComparisonOption`, and `StatisticalPairwiseResult`.
- Modify `app/main.py`: include `routes_analysis`.
- Modify `app/services/route_service.py`: include latest statistical comparison in route comparison payload and compute route comparison after route alternatives are created with analysis dates.
- Modify `app/api/routes_exports.py`: add `GET /exports/tableau/statistical-comparisons.csv`.
- Modify `README.md`: document the statistical comparison API, dashboard payload modes, and Tableau export.
- Add tests:
  - `tests/test_analysis_rate_tests.py`
  - `tests/test_analysis_exposure.py`
  - `tests/test_statistical_comparison_service.py`
  - `tests/test_statistical_comparison_api.py`
  - `tests/test_statistical_comparison_exports.py`

---

## Task 1: Statistical Core

**Files:**
- Create: `app/analysis/__init__.py`
- Create: `app/analysis/schemas.py`
- Create: `app/analysis/rate_tests.py`
- Create: `tests/test_analysis_rate_tests.py`

- [ ] **Step 1: Write failing statistical core tests**

Create `tests/test_analysis_rate_tests.py`:

```python
from app.analysis.rate_tests import (
    DecisionClass,
    benjamini_hochberg,
    classify_pairwise_result,
    compare_incident_rates,
    dispersion_status,
)


def test_compare_incident_rates_finds_lower_rate_with_exact_method():
    result = compare_incident_rates(
        count_a=8,
        exposure_a=30.0,
        count_b=28,
        exposure_b=30.0,
    )

    assert result.method == "exact_conditional_poisson"
    assert result.rate_a == 8 / 30.0
    assert result.rate_b == 28 / 30.0
    assert round(result.rate_ratio, 3) == 0.286
    assert result.p_value < 0.05
    assert result.ci_lower < result.rate_ratio < result.ci_upper


def test_compare_incident_rates_handles_zero_count_with_continuity_correction():
    result = compare_incident_rates(
        count_a=0,
        exposure_a=30.0,
        count_b=12,
        exposure_b=30.0,
    )

    assert result.used_continuity_correction is True
    assert result.rate_ratio < 0.1
    assert result.p_value < 0.05
    assert "continuity correction" in result.caveat_text


def test_dispersion_status_marks_high_variance_periods_as_overdispersed():
    status = dispersion_status([0, 0, 0, 12, 0, 12])

    assert status.status == "overdispersed"
    assert status.phi > 1.2


def test_dispersion_status_marks_short_series_as_insufficient_periods():
    status = dispersion_status([2])

    assert status.status == "insufficient_periods"
    assert status.phi is None


def test_quasi_poisson_adjustment_weakens_high_dispersion_significance():
    poisson = compare_incident_rates(
        count_a=8,
        exposure_a=30.0,
        count_b=28,
        exposure_b=30.0,
        overdispersion_phi=1.0,
    )
    adjusted = compare_incident_rates(
        count_a=8,
        exposure_a=30.0,
        count_b=28,
        exposure_b=30.0,
        overdispersion_phi=4.0,
    )

    assert poisson.method == "exact_conditional_poisson"
    assert adjusted.method == "quasi_poisson_log_rate_ratio"
    assert adjusted.p_value > poisson.p_value
    assert adjusted.ci_lower < poisson.ci_lower
    assert adjusted.ci_upper > poisson.ci_upper


def test_benjamini_hochberg_adjusts_p_values_monotonically():
    adjusted = benjamini_hochberg([0.01, 0.04, 0.03])

    assert adjusted == [0.03, 0.04, 0.04]


def test_classify_requires_statistical_and_practical_thresholds():
    statistically_lower = classify_pairwise_result(
        rate_ratio=0.5,
        adjusted_p_value=0.01,
        minimum_data_met=True,
        model_warning=False,
    )
    weak_practical_difference = classify_pairwise_result(
        rate_ratio=0.9,
        adjusted_p_value=0.01,
        minimum_data_met=True,
        model_warning=False,
    )
    weak_statistical_difference = classify_pairwise_result(
        rate_ratio=0.5,
        adjusted_p_value=0.20,
        minimum_data_met=True,
        model_warning=False,
    )

    assert statistically_lower == DecisionClass.STATISTICALLY_LOWER
    assert weak_practical_difference == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert weak_statistical_difference == DecisionClass.NOT_STATISTICALLY_CLEAR
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_analysis_rate_tests.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.analysis'`.

- [ ] **Step 3: Create analysis schemas**

Create `app/analysis/__init__.py`:

```python
from __future__ import annotations
```

Create `app/analysis/schemas.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.schemas import new_id


class GeometryType(StrEnum):
    PLACE_BUFFER = "place_buffer"
    ROUTE_CORRIDOR = "route_corridor"


class DecisionClass(StrEnum):
    STATISTICALLY_LOWER = "statistically_lower"
    NOT_STATISTICALLY_CLEAR = "not_statistically_clear"
    INSUFFICIENT_DATA = "insufficient_data"
    MODEL_WARNING = "model_warning"


@dataclass(frozen=True)
class DispersionResult:
    phi: float | None
    status: str


@dataclass(frozen=True)
class RateTestResult:
    count_a: int
    count_b: int
    exposure_a: float
    exposure_b: float
    rate_a: float
    rate_b: float
    rate_ratio: float
    ci_lower: float
    ci_upper: float
    p_value: float
    method: str
    overdispersion_phi: float | None
    overdispersion_status: str
    used_continuity_correction: bool
    caveat_text: str


class AnalysisSiteOption(BaseModel):
    id: str = Field(default_factory=new_id)
    label: str
    latitude: float
    longitude: float
    radius_m: int = Field(gt=0, le=5000)


class SiteComparisonRequest(BaseModel):
    options: list[AnalysisSiteOption] = Field(min_length=2)
    analysis_start_date: date
    analysis_end_date: date
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class RouteComparisonRequest(BaseModel):
    route_request_id: str
    radius_m: int = Field(gt=0, le=5000)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class AnalysisOptionResult(BaseModel):
    option_id: str
    option_label: str
    geometry_type: GeometryType
    radius_m: int
    incident_count: int
    exposure: float
    exposure_unit: str
    incident_rate: float


class PairwiseComparisonResult(BaseModel):
    id: str = Field(default_factory=new_id)
    comparison_id: str | None = None
    option_a_id: str
    option_a_label: str
    option_b_id: str
    option_b_label: str
    winner_option_id: str | None
    winner_label: str | None
    decision_class: DecisionClass
    method: str
    incident_count_a: int
    incident_count_b: int
    exposure_a: float
    exposure_b: float
    exposure_unit: str
    rate_a: float
    rate_b: float
    rate_ratio: float
    ci_lower: float
    ci_upper: float
    p_value: float
    adjusted_p_value: float
    overdispersion_phi: float | None
    overdispersion_status: str
    minimum_data_status: str
    caveat_text: str


class StatisticalComparisonResult(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id_hash: str
    comparison_type: str
    geometry_type: GeometryType
    radius_m: int
    analysis_start_date: date
    analysis_end_date: date
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    source_dataset: str = "seattle_spd_crime"
    exposure_unit: str = "square_km_days"
    decision_class: DecisionClass
    recommendation_option_id: str | None = None
    recommendation_label: str | None = None
    overview_summary_text: str
    overview_caveat_text: str
    full_caveat_text: str
    options: list[AnalysisOptionResult]
    pairwise_results: list[PairwiseComparisonResult]
    created_at: datetime | None = None
```

- [ ] **Step 4: Implement statistical functions**

Create `app/analysis/rate_tests.py`:

```python
from __future__ import annotations

import math
from collections.abc import Sequence

from app.analysis.schemas import DecisionClass, DispersionResult, RateTestResult

ALPHA = 0.05
DISPERSION_THRESHOLD = 1.2
MAX_RATE_RATIO_FOR_RECOMMENDATION = 0.80
MIN_COMBINED_COUNT = 10
MIN_ANALYSIS_DAYS = 30
Z_975 = 1.959963984540054


def compare_incident_rates(
    *,
    count_a: int,
    exposure_a: float,
    count_b: int,
    exposure_b: float,
    overdispersion_phi: float | None = None,
) -> RateTestResult:
    if exposure_a <= 0 or exposure_b <= 0:
        raise ValueError("Exposure values must be positive.")

    raw_rate_a = count_a / exposure_a
    raw_rate_b = count_b / exposure_b
    safe_count_a = count_a
    safe_count_b = count_b
    used_correction = False
    caveats: list[str] = []
    if count_a == 0 or count_b == 0:
        safe_count_a = count_a + 0.5
        safe_count_b = count_b + 0.5
        used_correction = True
        caveats.append("A continuity correction was used because one option had zero incidents.")

    rate_ratio = (safe_count_a / exposure_a) / (safe_count_b / exposure_b)
    phi = overdispersion_phi or 1.0

    if phi > DISPERSION_THRESHOLD:
        method = "quasi_poisson_log_rate_ratio"
        se_log_rr = math.sqrt(phi * ((1 / safe_count_a) + (1 / safe_count_b)))
        z_value = abs(math.log(rate_ratio)) / se_log_rr if se_log_rr else 0.0
        p_value = math.erfc(z_value / math.sqrt(2))
        overdispersion_status = "overdispersed"
    else:
        method = "exact_conditional_poisson"
        p_value = _exact_conditional_poisson_p_value(
            count_a=count_a,
            exposure_a=exposure_a,
            count_b=count_b,
            exposure_b=exposure_b,
        )
        se_log_rr = math.sqrt((1 / safe_count_a) + (1 / safe_count_b))
        overdispersion_status = "poisson_ok"

    ci_lower = math.exp(math.log(rate_ratio) - Z_975 * se_log_rr)
    ci_upper = math.exp(math.log(rate_ratio) + Z_975 * se_log_rr)

    return RateTestResult(
        count_a=count_a,
        count_b=count_b,
        exposure_a=exposure_a,
        exposure_b=exposure_b,
        rate_a=raw_rate_a,
        rate_b=raw_rate_b,
        rate_ratio=rate_ratio,
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        p_value=p_value,
        method=method,
        overdispersion_phi=overdispersion_phi,
        overdispersion_status=overdispersion_status,
        used_continuity_correction=used_correction,
        caveat_text=" ".join(caveats),
    )


def _exact_conditional_poisson_p_value(
    *,
    count_a: int,
    exposure_a: float,
    count_b: int,
    exposure_b: float,
) -> float:
    total = count_a + count_b
    if total == 0:
        return 1.0
    probability_a = exposure_a / (exposure_a + exposure_b)
    observed = _binomial_probability(total, count_a, probability_a)
    p_value = 0.0
    for successes in range(total + 1):
        probability = _binomial_probability(total, successes, probability_a)
        if probability <= observed + 1e-15:
            p_value += probability
    return min(1.0, p_value)


def _binomial_probability(trials: int, successes: int, probability: float) -> float:
    if probability <= 0:
        return 1.0 if successes == 0 else 0.0
    if probability >= 1:
        return 1.0 if successes == trials else 0.0
    log_combination = (
        math.lgamma(trials + 1)
        - math.lgamma(successes + 1)
        - math.lgamma(trials - successes + 1)
    )
    log_probability = (
        log_combination
        + successes * math.log(probability)
        + (trials - successes) * math.log1p(-probability)
    )
    return math.exp(log_probability)


def dispersion_status(period_counts: Sequence[int]) -> DispersionResult:
    if len(period_counts) < 2:
        return DispersionResult(phi=None, status="insufficient_periods")
    mean = sum(period_counts) / len(period_counts)
    if mean == 0:
        return DispersionResult(phi=0.0, status="poisson_ok")
    variance = sum((count - mean) ** 2 for count in period_counts) / (len(period_counts) - 1)
    phi = variance / mean
    status = "overdispersed" if phi > DISPERSION_THRESHOLD else "poisson_ok"
    return DispersionResult(phi=phi, status=status)


def benjamini_hochberg(p_values: Sequence[float]) -> list[float]:
    count = len(p_values)
    indexed = sorted(enumerate(p_values), key=lambda item: item[1], reverse=True)
    adjusted = [1.0] * count
    running_min = 1.0
    for rank_from_largest, (original_index, p_value) in enumerate(indexed):
        rank = count - rank_from_largest
        candidate = min(1.0, p_value * count / rank)
        running_min = min(running_min, candidate)
        adjusted[original_index] = running_min
    return adjusted


def classify_pairwise_result(
    *,
    rate_ratio: float,
    adjusted_p_value: float,
    minimum_data_met: bool,
    model_warning: bool,
) -> DecisionClass:
    if not minimum_data_met:
        return DecisionClass.INSUFFICIENT_DATA
    if model_warning:
        return DecisionClass.MODEL_WARNING
    if adjusted_p_value < ALPHA and rate_ratio <= MAX_RATE_RATIO_FOR_RECOMMENDATION:
        return DecisionClass.STATISTICALLY_LOWER
    return DecisionClass.NOT_STATISTICALLY_CLEAR
```

- [ ] **Step 5: Run statistical tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_analysis_rate_tests.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit statistical core**

Run:

```bash
git add app/analysis/__init__.py app/analysis/schemas.py app/analysis/rate_tests.py tests/test_analysis_rate_tests.py
git commit -m "feat: add statistical rate comparison core"
```

---

## Task 2: Route Corridor And Place Exposure

**Files:**
- Create: `app/analysis/exposure.py`
- Create: `tests/test_analysis_exposure.py`

- [ ] **Step 1: Write failing exposure tests**

Create `tests/test_analysis_exposure.py`:

```python
from datetime import UTC, date, datetime

from app.analysis.exposure import (
    analysis_days,
    count_incidents_in_place_buffer,
    count_incidents_in_route_corridor,
    parse_route_geometry,
    place_exposure_square_km_days,
    point_to_route_distance_m,
    route_corridor_exposure_square_km_days,
)
from app.schemas import CrimeIncidentData


def test_analysis_days_is_inclusive():
    assert analysis_days(date(2024, 1, 1), date(2024, 1, 30)) == 30


def test_place_exposure_uses_buffer_area_times_days():
    exposure = place_exposure_square_km_days(
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 30),
    )

    assert round(exposure, 3) == 23.562


def test_parse_route_geometry_reads_existing_lat_lon_semicolon_format():
    assert parse_route_geometry("47.1,-122.1;47.2,-122.2") == [
        (47.1, -122.1),
        (47.2, -122.2),
    ]


def test_point_to_route_distance_counts_points_near_segment_not_only_endpoints():
    route = parse_route_geometry("47.6116,-122.3372;47.609,-122.335")
    distance = point_to_route_distance_m(47.6103, -122.3361, route)

    assert distance < 40


def test_route_corridor_exposure_is_positive_for_existing_geometry_format():
    exposure = route_corridor_exposure_square_km_days(
        geometry="47.6116,-122.3372;47.609,-122.335",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 30),
    )

    assert exposure > 0


def test_count_incidents_in_route_corridor_filters_dates_coordinates_and_offense():
    incidents = [
        CrimeIncidentData(
            id="near",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6103,
            longitude=-122.3361,
        ),
        CrimeIncidentData(
            id="wrong-offense",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PERSON",
            offense_subcategory="ASSAULT",
            nibrs_group="A",
            latitude=47.6103,
            longitude=-122.3361,
        ),
        CrimeIncidentData(
            id="outside",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6200,
            longitude=-122.3500,
        ),
    ]

    result = count_incidents_in_route_corridor(
        incidents=incidents,
        geometry="47.6116,-122.3372;47.609,-122.335",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert [incident.id for incident in result] == ["near"]


def test_count_incidents_in_place_buffer_uses_haversine_distance():
    incidents = [
        CrimeIncidentData(
            id="near",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.6117,
            longitude=-122.3371,
        ),
        CrimeIncidentData(
            id="far",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.7000,
            longitude=-122.4000,
        ),
    ]

    result = count_incidents_in_place_buffer(
        incidents=incidents,
        latitude=47.6116,
        longitude=-122.3372,
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert [incident.id for incident in result] == ["near"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_analysis_exposure.py -q
```

Expected: FAIL because `app.analysis.exposure` does not exist.

- [ ] **Step 3: Implement exposure helpers**

Create `app/analysis/exposure.py`:

```python
from __future__ import annotations

import math
from datetime import date

from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData

EARTH_RADIUS_M = 6_371_000


def analysis_days(analysis_start_date: date, analysis_end_date: date) -> int:
    days = (analysis_end_date - analysis_start_date).days + 1
    if days <= 0:
        raise ValueError("analysis_end_date must be on or after analysis_start_date.")
    return days


def place_exposure_square_km_days(
    *,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float:
    radius_km = radius_m / 1000
    return math.pi * radius_km * radius_km * analysis_days(
        analysis_start_date,
        analysis_end_date,
    )


def parse_route_geometry(geometry: str | None) -> list[tuple[float, float]]:
    if not geometry:
        return []
    points: list[tuple[float, float]] = []
    for raw_point in geometry.split(";"):
        latitude_text, longitude_text = raw_point.split(",", 1)
        points.append((float(latitude_text), float(longitude_text)))
    return points


def route_length_km(points: list[tuple[float, float]]) -> float:
    if len(points) < 2:
        return 0.0
    total_m = 0.0
    for start, end in zip(points, points[1:]):
        total_m += haversine_m(start[0], start[1], end[0], end[1])
    return total_m / 1000


def route_corridor_exposure_square_km_days(
    *,
    geometry: str | None,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float:
    points = parse_route_geometry(geometry)
    length_km = route_length_km(points)
    radius_km = radius_m / 1000
    area_square_km = (length_km * 2 * radius_km) + math.pi * radius_km * radius_km
    return area_square_km * analysis_days(analysis_start_date, analysis_end_date)


def point_to_route_distance_m(
    latitude: float,
    longitude: float,
    route_points: list[tuple[float, float]],
) -> float:
    if not route_points:
        return math.inf
    if len(route_points) == 1:
        return haversine_m(latitude, longitude, route_points[0][0], route_points[0][1])
    return min(
        _point_to_segment_distance_m(latitude, longitude, start, end)
        for start, end in zip(route_points, route_points[1:])
    )


def _point_to_segment_distance_m(
    latitude: float,
    longitude: float,
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    reference_latitude_rad = math.radians((start[0] + end[0] + latitude) / 3)

    def project(point_latitude: float, point_longitude: float) -> tuple[float, float]:
        x = math.radians(point_longitude) * math.cos(reference_latitude_rad) * EARTH_RADIUS_M
        y = math.radians(point_latitude) * EARTH_RADIUS_M
        return x, y

    point_x, point_y = project(latitude, longitude)
    start_x, start_y = project(start[0], start[1])
    end_x, end_y = project(end[0], end[1])
    segment_dx = end_x - start_x
    segment_dy = end_y - start_y
    segment_length_squared = segment_dx * segment_dx + segment_dy * segment_dy
    if segment_length_squared == 0:
        return haversine_m(latitude, longitude, start[0], start[1])
    position = (
        ((point_x - start_x) * segment_dx) + ((point_y - start_y) * segment_dy)
    ) / segment_length_squared
    clamped = max(0.0, min(1.0, position))
    closest_x = start_x + clamped * segment_dx
    closest_y = start_y + clamped * segment_dy
    return math.hypot(point_x - closest_x, point_y - closest_y)


def count_incidents_in_route_corridor(
    *,
    incidents: list[CrimeIncidentData],
    geometry: str | None,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> list[CrimeIncidentData]:
    route_points = parse_route_geometry(geometry)
    return [
        incident
        for incident in incidents
        if _incident_matches_filters(
            incident,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
        )
        and incident.latitude is not None
        and incident.longitude is not None
        and point_to_route_distance_m(incident.latitude, incident.longitude, route_points) <= radius_m
    ]


def count_incidents_in_place_buffer(
    *,
    incidents: list[CrimeIncidentData],
    latitude: float,
    longitude: float,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> list[CrimeIncidentData]:
    return [
        incident
        for incident in incidents
        if _incident_matches_filters(
            incident,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
        )
        and incident.latitude is not None
        and incident.longitude is not None
        and haversine_m(latitude, longitude, incident.latitude, incident.longitude) <= radius_m
    ]


def _incident_matches_filters(
    incident: CrimeIncidentData,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> bool:
    observed = incident.offense_start_utc or incident.report_utc
    if observed is None:
        return False
    observed_date = observed.date()
    if not analysis_start_date <= observed_date <= analysis_end_date:
        return False
    return (
        _matches_optional_filter(incident.offense_category, offense_category)
        and _matches_optional_filter(incident.offense_subcategory, offense_subcategory)
        and _matches_optional_filter(incident.nibrs_group, nibrs_group)
    )


def _matches_optional_filter(value: str | None, selected: str | None) -> bool:
    return selected is None or value == selected
```

- [ ] **Step 4: Run exposure tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_analysis_exposure.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit exposure helpers**

Run:

```bash
git add app/analysis/exposure.py tests/test_analysis_exposure.py
git commit -m "feat: compute route and place exposure"
```

---

## Task 3: Pure Comparison Orchestration

**Files:**
- Create: `app/analysis/comparison.py`
- Modify: `app/analysis/schemas.py`
- Create: `tests/test_statistical_comparison_service.py`

- [ ] **Step 1: Write failing pure comparison tests**

Create `tests/test_statistical_comparison_service.py` with the first tests focused on pure comparison logic:

```python
from datetime import date

from app.analysis.comparison import build_statistical_comparison
from app.analysis.schemas import AnalysisOptionResult, DecisionClass, GeometryType


def test_build_statistical_comparison_recommends_candidate_only_when_all_pairs_pass():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Route A",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=28,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=28 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [2, 2, 2, 2],
            "b": [7, 7, 7, 7],
        },
    )

    assert result.decision_class == DecisionClass.STATISTICALLY_LOWER
    assert result.recommendation_option_id == "a"
    assert result.recommendation_label == "Route A"
    assert "statistically lower reported-incident rate" in result.overview_summary_text
    assert "safe" not in result.overview_summary_text.lower()
    assert result.pairwise_results[0].adjusted_p_value == result.pairwise_results[0].p_value


def test_build_statistical_comparison_keeps_alternatives_when_result_is_not_clear():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Route A",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=10,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=10 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [2, 2, 2, 2],
            "b": [3, 3, 2, 2],
        },
    )

    assert result.decision_class == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert result.recommendation_option_id is None
    assert "no statistically clear lower-incident alternative" in result.overview_summary_text


def test_build_statistical_comparison_blocks_short_date_ranges():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 15),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Site A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=1,
                exposure=10.0,
                exposure_unit="square_km_days",
                incident_rate=0.1,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Site B",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=20,
                exposure=10.0,
                exposure_unit="square_km_days",
                incident_rate=2.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [1],
            "b": [20],
        },
    )

    assert result.decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.recommendation_option_id is None
    assert result.pairwise_results[0].minimum_data_status == "date_range_too_short"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_service.py -q
```

Expected: FAIL because `app.analysis.comparison` does not exist.

- [ ] **Step 3: Implement comparison orchestration**

Create `app/analysis/comparison.py`:

```python
from __future__ import annotations

from datetime import date

from app.analysis.exposure import analysis_days
from app.analysis.rate_tests import (
    MIN_ANALYSIS_DAYS,
    MIN_COMBINED_COUNT,
    benjamini_hochberg,
    classify_pairwise_result,
    compare_incident_rates,
    dispersion_status,
)
from app.analysis.schemas import (
    AnalysisOptionResult,
    DecisionClass,
    GeometryType,
    PairwiseComparisonResult,
    StatisticalComparisonResult,
)


def build_statistical_comparison(
    *,
    user_id_hash: str,
    comparison_type: str,
    geometry_type: GeometryType,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    options: list[AnalysisOptionResult],
    period_counts_by_option_id: dict[str, list[int]],
) -> StatisticalComparisonResult:
    if len(options) < 2:
        raise ValueError("At least two options are required.")

    candidate = min(options, key=lambda option: option.incident_rate)
    raw_pairwise: list[PairwiseComparisonResult] = []
    p_values: list[float] = []

    for other in options:
        if other.option_id == candidate.option_id:
            continue
        minimum_data_status = _minimum_data_status(
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
            candidate=candidate,
            other=other,
        )
        dispersion = _combined_dispersion(
            period_counts_by_option_id.get(candidate.option_id, []),
            period_counts_by_option_id.get(other.option_id, []),
        )
        rate_test = compare_incident_rates(
            count_a=candidate.incident_count,
            exposure_a=candidate.exposure,
            count_b=other.incident_count,
            exposure_b=other.exposure,
            overdispersion_phi=dispersion.phi,
        )
        pairwise = PairwiseComparisonResult(
            option_a_id=candidate.option_id,
            option_a_label=candidate.option_label,
            option_b_id=other.option_id,
            option_b_label=other.option_label,
            winner_option_id=candidate.option_id,
            winner_label=candidate.option_label,
            decision_class=DecisionClass.NOT_STATISTICALLY_CLEAR,
            method=rate_test.method,
            incident_count_a=rate_test.count_a,
            incident_count_b=rate_test.count_b,
            exposure_a=rate_test.exposure_a,
            exposure_b=rate_test.exposure_b,
            exposure_unit=candidate.exposure_unit,
            rate_a=rate_test.rate_a,
            rate_b=rate_test.rate_b,
            rate_ratio=rate_test.rate_ratio,
            ci_lower=rate_test.ci_lower,
            ci_upper=rate_test.ci_upper,
            p_value=rate_test.p_value,
            adjusted_p_value=rate_test.p_value,
            overdispersion_phi=dispersion.phi,
            overdispersion_status=dispersion.status,
            minimum_data_status=minimum_data_status,
            caveat_text=_pairwise_caveat(minimum_data_status, dispersion.status, rate_test.caveat_text),
        )
        raw_pairwise.append(pairwise)
        p_values.append(rate_test.p_value)

    adjusted = benjamini_hochberg(p_values)
    pairwise_results: list[PairwiseComparisonResult] = []
    for pairwise, adjusted_p_value in zip(raw_pairwise, adjusted):
        decision_class = classify_pairwise_result(
            rate_ratio=pairwise.rate_ratio,
            adjusted_p_value=adjusted_p_value,
            minimum_data_met=pairwise.minimum_data_status == "met",
            model_warning=pairwise.overdispersion_status == "insufficient_periods",
        )
        pairwise_results.append(
            pairwise.model_copy(
                update={
                    "adjusted_p_value": adjusted_p_value,
                    "decision_class": decision_class,
                },
            ),
        )

    overall_decision = _overall_decision(pairwise_results)
    recommendation_option_id = (
        candidate.option_id if overall_decision == DecisionClass.STATISTICALLY_LOWER else None
    )
    recommendation_label = (
        candidate.option_label if overall_decision == DecisionClass.STATISTICALLY_LOWER else None
    )

    return StatisticalComparisonResult(
        user_id_hash=user_id_hash,
        comparison_type=comparison_type,
        geometry_type=geometry_type,
        radius_m=radius_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        decision_class=overall_decision,
        recommendation_option_id=recommendation_option_id,
        recommendation_label=recommendation_label,
        overview_summary_text=_overview_summary(overall_decision, recommendation_label),
        overview_caveat_text=_overview_caveat(overall_decision),
        full_caveat_text=_full_caveat(pairwise_results),
        options=options,
        pairwise_results=pairwise_results,
    )


def _combined_dispersion(counts_a: list[int], counts_b: list[int]):
    combined = counts_a + counts_b
    return dispersion_status(combined)


def _minimum_data_status(
    *,
    analysis_start_date: date,
    analysis_end_date: date,
    candidate: AnalysisOptionResult,
    other: AnalysisOptionResult,
) -> str:
    if analysis_days(analysis_start_date, analysis_end_date) < MIN_ANALYSIS_DAYS:
        return "date_range_too_short"
    if candidate.exposure <= 0 or other.exposure <= 0:
        return "non_positive_exposure"
    if candidate.incident_count + other.incident_count < MIN_COMBINED_COUNT:
        return "combined_count_too_low"
    return "met"


def _overall_decision(pairwise_results: list[PairwiseComparisonResult]) -> DecisionClass:
    if any(result.decision_class == DecisionClass.MODEL_WARNING for result in pairwise_results):
        return DecisionClass.MODEL_WARNING
    if any(result.decision_class == DecisionClass.INSUFFICIENT_DATA for result in pairwise_results):
        return DecisionClass.INSUFFICIENT_DATA
    if pairwise_results and all(
        result.decision_class == DecisionClass.STATISTICALLY_LOWER
        for result in pairwise_results
    ):
        return DecisionClass.STATISTICALLY_LOWER
    return DecisionClass.NOT_STATISTICALLY_CLEAR


def _overview_summary(decision_class: DecisionClass, recommendation_label: str | None) -> str:
    if decision_class == DecisionClass.STATISTICALLY_LOWER and recommendation_label:
        return (
            f"{recommendation_label} has a statistically lower reported-incident rate "
            "for the selected corridor, date range, and offense filter."
        )
    if decision_class == DecisionClass.INSUFFICIENT_DATA:
        return "There is insufficient data for a statistical comparison under the selected filters."
    if decision_class == DecisionClass.MODEL_WARNING:
        return "The model detected data or geometry limitations that require analytical review."
    return "There is no statistically clear lower-incident alternative under the selected filters."


def _overview_caveat(decision_class: DecisionClass) -> str:
    if decision_class == DecisionClass.STATISTICALLY_LOWER:
        return "This describes reported incidents, not personal safety or causation."
    return "The app still shows alternatives, but it does not make a lower-incident recommendation."


def _full_caveat(pairwise_results: list[PairwiseComparisonResult]) -> str:
    caveats = [result.caveat_text for result in pairwise_results if result.caveat_text]
    base = "Results use exposure-adjusted reported incident rates and conservative thresholds."
    return " ".join([base, *caveats]).strip()


def _pairwise_caveat(
    minimum_data_status: str,
    overdispersion_status: str,
    rate_test_caveat: str,
) -> str:
    caveats: list[str] = []
    if minimum_data_status != "met":
        caveats.append(f"Minimum data status: {minimum_data_status}.")
    if overdispersion_status == "overdispersed":
        caveats.append("Overdispersion was detected, so quasi-Poisson adjustment was used.")
    if overdispersion_status == "insufficient_periods":
        caveats.append("There were too few period bins to estimate overdispersion.")
    if rate_test_caveat:
        caveats.append(rate_test_caveat)
    return " ".join(caveats)
```

- [ ] **Step 4: Run comparison tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_service.py -q
```

Expected: PASS for the pure comparison tests.

- [ ] **Step 5: Scan generated text for disallowed product language**

Run:

```bash
rg -n '"safe"|"unsafe"|"dangerous"|"risk-free"|"you should take this route"|"prevents crime"' app/analysis tests/test_statistical_comparison_service.py
```

Expected: no hits except the explicit assertion that `safe` is absent.

- [ ] **Step 6: Commit comparison orchestration**

Run:

```bash
git add app/analysis/comparison.py tests/test_statistical_comparison_service.py
git commit -m "feat: classify statistical comparisons"
```

---

## Task 4: Persistence And Alembic Migration

**Files:**
- Modify: `app/models.py`
- Create: `alembic/versions/0003_statistical_comparisons.py`
- Modify: `tests/test_route_models_migration.py`

- [ ] **Step 1: Write failing persistence and migration tests**

Append to `tests/test_route_models_migration.py`:

```python

from app.models import (
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)


def test_statistical_comparison_models_persist_options_and_pairwise_results(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()

    comparison = StatisticalComparison(
        user_id_hash="analysis-user",
        comparison_type="route",
        geometry_type="route_corridor",
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        source_dataset="seattle_spd_crime",
        exposure_unit="square_km_days",
        decision_class="statistically_lower",
        recommendation_option_id="route-a",
        recommendation_label="Route A",
        overview_summary_text="Route A has a statistically lower reported-incident rate.",
        overview_caveat_text="This describes reported incidents.",
        full_caveat_text="Results use exposure-adjusted reported incident rates.",
    )
    session.add(comparison)
    session.flush()

    session.add(
        StatisticalComparisonOption(
            comparison_id=comparison.id,
            user_id_hash="analysis-user",
            option_id="route-a",
            option_label="Route A",
            geometry_type="route_corridor",
            radius_m=500,
            incident_count=8,
            exposure=30,
            exposure_unit="square_km_days",
            incident_rate=8 / 30,
        ),
    )
    session.add(
        StatisticalPairwiseResult(
            comparison_id=comparison.id,
            user_id_hash="analysis-user",
            option_a_id="route-a",
            option_a_label="Route A",
            option_b_id="route-b",
            option_b_label="Route B",
            winner_option_id="route-a",
            winner_label="Route A",
            decision_class="statistically_lower",
            method="exact_conditional_poisson",
            incident_count_a=8,
            incident_count_b=28,
            exposure_a=30,
            exposure_b=30,
            exposure_unit="square_km_days",
            rate_a=8 / 30,
            rate_b=28 / 30,
            rate_ratio=(8 / 30) / (28 / 30),
            ci_lower=0.1,
            ci_upper=0.8,
            p_value=0.01,
            adjusted_p_value=0.01,
            overdispersion_status="poisson_ok",
            minimum_data_status="met",
            caveat_text="",
        ),
    )
    session.commit()

    assert comparison.id
    assert session.get(StatisticalComparison, comparison.id).decision_class == "statistically_lower"
    session.close()


def test_statistical_alembic_migration_creates_comparison_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "statistical-migration.sqlite3"
    database_url = f"sqlite+pysqlite:///{db_path}"
    monkeypatch.setenv("MCA_DATABASE_URL", database_url)

    command.upgrade(Config("alembic.ini"), "head")

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert {
        "statistical_comparisons",
        "statistical_comparison_options",
        "statistical_pairwise_results",
    }.issubset(set(inspector.get_table_names()))

    comparison_columns = {
        column["name"] for column in inspector.get_columns("statistical_comparisons")
    }
    assert {
        "user_id_hash",
        "comparison_type",
        "geometry_type",
        "decision_class",
        "overview_summary_text",
        "overview_caveat_text",
        "full_caveat_text",
    }.issubset(comparison_columns)

    option_fks = inspector.get_foreign_keys("statistical_comparison_options")
    pairwise_fks = inspector.get_foreign_keys("statistical_pairwise_results")
    assert any(fk["referred_table"] == "statistical_comparisons" for fk in option_fks)
    assert any(fk["referred_table"] == "statistical_comparisons" for fk in pairwise_fks)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_route_models_migration.py -q
```

Expected: FAIL because the `StatisticalComparison` models and migration tables do not exist.

- [ ] **Step 3: Add SQLAlchemy models**

Append these models to `app/models.py` after `RouteContextSummary`:

```python


class StatisticalComparison(Base):
    __tablename__ = "statistical_comparisons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    comparison_type: Mapped[str] = mapped_column(Text)
    source_route_request_id: Mapped[str | None] = mapped_column(
        ForeignKey("route_requests.id"),
        nullable=True,
        index=True,
    )
    geometry_type: Mapped[str] = mapped_column(Text)
    radius_m: Mapped[int] = mapped_column(Integer)
    analysis_start_date: Mapped[date] = mapped_column(Date)
    analysis_end_date: Mapped[date] = mapped_column(Date)
    offense_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_subcategory: Mapped[str | None] = mapped_column(Text, nullable=True)
    nibrs_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_dataset: Mapped[str] = mapped_column(Text, default="seattle_spd_crime")
    exposure_unit: Mapped[str] = mapped_column(Text, default="square_km_days")
    decision_class: Mapped[str] = mapped_column(Text)
    recommendation_option_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    overview_summary_text: Mapped[str] = mapped_column(Text)
    overview_caveat_text: Mapped[str] = mapped_column(Text)
    full_caveat_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class StatisticalComparisonOption(Base):
    __tablename__ = "statistical_comparison_options"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    comparison_id: Mapped[str] = mapped_column(
        ForeignKey("statistical_comparisons.id"),
        index=True,
    )
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    option_id: Mapped[str] = mapped_column(Text)
    option_label: Mapped[str] = mapped_column(Text)
    geometry_type: Mapped[str] = mapped_column(Text)
    radius_m: Mapped[int] = mapped_column(Integer)
    incident_count: Mapped[int] = mapped_column(Integer)
    exposure: Mapped[float] = mapped_column(Float)
    exposure_unit: Mapped[str] = mapped_column(Text)
    incident_rate: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class StatisticalPairwiseResult(Base):
    __tablename__ = "statistical_pairwise_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    comparison_id: Mapped[str] = mapped_column(
        ForeignKey("statistical_comparisons.id"),
        index=True,
    )
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    option_a_id: Mapped[str] = mapped_column(Text)
    option_a_label: Mapped[str] = mapped_column(Text)
    option_b_id: Mapped[str] = mapped_column(Text)
    option_b_label: Mapped[str] = mapped_column(Text)
    winner_option_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    winner_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_class: Mapped[str] = mapped_column(Text)
    method: Mapped[str] = mapped_column(Text)
    incident_count_a: Mapped[int] = mapped_column(Integer)
    incident_count_b: Mapped[int] = mapped_column(Integer)
    exposure_a: Mapped[float] = mapped_column(Float)
    exposure_b: Mapped[float] = mapped_column(Float)
    exposure_unit: Mapped[str] = mapped_column(Text)
    rate_a: Mapped[float] = mapped_column(Float)
    rate_b: Mapped[float] = mapped_column(Float)
    rate_ratio: Mapped[float] = mapped_column(Float)
    ci_lower: Mapped[float] = mapped_column(Float)
    ci_upper: Mapped[float] = mapped_column(Float)
    p_value: Mapped[float] = mapped_column(Float)
    adjusted_p_value: Mapped[float] = mapped_column(Float)
    overdispersion_phi: Mapped[float | None] = mapped_column(Float, nullable=True)
    overdispersion_status: Mapped[str] = mapped_column(Text)
    minimum_data_status: Mapped[str] = mapped_column(Text)
    caveat_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

- [ ] **Step 4: Add Alembic migration**

Create `alembic/versions/0003_statistical_comparisons.py`:

```python
"""statistical comparisons

Revision ID: 0003_statistical_comparisons
Revises: 0002_route_alternatives
Create Date: 2026-06-23
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_statistical_comparisons"
down_revision = "0002_route_alternatives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "statistical_comparisons",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("comparison_type", sa.Text(), nullable=False),
        sa.Column(
            "source_route_request_id",
            sa.String(length=36),
            sa.ForeignKey("route_requests.id"),
            nullable=True,
        ),
        sa.Column("geometry_type", sa.Text(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False),
        sa.Column("analysis_start_date", sa.Date(), nullable=False),
        sa.Column("analysis_end_date", sa.Date(), nullable=False),
        sa.Column("offense_category", sa.Text(), nullable=True),
        sa.Column("offense_subcategory", sa.Text(), nullable=True),
        sa.Column("nibrs_group", sa.Text(), nullable=True),
        sa.Column("source_dataset", sa.Text(), nullable=False),
        sa.Column("exposure_unit", sa.Text(), nullable=False),
        sa.Column("decision_class", sa.Text(), nullable=False),
        sa.Column("recommendation_option_id", sa.Text(), nullable=True),
        sa.Column("recommendation_label", sa.Text(), nullable=True),
        sa.Column("overview_summary_text", sa.Text(), nullable=False),
        sa.Column("overview_caveat_text", sa.Text(), nullable=False),
        sa.Column("full_caveat_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_statistical_comparisons_user_id_hash",
        "statistical_comparisons",
        ["user_id_hash"],
    )
    op.create_index(
        "ix_statistical_comparisons_source_route_request_id",
        "statistical_comparisons",
        ["source_route_request_id"],
    )

    op.create_table(
        "statistical_comparison_options",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "comparison_id",
            sa.String(length=36),
            sa.ForeignKey("statistical_comparisons.id"),
            nullable=False,
        ),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("option_id", sa.Text(), nullable=False),
        sa.Column("option_label", sa.Text(), nullable=False),
        sa.Column("geometry_type", sa.Text(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False),
        sa.Column("incident_count", sa.Integer(), nullable=False),
        sa.Column("exposure", sa.Float(), nullable=False),
        sa.Column("exposure_unit", sa.Text(), nullable=False),
        sa.Column("incident_rate", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_statistical_comparison_options_comparison_id",
        "statistical_comparison_options",
        ["comparison_id"],
    )
    op.create_index(
        "ix_statistical_comparison_options_user_id_hash",
        "statistical_comparison_options",
        ["user_id_hash"],
    )

    op.create_table(
        "statistical_pairwise_results",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "comparison_id",
            sa.String(length=36),
            sa.ForeignKey("statistical_comparisons.id"),
            nullable=False,
        ),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("option_a_id", sa.Text(), nullable=False),
        sa.Column("option_a_label", sa.Text(), nullable=False),
        sa.Column("option_b_id", sa.Text(), nullable=False),
        sa.Column("option_b_label", sa.Text(), nullable=False),
        sa.Column("winner_option_id", sa.Text(), nullable=True),
        sa.Column("winner_label", sa.Text(), nullable=True),
        sa.Column("decision_class", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("incident_count_a", sa.Integer(), nullable=False),
        sa.Column("incident_count_b", sa.Integer(), nullable=False),
        sa.Column("exposure_a", sa.Float(), nullable=False),
        sa.Column("exposure_b", sa.Float(), nullable=False),
        sa.Column("exposure_unit", sa.Text(), nullable=False),
        sa.Column("rate_a", sa.Float(), nullable=False),
        sa.Column("rate_b", sa.Float(), nullable=False),
        sa.Column("rate_ratio", sa.Float(), nullable=False),
        sa.Column("ci_lower", sa.Float(), nullable=False),
        sa.Column("ci_upper", sa.Float(), nullable=False),
        sa.Column("p_value", sa.Float(), nullable=False),
        sa.Column("adjusted_p_value", sa.Float(), nullable=False),
        sa.Column("overdispersion_phi", sa.Float(), nullable=True),
        sa.Column("overdispersion_status", sa.Text(), nullable=False),
        sa.Column("minimum_data_status", sa.Text(), nullable=False),
        sa.Column("caveat_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_statistical_pairwise_results_comparison_id",
        "statistical_pairwise_results",
        ["comparison_id"],
    )
    op.create_index(
        "ix_statistical_pairwise_results_user_id_hash",
        "statistical_pairwise_results",
        ["user_id_hash"],
    )


def downgrade() -> None:
    op.drop_table("statistical_pairwise_results")
    op.drop_table("statistical_comparison_options")
    op.drop_table("statistical_comparisons")
```

- [ ] **Step 5: Run persistence and migration tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_route_models_migration.py -q
```

Expected: PASS.

- [ ] **Step 6: Run Alembic upgrade directly**

Run:

```bash
MCA_DATABASE_URL=sqlite+pysqlite:///./dev-output/statistical-plan-check.sqlite3 .venv/bin/alembic upgrade head
```

Expected: command exits 0 and applies through `0003_statistical_comparisons`.

- [ ] **Step 7: Commit persistence**

Run:

```bash
git add app/models.py alembic/versions/0003_statistical_comparisons.py tests/test_route_models_migration.py
git commit -m "feat: persist statistical comparisons"
```

---

## Task 5: Service Layer And Analysis API

**Files:**
- Create: `app/services/analysis_service.py`
- Create: `app/api/routes_analysis.py`
- Modify: `app/main.py`
- Modify: `tests/test_statistical_comparison_service.py`
- Create: `tests/test_statistical_comparison_api.py`

- [ ] **Step 1: Add service integration tests**

Append to `tests/test_statistical_comparison_service.py`:

```python

from datetime import UTC, datetime

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.services.analysis_service import compare_site_options


def test_compare_site_options_counts_incidents_persists_and_returns_payload(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"a-{index}",
                offense_start_utc=datetime(2024, 1, 10 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"b-{index}",
                offense_start_utc=datetime(2024, 1, 1 + (index % 28), tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6205,
                longitude=-122.3493,
            )
            for index in range(28)
        ],
    )
    session.commit()

    result = compare_site_options(
        session=session,
        user_id_hash="site-user",
        options=[
            {
                "id": "site-a",
                "label": "Site A",
                "latitude": 47.6116,
                "longitude": -122.3372,
                "radius_m": 250,
            },
            {
                "id": "site-b",
                "label": "Site B",
                "latitude": 47.6205,
                "longitude": -122.3493,
                "radius_m": 250,
            },
        ],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert result["overview"]["decision_class"] == "statistically_lower"
    assert result["overview"]["recommendation_label"] == "Site A"
    assert result["analytical"]["pairwise_results"][0]["method"] in {
        "exact_conditional_poisson",
        "quasi_poisson_log_rate_ratio",
    }
    assert result["id"]
    session.close()
```

- [ ] **Step 2: Add API tests**

Create `tests/test_statistical_comparison_api.py`:

```python
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_site_comparison_api_returns_overview_and_analytical_payload(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"a-{index}",
                offense_start_utc=datetime(2024, 1, 10 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"b-{index}",
                offense_start_utc=datetime(2024, 1, 1 + (index % 28), tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6205,
                longitude=-122.3493,
            )
            for index in range(28)
        ],
    )
    session.commit()
    session.close()

    response = client.post(
        "/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "offense_category": "PROPERTY",
            "options": [
                {
                    "id": "site-a",
                    "label": "Site A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "site-b",
                    "label": "Site B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 250,
                },
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["overview"]["label"] == "Overview"
    assert payload["analytical"]["label"] == "Analytical"
    assert payload["overview"]["decision_class"] == "statistically_lower"
    assert "safe" not in payload["overview"]["summary_text"].lower()
    assert payload["analytical"]["pairwise_results"][0]["adjusted_p_value"] < 0.05

    lookup = client.get(
        f"/analysis/comparisons/{payload['id']}",
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )
    assert lookup.status_code == 200
    assert lookup.json()["id"] == payload["id"]


def test_statistical_comparison_lookup_is_scoped_to_user(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-15",
            "options": [
                {"id": "a", "label": "A", "latitude": 47.6116, "longitude": -122.3372, "radius_m": 250},
                {"id": "b", "label": "B", "latitude": 47.6205, "longitude": -122.3493, "radius_m": 250},
            ],
        },
        headers={"X-Demo-User-Id": "analysis-user@example.com"},
    )
    assert response.status_code == 200

    lookup = client.get(
        f"/analysis/comparisons/{response.json()['id']}",
        headers={"X-Demo-User-Id": "other-user@example.com"},
    )

    assert lookup.status_code == 404
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_service.py tests/test_statistical_comparison_api.py -q
```

Expected: FAIL because `app.services.analysis_service` and `/analysis` routes do not exist.

- [ ] **Step 4: Implement analysis service**

Create `app/services/analysis_service.py` with these functions:

```python
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.comparison import build_statistical_comparison
from app.analysis.exposure import (
    count_incidents_in_place_buffer,
    count_incidents_in_route_corridor,
    place_exposure_square_km_days,
    route_corridor_exposure_square_km_days,
)
from app.analysis.schemas import (
    AnalysisOptionResult,
    GeometryType,
    StatisticalComparisonResult,
)
from app.models import (
    CrimeIncident,
    RouteAlternative,
    RouteRequest,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)
from app.schemas import CrimeIncidentData


def compare_site_options(
    *,
    session: Session,
    user_id_hash: str,
    options: list[dict[str, Any]],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> dict[str, Any]:
    incidents = [_incident_data(row) for row in session.scalars(select(CrimeIncident)).all()]
    option_results: list[AnalysisOptionResult] = []
    period_counts: dict[str, list[int]] = {}
    radius_m = int(options[0]["radius_m"])
    for option in options:
        option_radius = int(option["radius_m"])
        counted = count_incidents_in_place_buffer(
            incidents=incidents,
            latitude=float(option["latitude"]),
            longitude=float(option["longitude"]),
            radius_m=option_radius,
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
            offense_category=offense_category,
            offense_subcategory=offense_subcategory,
            nibrs_group=nibrs_group,
        )
        exposure = place_exposure_square_km_days(
            radius_m=option_radius,
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
        )
        option_results.append(
            AnalysisOptionResult(
                option_id=str(option["id"]),
                option_label=str(option["label"]),
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=option_radius,
                incident_count=len(counted),
                exposure=exposure,
                exposure_unit="square_km_days",
                incident_rate=len(counted) / exposure if exposure else 0,
            ),
        )
        period_counts[str(option["id"])] = _monthly_counts(counted)

    comparison = build_statistical_comparison(
        user_id_hash=user_id_hash,
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
        radius_m=radius_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        options=option_results,
        period_counts_by_option_id=period_counts,
    )
    return _persist_and_payload(session, comparison, source_route_request_id=None)


def compare_route_request(
    *,
    session: Session,
    user_id_hash: str,
    route_request_id: str,
    radius_m: int,
    offense_category: str | None = None,
    offense_subcategory: str | None = None,
    nibrs_group: str | None = None,
) -> dict[str, Any] | None:
    route_request = session.get(RouteRequest, route_request_id)
    if route_request is None or route_request.user_id_hash != user_id_hash:
        return None
    if route_request.analysis_start_date is None or route_request.analysis_end_date is None:
        return None

    alternatives = list(
        session.scalars(
            select(RouteAlternative)
            .where(RouteAlternative.route_request_id == route_request_id)
            .where(RouteAlternative.user_id_hash == user_id_hash)
            .order_by(RouteAlternative.rank)
        ),
    )
    incidents = [_incident_data(row) for row in session.scalars(select(CrimeIncident)).all()]
    option_results: list[AnalysisOptionResult] = []
    period_counts: dict[str, list[int]] = {}
    for alternative in alternatives:
        counted = count_incidents_in_route_corridor(
            incidents=incidents,
            geometry=alternative.summary_geometry,
            radius_m=radius_m,
            analysis_start_date=route_request.analysis_start_date,
            analysis_end_date=route_request.analysis_end_date,
            offense_category=offense_category,
            offense_subcategory=offense_subcategory,
            nibrs_group=nibrs_group,
        )
        exposure = route_corridor_exposure_square_km_days(
            geometry=alternative.summary_geometry,
            radius_m=radius_m,
            analysis_start_date=route_request.analysis_start_date,
            analysis_end_date=route_request.analysis_end_date,
        )
        option_results.append(
            AnalysisOptionResult(
                option_id=alternative.id,
                option_label=alternative.route_label,
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=radius_m,
                incident_count=len(counted),
                exposure=exposure,
                exposure_unit="square_km_days",
                incident_rate=len(counted) / exposure if exposure else 0,
            ),
        )
        period_counts[alternative.id] = _monthly_counts(counted)

    comparison = build_statistical_comparison(
        user_id_hash=user_id_hash,
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=radius_m,
        analysis_start_date=route_request.analysis_start_date,
        analysis_end_date=route_request.analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        options=option_results,
        period_counts_by_option_id=period_counts,
    )
    return _persist_and_payload(session, comparison, source_route_request_id=route_request_id)


def get_comparison_payload(
    session: Session,
    comparison_id: str,
    user_id_hash: str,
) -> dict[str, Any] | None:
    comparison = session.get(StatisticalComparison, comparison_id)
    if comparison is None or comparison.user_id_hash != user_id_hash:
        return None
    options = list(
        session.scalars(
            select(StatisticalComparisonOption)
            .where(StatisticalComparisonOption.comparison_id == comparison_id)
            .where(StatisticalComparisonOption.user_id_hash == user_id_hash)
            .order_by(StatisticalComparisonOption.incident_rate, StatisticalComparisonOption.option_label),
        ),
    )
    pairwise = list(
        session.scalars(
            select(StatisticalPairwiseResult)
            .where(StatisticalPairwiseResult.comparison_id == comparison_id)
            .where(StatisticalPairwiseResult.user_id_hash == user_id_hash)
            .order_by(StatisticalPairwiseResult.option_a_label, StatisticalPairwiseResult.option_b_label),
        ),
    )
    return _comparison_model_payload(comparison, options, pairwise)


def latest_route_comparison_payload(
    session: Session,
    route_request_id: str,
    user_id_hash: str,
) -> dict[str, Any] | None:
    comparison = session.scalar(
        select(StatisticalComparison)
        .where(StatisticalComparison.source_route_request_id == route_request_id)
        .where(StatisticalComparison.user_id_hash == user_id_hash)
        .order_by(StatisticalComparison.created_at.desc()),
    )
    if comparison is None:
        return None
    return get_comparison_payload(session, comparison.id, user_id_hash)


def _persist_and_payload(
    session: Session,
    result: StatisticalComparisonResult,
    source_route_request_id: str | None,
) -> dict[str, Any]:
    comparison = StatisticalComparison(
        id=result.id,
        user_id_hash=result.user_id_hash,
        comparison_type=result.comparison_type,
        source_route_request_id=source_route_request_id,
        geometry_type=result.geometry_type.value,
        radius_m=result.radius_m,
        analysis_start_date=result.analysis_start_date,
        analysis_end_date=result.analysis_end_date,
        offense_category=result.offense_category,
        offense_subcategory=result.offense_subcategory,
        nibrs_group=result.nibrs_group,
        source_dataset=result.source_dataset,
        exposure_unit=result.exposure_unit,
        decision_class=result.decision_class.value,
        recommendation_option_id=result.recommendation_option_id,
        recommendation_label=result.recommendation_label,
        overview_summary_text=result.overview_summary_text,
        overview_caveat_text=result.overview_caveat_text,
        full_caveat_text=result.full_caveat_text,
    )
    session.add(comparison)
    session.flush()

    option_models = [
        StatisticalComparisonOption(
            comparison_id=comparison.id,
            user_id_hash=result.user_id_hash,
            option_id=option.option_id,
            option_label=option.option_label,
            geometry_type=option.geometry_type.value,
            radius_m=option.radius_m,
            incident_count=option.incident_count,
            exposure=option.exposure,
            exposure_unit=option.exposure_unit,
            incident_rate=option.incident_rate,
        )
        for option in result.options
    ]
    pairwise_models = [
        StatisticalPairwiseResult(
            id=pairwise.id,
            comparison_id=comparison.id,
            user_id_hash=result.user_id_hash,
            option_a_id=pairwise.option_a_id,
            option_a_label=pairwise.option_a_label,
            option_b_id=pairwise.option_b_id,
            option_b_label=pairwise.option_b_label,
            winner_option_id=pairwise.winner_option_id,
            winner_label=pairwise.winner_label,
            decision_class=pairwise.decision_class.value,
            method=pairwise.method,
            incident_count_a=pairwise.incident_count_a,
            incident_count_b=pairwise.incident_count_b,
            exposure_a=pairwise.exposure_a,
            exposure_b=pairwise.exposure_b,
            exposure_unit=pairwise.exposure_unit,
            rate_a=pairwise.rate_a,
            rate_b=pairwise.rate_b,
            rate_ratio=pairwise.rate_ratio,
            ci_lower=pairwise.ci_lower,
            ci_upper=pairwise.ci_upper,
            p_value=pairwise.p_value,
            adjusted_p_value=pairwise.adjusted_p_value,
            overdispersion_phi=pairwise.overdispersion_phi,
            overdispersion_status=pairwise.overdispersion_status,
            minimum_data_status=pairwise.minimum_data_status,
            caveat_text=pairwise.caveat_text,
        )
        for pairwise in result.pairwise_results
    ]
    session.add_all(option_models + pairwise_models)
    session.commit()
    return get_comparison_payload(session, comparison.id, result.user_id_hash) or {}


def _comparison_model_payload(
    comparison: StatisticalComparison,
    options: list[StatisticalComparisonOption],
    pairwise: list[StatisticalPairwiseResult],
) -> dict[str, Any]:
    return {
        "id": comparison.id,
        "comparison_type": comparison.comparison_type,
        "geometry_type": comparison.geometry_type,
        "radius_m": comparison.radius_m,
        "analysis_start_date": comparison.analysis_start_date,
        "analysis_end_date": comparison.analysis_end_date,
        "offense_category": comparison.offense_category,
        "offense_subcategory": comparison.offense_subcategory,
        "nibrs_group": comparison.nibrs_group,
        "overview": {
            "label": "Overview",
            "decision_class": comparison.decision_class,
            "recommendation_option_id": comparison.recommendation_option_id,
            "recommendation_label": comparison.recommendation_label,
            "summary_text": comparison.overview_summary_text,
            "caveat_text": comparison.overview_caveat_text,
            "options": [_option_payload(option) for option in options],
        },
        "analytical": {
            "label": "Analytical",
            "source_dataset": comparison.source_dataset,
            "exposure_unit": comparison.exposure_unit,
            "full_caveat_text": comparison.full_caveat_text,
            "options": [_option_payload(option) for option in options],
            "pairwise_results": [_pairwise_payload(result) for result in pairwise],
        },
        "created_at": comparison.created_at,
    }


def _option_payload(option: StatisticalComparisonOption) -> dict[str, Any]:
    return {
        "option_id": option.option_id,
        "option_label": option.option_label,
        "geometry_type": option.geometry_type,
        "radius_m": option.radius_m,
        "incident_count": option.incident_count,
        "exposure": option.exposure,
        "exposure_unit": option.exposure_unit,
        "incident_rate": option.incident_rate,
    }


def _pairwise_payload(result: StatisticalPairwiseResult) -> dict[str, Any]:
    return {
        "id": result.id,
        "option_a_id": result.option_a_id,
        "option_a_label": result.option_a_label,
        "option_b_id": result.option_b_id,
        "option_b_label": result.option_b_label,
        "winner_option_id": result.winner_option_id,
        "winner_label": result.winner_label,
        "decision_class": result.decision_class,
        "method": result.method,
        "incident_count_a": result.incident_count_a,
        "incident_count_b": result.incident_count_b,
        "exposure_a": result.exposure_a,
        "exposure_b": result.exposure_b,
        "exposure_unit": result.exposure_unit,
        "rate_a": result.rate_a,
        "rate_b": result.rate_b,
        "rate_ratio": result.rate_ratio,
        "ci_lower": result.ci_lower,
        "ci_upper": result.ci_upper,
        "p_value": result.p_value,
        "adjusted_p_value": result.adjusted_p_value,
        "overdispersion_phi": result.overdispersion_phi,
        "overdispersion_status": result.overdispersion_status,
        "minimum_data_status": result.minimum_data_status,
        "caveat_text": result.caveat_text,
    }


def _monthly_counts(incidents: list[CrimeIncidentData]) -> list[int]:
    counts: dict[tuple[int, int], int] = {}
    for incident in incidents:
        observed = incident.offense_start_utc or incident.report_utc
        if observed is None:
            continue
        key = (observed.year, observed.month)
        counts[key] = counts.get(key, 0) + 1
    return list(counts.values())


def _incident_data(row: CrimeIncident) -> CrimeIncidentData:
    return CrimeIncidentData(
        id=row.id,
        external_incident_id=row.external_incident_id,
        report_number=row.report_number,
        offense_id=row.offense_id,
        offense_start_utc=row.offense_start_utc,
        offense_end_utc=row.offense_end_utc,
        report_utc=row.report_utc,
        offense_category=row.offense_category,
        offense_subcategory=row.offense_subcategory,
        nibrs_group=row.nibrs_group,
        precinct=row.precinct,
        sector=row.sector,
        beat=row.beat,
        mcpp=row.mcpp,
        block_address=row.block_address,
        latitude=row.latitude,
        longitude=row.longitude,
        source_dataset=row.source_dataset,
        snapshot_at=row.snapshot_at,
    )
```

- [ ] **Step 5: Implement API router and register it**

Create `app/api/routes_analysis.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.analysis.schemas import RouteComparisonRequest, SiteComparisonRequest
from app.api.deps import current_user_hash
from app.db import get_session
from app.services.analysis_service import (
    compare_route_request,
    compare_site_options,
    get_comparison_payload,
)

router = APIRouter()


@router.post("/analysis/sites/compare")
def compare_sites(
    request: SiteComparisonRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    return compare_site_options(
        session=session,
        user_id_hash=user_id_hash,
        options=[option.model_dump() for option in request.options],
        analysis_start_date=request.analysis_start_date,
        analysis_end_date=request.analysis_end_date,
        offense_category=request.offense_category,
        offense_subcategory=request.offense_subcategory,
        nibrs_group=request.nibrs_group,
    )


@router.post("/analysis/routes/compare")
def compare_routes(
    request: RouteComparisonRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = compare_route_request(
        session=session,
        user_id_hash=user_id_hash,
        route_request_id=request.route_request_id,
        radius_m=request.radius_m,
        offense_category=request.offense_category,
        offense_subcategory=request.offense_subcategory,
        nibrs_group=request.nibrs_group,
    )
    if payload is None:
        raise HTTPException(status_code=404, detail="Route request not found or not analyzable")
    return payload


@router.get("/analysis/comparisons/{comparison_id}")
def comparison_detail(
    comparison_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = get_comparison_payload(session, comparison_id, user_id_hash)
    if payload is None:
        raise HTTPException(status_code=404, detail="Statistical comparison not found")
    return payload
```

Modify `app/main.py`:

```python
from app.api.routes_analysis import router as analysis_router
```

and include the router before dashboard/export routes:

```python
    app.include_router(analysis_router)
```

- [ ] **Step 6: Run service and API tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_service.py tests/test_statistical_comparison_api.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit service and API**

Run:

```bash
git add app/services/analysis_service.py app/api/routes_analysis.py app/main.py tests/test_statistical_comparison_service.py tests/test_statistical_comparison_api.py
git commit -m "feat: expose statistical comparison api"
```

---

## Task 6: Route Dashboard Integration

**Files:**
- Modify: `app/services/route_service.py`
- Modify: `tests/test_route_alternatives_api.py`

- [ ] **Step 1: Write failing route integration tests**

Append to `tests/test_route_alternatives_api.py`:

```python

def test_route_alternatives_response_includes_statistical_comparison_when_analyzable(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-stat-user@example.com"}
    client.post("/crime/ingest/sample")

    response = client.post(
        "/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["statistical_comparison"]["overview"]["label"] == "Overview"
    assert payload["statistical_comparison"]["analytical"]["label"] == "Analytical"

    lookup = client.get(
        f"/routes/requests/{payload['request']['id']}/comparison",
        headers=headers,
    )

    assert lookup.status_code == 200
    assert lookup.json()["statistical_comparison"]["id"] == payload["statistical_comparison"]["id"]


def test_route_alternatives_are_sorted_with_statistical_winner_first(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-stat-sort-user@example.com"}
    client.post("/crime/ingest/sample")

    response = client.post(
        "/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    recommendation = payload["statistical_comparison"]["overview"]["recommendation_option_id"]
    if recommendation is not None:
        assert payload["alternatives"][0]["id"] == recommendation
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_route_alternatives_api.py -q
```

Expected: FAIL because route comparison payloads do not include `statistical_comparison`.

- [ ] **Step 3: Wire comparison into route service**

Modify `app/services/route_service.py` imports:

```python
from app.services.analysis_service import compare_route_request, latest_route_comparison_payload
```

After route context summaries are added and before `session.commit()` in `create_route_alternatives`, keep the existing `session.add_all(...)`, then commit route rows first, then compute a statistical comparison:

```python
    session.commit()

    if route_request.analysis_start_date and route_request.analysis_end_date and request_payload.radii_m:
        compare_route_request(
            session=session,
            user_id_hash=user_id_hash,
            route_request_id=route_request.id,
            radius_m=request_payload.radii_m[0],
        )
    return get_route_comparison(session, route_request.id, user_id_hash) or {}
```

In `get_route_comparison`, fetch the latest statistical comparison:

```python
    statistical_comparison = latest_route_comparison_payload(session, request_id, user_id_hash)
```

Return it as:

```python
    payload = {
        "request": _request_to_dict(route_request),
        "alternatives": _sort_alternatives_for_payload(
            [
                _alternative_to_dict(alternative, segments.get(alternative.id, []))
                for alternative in alternatives
            ],
            statistical_comparison,
        ),
        "context_summaries": summaries,
        "statistical_comparison": statistical_comparison,
    }
    return payload
```

Add this helper:

```python
def _sort_alternatives_for_payload(
    alternatives: list[dict[str, Any]],
    statistical_comparison: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    recommendation_id = None
    if statistical_comparison:
        recommendation_id = statistical_comparison["overview"].get("recommendation_option_id")
    return sorted(
        alternatives,
        key=lambda alternative: (
            alternative["id"] != recommendation_id if recommendation_id else False,
            alternative.get("duration_minutes") is None,
            alternative.get("duration_minutes") or 0,
            alternative.get("transfer_count") or 0,
            alternative.get("walking_distance_m") or 0,
            alternative.get("rank") or 0,
        ),
    )
```

- [ ] **Step 4: Run route integration tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_route_alternatives_api.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit route integration**

Run:

```bash
git add app/services/route_service.py tests/test_route_alternatives_api.py
git commit -m "feat: include statistical route comparison"
```

---

## Task 7: Tableau Export And Documentation

**Files:**
- Create: `app/exports/statistical.py`
- Create: `app/services/statistical_export_service.py`
- Modify: `app/api/routes_exports.py`
- Create: `tests/test_statistical_comparison_exports.py`
- Create: `docs/analysis/statistical-route-place-comparison.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing export tests**

Create `tests/test_statistical_comparison_exports.py`:

```python
import csv
from datetime import UTC, datetime
from io import StringIO

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_statistical_comparison_tableau_export_includes_audit_fields(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"a-{index}",
                offense_start_utc=datetime(2024, 1, 10 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"b-{index}",
                offense_start_utc=datetime(2024, 1, 1 + (index % 28), tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6205,
                longitude=-122.3493,
            )
            for index in range(28)
        ],
    )
    session.commit()
    session.close()

    compare = client.post(
        "/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "offense_category": "PROPERTY",
            "options": [
                {"id": "site-a", "label": "Site A", "latitude": 47.6116, "longitude": -122.3372, "radius_m": 250},
                {"id": "site-b", "label": "Site B", "latitude": 47.6205, "longitude": -122.3493, "radius_m": 250},
            ],
        },
        headers={"X-Demo-User-Id": "export-user@example.com"},
    )
    assert compare.status_code == 200

    export = client.get(
        "/exports/tableau/statistical-comparisons.csv",
        headers={"X-Demo-User-Id": "export-user@example.com"},
    )

    assert export.status_code == 200
    assert export.headers["content-disposition"] == "attachment; filename=statistical-comparisons.csv"
    rows = list(csv.DictReader(StringIO(export.text)))
    assert rows
    assert rows[0].keys() == {
        "comparison_id",
        "comparison_type",
        "option_a_id",
        "option_a_label",
        "option_b_id",
        "option_b_label",
        "winner_option_id",
        "winner_label",
        "decision_class",
        "method",
        "radius_m",
        "analysis_start_date",
        "analysis_end_date",
        "offense_category",
        "offense_subcategory",
        "incident_count_a",
        "incident_count_b",
        "exposure_a",
        "exposure_b",
        "exposure_unit",
        "rate_a",
        "rate_b",
        "rate_ratio",
        "ci_lower",
        "ci_upper",
        "p_value",
        "adjusted_p_value",
        "overdispersion_phi",
        "overdispersion_status",
        "minimum_data_status",
        "overview_summary_text",
        "caveat_text",
        "created_at",
    }
    assert rows[0]["comparison_id"] == compare.json()["id"]
    assert rows[0]["decision_class"] in {
        "statistically_lower",
        "not_statistically_clear",
        "insufficient_data",
        "model_warning",
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_exports.py -q
```

Expected: FAIL because the statistical comparison export endpoint does not exist.

- [ ] **Step 3: Implement CSV builder and export service**

Create `app/exports/statistical.py`:

```python
from __future__ import annotations

import csv
from collections.abc import Iterable, Mapping
from io import StringIO
from typing import Any

STATISTICAL_COMPARISON_COLUMNS = [
    "comparison_id",
    "comparison_type",
    "option_a_id",
    "option_a_label",
    "option_b_id",
    "option_b_label",
    "winner_option_id",
    "winner_label",
    "decision_class",
    "method",
    "radius_m",
    "analysis_start_date",
    "analysis_end_date",
    "offense_category",
    "offense_subcategory",
    "incident_count_a",
    "incident_count_b",
    "exposure_a",
    "exposure_b",
    "exposure_unit",
    "rate_a",
    "rate_b",
    "rate_ratio",
    "ci_lower",
    "ci_upper",
    "p_value",
    "adjusted_p_value",
    "overdispersion_phi",
    "overdispersion_status",
    "minimum_data_status",
    "overview_summary_text",
    "caveat_text",
    "created_at",
]


def build_statistical_comparisons_csv(rows: Iterable[Mapping[str, Any]]) -> str:
    output = StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=STATISTICAL_COMPARISON_COLUMNS,
        extrasaction="ignore",
    )
    writer.writeheader()
    for row in rows:
        writer.writerow({column: _csv_value(row.get(column)) for column in STATISTICAL_COMPARISON_COLUMNS})
    return output.getvalue()


def _csv_value(value: Any) -> Any:
    if value is None:
        return ""
    return value
```

Create `app/services/statistical_export_service.py`:

```python
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exports.statistical import build_statistical_comparisons_csv
from app.models import StatisticalComparison, StatisticalPairwiseResult


def tableau_statistical_comparisons_csv(session: Session, user_id_hash: str) -> str:
    rows = session.execute(
        select(StatisticalComparison, StatisticalPairwiseResult)
        .join(
            StatisticalPairwiseResult,
            StatisticalPairwiseResult.comparison_id == StatisticalComparison.id,
        )
        .where(StatisticalComparison.user_id_hash == user_id_hash)
        .where(StatisticalPairwiseResult.user_id_hash == user_id_hash)
        .order_by(
            StatisticalComparison.created_at,
            StatisticalComparison.id,
            StatisticalPairwiseResult.option_a_label,
            StatisticalPairwiseResult.option_b_label,
        ),
    ).all()
    return build_statistical_comparisons_csv(
        [_export_row(comparison, pairwise) for comparison, pairwise in rows],
    )


def _export_row(
    comparison: StatisticalComparison,
    pairwise: StatisticalPairwiseResult,
) -> dict[str, object]:
    return {
        "comparison_id": comparison.id,
        "comparison_type": comparison.comparison_type,
        "option_a_id": pairwise.option_a_id,
        "option_a_label": pairwise.option_a_label,
        "option_b_id": pairwise.option_b_id,
        "option_b_label": pairwise.option_b_label,
        "winner_option_id": pairwise.winner_option_id,
        "winner_label": pairwise.winner_label,
        "decision_class": pairwise.decision_class,
        "method": pairwise.method,
        "radius_m": comparison.radius_m,
        "analysis_start_date": comparison.analysis_start_date,
        "analysis_end_date": comparison.analysis_end_date,
        "offense_category": comparison.offense_category,
        "offense_subcategory": comparison.offense_subcategory,
        "incident_count_a": pairwise.incident_count_a,
        "incident_count_b": pairwise.incident_count_b,
        "exposure_a": pairwise.exposure_a,
        "exposure_b": pairwise.exposure_b,
        "exposure_unit": pairwise.exposure_unit,
        "rate_a": pairwise.rate_a,
        "rate_b": pairwise.rate_b,
        "rate_ratio": pairwise.rate_ratio,
        "ci_lower": pairwise.ci_lower,
        "ci_upper": pairwise.ci_upper,
        "p_value": pairwise.p_value,
        "adjusted_p_value": pairwise.adjusted_p_value,
        "overdispersion_phi": pairwise.overdispersion_phi,
        "overdispersion_status": pairwise.overdispersion_status,
        "minimum_data_status": pairwise.minimum_data_status,
        "overview_summary_text": comparison.overview_summary_text,
        "caveat_text": pairwise.caveat_text or comparison.full_caveat_text,
        "created_at": comparison.created_at,
    }
```

- [ ] **Step 4: Add export endpoint**

Modify `app/api/routes_exports.py` imports:

```python
from app.services.statistical_export_service import tableau_statistical_comparisons_csv
```

Add endpoint:

```python
@router.get("/exports/tableau/statistical-comparisons.csv")
def export_statistical_comparisons(
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    return Response(
        content=tableau_statistical_comparisons_csv(session, user_id_hash),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=statistical-comparisons.csv"},
    )
```

- [ ] **Step 5: Write analysis documentation**

Create `docs/analysis/statistical-route-place-comparison.md` with these sections:

```markdown
# Statistical Route And Place Comparison

## What The App Can Claim

The app can say that one route or site has a statistically lower reported-incident rate
than another route or site for the selected date range, geography, radius, offense filter,
and method.

The app cannot say that a route is safe, unsafe, dangerous, risk-free, or that a route
prevents crime.

## Why Raw Counts Are Not Enough

Raw incident counts do not account for route length, buffer size, or analysis period.
This app compares exposure-adjusted rates so a long route corridor is not treated the
same as a small place buffer.

## Exposure

Place exposure is the buffer area in square kilometers multiplied by analysis days.

Route exposure is the route corridor area in square kilometers multiplied by analysis
days. The first route corridor area estimate uses route length and corridor radius:

```text
route_corridor_area_square_km = (route_length_km * 2 * radius_km) + pi * radius_km^2
```

## Incident Inclusion

Incidents are included only when they have usable coordinates, fall within the selected
date range, match the selected offense filters, and fall inside the selected place buffer
or route corridor.

## Statistical Test

The app compares two exposure-adjusted count rates. The default test is an exact
conditional Poisson comparison. If period counts are overdispersed, the app uses a
quasi-Poisson log-rate-ratio adjustment.

## Multiple Comparisons

When more than two options are compared, the app applies Benjamini-Hochberg adjustment to
pairwise p-values. A route is recommended only when it passes the conservative threshold
against every relevant alternative.

## Recommendation Threshold

A lower-incident recommendation requires all of the following:

- adjusted p-value below 0.05,
- adjusted rate ratio less than or equal to 0.80,
- at least 30 analysis days,
- positive exposure for every compared option,
- combined incident count of at least 10,
- no unhandled model warning.

## Dashboard Modes

`Overview` is the public summary. It shows compared options, adjusted rates, the decision
class, plain-language result text, and a short caveat.

`Analytical` is the audit view. It shows counts, exposure, rate ratio, confidence
interval, p-values, overdispersion status, minimum-data status, method, filters, and full
caveats.

Both modes read the same backend result.

## Decision Classes

- `statistically_lower`: one option has a statistically clear and practically meaningful
  lower reported-incident rate.
- `not_statistically_clear`: differences exist, but they do not pass the conservative
  threshold.
- `insufficient_data`: date range, exposure, or counts are too sparse.
- `model_warning`: the model detected a limitation that needs analytical review.
```

- [ ] **Step 6: Update README**

Add a README section:

```markdown
## Statistical Route And Place Comparison

The app can compare public place buffers and route corridors using exposure-adjusted
reported SPD incident rates. Statistical comparison payloads include two dashboard modes:

- `Overview`: public summary text, decision class, adjusted rates, and short caveat.
- `Analytical`: counts, exposure, rate ratio, confidence interval, p-values, method,
  overdispersion status, minimum-data status, filters, and full caveats.

Endpoints:

```text
POST /analysis/sites/compare
POST /analysis/routes/compare
GET /analysis/comparisons/{comparison_id}
GET /exports/tableau/statistical-comparisons.csv
```

The app may say "lower reported-incident rate." It must not say a route is safe, unsafe,
dangerous, risk-free, or crime-preventing.
```

- [ ] **Step 7: Run export and docs checks**

Run:

```bash
.venv/bin/python -m pytest tests/test_statistical_comparison_exports.py -q
rg -n "safe|unsafe|dangerous|risk-free|prevents crime|you should take this route" app docs README.md
```

Expected: pytest PASS. The `rg` command may return hits in approved disallowed-language lists or documentation explaining what not to claim; there should be no generated product string that tells a user an option is safe or unsafe.

- [ ] **Step 8: Commit exports and docs**

Run:

```bash
git add app/exports/statistical.py app/services/statistical_export_service.py app/api/routes_exports.py tests/test_statistical_comparison_exports.py docs/analysis/statistical-route-place-comparison.md README.md
git commit -m "feat: export statistical comparisons"
```

---

## Task 8: Full Verification And Final Review

**Files:**
- Review all files changed by Tasks 1-7.

- [ ] **Step 1: Run focused statistical tests**

Run:

```bash
.venv/bin/python -m pytest \
  tests/test_analysis_rate_tests.py \
  tests/test_analysis_exposure.py \
  tests/test_statistical_comparison_service.py \
  tests/test_statistical_comparison_api.py \
  tests/test_statistical_comparison_exports.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Run route regression tests**

Run:

```bash
.venv/bin/python -m pytest \
  tests/test_route_context.py \
  tests/test_route_alternatives_api.py \
  tests/test_route_tableau_exports.py \
  tests/test_route_models_migration.py \
  -q
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
.venv/bin/python -m pytest tests -q
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
.venv/bin/ruff check .
```

Expected: PASS.

- [ ] **Step 5: Run migration check**

Run:

```bash
MCA_DATABASE_URL=sqlite+pysqlite:///./dev-output/statistical-final.sqlite3 .venv/bin/alembic upgrade head
```

Expected: command exits 0.

- [ ] **Step 6: Run product-language scan**

Run:

```bash
rg -n "you should take this route|this route prevents crime|risk-free" app tests docs README.md
```

Expected: hits only in disallowed-language documentation or tests that enforce absence.

- [ ] **Step 7: Final commit if verification changes files**

If verification produces documentation or test fixture edits, commit them:

```bash
git add README.md docs/analysis/statistical-route-place-comparison.md tests app alembic
git commit -m "test: verify statistical comparison workflow"
```

If there are no file changes, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Exposure-adjusted rates: Task 2 and Task 3.
- Place/site comparison: Task 5.
- Route comparison and route alternatives: Task 5 and Task 6.
- Conservative statistical threshold: Task 1 and Task 3.
- Overdispersion handling: Task 1 and Task 3.
- Multiple-comparison adjustment: Task 1 and Task 3.
- Minimum data rules: Task 1 and Task 3.
- `Overview` and `Analytical` UI modes: Task 5, Task 6, and Task 7.
- Tableau export: Task 7.
- Public analysis documentation: Task 7.
- Regression verification: Task 8.

Type consistency:

- `DecisionClass` values match model strings and API payloads.
- `GeometryType` values match persistence strings.
- `overview_summary_text`, `overview_caveat_text`, and `full_caveat_text` match the approved spec.
- Export columns match the approved Tableau export design.
