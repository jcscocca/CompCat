from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

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
from app.ratelimit import client_ip_from, get_rate_limiter

logger = logging.getLogger(__name__)

_REQUEST_INVALID_MESSAGE = "That request didn't validate — check the values and try again."


class _AssistantValidationRoute(APIRoute):
    """Keep request-model internals out of both public assistant endpoints."""

    def get_route_handler(self):
        route_handler = super().get_route_handler()

        async def fixed_validation_copy(request: Request):
            try:
                return await route_handler(request)
            except RequestValidationError:
                return JSONResponse(
                    status_code=422,
                    content={"detail": _REQUEST_INVALID_MESSAGE},
                )

        return fixed_validation_copy


router = APIRouter(route_class=_AssistantValidationRoute)


def _no_think_body(disable_thinking: bool) -> dict[str, object] | None:
    """For llama.cpp/llama-swap thinking models (e.g. Qwen), turn off the
    chain-of-thought so the answer lands in ``content`` instead of consuming the
    token budget on ``reasoning_content``."""
    if disable_thinking:
        return {"chat_template_kwargs": {"enable_thinking": False}}
    return None


def _is_groq_gpt_oss(base_url: str, model: str) -> bool:
    """True only for Groq-hosted GPT-OSS, whose request extensions are known."""
    return (
        (urlparse(base_url).hostname or "").lower() == "api.groq.com"
        and model.lower().startswith("openai/gpt-oss-")
    )


def _openai_compatible_options(
    base_url: str,
    model: str,
    disable_thinking: bool,
) -> tuple[dict[str, object] | None, bool, dict[str, object] | None]:
    if _is_groq_gpt_oss(base_url, model):
        # GPT-OSS defaults to medium reasoning. Low is sufficient for Tabby's narration,
        # while hidden keeps reasoning tokens out of user-visible content.
        # Planning gets medium effort separately: choosing and parameterizing a tool is the
        # reasoning-heavy half of the turn.
        return (
            {"reasoning_effort": "low", "reasoning_format": "hidden"},
            True,
            {"reasoning_effort": "medium"},
        )
    return _no_think_body(disable_thinking), False, None


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
    extra_body, supports_structured_output, structured_extra_body = _openai_compatible_options(
        settings.llm_base_url,
        settings.llm_model,
        settings.llm_disable_thinking,
    )
    return OpenAiLlmClient(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        timeout_s=settings.llm_timeout_s,
        extra_body=extra_body,
        api_key=settings.llm_api_key,
        include_stream_usage=settings.assistant_token_budget_per_day > 0,
        supports_structured_output=supports_structured_output,
        structured_extra_body=structured_extra_body,
    )


def _build_slot(
    settings: Settings,
    *,
    provider: str,
    base_url: str,
    model: str,
    api_key: str,
    disable_thinking: bool,
    setting_name: str,
) -> AssistantLlmClient | None:
    """One non-primary slot in the failover chain. Key-based backends (anthropic,
    openai_native) activate whenever their key is set; the OpenAI-compatible backend keeps
    its original gate — both base URL and model configured. An empty provider is the
    explicit "no such slot" case. Returning None simply shortens the chain; it is never
    fatal, because a missing failover leaves the primary serving on its own."""
    if not provider:
        return None
    if provider == "anthropic":
        if settings.anthropic_api_key:
            return _require_anthropic(settings)
        logger.warning(
            "%s is 'anthropic' but MCA_ANTHROPIC_API_KEY is unset; that failover slot "
            "is disabled.",
            setting_name,
        )
        return None
    if provider == "openai_native":
        if settings.openai_api_key:
            return _require_openai_native(settings)
        logger.warning(
            "%s is 'openai_native' but MCA_OPENAI_API_KEY is unset; that failover slot "
            "is disabled.",
            setting_name,
        )
        return None
    base_url = base_url.strip()
    model = model.strip()
    if not (base_url and model):
        return None
    extra_body, supports_structured_output, structured_extra_body = _openai_compatible_options(
        base_url,
        model,
        disable_thinking,
    )
    return OpenAiLlmClient(
        base_url=base_url,
        model=model,
        timeout_s=settings.llm_timeout_s,
        extra_body=extra_body,
        api_key=api_key,
        include_stream_usage=settings.assistant_token_budget_per_day > 0,
        supports_structured_output=supports_structured_output,
        structured_extra_body=structured_extra_body,
    )


def _backend_identity(client: AssistantLlmClient) -> tuple[str, str, str]:
    """What makes two chain entries the same upstream. Anthropic and openai_native clients
    carry no per-slot credentials — they read one shared key family — so class, base URL and
    model fully identify the endpoint a slot would call."""
    return (
        type(client).__name__,
        getattr(client, "base_url", ""),
        getattr(client, "model", ""),
    )


def _failover_chain(settings: Settings) -> list[AssistantLlmClient]:
    """The primary followed by each configured slot, in the order they are tried.

    Duplicates are dropped. The key-based providers share one credential family across every
    slot, so naming the same provider twice resolves to the same endpoint — queuing it behind
    itself would spend a second attempt failing exactly the way the first one did, and on a
    rate-limited backend it would burn the retry budget for no added resilience.
    """
    chain = [_build_primary(settings)]
    for client in (
        _build_slot(
            settings,
            provider=settings.llm_fallback_provider,
            base_url=settings.llm_fallback_base_url,
            model=settings.llm_fallback_model,
            api_key=settings.effective_llm_fallback_api_key,
            disable_thinking=settings.llm_fallback_disable_thinking,
            setting_name="llm_fallback_provider",
        ),
        _build_slot(
            settings,
            provider=settings.llm_third_provider,
            base_url=settings.llm_third_base_url,
            model=settings.llm_third_model,
            api_key=settings.llm_third_api_key,
            disable_thinking=settings.llm_third_disable_thinking,
            setting_name="llm_third_provider",
        ),
    ):
        if client is None:
            continue
        identity = _backend_identity(client)
        if any(identity == _backend_identity(existing) for existing in chain):
            logger.warning(
                "Assistant failover slot resolves to a backend already in the chain (%s); "
                "skipping the duplicate.",
                identity,
            )
            continue
        chain.append(client)
    return chain


def build_assistant_llm_client(settings: Settings) -> AssistantLlmClient:
    """Build the assistant LLM client: the primary backend (OpenAI-compatible or Claude),
    wrapped in automatic failover to each additional backend configured, tried in order.
    A primary with no usable failover slot is returned bare rather than wrapped."""
    chain = _failover_chain(settings)
    if len(chain) == 1:
        return chain[0]
    return FailoverLlmClient(chain)


@router.post("/assistant/chat")
async def assistant_chat(
    request: AssistantChatRequest,
    http_request: Request,
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
        # Per-IP bucket beside it: the per-session tier is reset by simply asking for a new
        # session cookie, so on its own it bounds a conversation rather than a caller. Also
        # checked before the global counter, for the same reason the session bucket is.
        ip_wait = limiter.try_take(
            "assistant_ip",
            client_ip_from(
                http_request,
                trust_proxy_headers=settings.trust_proxy_headers,
                trust_x_forwarded_for=settings.trust_x_forwarded_for,
            ),
            capacity=settings.rate_limit_assistant_per_ip_per_hour,
            per_seconds=3600.0,
        )
        if ip_wait > 0:
            raise HTTPException(
                status_code=429,
                detail="Analyst request limit reached — please retry later.",
                headers={"Retry-After": str(max(1, int(ip_wait)))},
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
                    request.latest_result_context,
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
    """execute_tool re-raises wrapped exceptions as AssistantToolError(str(exc)), keeping
    the original as __cause__ — so the wrapper's message can be raw internal text.
    Pydantic dumps and codec errors are never user-authored copy; service-raised
    ValueErrors ("Unknown layer: ...") are, and keep passing through unchanged."""
    internal = (ValidationError, UnicodeError)
    return isinstance(exc, internal) or isinstance(exc.__cause__, internal)


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
                # execute_tool is fully synchronous — sync DB work, sync httpx, and a
                # geocoder that time.sleep()s to hold its 1 req/s cadence. Awaiting it on
                # the event loop froze the whole process for the duration: one
                # select_places with several address lookups took health checks, static
                # files and every other user's request down with it.
                tool_result = await run_in_threadpool(
                    execute_tool, session, user_id_hash, request.command, dict(request.arguments)
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
