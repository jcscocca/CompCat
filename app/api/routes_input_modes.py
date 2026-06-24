from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.input_modes import supported_input_modes

router = APIRouter()


@router.get("/input-modes")
def input_modes() -> dict[str, object]:
    settings = get_settings()
    return {"modes": supported_input_modes(settings.public_enable_personal_uploads)}
