from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import load_beat_areas
from app.api.dashboard_schemas import (
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
    DashboardIncidentDetailsRequest,
)
from app.api.deps import required_public_user_hash
from app.db import get_session
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
    incident_details_for_places,
)
from app.services.neighborhood_service import neighborhood_analysis_for_places

router = APIRouter()


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


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
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
