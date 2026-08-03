from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.db import get_session
from app.reports.profiles import all_report_profiles
from app.reports.schemas import (
    AnalysisReport,
    AnalysisReportRequest,
    DeleteReportsResponse,
    ReportLayerProfile,
)
from app.reports.service import (
    ReportCoverageAdjustmentRequiredError,
    ReportCoverageUnavailableError,
    ReportNotFoundError,
    ReportPrivacyBlockedError,
    create_analysis_report,
    delete_all_analysis_reports,
    delete_analysis_report,
    get_analysis_report,
)

router = APIRouter()


@router.get("/dashboard/report-profiles", response_model=list[ReportLayerProfile])
def dashboard_report_profiles(
    _user_id_hash: Annotated[str, Depends(required_public_user_hash)],
) -> list[ReportLayerProfile]:
    return all_report_profiles()


@router.post("/dashboard/reports", response_model=AnalysisReport)
def create_dashboard_report(
    request: AnalysisReportRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> AnalysisReport:
    try:
        return create_analysis_report(
            session,
            user_id_hash=user_id_hash,
            request=request,
        )
    except ReportCoverageAdjustmentRequiredError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "date_coverage_adjustment_required",
                "message": str(exc),
                "requested_start_date": exc.requested_start.isoformat(),
                "requested_end_date": exc.requested_end.isoformat(),
                "available_start_date": exc.available_start.isoformat(),
            },
        ) from exc
    except ReportCoverageUnavailableError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "date_range_unavailable", "message": str(exc)},
        ) from exc
    except ReportPrivacyBlockedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/dashboard/reports/{report_id}", response_model=AnalysisReport)
def get_dashboard_report(
    report_id: str,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> AnalysisReport:
    try:
        return get_analysis_report(
            session,
            user_id_hash=user_id_hash,
            report_id=report_id,
        )
    except ReportNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Report not found.") from exc
    except ReportPrivacyBlockedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/dashboard/reports/{report_id}", status_code=204)
def delete_dashboard_report(
    report_id: str,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    try:
        delete_analysis_report(
            session,
            user_id_hash=user_id_hash,
            report_id=report_id,
        )
    except ReportNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Report not found.") from exc
    return Response(status_code=204)


@router.delete("/dashboard/reports", response_model=DeleteReportsResponse)
def delete_all_dashboard_reports(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> DeleteReportsResponse:
    return delete_all_analysis_reports(session, user_id_hash=user_id_hash)
