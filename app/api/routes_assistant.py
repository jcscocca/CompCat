from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.assistant.agent import _UNREACHABLE_MESSAGE, run_assistant_turn
from app.assistant.llm_client import (
    AnthropicLlmClient,
    AssistantLlmClient,
    FailoverLlmClient,
    OpenAiLlmClient,
    OpenAiNativeLlmClient,
)
from app.assistant.schemas import (
    AssistantChatRequest,
    AssistantCommandRequest,
    AssistantStreamEvent,
)
from app.assistant.summaries import build_tool_summary
from app.assistant.tools import (
    AssistantClarification,
    AssistantToolError,
    execute_tool,
)
from app.config import Settings, get_settings
from app.db import get_session
from app.ratelimit import get_rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter()


def _no_think_body(disable_thinking: bool) -> dict[str, object] | None:
    """For llama.cpp/llama-swap thinking models (e.g. Qwen), turn off the
    chain-of-thought so the answer lands in ``content`` instead of consuming the
    token budget on ``reasoning_content``."""
    if disable_thinking:
        return {"chat_template_kwargs": {"enable_thinking": False}}
    return None


def _require_anthropic(settings: Settings) -> AnthropicLlmClient:
    if not settings.anthropic_api_key:
        raise ValueError(
            "Assistant LLM provider 'anthropic' requires MCA_ANTHROPIC_API_KEY."
        )
    return AnthropicLlmClient(
        api_key=settings.anthropic_api_key,
        model=settings.anthropic_model,
        disable_thinking=settings.anthropic_disable_thinking,
    )


def _require_openai_native(settings: Settings) -> OpenAiNativeLlmClient:
    if not settings.openai_api_key:
        raise ValueError(
            "Assistant LLM provider 'openai_native' requires MCA_OPENAI_API_KEY."
        )
    return OpenAiNativeLlmClient(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        base_url=settings.openai_base_url,
        send_temperature=settings.openai_send_temperature,
    )


def _build_primary(settings: Settings) -> AssistantLlmClient:
    if settings.llm_provider == "anthropic":
        return _require_anthropic(settings)
    if settings.llm_provider == "openai_native":
        return _require_openai_native(settings)
    return OpenAiLlmClient(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        extra_body=_no_think_body(settings.llm_disable_thinking),
        api_key=settings.llm_api_key,
        include_stream_usage=settings.assistant_token_budget_per_day > 0,
    )


def _build_fallback(settings: Settings) -> AssistantLlmClient | None:
    """The optional failover backend. Key-based backends (anthropic, openai_native) activate
    whenever their key is set; the OpenAI-compatible fallback keeps its original gate — both
    base URL and model configured."""
    provider = settings.llm_fallback_provider
    if provider == "anthropic":
        if settings.anthropic_api_key:
            return _require_anthropic(settings)
        logger.warning(
            "llm_fallback_provider is 'anthropic' but MCA_ANTHROPIC_API_KEY is unset; "
            "assistant failover is disabled."
        )
        return None
    if provider == "openai_native":
        if settings.openai_api_key:
            return _require_openai_native(settings)
        logger.warning(
            "llm_fallback_provider is 'openai_native' but MCA_OPENAI_API_KEY is unset; "
            "assistant failover is disabled."
        )
        return None
    base_url = settings.llm_fallback_base_url.strip()
    model = settings.llm_fallback_model.strip()
    if not (base_url and model):
        return None
    return OpenAiLlmClient(
        base_url=base_url,
        model=model,
        extra_body=_no_think_body(settings.llm_fallback_disable_thinking),
        api_key=settings.effective_llm_fallback_api_key,
        include_stream_usage=settings.assistant_token_budget_per_day > 0,
    )


def build_assistant_llm_client(settings: Settings) -> AssistantLlmClient:
    """Build the assistant LLM client: the primary backend (OpenAI-compatible or Claude),
    wrapped in automatic failover to a second backend when one is configured."""
    primary = _build_primary(settings)
    fallback = _build_fallback(settings)
    if fallback is not None:
        return FailoverLlmClient([primary, fallback])
    return primary


@router.post("/assistant/chat")
async def assistant_chat(
    request: AssistantChatRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> StreamingResponse:
    settings = get_settings()
    if settings.rate_limit_enabled:
        limiter = get_rate_limiter()
        # Per-session bucket first: try_count_global increments on every allowed call,
        # so checking it first would let one over-cap session burn the shared daily
        # budget with 429'd attempts.
        wait = limiter.try_take(
            "assistant",
            user_id_hash,
            capacity=settings.rate_limit_assistant_per_hour,
            per_seconds=3600.0,
        )
        if wait > 0:
            raise HTTPException(
                status_code=429,
                detail="Analyst request limit reached for this session — please retry later.",
                headers={"Retry-After": str(max(1, int(wait)))},
            )
        if not limiter.try_count_global(limit=settings.rate_limit_assistant_global_per_day):
            raise HTTPException(
                status_code=429,
                detail="The demo Analyst has reached its daily capacity — try again tomorrow.",
                headers={"Retry-After": "3600"},
            )
    llm_client = build_assistant_llm_client(settings)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async with contextlib.aclosing(
                run_assistant_turn(
                    session,
                    user_id_hash,
                    request.messages,
                    request.dashboard_state,
                    llm_client,
                )
            ) as stream:
                async for event in stream:
                    yield _sse_event(event)
        except Exception:
            logger.exception("assistant turn failed mid-stream")
            yield _sse_event(
                AssistantStreamEvent(
                    event="error", data={"message": _UNREACHABLE_MESSAGE, "code": "internal"}
                )
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


_COMMAND_FAILED_MESSAGE = "That didn't go through. Try again in a moment."
# AssistantToolError carries deliberate user-facing copy. Any other ValueError reaching
# here is a raw pydantic ValidationError from building the tool's args model, whose str()
# leaks the internal model name, field paths and a pydantic docs URL.
_COMMAND_INVALID_MESSAGE = "That command didn't validate — check the values and try again."


def _is_validation_failure(exc: BaseException) -> bool:
    """execute_tool re-raises a pydantic ValidationError as AssistantToolError(str(exc)),
    keeping the original as __cause__ — so the wrapper's message is the raw pydantic text.
    Deliberately authored AssistantToolError copy has no ValidationError cause and is
    passed through unchanged."""
    return isinstance(exc, ValidationError) or isinstance(exc.__cause__, ValidationError)


@router.post("/assistant/commands")
async def assistant_command(
    request: AssistantCommandRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> StreamingResponse:
    settings = get_settings()
    if settings.rate_limit_enabled:
        limiter = get_rate_limiter()
        wait = limiter.try_take(
            "assistant_commands",
            user_id_hash,
            capacity=settings.rate_limit_assistant_commands_per_hour,
            per_seconds=3600.0,
        )
        if wait > 0:
            raise HTTPException(
                status_code=429,
                detail="Command request limit reached for this session — please retry later.",
                headers={"Retry-After": str(max(1, int(wait)))},
            )
    # No global daily counter here: commands never touch the LLM, and the burst
    # middleware already caps per-IP volume.

    async def event_stream() -> AsyncIterator[str]:
        yield _sse_event(
            AssistantStreamEvent(
                event="meta", data={"mode": "command", "command": request.command}
            )
        )
        try:
            try:
                tool_result = execute_tool(
                    session, user_id_hash, request.command, dict(request.arguments)
                )
            except AssistantClarification as exc:
                yield _sse_event(AssistantStreamEvent(event="token", data={"delta": str(exc)}))
                yield _sse_event(AssistantStreamEvent(event="done", data={}))
                return
            except (AssistantToolError, ValueError) as exc:
                message = str(exc)
                if _is_validation_failure(exc):
                    logger.debug("assistant command failed validation", exc_info=exc)
                    message = _COMMAND_INVALID_MESSAGE
                yield _sse_event(
                    AssistantStreamEvent(
                        event="error", data={"message": message, "code": "tool_error"}
                    )
                )
                return
            yield _sse_event(AssistantStreamEvent(event="tool", data=tool_result))
            yield _sse_event(
                AssistantStreamEvent(
                    event="token", data={"delta": build_tool_summary(tool_result)}
                )
            )
            yield _sse_event(AssistantStreamEvent(event="done", data={}))
        except Exception:
            logger.exception("assistant command failed")
            yield _sse_event(
                AssistantStreamEvent(
                    event="error",
                    data={"message": _COMMAND_FAILED_MESSAGE, "code": "internal"},
                )
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _sse_event(event: AssistantStreamEvent) -> str:
    return f"event: {event.event}\ndata: {json.dumps(event.data, default=str)}\n\n"
