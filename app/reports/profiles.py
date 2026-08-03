from __future__ import annotations

from app.crime.sources import (
    LAYER_ARRESTS,
    LAYER_CALLS,
    LAYER_REPORTED,
    SOURCE_SPD_911,
    SOURCE_SPD_ARRESTS,
    SOURCE_SPD_CRIME,
)
from app.reports.schemas import ReportLayerCapabilities, ReportLayerProfile

_PROFILES = {
    LAYER_REPORTED: ReportLayerProfile(
        layer=LAYER_REPORTED,
        report_title="Reported Incident Context Report",
        source_dataset=SOURCE_SPD_CRIME,
        counting_unit="reported_offense_record",
        counting_unit_label="Reported-offense record",
        record_noun_singular="reported incident record",
        record_noun_plural="reported incident records",
        primary_time_field="recorded_offense_start",
        primary_time_label="Recorded offense start",
        secondary_time_field="reported_at",
        secondary_time_label="Reported time",
        subtype_field="offense_subcategory",
        subtype_label="Offense subcategory",
        supported_filters=["offense_category", "offense_subcategory", "nibrs_group"],
        capabilities=ReportLayerCapabilities(
            reference_context=True,
            modeled_comparison=True,
        ),
        disclosures=[
            "Reported records do not establish personal presence or personal risk.",
            "A police report number may be associated with multiple stored offense rows.",
            "Results can be incomplete, delayed, corrected, or geographically generalized.",
        ],
    ),
    LAYER_ARRESTS: ReportLayerProfile(
        layer=LAYER_ARRESTS,
        report_title="Arrest Activity Report",
        source_dataset=SOURCE_SPD_ARRESTS,
        counting_unit="arrest_record",
        counting_unit_label="Arrest record",
        record_noun_singular="arrest record",
        record_noun_plural="arrest records",
        primary_time_field="arrest_time",
        primary_time_label="Arrest time",
        secondary_time_field="arrest_reported_at",
        secondary_time_label="Arrest reported time",
        subtype_field="arrest_offense_description",
        subtype_label="Arrest offense description",
        supported_filters=[
            "offense_category",
            "arrest_offense_description",
            "nibrs_group",
        ],
        capabilities=ReportLayerCapabilities(
            reference_context=False,
            modeled_comparison=False,
        ),
        disclosures=[
            "Arrests describe enforcement activity at recorded arrest locations, not "
            "reported-incident prevalence or personal risk.",
            "The arrest offense description is imported NIBRS description text and is not "
            "necessarily a filed criminal charge.",
            "Category and NIBRS group values are best-effort crosswalks and may be incomplete.",
        ],
    ),
    LAYER_CALLS: ReportLayerProfile(
        layer=LAYER_CALLS,
        report_title="911 Call Activity Report",
        source_dataset=SOURCE_SPD_911,
        counting_unit="deduplicated_cad_event",
        counting_unit_label="Deduplicated CAD event",
        record_noun_singular="911 call event",
        record_noun_plural="911 call events",
        primary_time_field="queued_at",
        primary_time_label="Queued time",
        secondary_time_field="arrived_at",
        secondary_time_label="Arrival time",
        subtype_field="call_type",
        subtype_label="Call type",
        supported_filters=["call_type"],
        capabilities=ReportLayerCapabilities(
            reference_context=False,
            modeled_comparison=False,
        ),
        disclosures=[
            "911 calls are requests for service, not confirmed offenses or personal-risk "
            "measurements.",
            "Counts represent deduplicated CAD events; caller behavior and clustered "
            "requests affect the observed process.",
            "The source has a rolling availability window and some locations are missing "
            "or redacted.",
        ],
    ),
}


def report_profile(layer: str) -> ReportLayerProfile:
    try:
        return _PROFILES[layer]
    except KeyError:
        raise ValueError(f"Unknown report layer: {layer!r}") from None


def all_report_profiles() -> list[ReportLayerProfile]:
    return [
        _PROFILES[LAYER_REPORTED],
        _PROFILES[LAYER_ARRESTS],
        _PROFILES[LAYER_CALLS],
    ]
