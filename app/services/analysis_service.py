from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.comparison import build_statistical_comparison
from app.analysis.exposure import (
    count_incidents_in_place_buffer,
    place_exposure_square_km_days,
)
from app.analysis.schemas import (
    AnalysisOptionResult,
    AnalysisSiteOption,
    GeometryType,
    StatisticalComparisonResult,
)
from app.models import (
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)
from app.schemas import CrimeIncidentData
from app.services.incident_query_service import bounding_box_for_points, incidents_in_bbox


def compare_site_options(
    *,
    session: Session,
    user_id_hash: str,
    options: list[dict[str, Any] | AnalysisSiteOption],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    sources: Sequence[str] | None = None,
) -> dict[str, Any]:
    site_options = [
        option
        if isinstance(option, AnalysisSiteOption)
        else AnalysisSiteOption.model_validate(option)
        for option in options
    ]
    radius_m = site_options[0].radius_m
    incidents = incidents_in_bbox(
        session,
        box=bounding_box_for_points(
            [(option.latitude, option.longitude) for option in site_options], radius_m
        ),
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        sources=sources,
    )
    option_results: list[AnalysisOptionResult] = []
    period_counts_by_option_id: dict[str, list[int]] = {}
    geometry_metadata_by_option_id: dict[str, dict[str, Any]] = {}

    for option in site_options:
        matching_incidents = count_incidents_in_place_buffer(
            incidents=incidents,
            latitude=option.latitude,
            longitude=option.longitude,
            radius_m=option.radius_m,
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
            offense_category=offense_category,
            offense_subcategory=offense_subcategory,
            nibrs_group=nibrs_group,
        )
        exposure = place_exposure_square_km_days(
            radius_m=option.radius_m,
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
        )
        option_results.append(
            _option_result(
                option_id=option.id,
                option_label=option.label,
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=option.radius_m,
                incident_count=len(matching_incidents),
                exposure=exposure,
            )
        )
        period_counts_by_option_id[option.id] = _monthly_counts(
            incidents=matching_incidents,
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
        )
        geometry_metadata_by_option_id[option.id] = {
            "center": {"latitude": option.latitude, "longitude": option.longitude},
            "radius_m": option.radius_m,
        }

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
        period_counts_by_option_id=period_counts_by_option_id,
    )
    return _persist_and_payload(
        session,
        comparison,
        geometry_metadata_by_option_id=geometry_metadata_by_option_id,
    )


def get_comparison_payload(
    session: Session,
    comparison_id: str,
    user_id_hash: str,
) -> dict[str, Any] | None:
    comparison = session.get(StatisticalComparison, comparison_id)
    if comparison is None or comparison.user_id_hash != user_id_hash:
        return None
    return _comparison_model_payload(session, comparison)


def _persist_and_payload(
    session: Session,
    comparison: StatisticalComparisonResult,
    geometry_metadata_by_option_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    comparison_model = StatisticalComparison(
        id=comparison.id,
        user_id_hash=comparison.user_id_hash,
        comparison_type=comparison.comparison_type,
        geometry_type=comparison.geometry_type.value,
        radius_m=comparison.radius_m,
        analysis_start_date=comparison.analysis_start_date,
        analysis_end_date=comparison.analysis_end_date,
        offense_category=comparison.offense_category,
        offense_subcategory=comparison.offense_subcategory,
        nibrs_group=comparison.nibrs_group,
        source_dataset=comparison.source_dataset,
        exposure_unit=comparison.exposure_unit,
        decision_class=comparison.decision_class.value,
        recommendation_option_id=comparison.recommendation_option_id,
        recommendation_label=comparison.recommendation_label,
        overview_summary_text=comparison.overview_summary_text,
        overview_caveat_text=comparison.overview_caveat_text,
        full_caveat_text=comparison.full_caveat_text,
    )
    session.add(comparison_model)
    session.add_all(
        [
            StatisticalComparisonOption(
                comparison_id=comparison.id,
                user_id_hash=comparison.user_id_hash,
                option_id=option.option_id,
                option_label=option.option_label,
                geometry_type=option.geometry_type.value,
                radius_m=option.radius_m,
                incident_count=option.incident_count,
                exposure=option.exposure,
                exposure_unit=option.exposure_unit,
                incident_rate=option.incident_rate,
                geometry_metadata_json=_geometry_metadata_json(
                    geometry_metadata_by_option_id,
                    option.option_id,
                ),
            )
            for option in comparison.options
        ]
    )
    session.add_all(
        [
            StatisticalPairwiseResult(
                id=pairwise.id,
                comparison_id=comparison.id,
                user_id_hash=comparison.user_id_hash,
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
            for pairwise in comparison.pairwise_results
        ]
    )
    session.commit()
    session.refresh(comparison_model)
    return _comparison_model_payload(session, comparison_model)


def _comparison_model_payload(
    session: Session,
    comparison: StatisticalComparison,
) -> dict[str, Any]:
    options = list(
        session.scalars(
            select(StatisticalComparisonOption)
            .where(StatisticalComparisonOption.comparison_id == comparison.id)
            .where(StatisticalComparisonOption.user_id_hash == comparison.user_id_hash)
            .order_by(StatisticalComparisonOption.created_at, StatisticalComparisonOption.id)
        )
    )
    pairwise_results = list(
        session.scalars(
            select(StatisticalPairwiseResult)
            .where(StatisticalPairwiseResult.comparison_id == comparison.id)
            .where(StatisticalPairwiseResult.user_id_hash == comparison.user_id_hash)
            .order_by(StatisticalPairwiseResult.created_at, StatisticalPairwiseResult.id)
        )
    )
    option_payloads = [_option_payload(option) for option in options]
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
        "created_at": comparison.created_at,
        "overview": {
            "label": "Overview",
            "decision_class": comparison.decision_class,
            "recommendation_option_id": comparison.recommendation_option_id,
            "recommendation_label": comparison.recommendation_label,
            "summary_text": comparison.overview_summary_text,
            "caveat_text": comparison.overview_caveat_text,
            "options": option_payloads,
        },
        "analytical": {
            "label": "Analytical",
            "source_dataset": comparison.source_dataset,
            "exposure_unit": comparison.exposure_unit,
            "full_caveat_text": comparison.full_caveat_text,
            "options": option_payloads,
            "pairwise_results": [_pairwise_payload(pairwise) for pairwise in pairwise_results],
        },
    }


def _option_payload(option: StatisticalComparisonOption) -> dict[str, Any]:
    return {
        "id": option.option_id,
        "label": option.option_label,
        "geometry_type": option.geometry_type,
        "radius_m": option.radius_m,
        "incident_count": option.incident_count,
        "exposure": option.exposure,
        "exposure_unit": option.exposure_unit,
        "incident_rate": option.incident_rate,
        "geometry_metadata": _json_dict(option.geometry_metadata_json),
    }


def _pairwise_payload(pairwise: StatisticalPairwiseResult) -> dict[str, Any]:
    return {
        "id": pairwise.id,
        "option_a_id": pairwise.option_a_id,
        "option_a_label": pairwise.option_a_label,
        "option_b_id": pairwise.option_b_id,
        "option_b_label": pairwise.option_b_label,
        "winner_option_id": pairwise.winner_option_id,
        "winner_label": pairwise.winner_label,
        "decision_class": pairwise.decision_class,
        "method": pairwise.method,
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
        "caveat_text": pairwise.caveat_text,
    }


def _option_result(
    *,
    option_id: str,
    option_label: str,
    geometry_type: GeometryType,
    radius_m: int,
    incident_count: int,
    exposure: float,
) -> AnalysisOptionResult:
    return AnalysisOptionResult(
        option_id=option_id,
        option_label=option_label,
        geometry_type=geometry_type,
        radius_m=radius_m,
        incident_count=incident_count,
        exposure=exposure,
        exposure_unit="square_km_days",
        incident_rate=incident_count / exposure if exposure > 0 else 0.0,
    )


def _monthly_counts(
    *,
    incidents: list[CrimeIncidentData],
    analysis_start_date: date,
    analysis_end_date: date,
) -> list[int]:
    incident_months = [_observed_month(incident) for incident in incidents]
    counts_by_month = {
        current_month: incident_months.count(current_month)
        for current_month in _month_range(analysis_start_date, analysis_end_date)
    }
    return list(counts_by_month.values())


def _month_range(start_date: date, end_date: date) -> list[tuple[int, int]]:
    months: list[tuple[int, int]] = []
    year = start_date.year
    month = start_date.month
    while (year, month) <= (end_date.year, end_date.month):
        months.append((year, month))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return months


def _observed_month(incident: CrimeIncidentData) -> tuple[int, int]:
    observed_date = _observed_date(incident)
    return observed_date.year, observed_date.month


def _observed_date(incident: CrimeIncidentData) -> date:
    observed = incident.offense_start_utc or incident.report_utc
    if observed is None:
        raise ValueError("Incident has no observed date.")
    return observed.date()


def _geometry_metadata_json(
    geometry_metadata_by_option_id: dict[str, dict[str, Any]] | None,
    option_id: str,
) -> str | None:
    if not geometry_metadata_by_option_id:
        return None
    metadata = geometry_metadata_by_option_id.get(option_id)
    if metadata is None:
        return None
    return json.dumps(metadata, sort_keys=True)


def _json_dict(value: str | None) -> dict[str, Any] | None:
    if value is None:
        return None
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else None
