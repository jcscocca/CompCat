from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime
from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.analysis.area_baselines import load_mcpp_areas, load_mcpp_polygons
from app.analysis.beat_baselines import load_beat_areas, load_beat_polygons
from app.api.dashboard_schemas import AnalysisPoint
from app.crime.sources import (
    LAYER_ARRESTS,
    LAYER_REPORTED,
    get_crime_source,
    sources_for_layer,
)
from app.models import AnalysisReportSnapshot, PlaceCluster, utc_now
from app.normalization.geo import snap_to_grid
from app.reports.profiles import report_profile
from app.reports.schemas import (
    AnalysisReport,
    AnalysisReportRequest,
    ComparisonMode,
    DeleteReportsResponse,
    ReportBreakdownRow,
    ReportComparisonOption,
    ReportComparisonSection,
    ReportExportPolicy,
    ReportFilters,
    ReportOverviewSection,
    ReportPairwiseComparison,
    ReportPlaceContext,
    ReportRecord,
    ReportRecordsSection,
    ReportReferenceDistribution,
    ReportScope,
    ReportSections,
    ReportSectionStatus,
    ReportSelection,
    ReportStatus,
    ReportTemporalSection,
    SectionState,
    SelectionKind,
)
from app.schemas import PlaceClusterData, new_id
from app.services.analysis_points import point_clusters
from app.services.crime_service import _cluster_data, analysis_report_freshness
from app.services.dashboard_analysis_service import (
    compare_selected_places,
    incident_memberships_for_places,
)
from app.services.neighborhood_service import neighborhood_analysis_for_places


class ReportNotFoundError(ValueError):
    pass


class ReportPrivacyBlockedError(ValueError):
    pass


class ReportCoverageUnavailableError(ValueError):
    pass


class ReportCoverageAdjustmentRequiredError(ValueError):
    def __init__(
        self,
        *,
        requested_start: date,
        requested_end: date,
        available_start: date,
    ) -> None:
        super().__init__("The requested range begins before this layer's available history.")
        self.requested_start = requested_start
        self.requested_end = requested_end
        self.available_start = available_start


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@lru_cache(maxsize=1)
def _beat_polygons():
    return load_beat_polygons()


@lru_cache(maxsize=1)
def _mcpp_areas() -> dict[str, float]:
    return load_mcpp_areas()


@lru_cache(maxsize=1)
def _mcpp_polygons():
    return load_mcpp_polygons()


def create_analysis_report(
    session: Session,
    *,
    user_id_hash: str,
    request: AnalysisReportRequest,
    persist_snapshot: bool | None = None,
) -> AnalysisReport:
    profile = report_profile(request.layer)
    subtype_filter = _subtype_filter(request)
    available_start = get_crime_source(profile.source_dataset).data_floor(None)
    effective_start, effective_end = _effective_dates(request, available_start)
    points = _report_points(request.points)
    clusters = _report_clusters(
        session,
        user_id_hash=user_id_hash,
        place_ids=request.place_ids,
        points=points,
    )
    _assert_exportable_saved_places(clusters, persisted=request.place_ids is not None)

    selection_kind = SelectionKind.SINGLE_PLACE if len(clusters) == 1 else SelectionKind.MULTI_PLACE
    comparison_mode = _comparison_mode(request.layer, selection_kind)
    selection_id_by_internal = {
        cluster.id: f"selection-{index}" for index, cluster in enumerate(clusters, start=1)
    }
    # Inline points already carry report-safe ids through the existing analysis services.
    if points is not None:
        selection_id_by_internal = {cluster.id: cluster.id for cluster in clusters}
    selection = [_selection(cluster, selection_id_by_internal[cluster.id]) for cluster in clusters]

    rows = incident_memberships_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=request.place_ids,
        points=points,
        radius_m=request.radius_m,
        analysis_start_date=effective_start,
        analysis_end_date=effective_end,
        offense_category=request.offense_category,
        offense_subcategory=subtype_filter,
        nibrs_group=request.nibrs_group,
        sources=sources_for_layer(request.layer),
    )
    reference_by_selection: dict[str, list[ReportReferenceDistribution]] = {}
    if profile.capabilities.reference_context:
        reference_by_selection = _reported_reference_context(
            session=session,
            user_id_hash=user_id_hash,
            request=request,
            points=points,
            effective_start=effective_start,
            effective_end=effective_end,
            selection_id_by_internal=selection_id_by_internal,
        )

    place_context = _place_context(
        clusters=clusters,
        rows=rows,
        selection_id_by_internal=selection_id_by_internal,
        counting_unit=profile.counting_unit,
        reference_by_selection=reference_by_selection,
    )
    comparison = (
        _reported_comparison(
            session=session,
            user_id_hash=user_id_hash,
            request=request,
            points=points,
            effective_start=effective_start,
            effective_end=effective_end,
            selection_id_by_internal=selection_id_by_internal,
            counting_unit=profile.counting_unit,
        )
        if comparison_mode == ComparisonMode.MODELED
        else None
    )

    limited_rows = rows[: request.record_limit]
    unique_source_record_count = len({str(row["incident_id"]) for row in rows})
    records = _report_records(
        limited_rows,
        selection_id_by_internal=selection_id_by_internal,
        layer=request.layer,
        counting_unit=profile.counting_unit,
    )
    generated_at = utc_now()
    freshness = analysis_report_freshness(session, layer=request.layer)
    persisted = request.place_ids is not None if persist_snapshot is None else persist_snapshot
    report_id = new_id() if persisted else None
    report = AnalysisReport(
        report_id=report_id,
        profile=profile,
        selection_kind=selection_kind,
        comparison_mode=comparison_mode,
        status=(
            ReportStatus.COMPLETE
            if unique_source_record_count > 0
            else ReportStatus.INSUFFICIENT_DATA
        ),
        generated_at=generated_at,
        scope=ReportScope(
            layer=request.layer,
            source_dataset=profile.source_dataset,
            counting_unit=profile.counting_unit,
            requested_start_date=request.analysis_start_date,
            requested_end_date=request.analysis_end_date,
            effective_start_date=effective_start,
            effective_end_date=effective_end,
            available_start_date=available_start,
            latest_recorded_event_date=_date_or_none(freshness.get("data_through")),
            latest_row_ingested_at=_datetime_or_none(freshness.get("last_ingested_at")),
            confirmed_data_through=None,
            radius_m=request.radius_m,
            filters=ReportFilters(
                offense_category=request.offense_category,
                offense_subcategory=(
                    request.offense_subcategory if request.layer == LAYER_REPORTED else None
                ),
                arrest_offense_description=request.arrest_offense_description,
                call_type=request.call_type,
                nibrs_group=request.nibrs_group,
            ),
        ),
        selection=selection,
        sections=ReportSections(
            overview=ReportOverviewSection(
                counting_unit=profile.counting_unit,
                unique_source_record_count=unique_source_record_count,
                membership_count=len(rows),
                returned_record_count=len(records),
                record_limit=request.record_limit,
                records_truncated=len(rows) > request.record_limit,
            ),
            place_context=place_context,
            comparison=comparison,
            records=ReportRecordsSection(
                counting_unit=profile.counting_unit,
                total_membership_count=len(rows),
                returned_count=len(records),
                limit=request.record_limit,
                truncated=len(rows) > request.record_limit,
                records=records,
            ),
        ),
        section_statuses=_section_statuses(
            layer=request.layer,
            selection_kind=selection_kind,
            rows_truncated=len(rows) > request.record_limit,
        ),
        disclosures=profile.disclosures,
        export_policy=ReportExportPolicy(
            persisted_server_side=persisted,
            privacy_policy_checked_at=generated_at,
            download_revalidation="block_if_saved_place_deleted_or_sensitive",
        ),
    )
    if persisted:
        assert report_id is not None
        snapshot = AnalysisReportSnapshot(
            id=report_id,
            user_id_hash=user_id_hash,
            schema_version=report.schema_version,
            method_version=report.method_version,
            layer=request.layer,
            selection_kind=selection_kind.value,
            comparison_mode=comparison_mode.value,
            selected_place_ids_json=json.dumps(request.place_ids),
            payload_json=report.model_dump_json(),
            privacy_policy_checked_at=generated_at,
            created_at=generated_at,
        )
        session.add(snapshot)
        session.commit()
    return report


def get_analysis_report(
    session: Session,
    *,
    user_id_hash: str,
    report_id: str,
) -> AnalysisReport:
    snapshot = session.get(AnalysisReportSnapshot, report_id)
    if snapshot is None or snapshot.user_id_hash != user_id_hash:
        raise ReportNotFoundError("Report not found.")
    selected_place_ids = _json_string_list(snapshot.selected_place_ids_json)
    _revalidate_saved_places(
        session,
        user_id_hash=user_id_hash,
        selected_place_ids=selected_place_ids,
    )
    checked_at = utc_now()
    report = AnalysisReport.model_validate_json(snapshot.payload_json)
    return report.model_copy(
        update={
            "export_policy": report.export_policy.model_copy(
                update={"privacy_policy_checked_at": checked_at}
            )
        }
    )


def delete_analysis_report(
    session: Session,
    *,
    user_id_hash: str,
    report_id: str,
) -> None:
    snapshot = session.get(AnalysisReportSnapshot, report_id)
    if snapshot is None or snapshot.user_id_hash != user_id_hash:
        raise ReportNotFoundError("Report not found.")
    session.delete(snapshot)
    session.commit()


def delete_all_analysis_reports(
    session: Session,
    *,
    user_id_hash: str,
) -> DeleteReportsResponse:
    deleted_count = (
        session.execute(
            delete(AnalysisReportSnapshot).where(
                AnalysisReportSnapshot.user_id_hash == user_id_hash
            )
        ).rowcount
        or 0
    )
    session.commit()
    return DeleteReportsResponse(deleted_count=deleted_count)


def _effective_dates(
    request: AnalysisReportRequest,
    available_start: date,
) -> tuple[date, date]:
    if request.analysis_end_date < available_start:
        raise ReportCoverageUnavailableError(
            "The requested range does not overlap this layer's available history."
        )
    if request.analysis_start_date < available_start:
        if not request.adjust_to_available_dates:
            raise ReportCoverageAdjustmentRequiredError(
                requested_start=request.analysis_start_date,
                requested_end=request.analysis_end_date,
                available_start=available_start,
            )
        return available_start, request.analysis_end_date
    return request.analysis_start_date, request.analysis_end_date


def _report_points(points: list[AnalysisPoint] | None) -> list[AnalysisPoint] | None:
    if points is None:
        return None
    return [
        point.model_copy(update={"selection_id": f"selection-{index}"})
        for index, point in enumerate(points, start=1)
    ]


def _report_clusters(
    session: Session,
    *,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None,
) -> list[PlaceClusterData]:
    if points is not None:
        return point_clusters(points)
    ordered_ids = place_ids or []
    rows = list(
        session.scalars(
            select(PlaceCluster)
            .where(PlaceCluster.user_id_hash == user_id_hash)
            .where(PlaceCluster.id.in_(ordered_ids))
        )
    )
    by_id = {row.id: row for row in rows}
    if len(by_id) != len(ordered_ids):
        raise ValueError("One or more selected places could not be found.")
    return [_cluster_data(by_id[place_id]) for place_id in ordered_ids]


def _assert_exportable_saved_places(
    clusters: list[PlaceClusterData],
    *,
    persisted: bool,
) -> None:
    if not persisted:
        return
    if any(cluster.sensitivity_class != "normal" for cluster in clusters):
        raise ReportPrivacyBlockedError(
            "Reports containing a sensitive saved place cannot be persisted or exported."
        )


def _selection(cluster: PlaceClusterData, selection_id: str) -> ReportSelection:
    if cluster.display_latitude is None or cluster.display_longitude is None:
        raise ValueError("Selected places require display coordinates.")
    latitude, longitude = snap_to_grid(cluster.display_latitude, cluster.display_longitude)
    return ReportSelection(
        selection_id=selection_id,
        label=cluster.display_label or "Selected place",
        latitude=latitude,
        longitude=longitude,
    )


def _comparison_mode(layer: str, selection_kind: SelectionKind) -> ComparisonMode:
    if selection_kind == SelectionKind.SINGLE_PLACE:
        return ComparisonMode.NONE
    if layer == LAYER_REPORTED:
        return ComparisonMode.MODELED
    return ComparisonMode.DESCRIPTIVE


def _reported_reference_context(
    *,
    session: Session,
    user_id_hash: str,
    request: AnalysisReportRequest,
    points: list[AnalysisPoint] | None,
    effective_start: date,
    effective_end: date,
    selection_id_by_internal: dict[str, str],
) -> dict[str, list[ReportReferenceDistribution]]:
    payload = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=request.place_ids,
        points=points,
        radius_m=request.radius_m,
        analysis_start_date=effective_start,
        analysis_end_date=effective_end,
        offense_category=request.offense_category,
        offense_subcategory=request.offense_subcategory,
        nibrs_group=request.nibrs_group,
        area_lookup=_beat_areas(),
        beat_polygons=_beat_polygons(),
        mcpp_area_lookup=_mcpp_areas(),
        mcpp_polygons=_mcpp_polygons(),
        sources=sources_for_layer(request.layer),
    )
    result: dict[str, list[ReportReferenceDistribution]] = {}
    for place in payload.get("places", []):
        internal_id = str(place["place_id"])
        selection_id = selection_id_by_internal.get(internal_id)
        if selection_id is None:
            continue
        result[selection_id] = [
            ReportReferenceDistribution.model_validate(
                {**item, "counting_unit": "reported_offense_record"}
            )
            for item in place.get("reference_comparisons", [])
        ]
    return result


def _place_context(
    *,
    clusters: list[PlaceClusterData],
    rows: list[dict[str, object]],
    selection_id_by_internal: dict[str, str],
    counting_unit: str,
    reference_by_selection: dict[str, list[ReportReferenceDistribution]],
) -> list[ReportPlaceContext]:
    rows_by_place: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        rows_by_place[str(row["place_id"])].append(row)
    contexts: list[ReportPlaceContext] = []
    for cluster in clusters:
        selection_id = selection_id_by_internal[cluster.id]
        place_rows = rows_by_place.get(cluster.id, [])
        contexts.append(
            ReportPlaceContext(
                selection_id=selection_id,
                label=cluster.display_label or "Selected place",
                counting_unit=counting_unit,
                record_count=len(place_rows),
                type_mix=_type_mix(place_rows, counting_unit=counting_unit),
                temporal=_temporal(place_rows, counting_unit=counting_unit),
                coordinate_coverage=None,
                reference_context=reference_by_selection.get(selection_id, []),
            )
        )
    return contexts


def _type_mix(
    rows: list[dict[str, object]],
    *,
    counting_unit: str,
    top_n: int = 20,
) -> list[ReportBreakdownRow]:
    counter: Counter[str] = Counter(
        str(row.get("offense_subcategory") or row.get("offense_category") or "Uncategorized")
        for row in rows
    )
    total = sum(counter.values())
    if total == 0:
        return []
    ordered = sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    shown = ordered[:top_n]
    remainder = sum(count for _, count in ordered[top_n:])
    if remainder:
        shown.append(("Other", remainder))
    return [
        ReportBreakdownRow(
            counting_unit=counting_unit,
            label=label,
            count=count,
            share=count / total,
        )
        for label, count in shown
    ]


def _temporal(
    rows: list[dict[str, object]],
    *,
    counting_unit: str,
) -> ReportTemporalSection:
    hour_counts = [0] * 24
    dow_counts = [0] * 7
    monthly_counts: Counter[str] = Counter()
    with_time = 0
    without_time = 0
    for row in rows:
        observed = _datetime_or_none(row.get("occurred_at"))
        if observed is None:
            without_time += 1
            continue
        with_time += 1
        hour_counts[observed.hour] += 1
        dow_counts[observed.weekday()] += 1
        monthly_counts[f"{observed.year:04d}-{observed.month:02d}"] += 1
    return ReportTemporalSection(
        counting_unit=counting_unit,
        hour_counts=hour_counts,
        dow_counts=dow_counts,
        monthly_counts=dict(sorted(monthly_counts.items())),
        with_primary_time=with_time,
        without_primary_time=without_time,
    )


def _reported_comparison(
    *,
    session: Session,
    user_id_hash: str,
    request: AnalysisReportRequest,
    points: list[AnalysisPoint] | None,
    effective_start: date,
    effective_end: date,
    selection_id_by_internal: dict[str, str],
    counting_unit: str,
) -> ReportComparisonSection:
    payload = compare_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=request.place_ids,
        points=points,
        radius_m=request.radius_m,
        analysis_start_date=effective_start,
        analysis_end_date=effective_end,
        offense_category=request.offense_category,
        offense_subcategory=request.offense_subcategory,
        nibrs_group=request.nibrs_group,
        sources=sources_for_layer(request.layer),
        persist=False,
    )
    overview = payload["overview"]
    analytical = payload["analytical"]
    options = [
        ReportComparisonOption(
            counting_unit=counting_unit,
            selection_id=selection_id_by_internal[str(option["id"])],
            label=str(option["label"]),
            record_count=int(option["incident_count"]),
            exposure=float(option["exposure"]),
            exposure_unit=str(option["exposure_unit"]),
            record_rate=float(option["incident_rate"]),
            rate_ci_lower=_float_or_none(option.get("rate_ci_lower")),
            rate_ci_upper=_float_or_none(option.get("rate_ci_upper")),
            rate_ci_method=_string_or_none(option.get("rate_ci_method")),
        )
        for option in analytical["options"]
    ]
    pairwise = [
        ReportPairwiseComparison(
            counting_unit=counting_unit,
            selection_a_id=selection_id_by_internal[str(row["option_a_id"])],
            selection_a_label=str(row["option_a_label"]),
            selection_b_id=selection_id_by_internal[str(row["option_b_id"])],
            selection_b_label=str(row["option_b_label"]),
            decision_class=str(row["decision_class"]),
            method=str(row["method"]),
            record_count_a=int(row["incident_count_a"]),
            record_count_b=int(row["incident_count_b"]),
            rate_a=float(row["rate_a"]),
            rate_b=float(row["rate_b"]),
            rate_ratio=float(row["rate_ratio"]),
            ci_lower=float(row["ci_lower"]),
            ci_upper=float(row["ci_upper"]),
            p_value=float(row["p_value"]),
            adjusted_p_value=float(row["adjusted_p_value"]),
            overdispersion_phi=_float_or_none(row.get("overdispersion_phi")),
            overdispersion_status=str(row["overdispersion_status"]),
            minimum_data_status=str(row["minimum_data_status"]),
            caveat_text=str(row["caveat_text"]),
        )
        for row in analytical["pairwise_results"]
    ]
    return ReportComparisonSection(
        counting_unit=counting_unit,
        method_family="candidate_vs_alternatives_bh",
        decision_class=str(overview["decision_class"]),
        summary_text=str(overview["summary_text"]),
        caveat_text=str(analytical["full_caveat_text"]),
        options=options,
        pairwise_results=pairwise,
    )


def _report_records(
    rows: list[dict[str, object]],
    *,
    selection_id_by_internal: dict[str, str],
    layer: str,
    counting_unit: str,
) -> list[ReportRecord]:
    records: list[ReportRecord] = []
    for row in rows:
        subtype = _string_or_none(row.get("offense_subcategory"))
        records.append(
            ReportRecord(
                selection_id=selection_id_by_internal[str(row["place_id"])],
                place_label=str(row["place_label"]),
                counting_unit=counting_unit,
                source_dataset=str(row["source_dataset"]),
                primary_time=_datetime_or_none(row.get("occurred_at")),
                secondary_time=_datetime_or_none(row.get("reported_at")),
                offense_category=(
                    _string_or_none(row.get("offense_category")) if layer != "calls" else None
                ),
                offense_subcategory=subtype if layer == "reported" else None,
                arrest_offense_description=subtype if layer == "arrests" else None,
                call_type=subtype if layer == "calls" else None,
                nibrs_group=(_string_or_none(row.get("nibrs_group")) if layer != "calls" else None),
                distance_m=float(row["distance_m"]),
                duplicate_across_places=bool(row["duplicate_across_places"]),
            )
        )
    return records


def _section_statuses(
    *,
    layer: str,
    selection_kind: SelectionKind,
    rows_truncated: bool,
) -> list[ReportSectionStatus]:
    statuses = [
        ReportSectionStatus(section="overview", state=SectionState.COMPLETE),
        ReportSectionStatus(section="place_context", state=SectionState.COMPLETE),
        ReportSectionStatus(section="temporal", state=SectionState.COMPLETE),
        ReportSectionStatus(
            section="coordinate_coverage",
            state=SectionState.OMITTED,
            reason="Coordinate coverage is not canonicalized in this report version.",
        ),
        ReportSectionStatus(
            section="trend",
            state=SectionState.OMITTED,
            reason="The current trend endpoint does not match the report's spatial and date scope.",
        ),
    ]
    if layer == LAYER_REPORTED:
        statuses.append(
            ReportSectionStatus(section="reference_context", state=SectionState.COMPLETE)
        )
    else:
        statuses.append(
            ReportSectionStatus(
                section="reference_context",
                state=SectionState.OMITTED,
                reason="Reference context is not enabled for arrest or 911 call reports.",
            )
        )
    if selection_kind == SelectionKind.SINGLE_PLACE:
        statuses.append(
            ReportSectionStatus(
                section="comparison",
                state=SectionState.OMITTED,
                reason="A comparison requires two or more selected places.",
            )
        )
    elif layer == LAYER_REPORTED:
        statuses.append(ReportSectionStatus(section="comparison", state=SectionState.COMPLETE))
    else:
        statuses.append(
            ReportSectionStatus(
                section="comparison",
                state=SectionState.OMITTED,
                reason="Modeled comparison is not enabled for arrest or 911 call reports.",
            )
        )
    statuses.append(
        ReportSectionStatus(
            section="records",
            state=SectionState.TRUNCATED if rows_truncated else SectionState.COMPLETE,
            reason="The record table reached its requested row limit." if rows_truncated else None,
        )
    )
    return statuses


def _revalidate_saved_places(
    session: Session,
    *,
    user_id_hash: str,
    selected_place_ids: list[str],
) -> None:
    rows = list(
        session.scalars(
            select(PlaceCluster)
            .where(PlaceCluster.user_id_hash == user_id_hash)
            .where(PlaceCluster.id.in_(selected_place_ids))
        )
    )
    if len(rows) != len(selected_place_ids) or any(
        row.sensitivity_class != "normal" for row in rows
    ):
        raise ReportPrivacyBlockedError(
            "This report can no longer be retrieved because a selected saved place was "
            "deleted or became sensitive."
        )


def _json_string_list(value: str) -> list[str]:
    parsed = json.loads(value)
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ValueError("Stored report selection is invalid.")
    return parsed


def _subtype_filter(request: AnalysisReportRequest) -> str | None:
    if request.layer == LAYER_REPORTED:
        return request.offense_subcategory
    if request.layer == LAYER_ARRESTS:
        return request.arrest_offense_description
    return request.call_type


def _date_or_none(value: object) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value)[:10])


def _datetime_or_none(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _float_or_none(value: object) -> float | None:
    return None if value is None else float(value)


def _string_or_none(value: object) -> str | None:
    return None if value is None else str(value)
