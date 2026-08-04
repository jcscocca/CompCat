from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.api.dashboard_schemas import (
    AnalysisPoint,
    AnalysisWindow,
    DashboardRadiusMeters,
    OffenseFilter,
)
from app.crime.sources import LAYER_ARRESTS, LAYER_CALLS, LAYER_REPORTED, LAYERS

REPORT_SCHEMA_VERSION = "1.1"
REPORT_METHOD_VERSION = "analysis-report-v1"
REPORT_PROFILE_VERSION = "1.0"


class SelectionKind(StrEnum):
    SINGLE_PLACE = "single_place"
    MULTI_PLACE = "multi_place"


class ComparisonMode(StrEnum):
    NONE = "none"
    DESCRIPTIVE = "descriptive"
    MODELED = "modeled"


class ReportStatus(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    INSUFFICIENT_DATA = "insufficient_data"


class SectionState(StrEnum):
    COMPLETE = "complete"
    OMITTED = "omitted"
    FAILED = "failed"
    TRUNCATED = "truncated"


class CountingBasis(StrEnum):
    UNIQUE_SOURCE_RECORDS = "unique_source_records"
    PER_PLACE_MEMBERSHIP = "per_place_membership"


class AnalysisReportRequest(AnalysisWindow):
    """One-radius report request. Exactly one saved or inline selection is accepted."""

    place_ids: list[str] | None = Field(default=None, min_length=1, max_length=10)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=1, max_length=10)
    radius_m: DashboardRadiusMeters
    offense_category: OffenseFilter = None
    offense_subcategory: OffenseFilter = None
    arrest_offense_description: OffenseFilter = None
    call_type: OffenseFilter = None
    nibrs_group: OffenseFilter = None
    layer: str = "reported"
    adjust_to_available_dates: bool = False
    record_limit: int = Field(default=100, ge=1, le=500)

    @model_validator(mode="after")
    def validate_selection_and_layer_filters(self) -> AnalysisReportRequest:
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        if self.place_ids is not None and len(self.place_ids) != len(set(self.place_ids)):
            raise ValueError("place_ids values must be unique")
        if self.layer not in LAYERS:
            allowed = ", ".join(sorted(LAYERS))
            raise ValueError(f"layer must be one of: {allowed}")
        if self.layer == LAYER_REPORTED and (
            self.arrest_offense_description is not None or self.call_type is not None
        ):
            raise ValueError(
                "reported-incident reports do not support arrest_offense_description or call_type"
            )
        if self.layer == LAYER_ARRESTS and (
            self.offense_subcategory is not None or self.call_type is not None
        ):
            raise ValueError(
                "arrest reports use arrest_offense_description instead of offense_subcategory"
            )
        if self.layer == LAYER_CALLS and any(
            value is not None
            for value in (
                self.offense_category,
                self.offense_subcategory,
                self.arrest_offense_description,
                self.nibrs_group,
            )
        ):
            raise ValueError("911 call reports support call_type only")
        return self


class ReportLayerCapabilities(BaseModel):
    reference_context: bool
    modeled_comparison: bool
    contextual_trend: bool = False


class ReportLayerProfile(BaseModel):
    profile_version: str = REPORT_PROFILE_VERSION
    layer: str
    report_title: str
    source_dataset: str
    counting_unit: str
    counting_unit_label: str
    record_noun_singular: str
    record_noun_plural: str
    primary_time_field: str
    primary_time_label: str
    secondary_time_field: str | None = None
    secondary_time_label: str | None = None
    subtype_field: str
    subtype_label: str
    supported_filters: list[str]
    capabilities: ReportLayerCapabilities
    disclosures: list[str]


class ReportFilters(BaseModel):
    offense_category: str | None = None
    offense_subcategory: str | None = None
    arrest_offense_description: str | None = None
    call_type: str | None = None
    nibrs_group: str | None = None


class ReportScope(BaseModel):
    layer: str
    source_dataset: str
    counting_unit: str
    requested_start_date: date
    requested_end_date: date
    effective_start_date: date
    effective_end_date: date
    available_start_date: date
    latest_recorded_event_date: date | None = None
    latest_row_ingested_at: datetime | None = None
    confirmed_data_through: date | None = None
    radius_m: int
    filters: ReportFilters


class ReportSelection(BaseModel):
    selection_id: str
    label: str
    latitude: float
    longitude: float


class ReportOverlapSummary(BaseModel):
    shared_source_record_count: int = Field(ge=0)
    additional_membership_count: int = Field(ge=0)
    maximum_places_per_record: int = Field(ge=0)


class ReportOverviewSection(BaseModel):
    counting_unit: str
    unique_counting_basis: Literal[CountingBasis.UNIQUE_SOURCE_RECORDS] = (
        CountingBasis.UNIQUE_SOURCE_RECORDS
    )
    membership_counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = (
        CountingBasis.PER_PLACE_MEMBERSHIP
    )
    unique_source_record_count: int = Field(ge=0)
    membership_count: int = Field(ge=0)
    overlap_summary: ReportOverlapSummary | None = None
    returned_record_count: int = Field(ge=0)
    record_limit: int = Field(ge=1)
    records_truncated: bool

    @model_validator(mode="after")
    def validate_overlap_summary(self) -> ReportOverviewSection:
        if self.membership_count < self.unique_source_record_count:
            raise ValueError("membership_count cannot be less than unique_source_record_count")
        if self.overlap_summary is None:
            return self
        overlap = self.overlap_summary
        if overlap.additional_membership_count != (
            self.membership_count - self.unique_source_record_count
        ):
            raise ValueError("additional memberships must reconcile overview counts")
        if overlap.shared_source_record_count > self.unique_source_record_count:
            raise ValueError("shared source records cannot exceed unique source records")
        expected_minimum_max = 0 if self.unique_source_record_count == 0 else 1
        if overlap.maximum_places_per_record < expected_minimum_max:
            raise ValueError("maximum places per record is inconsistent with the record count")
        if overlap.shared_source_record_count == 0 and (
            overlap.additional_membership_count != 0
            or overlap.maximum_places_per_record > expected_minimum_max
        ):
            raise ValueError("overlap summary reports memberships without shared source records")
        if overlap.shared_source_record_count > 0 and overlap.maximum_places_per_record < 2:
            raise ValueError("shared source records require at least two place memberships")
        return self


class ReportBreakdownRow(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    label: str
    count: int = Field(ge=0)
    share: float = Field(ge=0, le=1)


class ReportTemporalSection(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    hour_counts: list[int] = Field(min_length=24, max_length=24)
    dow_counts: list[int] = Field(min_length=7, max_length=7)
    monthly_counts: dict[str, int]
    with_primary_time: int = Field(ge=0)
    without_primary_time: int = Field(ge=0)


class ReportReferenceDistribution(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    kind: str
    label: str
    available: bool
    adequacy_status: str
    sampling_frame: str
    sampling_frame_version: str
    computation: str | None = None
    geography_components: list[dict[str, Any]]
    reference_center_count: int = Field(ge=0)
    reference_draw_count: int = Field(ge=0)
    monte_carlo_error: float | None = None
    covered_area_share: float
    effective_geographies: float
    target_count: int = Field(ge=0)
    p10: int | None = None
    p25: int | None = None
    median: int | None = None
    p75: int | None = None
    p90: int | None = None
    share_below: float | None = None
    share_equal: float | None = None
    share_above: float | None = None
    midrank_percentile: float | None = None
    warnings: list[str]


class ReportPlaceContext(BaseModel):
    selection_id: str
    label: str
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    record_count: int = Field(ge=0)
    type_mix: list[ReportBreakdownRow]
    temporal: ReportTemporalSection
    coordinate_coverage: dict[str, Any] | None = None
    reference_context: list[ReportReferenceDistribution] = Field(default_factory=list)


class ReportComparisonOption(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    selection_id: str
    label: str
    record_count: int = Field(ge=0)
    exposure: float
    exposure_unit: str
    record_rate: float
    rate_ci_lower: float | None = None
    rate_ci_upper: float | None = None
    rate_ci_method: str | None = None


class ReportPairwiseComparison(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    selection_a_id: str
    selection_a_label: str
    selection_b_id: str
    selection_b_label: str
    decision_class: str
    method: str
    record_count_a: int = Field(ge=0)
    record_count_b: int = Field(ge=0)
    rate_a: float
    rate_b: float
    rate_ratio: float
    ci_lower: float
    ci_upper: float
    p_value: float
    adjusted_p_value: float
    overdispersion_phi: float | None = None
    overdispersion_status: str
    minimum_data_status: str
    caveat_text: str


class ReportComparisonSection(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    method_family: str
    decision_class: str
    summary_text: str
    caveat_text: str
    options: list[ReportComparisonOption]
    pairwise_results: list[ReportPairwiseComparison]


class ReportRecord(BaseModel):
    selection_id: str
    place_label: str
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    source_dataset: str
    primary_time: datetime | None = None
    secondary_time: datetime | None = None
    offense_category: str | None = None
    offense_subcategory: str | None = None
    arrest_offense_description: str | None = None
    call_type: str | None = None
    nibrs_group: str | None = None
    distance_m: float = Field(ge=0)
    duplicate_across_places: bool


class ReportRecordsSection(BaseModel):
    counting_unit: str
    counting_basis: Literal[CountingBasis.PER_PLACE_MEMBERSHIP] = CountingBasis.PER_PLACE_MEMBERSHIP
    total_membership_count: int = Field(ge=0)
    returned_count: int = Field(ge=0)
    limit: int = Field(ge=1)
    truncated: bool
    records: list[ReportRecord]


class ReportSections(BaseModel):
    overview: ReportOverviewSection
    place_context: list[ReportPlaceContext]
    comparison: ReportComparisonSection | None = None
    records: ReportRecordsSection


class ReportSectionStatus(BaseModel):
    section: str
    state: SectionState
    reason: str | None = None


class ReportExportPolicy(BaseModel):
    artifact_coordinate_decimals: Literal[3] = 3
    exact_coordinates_in_artifact: Literal[False] = False
    includes_owner_hash: Literal[False] = False
    includes_internal_place_ids: Literal[False] = False
    persisted_server_side: bool
    privacy_policy_checked_at: datetime
    download_revalidation: Literal["block_if_saved_place_deleted_or_sensitive"]


class AnalysisReport(BaseModel):
    report_id: str | None = None
    schema_version: str = REPORT_SCHEMA_VERSION
    method_version: str = REPORT_METHOD_VERSION
    profile: ReportLayerProfile
    selection_kind: SelectionKind
    comparison_mode: ComparisonMode
    status: ReportStatus
    generated_at: datetime
    scope: ReportScope
    selection: list[ReportSelection]
    sections: ReportSections
    section_statuses: list[ReportSectionStatus]
    disclosures: list[str]
    export_policy: ReportExportPolicy

    @model_validator(mode="after")
    def validate_contract_consistency(self) -> AnalysisReport:
        expected_unit = self.scope.counting_unit
        if (
            self.profile.layer != self.scope.layer
            or self.profile.source_dataset != self.scope.source_dataset
            or self.profile.counting_unit != expected_unit
        ):
            raise ValueError("profile and scope must describe the same report layer")

        units = [
            self.sections.overview.counting_unit,
            self.sections.records.counting_unit,
            *(place.counting_unit for place in self.sections.place_context),
            *(place.temporal.counting_unit for place in self.sections.place_context),
            *(row.counting_unit for place in self.sections.place_context for row in place.type_mix),
            *(
                row.counting_unit
                for place in self.sections.place_context
                for row in place.reference_context
            ),
            *(record.counting_unit for record in self.sections.records.records),
        ]
        if self.sections.comparison is not None:
            units.extend(
                [
                    self.sections.comparison.counting_unit,
                    *(option.counting_unit for option in self.sections.comparison.options),
                    *(row.counting_unit for row in self.sections.comparison.pairwise_results),
                ]
            )
        if any(unit != expected_unit for unit in units):
            raise ValueError("every report section must use scope.counting_unit")

        selection_ids = [selection.selection_id for selection in self.selection]
        if len(selection_ids) != len(set(selection_ids)):
            raise ValueError("selection ids must be unique")
        allowed_ids = set(selection_ids)
        referenced_ids = {
            *(place.selection_id for place in self.sections.place_context),
            *(record.selection_id for record in self.sections.records.records),
        }
        if self.sections.comparison is not None:
            referenced_ids.update(
                option.selection_id for option in self.sections.comparison.options
            )
            for row in self.sections.comparison.pairwise_results:
                referenced_ids.update((row.selection_a_id, row.selection_b_id))
        if not referenced_ids.issubset(allowed_ids):
            raise ValueError("report sections reference an unknown selection id")
        return self


class DeleteReportsResponse(BaseModel):
    deleted_count: int = Field(ge=0)
