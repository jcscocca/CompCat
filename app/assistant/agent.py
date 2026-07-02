from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Iterable
from typing import Any

from sqlalchemy.orm import Session

from app.assistant.llm_client import AssistantLlmClient, LlmUnavailable
from app.assistant.prompts import build_planning_messages
from app.assistant.schemas import (
    AssistantChatMessage,
    AssistantDashboardState,
    AssistantStreamEvent,
)
from app.assistant.semantic_layer import build_semantic_context
from app.assistant.summaries import build_tool_summary
from app.assistant.tools import AssistantClarification, AssistantToolError, execute_tool
from app.config import get_settings

# Reject requests that ask the assistant to score/rank places by safety, danger, or risk —
# the product invariant forbids it. The guard is split into three cooperating patterns:
#   1. _UNAMBIGUOUS_SAFETY_PATTERN — terms that alone signal a safety-ranking ask (safe,
#      dangerous, seguridad, peligroso, "crime-free", the rank/rate/score verb arms, the
#      "mal + place-noun" compound, ...). A hit here trips the guard on its own.
#   2. _AMBIGUOUS_TERM_PATTERN — colloquial/adjectival terms that ALSO have benign senses
#      ("sketchy" as a proper noun; "seguro" as "I'm sure"; "tranquilo" as "calm"). These
#      only trip if _PLACE_CONTEXT_PATTERN also matches the same message.
#   3. _PLACE_CONTEXT_PATTERN — deictics + place nouns in English and Spanish.
# Event/offense descriptors ("violent", "threatening", "menacing") are deliberately excluded
# — they are legitimate incident context, not place-ranking words. Word-boundary matching
# keeps legitimate substrings ("safely", "Safeway", "incident rate") and allowed count
# framing ("which area has the most crime") from false-triggering. The guard runs on BOTH
# the incoming user text and the model's final answer (see run_assistant_turn).
_UNAMBIGUOUS_SAFETY_PATTERN = re.compile(
    r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|hazard(?:ous)?|peril(?:ous)?"
    r"|risk(?:y|ier|iest)?)\b"
    r"|\bcrime[-\s]free\b"
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*)[\s,:;\-—]+"
    r"(?:(?:the|these|those|this|that|them|my|your|our|their|its|his|her|a|an|all|both"
    r"|any|some|each|every)\s+)*"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b"
    r"|\b(?:seguridad(?:es)?|inseguridad(?:es)?"
    r"|peligros(?:[oa]s?|idad(?:es)?)|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
    r"|\blibre\s+de\s+crimen\b"
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*[\s,:;\-—]+"
    r"(?:(?:el|la|los|las|este|esta|estos|estas|ese|esa|esos|esas|mi|mis|tu|tus|su|sus"
    r"|un|una|unos|unas|todo|toda|todos|todas|cada)\s+)*"
    r"(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b"
    r"|\b(?:mal|mala|mal[oa]s)\s+"
    r"(?:(?:barrio|zona|vecindario|colonia)s?|(?:lugar|sector)(?:es)?)\b"
    r"|\b(?:(?:barrio|zona|vecindario|colonia)s?|(?:lugar|sector)(?:es)?)\s+mal[oa]s?\b",
    re.IGNORECASE,
)

_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?|avoid(?:s|ed|ing)?|evit\w*)\b",
    re.IGNORECASE,
)

_PLACE_CONTEXT_PATTERN = re.compile(
    r"\b(?:here|there|around|this|that|these|those|area|block"
    r"|neighbou?rhood|route|street|spot|option|location|place|corner"
    r"|downtown|uptown|part\s+of\s+town|side\s+of\s+town)s?\b"
    r"|\b(?:aqu[ií]|all[ií]|all[aá]|ac[aá])\b"
    r"|\b(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida|centro|esquina)s?"
    r"|ubicaci[oó]n(?:es)?)\b",
    re.IGNORECASE,
)

# Back-compat alias — downstream imports (and the output-guard test) still work.
_SAFETY_SCORE_PATTERN = _UNAMBIGUOUS_SAFETY_PATTERN

# Single source for the refusal/redirect text, reused by the input- and output-side guards.
_SAFETY_REDIRECT = (
    "I can discuss reported incident context, but I can't label places safe or unsafe, rank "
    "them by safety, danger, or risk, or produce a personal safety score. I can instead order "
    "places by reported incident count or compare exposure-adjusted incident rates — just ask "
    "it that way."
)
SELECTION_TOOLS = (
    "run_place_analysis",
    "compare_places",
    "get_neighborhood_analysis",
    "get_incident_details",
    "analyze_places",
)
_UNREACHABLE_MESSAGE = (
    "Couldn't reach the analyst to interpret your request. The rest of Waypoint still works."
)


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

    if _asks_for_safety_score(_recent_user_texts(messages)):
        yield AssistantStreamEvent(event="token", data={"delta": _SAFETY_REDIRECT})
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
    except LlmUnavailable:
        yield AssistantStreamEvent(event="error", data={"message": _UNREACHABLE_MESSAGE})
        return
    except ValueError as exc:
        yield AssistantStreamEvent(event="error", data={"message": str(exc)})
        return

    if plan.get("type") == "tool_call":
        tool_name = str(plan.get("tool_name"))
        try:
            tool_result = execute_tool(
                session,
                user_id_hash,
                tool_name,
                _tool_arguments(tool_name, dashboard_state, plan.get("arguments")),
            )
        except AssistantClarification as exc:
            yield AssistantStreamEvent(event="token", data={"delta": str(exc)})
            yield AssistantStreamEvent(event="done", data={})
            return
        except (AssistantToolError, ValueError) as exc:
            yield AssistantStreamEvent(event="error", data={"message": str(exc)})
            return
        yield AssistantStreamEvent(event="tool", data=tool_result)
        yield AssistantStreamEvent(event="token", data={"delta": build_tool_summary(tool_result)})
        yield AssistantStreamEvent(event="done", data={})
        return

    try:
        message = _final_message(plan)
    except ValueError as exc:
        yield AssistantStreamEvent(event="error", data={"message": str(exc)})
        return
    # Output-side invariant guard: a model answer that slipped past the input guard must not
    # stream safety-ranking language; replace it with the standard redirect.
    if _contains_safety_ranking(message):
        message = _SAFETY_REDIRECT
    yield AssistantStreamEvent(event="token", data={"delta": message})
    yield AssistantStreamEvent(event="done", data={})


def _recent_user_texts(
    messages: list[AssistantChatMessage], limit: int = 8
) -> list[str]:
    # Scan the recent user turns the model can actually see (prompts.py sends
    # messages[-8:]), not just the newest one, so a safety-score request split across
    # turns or carried by a short "yes, do that" follow-up still trips the guard.
    return [message.content for message in messages[-limit:] if message.role == "user"]


def _asks_for_safety_score(texts: Iterable[str]) -> bool:
    return any(_contains_safety_ranking(text) for text in texts)


def _contains_safety_ranking(text: str) -> bool:
    if _UNAMBIGUOUS_SAFETY_PATTERN.search(text):
        return True
    return bool(
        _AMBIGUOUS_TERM_PATTERN.search(text)
        and _PLACE_CONTEXT_PATTERN.search(text)
    )


def _tool_arguments(
    tool_name: str,
    dashboard_state: AssistantDashboardState,
    model_arguments: Any,
) -> dict[str, Any]:
    """Backfill selection-tool arguments from the dashboard state.

    Small local models routinely emit a ``tool_call`` with empty ``arguments``.
    The agent already holds the authoritative selection (places, radius, dates),
    so we inject it and let any model-provided values override.
    """
    raw_arguments = model_arguments if isinstance(model_arguments, dict) else {}
    arguments = {
        key: value
        for key, value in raw_arguments.items()
        if value not in (None, "", [])
    }
    if tool_name not in SELECTION_TOOLS:
        return arguments

    defaults: dict[str, Any] = {
        "place_ids": list(dashboard_state.selected_place_ids),
        "analysis_start_date": (
            dashboard_state.analysis_start_date.isoformat()
            if dashboard_state.analysis_start_date
            else None
        ),
        "analysis_end_date": (
            dashboard_state.analysis_end_date.isoformat()
            if dashboard_state.analysis_end_date
            else None
        ),
        "offense_category": dashboard_state.offense_category,
        "offense_subcategory": dashboard_state.offense_subcategory,
        "nibrs_group": dashboard_state.nibrs_group,
        "layer": dashboard_state.layer,
    }
    if tool_name == "compare_places":
        defaults["radius_m"] = dashboard_state.radii_m[0] if dashboard_state.radii_m else None
    else:
        # AssistantDashboardState allows duplicate radii; the request schema requires them
        # unique, so dedupe (order-preserving) before backfilling.
        defaults["radii_m"] = list(dict.fromkeys(dashboard_state.radii_m))

    merged = {key: value for key, value in defaults.items() if value not in (None, "", [])}
    merged.update(arguments)
    return merged


def _parse_model_json(raw: str) -> dict[str, Any]:
    for candidate in _json_candidates(raw.strip()):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("The local model returned an invalid assistant plan.")


def _json_candidates(text: str) -> list[str]:
    candidates = [text]
    fenced = _strip_code_fence(text)
    if fenced != text:
        candidates.append(fenced)
    extracted = _extract_first_json_object(fenced)
    if extracted is not None and extracted not in candidates:
        candidates.append(extracted)
    return candidates


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _final_message(plan: dict[str, Any]) -> str:
    if plan.get("type") != "final":
        raise ValueError("The local model did not return a final assistant answer.")
    message = plan.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ValueError("The local model returned an empty assistant answer.")
    return message.strip()

