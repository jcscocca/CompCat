from __future__ import annotations

import json

from app.assistant.schemas import AssistantChatMessage, SemanticContextPacket

PLANNING_SYSTEM_PROMPT = """You are Waypoint's reported-incident analyst.
Use only the semantic context and approved tool results.
Do not label places safe or unsafe.
Do not produce personal safety scores.
Do not treat expected visits as a risk denominator.
Say when data is missing, stale, filtered, or insufficient.
During planning, return only JSON:
{"type":"final","message":"..."} or
{"type":"tool_call","tool_name":"...","arguments":{...}}."""


def build_planning_messages(
    messages: list[AssistantChatMessage],
    context: SemanticContextPacket,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Semantic context packet:\n"
                f"{json.dumps(context.model_dump(mode='json'), indent=2)}"
            ),
        },
        *[message.model_dump() for message in messages[-8:]],
    ]


def build_narration_messages(
    messages: list[AssistantChatMessage],
    context: SemanticContextPacket,
    tool_result: dict,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Narrate this tool result for the user using reported-incident "
                "language and concrete counts. Return JSON only as "
                '{"type":"final","message":"..."}.\n\n'
                "Semantic context packet:\n"
                f"{json.dumps(context.model_dump(mode='json'), indent=2)}\n\n"
                "Tool result:\n"
                f"{json.dumps(tool_result, indent=2, default=str)}"
            ),
        },
        *[message.model_dump() for message in messages[-8:]],
    ]

