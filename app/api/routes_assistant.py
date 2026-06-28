from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.assistant.agent import run_assistant_turn
from app.assistant.llm_client import (
    AssistantLlmClient,
    FailoverLlmClient,
    OpenAiLlmClient,
)
from app.assistant.schemas import AssistantChatRequest, AssistantStreamEvent
from app.config import Settings, get_settings
from app.db import get_session

router = APIRouter()


def _no_think_body(disable_thinking: bool) -> dict[str, object] | None:
    """For llama.cpp/llama-swap thinking models (e.g. Qwen), turn off the
    chain-of-thought so the answer lands in ``content`` instead of consuming the
    token budget on ``reasoning_content``."""
    if disable_thinking:
        return {"chat_template_kwargs": {"enable_thinking": False}}
    return None


def build_assistant_llm_client(settings: Settings) -> AssistantLlmClient:
    """Build the assistant LLM client: the primary endpoint, wrapped in
    automatic failover to a second node when both fallback values are set."""
    primary = OpenAiLlmClient(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        extra_body=_no_think_body(settings.llm_disable_thinking),
    )
    fallback_base_url = settings.llm_fallback_base_url.strip()
    fallback_model = settings.llm_fallback_model.strip()
    if fallback_base_url and fallback_model:
        fallback = OpenAiLlmClient(
            base_url=fallback_base_url,
            model=fallback_model,
            extra_body=_no_think_body(settings.llm_fallback_disable_thinking),
        )
        return FailoverLlmClient([primary, fallback])
    return primary


@router.post("/assistant/chat")
async def assistant_chat(
    request: AssistantChatRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> StreamingResponse:
    llm_client = build_assistant_llm_client(get_settings())

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
