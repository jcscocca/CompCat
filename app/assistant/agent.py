from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.orm import Session

from app.assistant.localagent_client import AssistantLlmClient, LocalAgentUnavailable
from app.assistant.prompts import build_followup_messages, build_planning_messages
from app.assistant.schemas import (
    AssistantChatMessage,
    AssistantDashboardState,
    AssistantStreamEvent,
)
from app.assistant.semantic_layer import build_semantic_context
from app.assistant.tools import AssistantToolError, execute_tool
from app.config import get_settings

SAFE_UNSAFE_TERMS = ("safest", "least safe", "unsafe", "safe?")


async def run_assistant_turn(
    session: Session,
    user_id_hash: str,
    messages: list[AssistantChatMessage],
    dashboard_state: AssistantDashboardState,
    llm_client: AssistantLlmClient,
) -> AsyncIterator[AssistantStreamEvent]:
    settings = get_settings()
    context = build_semantic_context(session, user_id_hash, dashboard_state, settings)
    yield AssistantStreamEvent(
        event="meta",
        data={"role": settings.assistant_role, "missing_context": context.missing_context},
    )

    latest_user = _latest_user_text(messages)
    if _asks_for_safety_score(latest_user):
        yield AssistantStreamEvent(
            event="token",
            data={
                "delta": (
                    "I can discuss reported incident context, but I cannot label "
                    "places safe or unsafe or produce a personal safety score."
                )
            },
        )
        yield AssistantStreamEvent(event="done", data={})
        return

    try:
        raw_plan = await llm_client.complete(
            build_planning_messages(messages, context),
            role=settings.assistant_role,
            temperature=0.2,
            max_tokens=1024,
        )
        plan = _parse_model_json(raw_plan)
        max_tool_calls = max(1, settings.assistant_max_tool_calls)
        tool_results: list[dict[str, Any]] = []
        tool_calls = 0
        while plan.get("type") == "tool_call" and tool_calls < max_tool_calls:
            tool_result = execute_tool(
                session,
                user_id_hash,
                str(plan.get("tool_name")),
                dict(plan.get("arguments") or {}),
            )
            yield AssistantStreamEvent(event="tool", data=tool_result)
            tool_results.append(tool_result)
            tool_calls += 1
            raw_next = await llm_client.complete(
                build_followup_messages(
                    messages,
                    context,
                    tool_results,
                    force_final=tool_calls >= max_tool_calls,
                ),
                role=settings.assistant_role,
                temperature=0.2,
                max_tokens=1024,
            )
            plan = _parse_model_json(raw_next)
        message = _final_message(plan)
        yield AssistantStreamEvent(event="token", data={"delta": message})
        yield AssistantStreamEvent(event="done", data={})
    except (AssistantToolError, LocalAgentUnavailable, ValueError) as exc:
        yield AssistantStreamEvent(event="error", data={"message": str(exc)})


def _latest_user_text(messages: list[AssistantChatMessage]) -> str:
    for message in reversed(messages):
        if message.role == "user":
            return message.content
    return ""


def _asks_for_safety_score(text: str) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in SAFE_UNSAFE_TERMS)


def _parse_model_json(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("The local model returned an invalid assistant plan.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("The local model returned an invalid assistant plan.")
    return parsed


def _final_message(plan: dict[str, Any]) -> str:
    if plan.get("type") != "final":
        raise ValueError("The local model did not return a final assistant answer.")
    message = plan.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ValueError("The local model returned an empty assistant answer.")
    return message.strip()

