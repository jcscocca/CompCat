from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash, required_public_user_hash
from app.db import get_session
from app.services.place_service import list_places

router = APIRouter()


@router.get("/places")
def places(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    include_sensitive: bool = False,
) -> dict[str, object]:
    return _places_payload(session, user_id_hash, include_sensitive=include_sensitive)


@router.get("/internal/places", include_in_schema=False)
def internal_places(
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    include_sensitive: bool = False,
) -> dict[str, object]:
    return _places_payload(session, user_id_hash, include_sensitive=include_sensitive)


def _places_payload(
    session: Session,
    user_id_hash: str,
    *,
    include_sensitive: bool,
) -> dict[str, object]:
    rows = list_places(session, user_id_hash, include_sensitive=include_sensitive)
    return {
        "count": len(rows),
        "places": [
            {
                "id": row.id,
                "display_label": row.display_label,
                "latitude": row.display_latitude,
                "longitude": row.display_longitude,
                "visit_count": row.visit_count,
                "total_dwell_minutes": row.total_dwell_minutes,
                "inferred_place_type": row.inferred_place_type,
                "sensitivity_class": row.sensitivity_class,
            }
            for row in rows
        ],
    }
