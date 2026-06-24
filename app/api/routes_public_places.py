from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.db import get_session
from app.places.schemas import (
    BulkPlaceCreate,
    BulkPlaceCreateResponse,
    ManualPlaceCreate,
    ManualPlaceResponse,
    ManualPlaceUpdate,
)
from app.services.manual_place_service import (
    create_bulk_manual_places,
    create_manual_place,
    delete_manual_place,
    update_manual_place,
)

router = APIRouter()


@router.post("/places", response_model=ManualPlaceResponse, status_code=status.HTTP_201_CREATED)
def create_place(
    payload: ManualPlaceCreate,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> ManualPlaceResponse:
    return create_manual_place(session, user_id_hash, payload)


@router.post(
    "/places/bulk",
    response_model=BulkPlaceCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_places_bulk(
    payload: BulkPlaceCreate,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> BulkPlaceCreateResponse:
    return create_bulk_manual_places(session, user_id_hash, payload.csv_text)


@router.patch("/places/{place_id}", response_model=ManualPlaceResponse)
def update_place(
    place_id: str,
    payload: ManualPlaceUpdate,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> ManualPlaceResponse:
    place = update_manual_place(session, user_id_hash, place_id, payload)
    if place is None:
        raise HTTPException(status_code=404, detail="Place not found")
    return place


@router.delete("/places/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(
    place_id: str,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    if not delete_manual_place(session, user_id_hash, place_id):
        raise HTTPException(status_code=404, detail="Place not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
