from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.assistant.agent import run_assistant_turn
from app.assistant.localagent_client import LocalAgentClient
from app.assistant.schemas import AssistantChatRequest, AssistantStreamEvent
from app.config import get_settings
from app.db import get_session

router = APIRouter()


@router.post("/assistant/chat")
async def assistant_chat(
    request: AssistantChatRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> StreamingResponse:
    settings = get_settings()
    llm_client = LocalAgentClient(settings.localagent_base_url)

    async def event_stream() -> AsyncIterator[str]:
        async for event in run_assistant_turn(
            session,
            user_id_hash,
            request.messages,
            request.dashboard_state,
            llm_client,
        ):
            yield _sse_event(event)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _sse_event(event: AssistantStreamEvent) -> str:
    return f"event: {event.event}\ndata: {json.dumps(event.data, default=str)}\n\n"

