from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator

from app.schemas import new_id


class GeometryType(StrEnum):
    PLACE_BUFFER = "place_buffer"
    ROUTE_CORRIDOR = "route_corridor"
    ROUTE_DIVERGENT_CORRIDOR = "route_divergent_corridor"


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
    exact_p_value: float | None = None


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

    @model_validator(mode="after")
    def validate_option_identity_and_radius(self) -> SiteComparisonRequest:
        option_ids = [option.id for option in self.options]
        if len(set(option_ids)) != len(option_ids):
            raise ValueError("Site comparison option ids must be unique.")
        radii = {option.radius_m for option in self.options}
        if len(radii) > 1:
            raise ValueError("Site comparison options must use the same radius.")
        return self


class RouteComparisonRequest(BaseModel):
    route_request_id: str
    radius_m: int = Field(gt=0, le=5000)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    sources: list[str] | None = None


class PairDivergenceInput(BaseModel):
    option_a_id: str
    option_b_id: str
    count_a: int
    count_b: int
    exposure_a: float
    exposure_b: float
    period_counts_a: list[int]
    period_counts_b: list[int]
    divergent_share_a: float
    divergent_share_b: float


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
