from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.analysis.schemas import RouteComparisonRequest, SiteComparisonRequest
from app.api.deps import current_user_hash
from app.db import get_session
from app.services.analysis_service import (
    compare_route_request,
    compare_site_options,
    get_comparison_payload,
)

router = APIRouter()


@router.post("/analysis/sites/compare")
def compare_sites(
    request: SiteComparisonRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return compare_site_options(
            session=session,
            user_id_hash=user_id_hash,
            options=request.options,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analysis/routes/compare")
def compare_routes(
    request: RouteComparisonRequest,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        payload = compare_route_request(
            session=session,
            user_id_hash=user_id_hash,
            request=request,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload is None:
        raise HTTPException(status_code=404, detail="Route request not found or not analyzable")
    return payload


@router.get("/analysis/comparisons/{comparison_id}")
def get_comparison(
    comparison_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = get_comparison_payload(session, comparison_id, user_id_hash)
    if payload is None:
        raise HTTPException(status_code=404, detail="Comparison not found")
    return payload
