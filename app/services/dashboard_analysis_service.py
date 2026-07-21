from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, time
from math import cos, radians
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.analysis.schemas import AnalysisSiteOption
from app.api.dashboard_schemas import AnalysisPoint
from app.crime.sources import SOURCE_SPD_CRIME
from app.crime.summaries import summarize_place_crime
from app.models import CrimeIncident, PlaceCluster
from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.analysis_points import point_clusters
from app.services.analysis_runs import create_analysis_run
from app.services.analysis_service import compare_site_options
from app.services.crime_service import _cluster_data, _incident_data, _summary_model

METERS_PER_LATITUDE_DEGREE = 111_320
MIN_LONGITUDE_COSINE = 0.01


def analyze_selected_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None = None,
    *,
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    sources: Sequence[str] | None = None,
    layer: str | None = None,
) -> dict[str, int | str | None]:
    validate_date_range(analysis_start_date, analysis_end_date)
    clusters = _resolve_clusters(session, user_id_hash, place_ids, points)
    incidents = _filtered_incidents(
        session,
        clusters=clusters,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        sources=sources,
    )
    summaries = summarize_place_crime(
        clusters,
        incidents,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
    )
    run_id: str | None = None
    if points is None:
        # Points resolve to synthetic, non-persisted clusters (no real place_cluster_id),
        # so there is nothing valid to attach a PlaceCrimeSummary/AnalysisRun audit row to.
        # A points-based (shared-view) analyze is a stateless recompute — see
        # docs/superpowers/specs/2026-06-30-saved-views-design.md.
        run = create_analysis_run(
            session,
            user_id_hash=user_id_hash,
            radii_m=radii_m,
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
            offense_category=offense_category,
            offense_subcategory=offense_subcategory,
            nibrs_group=nibrs_group,
            layer=layer,
        )
        run_id = run.id
        models = [_summary_model(summary) for summary in summaries]
        for model in models:
            model.analysis_run_id = run.id
            model.layer = layer
        session.add_all(models)
        session.commit()
    # Callers that need a run-scoped artifact must use the id created by this exact
    # invocation. Looking up the user's "latest" run after commit is race-prone when
    # two analysis requests overlap.
    return {"summary_count": len(summaries), "analysis_run_id": run_id}


def compare_selected_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None = None,
    *,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    sources: Sequence[str] | None = None,
) -> dict[str, Any]:
    clusters = _resolve_clusters(session, user_id_hash, place_ids, points)
    if len(clusters) < 2:
        raise ValueError("Select at least two places.")
    options: list[AnalysisSiteOption] = []
    for cluster in clusters:
        if cluster.display_latitude is None or cluster.display_longitude is None:
            raise ValueError("Selected places require display coordinates.")
        options.append(
            AnalysisSiteOption(
                id=cluster.id,
                label=cluster.display_label or "Selected place",
                latitude=cluster.display_latitude,
                longitude=cluster.display_longitude,
                radius_m=radius_m,
            )
        )
    return compare_site_options(
        session=session,
        user_id_hash=user_id_hash,
        options=options,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        sources=sources,
    )


def incident_details_for_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None = None,
    *,
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    limit: int,
    sources: Sequence[str] | None = None,
) -> dict[str, object]:
    validate_date_range(analysis_start_date, analysis_end_date)
    if not radii_m:
        return {
            "incidents": [],
            "returned_count": 0,
            "total_count": 0,
            "limit": limit,
            "radius_m": None,
        }

    radius_m = radii_m[0]
    clusters = _resolve_clusters(session, user_id_hash, place_ids, points)
    incidents = _filtered_incidents(
        session,
        clusters=clusters,
        radii_m=[radius_m],
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        sources=sources,
    )
    rows = _incident_detail_rows(clusters, incidents, radius_m)
    limited_rows = rows[:limit]
    return {
        "incidents": limited_rows,
        "returned_count": len(limited_rows),
        "total_count": len(rows),
        "limit": limit,
        "radius_m": radius_m,
    }


def _resolve_clusters(
    session: Session,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None,
) -> list[PlaceClusterData]:
    if points is not None:
        return point_clusters(points)
    rows = _selected_clusters(session, user_id_hash, place_ids or [])
    return [_cluster_data(row) for row in rows]


def _selected_clusters(
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
) -> list[PlaceCluster]:
    if not place_ids:
        raise ValueError("Select at least one place.")

    unique_place_ids = list(set(place_ids))
    clusters = list(
        session.scalars(
            select(PlaceCluster)
            .where(PlaceCluster.user_id_hash == user_id_hash)
            .where(PlaceCluster.id.in_(unique_place_ids))
            .order_by(PlaceCluster.visit_count.desc(), PlaceCluster.display_label.asc())
        )
    )
    if len(clusters) != len(unique_place_ids):
        raise ValueError("One or more selected places could not be found.")
    return clusters


def _filtered_incidents(
    session: Session,
    *,
    clusters: list[PlaceClusterData],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    source_dataset: str = SOURCE_SPD_CRIME,
    sources: Sequence[str] | None = None,
) -> list[CrimeIncidentData]:
    if not radii_m:
        return []

    effective_sources = tuple(sources) if sources is not None else (source_dataset,)
    start_at, end_at = _analysis_datetime_bounds(analysis_start_date, analysis_end_date)
    observed_at = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    statement = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset.in_(effective_sources))
        .where(observed_at >= start_at)
        .where(observed_at <= end_at)
        .where(CrimeIncident.latitude.is_not(None))
        .where(CrimeIncident.longitude.is_not(None))
    )
    if offense_category is not None:
        statement = statement.where(CrimeIncident.offense_category == offense_category)
    if offense_subcategory is not None:
        statement = statement.where(CrimeIncident.offense_subcategory == offense_subcategory)
    if nibrs_group is not None:
        statement = statement.where(CrimeIncident.nibrs_group == nibrs_group)
    bounding_boxes = _incident_bounding_boxes(clusters, max(radii_m))
    if not bounding_boxes:
        return []
    statement = statement.where(or_(*bounding_boxes))
    return [_incident_data(row) for row in session.scalars(statement).all()]


def _analysis_datetime_bounds(
    analysis_start_date: date,
    analysis_end_date: date,
) -> tuple[datetime, datetime]:
    return (
        datetime.combine(analysis_start_date, time.min, tzinfo=UTC),
        datetime.combine(analysis_end_date, time.max, tzinfo=UTC),
    )


def _incident_bounding_boxes(clusters: list[PlaceClusterData], radius_m: int) -> list[Any]:
    boxes: list[Any] = []
    for cluster in clusters:
        coordinates = _display_coordinates(cluster)
        if coordinates is None:
            continue
        latitude, longitude = coordinates
        lat_delta = radius_m / METERS_PER_LATITUDE_DEGREE
        lon_scale = max(abs(cos(radians(latitude))), MIN_LONGITUDE_COSINE)
        lon_delta = radius_m / (METERS_PER_LATITUDE_DEGREE * lon_scale)
        boxes.append(
            and_(
                CrimeIncident.latitude >= latitude - lat_delta,
                CrimeIncident.latitude <= latitude + lat_delta,
                CrimeIncident.longitude >= longitude - lon_delta,
                CrimeIncident.longitude <= longitude + lon_delta,
            )
        )
    return boxes


def _display_coordinates(cluster: PlaceClusterData) -> tuple[float, float] | None:
    if cluster.display_latitude is None or cluster.display_longitude is None:
        return None
    return cluster.display_latitude, cluster.display_longitude


def _incident_detail_rows(
    clusters: list[PlaceClusterData],
    incidents: list[CrimeIncidentData],
    radius_m: int,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for cluster in clusters:
        coordinates = _display_coordinates(cluster)
        if coordinates is None:
            continue
        cluster_latitude, cluster_longitude = coordinates
        for incident in incidents:
            if incident.latitude is None or incident.longitude is None:
                continue
            distance_m = haversine_m(
                cluster_latitude,
                cluster_longitude,
                incident.latitude,
                incident.longitude,
            )
            if distance_m > radius_m:
                continue
            rows.append(
                {
                    "place_id": cluster.id,
                    "place_label": cluster.display_label or "Selected place",
                    "incident_id": incident.id,
                    "external_incident_id": incident.external_incident_id,
                    "source_dataset": incident.source_dataset,
                    "report_number": incident.report_number,
                    "occurred_at": _utc_json_datetime(incident.offense_start_utc),
                    "reported_at": _utc_json_datetime(incident.report_utc),
                    "offense_category": incident.offense_category,
                    "offense_subcategory": incident.offense_subcategory,
                    "nibrs_group": incident.nibrs_group,
                    "block_address": incident.block_address,
                    "distance_m": distance_m,
                }
            )
    return sorted(
        rows,
        key=lambda row: (
            str(row["place_label"]).lower(),
            float(row["distance_m"]),
            str(row["occurred_at"] or row["reported_at"] or ""),
            str(row["incident_id"]),
        ),
    )


def _utc_json_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def validate_date_range(analysis_start_date: date, analysis_end_date: date) -> None:
    if analysis_end_date < analysis_start_date:
        raise ValueError("analysis_end_date must be on or after analysis_start_date.")
