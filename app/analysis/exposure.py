from __future__ import annotations

import math
from datetime import date

from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData


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
