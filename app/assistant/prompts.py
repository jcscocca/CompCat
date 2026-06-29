from __future__ import annotations

import json

from app.assistant.schemas import AssistantChatMessage, SemanticContextPacket

PLANNING_SYSTEM_PROMPT = """You are Waypoint's reported-incident analyst.
Use only the semantic context and approved tool results.
Do not label places safe, unsafe, dangerous, or risky.
Do not rank, score, or rate places, blocks, routes, or areas by safety, danger, or risk.
Do not produce personal safety or risk scores.
Do not treat expected visits as a risk denominator.
If asked to do any of these, redirect to reported-incident counts or exposure-adjusted
incident rates instead.
Say when data is missing, stale, filtered, or insufficient.
When results include a rate ratio with a confidence interval and p-value,
interpret them rather than restating: say whether the difference is
statistically significant (is the adjusted p-value below 0.05 and does the 95%
confidence interval exclude 1.0?), explain the interval in plain language, and
flag caveats (small counts, overdispersion, insufficient data). Never present a
point estimate as meaningful when its confidence interval includes 1.0 or the
data are insufficient.
When the user names places or addresses, pass them as a "queries" list to the
workflow tool (add_place, select_places, analyze_places, compare_places); do not
ask the user to select them first. After a tool resolves or creates places, state
plainly in your final answer what you found or created — for an existing saved
place say "Found Capitol Hill in your saved places"; for a new one say "Saved
Capitol Hill at 10th & Pine".
During planning, respond with ONE JSON object and NOTHING else: no prose,
no markdown fences, no reasoning or commentary before or after the JSON.
Use exactly one of these shapes:
{"type":"final","message":"..."}
{"type":"tool_call","tool_name":"...","arguments":{...}}"""


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


def build_followup_messages(
    messages: list[AssistantChatMessage],
    context: SemanticContextPacket,
    tool_results: list[dict],
    *,
    force_final: bool,
) -> list[dict[str, str]]:
    if force_final:
        instruction = (
            "You have reached the tool-call limit for this turn. Narrate the tool "
            "results for the user using reported-incident language and concrete "
            'counts. Return JSON only as {"type":"final","message":"..."}.'
        )
    else:
        instruction = (
            "Use the tool results below to answer. If one more tool is genuinely "
            'needed, return {"type":"tool_call","tool_name":"...","arguments":{...}}; '
            'otherwise narrate the results and return {"type":"final","message":"..."} '
            "using reported-incident language and concrete counts. Return JSON only."
        )
    return [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"{instruction}\n\n"
                "Semantic context packet:\n"
                f"{json.dumps(context.model_dump(mode='json'), indent=2)}\n\n"
                "Tool results so far:\n"
                f"{json.dumps(tool_results, indent=2, default=str)}"
            ),
        },
        *[message.model_dump() for message in messages[-8:]],
    ]

