from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.dashboard_schemas import AreaSelectionRequest
from app.api.deps import current_user_hash, required_public_user_hash
from app.db import get_session
from app.services.area_selection_service import area_selection_csv_rows
from app.services.export_service import analysis_run_csv, tableau_place_summary_csv

router = APIRouter()


@router.post("/exports/area-selection.csv")
def export_area_selection(
    request: AreaSelectionRequest,
    _user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> StreamingResponse:
    try:
        rows = area_selection_csv_rows(session, request)
        # Validate before response headers are committed; later rows stream incrementally.
        first = next(rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def content():
        yield first
        yield from rows

    return StreamingResponse(
        content(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="compcat-area-selection.csv"'
        },
    )


@router.get("/exports/analysis.csv")
def export_analysis(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    run_id: Annotated[str, Query(min_length=1)],
) -> Response:
    try:
        content = analysis_run_csv(session, user_id_hash, run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Analysis run not found.") from exc
    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="compcat-analysis.csv"',
            "Deprecation": "true",
            "Sunset": "Tue, 01 Sep 2026 00:00:00 GMT",
            "Link": '</dashboard/reports>; rel="successor-version"',
            "Warning": '299 - "Legacy reference-circle CSV; use layer-aware reports"',
        },
    )


@router.get("/exports/tableau/place-summary.csv")
def export_place_summary(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    run_id: Annotated[str | None, Query()] = None,
) -> Response:
    try:
        return _place_summary_response(session, user_id_hash, run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Analysis run not found.") from exc


@router.get("/internal/exports/tableau/place-summary.csv", include_in_schema=False)
def export_internal_place_summary(
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    return _place_summary_response(session, user_id_hash)


def _place_summary_response(
    session: Session, user_id_hash: str, run_id: str | None = None
) -> Response:
    return Response(
        content=tableau_place_summary_csv(session, user_id_hash, run_id),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=place-summary.csv"},
    )
