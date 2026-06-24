from __future__ import annotations

from datetime import UTC, date, datetime, time
from math import cos, radians
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.analysis.schemas import AnalysisSiteOption
from app.crime.summaries import summarize_place_crime
from app.models import CrimeIncident, PlaceCluster, PlaceCrimeSummary
from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.analysis_service import compare_site_options
from app.services.crime_service import _cluster_data, _incident_data, _summary_model

METERS_PER_LATITUDE_DEGREE = 111_320
MIN_LONGITUDE_COSINE = 0.01


def analyze_selected_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> dict[str, int]:
    _validate_date_range(analysis_start_date, analysis_end_date)
    clusters = [_cluster_data(row) for row in _selected_clusters(session, user_id_hash, place_ids)]
    incidents = _filtered_incidents(
        session,
        clusters=clusters,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
    )
    summaries = summarize_place_crime(
        clusters,
        incidents,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
    )
    session.execute(delete(PlaceCrimeSummary).where(PlaceCrimeSummary.user_id_hash == user_id_hash))
    session.add_all([_summary_model(summary) for summary in summaries])
    session.commit()
    return {"summary_count": len(summaries)}


def compare_selected_places(
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
) -> dict[str, Any]:
    clusters = _selected_clusters(session, user_id_hash, place_ids)
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
    )


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
) -> list[CrimeIncidentData]:
    if not radii_m:
        return []

    start_at, end_at = _analysis_datetime_bounds(analysis_start_date, analysis_end_date)
    observed_at = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    statement = (
        select(CrimeIncident)
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


def _validate_date_range(analysis_start_date: date, analysis_end_date: date) -> None:
    if analysis_end_date < analysis_start_date:
        raise ValueError("analysis_end_date must be on or after analysis_start_date.")
