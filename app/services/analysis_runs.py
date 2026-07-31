from __future__ import annotations

import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AnalysisRun


def create_analysis_run(
    session: Session,
    *,
    user_id_hash: str,
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    place_ids: list[str] | None = None,
    layer: str | None = None,
) -> AnalysisRun:
    run = AnalysisRun(
        user_id_hash=user_id_hash,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        radii_m_json=json.dumps(sorted(radii_m)),
        place_ids_json=json.dumps(list(dict.fromkeys(place_ids)))
        if place_ids is not None
        else None,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        layer=layer,
    )
    session.add(run)
    session.flush()  # populate run.id within the caller's transaction
    return run


def latest_analysis_run_id(session: Session, user_id_hash: str) -> str | None:
    return session.scalar(
        select(AnalysisRun.id)
        .where(AnalysisRun.user_id_hash == user_id_hash)
        .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
    )
