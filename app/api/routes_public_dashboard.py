from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.db import get_session
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
)

DashboardRadiusMeters = Annotated[int, Field(gt=0, le=5000)]

router = APIRouter()


class DashboardAnalyzeRequest(BaseModel):
    place_ids: list[str] = Field(min_length=1)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[DashboardRadiusMeters] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None

    @field_validator("radii_m")
    @classmethod
    def radii_m_values_must_be_unique(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("radii_m values must be unique")
        return value


class DashboardCompareRequest(BaseModel):
    place_ids: list[str] = Field(min_length=2)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: DashboardRadiusMeters
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


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
