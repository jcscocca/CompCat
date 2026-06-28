from __future__ import annotations

from dataclasses import asdict
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import (
    BeatPolygons,
    load_beat_areas,
    load_beat_polygons,
)
from app.api.dashboard_schemas import (
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
    DashboardIncidentDetailsRequest,
    GeocodeResultSchema,
)
from app.api.deps import required_public_user_hash
from app.config import get_settings
from app.db import get_session
from app.geocoding.providers import GeocodeProvider, GeocoderUpstreamError, build_provider
from app.services.crime_service import crime_data_freshness
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
    incident_details_for_places,
)
from app.services.geocoding_service import search_addresses
from app.services.neighborhood_service import neighborhood_analysis_for_places

router = APIRouter()


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@lru_cache(maxsize=1)
def _beat_polygons() -> BeatPolygons:
    return load_beat_polygons()


@router.post("/dashboard/analyze")
def analyze_dashboard_places(
    request: DashboardAnalyzeRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, int]:
    try:
        return analyze_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            radii_m=request.radii_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/incidents")
def dashboard_incidents(
    request: DashboardIncidentDetailsRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return incident_details_for_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            radii_m=request.radii_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
            limit=request.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/compare")
def compare_dashboard_places(
    request: DashboardCompareRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return compare_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            radius_m=request.radius_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/neighborhood")
def dashboard_neighborhood(
    request: DashboardAnalyzeRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return neighborhood_analysis_for_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            radius_m=request.radii_m[0],
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
            area_lookup=_beat_areas(),
            beat_polygons=_beat_polygons(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/dashboard/freshness")
def dashboard_freshness(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    # Coverage of the shared reported-incident dataset (global, not user-scoped); the
    # session gate just keeps it on the authenticated public tier like its siblings.
    return crime_data_freshness(session)


def get_geocode_provider() -> GeocodeProvider:
    return build_provider(get_settings())


@router.get("/dashboard/geocode")
def dashboard_geocode(
    q: str,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    provider: Annotated[GeocodeProvider, Depends(get_geocode_provider)],
) -> list[GeocodeResultSchema]:
    try:
        hits = search_addresses(session, get_settings(), q, provider=provider)
    except GeocoderUpstreamError as exc:
        raise HTTPException(status_code=502, detail="Geocoding upstream unavailable.") from exc
    return [GeocodeResultSchema(**asdict(hit)) for hit in hits]
