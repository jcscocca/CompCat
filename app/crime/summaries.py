from __future__ import annotations

from collections import defaultdict
from datetime import date

from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData, PlaceClusterData, PlaceCrimeSummaryData


def summarize_place_crime(
    clusters: list[PlaceClusterData],
    incidents: list[CrimeIncidentData],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
) -> list[PlaceCrimeSummaryData]:
    summaries: list[PlaceCrimeSummaryData] = []
    for cluster in clusters:
        cluster_coordinates = _display_coordinates(cluster)
        if cluster_coordinates is None:
            continue
        cluster_latitude, cluster_longitude = cluster_coordinates
        cluster_incidents = [
            incident
            for incident in incidents
            if _incident_in_date_range(incident, analysis_start_date, analysis_end_date)
            and incident.latitude is not None
            and incident.longitude is not None
        ]
        for radius in radii_m:
            grouped: dict[
                tuple[str | None, str | None, str | None],
                list[tuple[CrimeIncidentData, float]],
            ] = defaultdict(list)
            for incident in cluster_incidents:
                distance = haversine_m(
                    cluster_latitude,
                    cluster_longitude,
                    incident.latitude,
                    incident.longitude,
                )
                if distance <= radius:
                    key = (
                        incident.offense_category,
                        incident.offense_subcategory,
                        incident.nibrs_group,
                    )
                    grouped[key].append((incident, distance))
            for key, rows in grouped.items():
                count = len(rows)
                total_hours = (cluster.total_dwell_minutes or 0) / 60
                expected_visits = _expected_visits_in_range(
                    weekly_visit_count=cluster.visit_count,
                    analysis_start_date=analysis_start_date,
                    analysis_end_date=analysis_end_date,
                )
                summaries.append(
                    PlaceCrimeSummaryData(
                        user_id_hash=cluster.user_id_hash,
                        place_cluster_id=cluster.id,
                        radius_m=radius,
                        analysis_start_date=analysis_start_date,
                        analysis_end_date=analysis_end_date,
                        offense_category=key[0],
                        offense_subcategory=key[1],
                        nibrs_group=key[2],
                        incident_count=count,
                        nearest_incident_m=min(distance for _, distance in rows),
                        incidents_per_visit=count / expected_visits
                        if expected_visits
                        else None,
                        incidents_per_hour_dwell=count / total_hours if total_hours else None,
                    )
                )
    return summaries


def _display_coordinates(cluster: PlaceClusterData) -> tuple[float, float] | None:
    if cluster.display_latitude is None or cluster.display_longitude is None:
        return None
    return cluster.display_latitude, cluster.display_longitude


def _incident_in_date_range(
    incident: CrimeIncidentData,
    analysis_start_date: date,
    analysis_end_date: date,
) -> bool:
    observed = incident.offense_start_utc or incident.report_utc
    if observed is None:
        return False
    observed_date = observed.date()
    return analysis_start_date <= observed_date <= analysis_end_date


def _expected_visits_in_range(
    *,
    weekly_visit_count: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float | None:
    days = (analysis_end_date - analysis_start_date).days + 1
    if weekly_visit_count <= 0 or days <= 0:
        return None
    return weekly_visit_count * days / 7
