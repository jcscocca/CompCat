from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import current_user_hash
from app.db import get_session
from app.routing.place_resolver import UnknownRoutePlaceError
from app.routing.providers import RoutingProviderError, UnsupportedRoutingProviderError
from app.routing.schemas import RouteRequestCreate
from app.services.route_service import (
    create_route_alternatives,
    get_route_comparison,
)

router = APIRouter()


@router.post("/internal/routes/alternatives", include_in_schema=False)
def alternatives(
    request: RouteRequestCreate,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return create_route_alternatives(session, request, user_id_hash)
    except (UnknownRoutePlaceError, UnsupportedRoutingProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RoutingProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/internal/routes/requests/{request_id}/comparison", include_in_schema=False)
def comparison(
    request_id: str,
    user_id_hash: Annotated[str, Depends(current_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = get_route_comparison(session, request_id, user_id_hash)
    if payload is None:
        raise HTTPException(status_code=404, detail="Route request not found")
    return payload
